"""Hour-by-hour farm simulation with memory.

Pure and deterministic: the same inputs and seed give the same result.

Each hour: world (with the user's overrides valid at that hour) → base weather (seeded)
→ weather events → per-plot protection and farmer measures → water balance → injuries.
At the end of each report day: development, growth, recovery and a record for the UI.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace

from app.biology.growth import CropParams
from app.biology.morphology import Morphology, stage_of
from app.sim.actions import Action, measures_at
from app.sim.data import soil_types
from app.sim.environment.base_climate import HourEnv, WorldClimate, base_hour
from app.sim.environment.compose import PlotEffects, plot_env
from app.sim.environment.events import EVENT_TYPES, Event, apply_event, envelope
from app.sim.environment.overrides import OverrideChange, WorldTimeline
from app.sim.plant.damage import daily_recovery, hourly_damage
from app.sim.plant.growth import DaySoil, grow_one_day, plant_day_record, yield_g
from app.sim.plant.phenology import sensitivity
from app.sim.plant.state import DayAccumulator, PlotState
from app.sim.plant.water import Bucket, ks, step_water

PROTECTIONS = ("open", "greenhouse", "closed")
TAIL_DAYS = 2

# Causes that kill the tops but leave formed tubers/roots in the soil harvestable.
ABOVEGROUND_DEATHS = frozenset({"frost", "heat", "injury"})


def _salvage(st: PlotState, morph: Morphology, cause: str) -> float:
    if morph.harvest_organ in ("tuber", "root") and cause in ABOVEGROUND_DEATHS:
        return yield_g(st, morph)
    return 0.0


DEATH_RU = {
    "frost": "мороз",
    "heat": "перегрев",
    "drought": "засуха: растение засохло",
    "darkness": "долгая темнота",
    "roots": "гибель корней от переувлажнения",
    "injury": "накопленные повреждения",
    "pressure": "слишком низкое давление",
    "o2": "нехватка кислорода",
    "co2": "непригодный CO₂",
    "soil": "непригодный грунт",
    "gravity": "гравитация",
    "uv": "ультрафиолет",
    "ionising": "радиация",
    "spectrum": "спектр",
}

STRESS_RU = {
    "frost": "Заморозок",
    "heat": "Жара",
    "heat_flowering": "Жара во время цветения",
    "drought": "Нехватка воды",
    "waterlog": "Переувлажнение",
    "wind": "Сильный ветер",
    "hail": "Град",
    "uv": "Ультрафиолет",
    "radiation": "Радиация",
    "warm_nights": "Тёплые ночи мешают клубням",
}


@dataclass(frozen=True, slots=True)
class PlotSpec:
    id: str
    crop_id: str
    protection: str = "open"
    irrigation: str = "rain"  # rain | auto


@dataclass(frozen=True, slots=True)
class SimScenario:
    world: WorldClimate
    plots: tuple[PlotSpec, ...]
    seed: int = 42
    duration_days: int = 120
    overrides: tuple[OverrideChange, ...] = ()
    events: tuple[Event, ...] = ()
    actions: tuple[Action, ...] = ()


@dataclass(frozen=True, slots=True)
class CropBook:
    params: dict[str, CropParams]
    morph: dict[str, Morphology]


@dataclass(slots=True)
class SimResult:
    report_day_hours: float
    days: int
    hours: int
    env_hours: list[list[float]]  # [temp, rh, precip, ppfd, wind, uv, hail, flood]
    env_days: list[dict[str, float]]
    plots: dict[str, list[dict[str, object]]]
    log: list[dict[str, object]]
    summary: dict[str, dict[str, object]]
    world: WorldClimate
    notes: list[str] = field(default_factory=list)


ENV_FIELDS = ("temp_c", "rh", "precip_mm", "ppfd", "wind_ms", "uv_rel", "hail", "flood")


def _env_row(env: HourEnv) -> list[float]:
    return [
        round(env.temp_c, 3),
        round(env.rh, 3),
        round(env.precip_mm, 3),
        round(env.ppfd, 2),
        round(env.wind_ms, 2),
        round(env.uv_rel, 3),
        round(env.hail, 3),
        1.0 if env.flood else 0.0,
    ]


def _bucket(world: WorldClimate, protection: str) -> Bucket:
    soils = soil_types()
    if protection == "closed":
        return Bucket.of(soils["hydroponic"])
    return Bucket.of(soils.get(world.soil, soils["loam"]))


def _day_soil(
    world: WorldClimate, protection: str, fertilized: bool, water_possible: bool
) -> DaySoil:
    nutrients = world.nutrients
    if fertilized:
        nutrients = {"low": "norm", "norm": "high"}.get(nutrients, nutrients)
    if protection == "closed":
        return DaySoil("hydroponic", None, "high", 0.5, 0.0, True)
    if protection == "greenhouse" and world.soil == "regolith":
        # Inside the dome regolith is washed and amended: nutrients at least normal.
        nutrients = "norm" if nutrients == "low" else nutrients
        # Regolith is washed of perchlorates inside the dome (about 1 % left).
        return DaySoil(
            "treated_regolith",
            world.ph,
            nutrients,
            world.salinity_ds_m,
            world.perchlorate_wt_pct * 0.01,
            True,
        )
    return DaySoil(
        world.soil,
        world.ph,
        nutrients,
        world.salinity_ds_m,
        world.perchlorate_wt_pct,
        water_possible,
    )


def _new_plot(spec: PlotSpec, bucket: Bucket, day: int) -> PlotState:
    st = PlotState(
        plot_id=spec.id,
        crop_id=spec.crop_id,
        protection=spec.protection,
        irrigation=spec.irrigation,
    )
    st.water_mm = bucket.fc
    st.planted_day = day
    return st


def run(sc: SimScenario, book: CropBook) -> SimResult:
    timeline = WorldTimeline(sc.world, list(sc.overrides))
    world0 = sc.world
    rd_hours = world0.report_day_hours
    total_hours = math.ceil(sc.duration_days * rd_hours)
    step_days = rd_hours / 24.0
    events = sorted(sc.events, key=lambda e: (e.start_hour, e.type, e.id))
    actions = tuple(sorted(sc.actions, key=lambda a: (a.hour, a.type, a.plot or "")))

    plots = {p.id: _new_plot(p, _bucket(world0, p.protection), 0) for p in sc.plots}
    specs = {p.id: p for p in sc.plots}
    records: dict[str, list[dict[str, object]]] = {p.id: [] for p in sc.plots}
    log: list[dict[str, object]] = []
    env_hours: list[list[float]] = []
    env_days: list[dict[str, float]] = []
    started: set[str] = set()
    ended: set[str] = set()
    done_actions: set[int] = set()

    day = 0
    day_env: list[HourEnv] = []
    end_after: int | None = None

    for hour in range(total_hours):
        world = timeline.at(hour)
        env = base_hour(world, hour, sc.seed)
        # Events.
        failure = False
        for i, ev in enumerate(events):
            w = envelope(ev, hour)
            key = ev.id or f"{ev.type}-{i}"
            if w > 0 and key not in started:
                started.add(key)
                log.append(
                    {
                        "day": day,
                        "hour": hour,
                        "plot": None,
                        "type": "event_start",
                        "event": ev.type,
                        "message": f"{EVENT_TYPES[ev.type].name_ru}: началось.",
                    }
                )
            if w <= 0 and key in started and key not in ended and hour + 0.5 >= ev.end_hour:
                ended.add(key)
                log.append(
                    {
                        "day": day,
                        "hour": hour,
                        "plot": None,
                        "type": "event_end",
                        "event": ev.type,
                        "message": f"{EVENT_TYPES[ev.type].name_ru}: закончилось.",
                    }
                )
            if w <= 0:
                continue
            if ev.type == "greenhouse_failure":
                failure = failure or w > 0.5
            else:
                apply_event(env, ev, w, world.day_hours, world.temp_night_c)
        env_hours.append(_env_row(env))
        day_env.append(env)

        # Instant actions (irrigation, harvest, re-sowing) at this hour.
        for ai, a in enumerate(actions):
            if ai in done_actions or a.hour > hour + 0.5:
                continue
            done_actions.add(ai)
            for pid, st in plots.items():
                if not a.applies_to(pid):
                    continue
                if a.type == "irrigate" and st.alive and not st.harvested:
                    before = st.water_mm
                    st.water_mm = min(_bucket(world, st.protection).sat, st.water_mm + a.amount())
                    st.water_used_mm += st.water_mm - before
                    log.append(
                        {
                            "day": day,
                            "hour": hour,
                            "plot": pid,
                            "type": "action",
                            "event": "irrigate",
                            "message": f"Полив {a.amount():.0f} мм.",
                        }
                    )
                elif a.type == "harvest" and st.alive and not st.harvested:
                    st.harvested = True
                    st.harvest_day = day
                    log.append(
                        {
                            "day": day,
                            "hour": hour,
                            "plot": pid,
                            "type": "harvest",
                            "event": "harvest",
                            "message": "Урожай собран досрочно.",
                        }
                    )
                elif a.type == "replant":
                    crop_id = str(a.params.get("crop", st.crop_id))
                    specs[pid] = replace(specs[pid], crop_id=crop_id)
                    plots[pid] = _new_plot(specs[pid], _bucket(world, st.protection), day)
                    log.append(
                        {
                            "day": day,
                            "hour": hour,
                            "plot": pid,
                            "type": "action",
                            "event": "replant",
                            "message": "Пересев.",
                        }
                    )
                elif a.type in ("fertilize", "mulch", "frost_cover", "shade", "drain", "stake"):
                    log.append(
                        {
                            "day": day,
                            "hour": hour,
                            "plot": pid,
                            "type": "action",
                            "event": a.type,
                            "message": "Действие фермера.",
                        }
                    )

        # Hour for every plot.
        for pid, st in plots.items():
            spec = specs[pid]
            crop = book.params[spec.crop_id]
            morph = book.morph[spec.crop_id]
            m = measures_at(actions, pid, hour, rd_hours)
            penv = plot_env(
                env,
                spec.protection,
                crop,
                failure,
                PlotEffects(frost_cover=m.frost_cover, shade=m.shade),
            )
            acc = st.day
            acc.hours += 1
            acc.temps.append(penv.temp_c)
            acc.ppfd_sum += penv.ppfd
            if penv.lit > 0:
                acc.lit_hours += penv.lit
            if penv.lit < 0.5:
                acc.night_temps.append(penv.temp_c)
            acc.far_red_sum += penv.far_red
            acc.co2_sum += penv.co2_ppm
            acc.o2_sum += penv.o2_kpa
            acc.pressure_sum += penv.pressure_kpa
            acc.radiation_sum += penv.radiation_msv_yr
            acc.uv_max = max(acc.uv_max, penv.uv_rel)
            acc.gravity = penv.gravity_g
            acc.precip += penv.precip_mm
            acc.wind_max = max(acc.wind_max, penv.wind_ms)
            if not st.alive or st.harvested:
                continue
            bucket = _bucket(world, spec.protection)
            auto = spec.irrigation == "auto" or (spec.protection != "open" and not failure)
            water_possible = (
                world.water_available
                or spec.protection != "open"
                or (failure is False and spec.protection != "open")
            )
            lai = 0.0
            if records[pid]:
                lai = float(records[pid][-1]["leafAreaIndex"])  # type: ignore[arg-type]
            if water_possible or auto:
                st.water_mm, added = step_water(
                    st.water_mm, bucket, penv, lai, auto, m.mulch, m.drained, world.groundwater_m
                )
                st.water_used_mm += added
            sens = sensitivity(spec.crop_id, st.progress, morph)
            cause = hourly_damage(st, penv, crop, morph, sens, bucket, m.staked)
            if cause:
                st.salvage_g = _salvage(st, morph, cause)
                st.alive = False
                st.death_cause = cause
                st.death_day = day
                log.append(
                    {
                        "day": day,
                        "hour": hour,
                        "plot": pid,
                        "type": "death",
                        "event": cause,
                        "message": f"Растение погибло: {DEATH_RU.get(cause, cause)}.",
                    }
                )

        # End of a report day.
        if int((hour + 1.5) // rd_hours) > day or hour == total_hours - 1:
            env_days.append(_day_summary(day_env, day))
            day_env = []
            for pid, st in plots.items():
                spec = specs[pid]
                crop = book.params[spec.crop_id]
                morph = book.morph[spec.crop_id]
                world = timeline.at(hour)
                m = measures_at(actions, pid, hour, rd_hours)
                soil = _day_soil(
                    world,
                    spec.protection,
                    m.fertilized,
                    world.water_available or spec.protection != "open" or spec.irrigation == "auto",
                )
                bucket = _bucket(world, spec.protection)
                stresses = [
                    {"cause": k, "label": STRESS_RU.get(k, k), "value": round(v, 3)}
                    for k, v in sorted(st.day.stresses.items())
                ]
                if st.alive and not st.harvested:
                    out = grow_one_day(st, crop, morph, soil, step_days)
                    if out.death_cause:
                        st.salvage_g = _salvage(st, morph, out.death_cause)
                        st.alive = False
                        st.death_cause = out.death_cause
                        st.death_day = day
                        log.append(
                            {
                                "day": day,
                                "hour": hour,
                                "plot": pid,
                                "type": "death",
                                "event": out.death_cause,
                                "message": _death_message(out.death_cause),
                            }
                        )
                    elif out.new_stage != st.last_stage:
                        msg = {
                            "germination": "Семя проросло.",
                            "flowering": "Началось цветение.",
                            "mature": "Урожай созрел.",
                        }.get(out.new_stage)
                        if msg:
                            log.append(
                                {
                                    "day": day,
                                    "hour": hour,
                                    "plot": pid,
                                    "type": out.new_stage
                                    if out.new_stage != "mature"
                                    else "harvest",
                                    "event": out.new_stage,
                                    "message": msg,
                                }
                            )
                        st.last_stage = out.new_stage
                    if out.organ_started:
                        log.append(
                            {
                                "day": day,
                                "hour": hour,
                                "plot": pid,
                                "type": "organ_init",
                                "event": morph.harvest_organ,
                                "message": _organ_ru(morph.harvest_organ),
                            }
                        )
                    if st.alive and st.progress >= 1.0:
                        st.harvested = True
                        st.harvest_day = day
                    daily_recovery(st)
                else:
                    from app.sim.plant.growth import daily_factors

                    cond, factors = daily_factors(st.day, crop, soil)
                    from app.sim.plant.growth import DayOutcome

                    out = DayOutcome(
                        0.0 if not st.alive else 1.0,
                        factors,
                        cond,
                        None,
                        stage_of(st.progress, morph, not st.alive),
                        False,
                    )
                rec = plant_day_record(
                    st, out, morph, day, step_days, ks(st.water_mm, bucket), stresses
                )
                if st.harvested and st.alive:
                    rec["stage"] = "mature"
                records[pid].append(rec)
                st.day = DayAccumulator()
            day += 1
            if end_after is None and all((not s.alive) or s.harvested for s in plots.values()):
                end_after = day + TAIL_DAYS
            if end_after is not None and day >= end_after:
                break

    summary: dict[str, dict[str, object]] = {}
    for pid, st in plots.items():
        morph = book.morph[specs[pid].crop_id]
        potential = morph.biomass_max_g * morph.harvest_index
        y = st.salvage_g if not st.alive else yield_g(st, morph)
        summary[pid] = {
            "crop_id": specs[pid].crop_id,
            "protection": specs[pid].protection,
            "alive": st.alive,
            "harvested": st.harvested,
            "harvest_day": st.harvest_day,
            "death_cause": st.death_cause,
            "death_day": st.death_day,
            "yield_g": round(y, 5),
            "yield_rel": round(min(1.0, y / potential) if potential else 0.0, 6),
            "water_used_mm": round(float(st.water_used_mm), 3),
            "damage": {
                "leaf": round(st.damage.leaf, 5),
                "root": round(st.damage.root, 5),
                "stem": round(st.damage.stem, 5),
                "sterility": round(st.damage.sterility, 5),
                "fruit_loss": round(st.damage.fruit_loss, 5),
                "tuber_efficiency": round(st.tuber_eff_sum / st.tuber_days, 5)
                if st.tuber_days
                else 1.0,
            },
        }
    return SimResult(
        report_day_hours=rd_hours,
        days=day,
        hours=len(env_hours),
        env_hours=env_hours,
        env_days=env_days,
        plots=records,
        log=log,
        summary=summary,
        world=sc.world,
        notes=list(sc.world.notes),
    )


def _death_message(cause: str) -> str:
    return f"Растение погибло: {DEATH_RU.get(cause, cause)}."


def _organ_ru(organ: str) -> str:
    return {
        "tuber": "Начали завязываться клубни.",
        "root": "Начал утолщаться корнеплод.",
        "grain": "Начался налив зерна.",
        "fruit": "Завязались плоды.",
        "pod": "Завязались бобы.",
    }.get(organ, "Началось формирование урожая.")


def _day_summary(hours: list[HourEnv], day: int) -> dict[str, float]:
    if not hours:
        return {"day": day}
    temps = [h.temp_c for h in hours]
    return {
        "day": day,
        "t_min_c": round(min(temps), 3),
        "t_max_c": round(max(temps), 3),
        "t_mean_c": round(sum(temps) / len(temps), 3),
        "precip_mm": round(sum(h.precip_mm for h in hours), 3),
        "dli_mol_m2": round(sum(h.ppfd for h in hours) * 3600 / 1e6, 4),
        "wind_max_ms": round(max(h.wind_ms for h in hours), 3),
        "rh_mean": round(sum(h.rh for h in hours) / len(hours), 4),
        "uv_max": round(max(h.uv_rel for h in hours), 4),
        "hail": round(max(h.hail for h in hours), 3),
    }
