"""Day-by-day growth timeline. Pure: same inputs and seed give the same timeline.

Each local day the scenario conditions (optionally modified by "what if" overrides and
random events) go through the same response curves as `/simulate`. The product of the
factors is the day's growth rate relative to Earth. Biomass follows the potential curve
of `morphology.py` scaled by that rate, so with constant conditions the final relative
yield equals the `/simulate` value exactly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace

import numpy as np

from app.biology.growth import (
    LETHAL_THRESHOLD,
    CropParams,
    Factor,
    GrowthConditions,
    days_to_harvest,
    evaluate_factors,
    evaluate_growth,
)
from app.biology.morphology import (
    Morphology,
    Stage,
    potential_biomass_fraction,
    stage_of,
    visible_traits,
)
from app.physics.environment import Assumption, BodyInputs, Environment
from app.scenarios import ScenarioId
from app.simulate import FACTOR_LABELS_RU, SimulationResult, simulate

HOURS_PER_EARTH_DAY = 24.0
MAX_LOCAL_DAY_HOURS = 48.0
LIGHT_KEYS = frozenset({"light", "photoperiod"})
LIGHT_STARVATION_EARTH_DAYS = 7.0
DEAD_TAIL_DAYS = 3
MAX_CYCLE_STRETCH = 5.0
HEALTH_SMOOTHING = 0.5
LED_PHOTOPERIOD_H = 16.0

# Random events (all estimates, see docs/ASSUMPTIONS.md).
DUST_STORM_PROB_PER_DAY = 0.01
DUST_STORM_DAYS = (10, 40)
DUST_STORM_LIGHT = (0.3, 0.6)
DUSTY_PRESSURE_PA = (100.0, 2000.0)
FLARE_TEFF_K = 3900.0
FLARE_PROB_PER_DAY = 0.05
FLARE_UV_MULTIPLIER = 10.0


@dataclass(frozen=True, slots=True)
class Overrides:
    """'What if' changes applied on top of a scenario."""

    supplemental_ppfd_umol_m2_s: float = 0.0
    heating_k: float = 0.0

    def is_empty(self) -> bool:
        return self.supplemental_ppfd_umol_m2_s == 0.0 and self.heating_k == 0.0


def apply_overrides(c: GrowthConditions, o: Overrides) -> GrowthConditions:
    if o.is_empty():
        return c
    out = replace(c, t_mean_c=c.t_mean_c + o.heating_k)
    if o.supplemental_ppfd_umol_m2_s > 0:
        led = o.supplemental_ppfd_umol_m2_s
        light_hours = max(c.light_hours, LED_PHOTOPERIOD_H)
        dark_hours = min(c.dark_hours, HOURS_PER_EARTH_DAY - LED_PHOTOPERIOD_H)
        out = replace(
            out,
            ppfd_umol_m2_s=c.ppfd_umol_m2_s + led,
            dli_mol_m2_d=c.dli_mol_m2_d + led * LED_PHOTOPERIOD_H * 3600.0 / 1e6,
            light_hours=light_hours,
            dark_hours=dark_hours,
        )
    return out


@dataclass(frozen=True, slots=True)
class Event:
    day: int
    type: str
    message: str


@dataclass(slots=True)
class _Weather:
    """Random event state carried between days."""

    storm_days_left: int = 0
    storm_light: float = 1.0


def step_hours(env: Environment) -> float:
    """One timeline step: a local solar day, or an Earth day when local days are very long."""
    if env.tidally_locked or env.day_hours is None or env.day_hours > MAX_LOCAL_DAY_HOURS:
        return HOURS_PER_EARTH_DAY
    return env.day_hours


def is_dusty(env: Environment, scenario: ScenarioId) -> bool:
    """Thin atmosphere over dusty regolith (Mars-like): regional dust storms happen."""
    lo, hi = DUSTY_PRESSURE_PA
    return scenario != "closed_farm" and env.substrate == "regolith" and lo <= env.pressure_pa <= hi


def has_flares(env: Environment, scenario: ScenarioId) -> bool:
    return scenario != "closed_farm" and env.teff_k < FLARE_TEFF_K


@dataclass(frozen=True, slots=True)
class DayState:
    day: int
    earth_day: float
    stage: Stage
    progress: float
    height_m: float
    leaf_count: int
    leaf_area_index: float
    biomass_g: float
    yield_g: float
    organ_count: int
    stress: dict[str, float]
    factors: dict[str, float]
    health: float
    growth_rate: float
    limiting_factor: str
    limiting_f: float
    t_mean_c: float
    ppfd_umol_m2_s: float
    storm: bool
    flare: bool


@dataclass(frozen=True, slots=True)
class TimelineResult:
    simulation: SimulationResult
    conditions: GrowthConditions
    step_hours: float
    days: tuple[DayState, ...]
    events: tuple[Event, ...]
    yield_rel: float
    static_yield_rel: float
    survival: bool
    harvest_day: int | None
    harvest_earth_days: float | None
    assumptions: tuple[Assumption, ...] = field(default_factory=tuple)


def _stress(factors: dict[str, Factor]) -> dict[str, float]:
    f = {k: v.f for k, v in factors.items()}
    return {
        "temp": 1.0 - f["temperature"],
        "light": 1.0 - min(f["light"], f["photoperiod"], f["spectrum"]),
        "water": 1.0 - min(f["water"], f["soil"]),
        "gravity": 1.0 - f["gravity"],
        "radiation": 1.0 - min(f["uv"], f["ionising"]),
    }


def _seed_state(morph: Morphology, c: GrowthConditions) -> DayState:
    return DayState(
        day=0,
        earth_day=0.0,
        stage="seed",
        progress=0.0,
        height_m=0.0,
        leaf_count=0,
        leaf_area_index=0.0,
        biomass_g=0.0,
        yield_g=0.0,
        organ_count=0,
        stress={"temp": 0.0, "light": 0.0, "water": 0.0, "gravity": 0.0, "radiation": 0.0},
        factors={},
        health=1.0,
        growth_rate=0.0,
        limiting_factor="temperature",
        limiting_f=1.0,
        t_mean_c=c.t_mean_c,
        ppfd_umol_m2_s=c.ppfd_umol_m2_s,
        storm=False,
        flare=False,
    )


def simulate_timeline(
    body: BodyInputs,
    crop: CropParams,
    morph: Morphology,
    scenario: ScenarioId,
    preset_id: str | None = None,
    overrides: Overrides | None = None,
    seed: int = 42,
    events_enabled: bool = True,
    crop_is_estimate: bool = True,
    yield_kg_m2_cycle: float | None = None,
) -> TimelineResult:
    sim = simulate(
        body,
        crop,
        scenario,
        preset_id,
        crop_is_estimate=crop_is_estimate,
        yield_kg_m2_cycle=yield_kg_m2_cycle,
    )
    env = sim.environment
    ov = overrides or Overrides()
    base = apply_overrides(sim.outcome.conditions, ov)
    static_rel = evaluate_growth(base, crop).yield_rel

    hours = step_hours(env)
    step_days = hours / HOURS_PER_EARTH_DAY
    rng = np.random.default_rng(seed)
    dusty = events_enabled and is_dusty(env, scenario)
    flares = events_enabled and has_flares(env, scenario)
    max_steps = math.ceil(MAX_CYCLE_STRETCH * crop.cycle_days / step_days) + 1

    notes: list[Assumption] = [
        Assumption(
            "timeline_daily_mean",
            "Таймлайн использует средние за сутки условия сценария; внутрисуточный ход "
            "учтён в кривых отклика.",
            0.0,
        ),
        Assumption(
            "morphology_estimate",
            "Высота, число листьев и органов, распределение биомассы — оценочная модель "
            "для визуализации.",
            0.0,
        ),
    ]
    if hours == HOURS_PER_EARTH_DAY and env.day_hours != HOURS_PER_EARTH_DAY:
        notes.append(
            Assumption(
                "timeline_earth_days",
                "Местные сутки очень длинные или их нет: шаг таймлайна — земные сутки.",
                0.0,
            )
        )
    if dusty or flares:
        notes.append(
            Assumption(
                "random_events",
                "Частота и сила пылевых бурь и вспышек — оценка; результат воспроизводим "
                f"при seed={seed}.",
                0.0,
            )
        )
    if not ov.is_empty():
        notes.append(Assumption("what_if", "Применены изменения «Что если…» поверх сценария.", 0.0))

    days: list[DayState] = [_seed_state(morph, base)]
    events: list[Event] = []
    weather = _Weather()
    progress = 0.0
    biomass = 0.0
    health: float | None = None
    organ_vigour = 1.0
    starvation = 0.0
    dead = False
    harvest_day: int | None = None
    frost_reported = False
    last_stage: Stage = "seed"

    for day in range(1, max_steps + 1):
        # Weather for the day.
        cond = base
        storm = flare = False
        if dusty:
            if weather.storm_days_left == 0 and rng.random() < DUST_STORM_PROB_PER_DAY:
                weather.storm_days_left = int(rng.integers(DUST_STORM_DAYS[0], DUST_STORM_DAYS[1]))
                weather.storm_light = float(rng.uniform(*DUST_STORM_LIGHT))
                events.append(
                    Event(
                        day,
                        "dust_storm",
                        f"Пылевая буря на {weather.storm_days_left} сут.: "
                        f"свет {weather.storm_light:.0%} от обычного.",
                    )
                )
            if weather.storm_days_left > 0:
                weather.storm_days_left -= 1
                storm = True
                cond = replace(
                    cond,
                    ppfd_umol_m2_s=cond.ppfd_umol_m2_s * weather.storm_light,
                    dli_mol_m2_d=cond.dli_mol_m2_d * weather.storm_light,
                )
        if flares and rng.random() < FLARE_PROB_PER_DAY:
            flare = True
            cond = replace(cond, uv_relative=cond.uv_relative * FLARE_UV_MULTIPLIER)
            events.append(Event(day, "flare", "Вспышка звезды: УФ в 10 раз выше обычного."))

        factors = {f.key: f for f in evaluate_factors(cond, crop)}
        rate = 1.0
        for f in factors.values():
            rate *= f.f
        limiting = min(factors.values(), key=lambda f: f.f)
        lethal = {k for k, f in factors.items() if f.f <= LETHAL_THRESHOLD}

        night_c = cond.t_mean_c - cond.diurnal_amplitude_k / 2.0
        if not frost_reported and not dead and night_c < 0.0 and "temperature" not in lethal:
            frost_reported = True
            events.append(Event(day, "frost", f"Ночные заморозки до {night_c:.0f} °C."))

        cause: Factor | None = None
        if lethal - LIGHT_KEYS:
            cause = factors[sorted(lethal - LIGHT_KEYS, key=lambda k: factors[k].f)[0]]
        elif lethal:
            starvation += step_days
            if starvation >= LIGHT_STARVATION_EARTH_DAYS:
                cause = factors[sorted(lethal, key=lambda k: factors[k].f)[0]]
        else:
            starvation = 0.0

        if cause is not None:
            dead = True
            label = FACTOR_LABELS_RU[cause.key]
            events.append(
                Event(
                    day,
                    "death",
                    f"Растение погибло: {_death_reason(cause, cond, label)}.",
                )
            )
        else:
            dth = days_to_harvest(cond, crop)
            new_progress = min(1.0, progress + step_days / dth)
            gained = potential_biomass_fraction(new_progress) - potential_biomass_fraction(progress)
            biomass += rate * morph.biomass_max_g * gained
            if progress <= morph.organ_init_frac < new_progress:
                potential = potential_biomass_fraction(new_progress)
                organ_vigour = biomass / (morph.biomass_max_g * potential) if potential else rate
                if morph.harvest_organ in _ORGAN_EVENT_RU:
                    events.append(Event(day, "organ_init", _ORGAN_EVENT_RU[morph.harvest_organ]))
            progress = new_progress

        health = (
            rate if health is None else (1 - HEALTH_SMOOTHING) * health + HEALTH_SMOOTHING * rate
        )
        potential = potential_biomass_fraction(progress)
        vigour = biomass / (morph.biomass_max_g * potential) if potential > 0 else rate
        stress = _stress(factors)
        traits = visible_traits(
            progress, biomass, vigour, organ_vigour, stress["light"], cond.gravity_g, morph
        )
        stage = stage_of(progress, morph, dead)
        if stage != last_stage and not dead:
            events.extend(_stage_events(day, stage))
        last_stage = stage
        days.append(
            DayState(
                day=day,
                earth_day=day * step_days,
                stage=stage,
                progress=progress,
                height_m=traits.height_m,
                leaf_count=traits.leaf_count,
                leaf_area_index=traits.leaf_area_index,
                biomass_g=biomass,
                yield_g=0.0 if dead else traits.yield_g,
                organ_count=traits.organ_count,
                stress=stress,
                factors={k: f.f for k, f in factors.items()},
                health=0.0 if dead else max(0.0, min(1.0, health)),
                growth_rate=0.0 if dead else rate,
                limiting_factor=cause.key if cause else limiting.key,
                limiting_f=cause.f if cause else limiting.f,
                t_mean_c=cond.t_mean_c,
                ppfd_umol_m2_s=cond.ppfd_umol_m2_s,
                storm=storm,
                flare=flare,
            )
        )
        if dead:
            _append_dead_tail(days, step_days)
            break
        if progress >= 1.0:
            harvest_day = day
            message = f"Урожай готов: {_grams(traits.yield_g)} сухой массы на растение."
            events.append(Event(day, "harvest", message))
            break

    final = days[-1]
    potential_yield = morph.biomass_max_g * morph.harvest_index
    yield_rel = 0.0 if dead or harvest_day is None else final.yield_g / potential_yield
    return TimelineResult(
        simulation=sim,
        conditions=base,
        step_hours=hours,
        days=tuple(days),
        events=tuple(events),
        yield_rel=min(1.0, yield_rel),
        static_yield_rel=static_rel,
        survival=not dead,
        harvest_day=harvest_day,
        harvest_earth_days=harvest_day * step_days if harvest_day else None,
        assumptions=tuple(sim.assumptions) + tuple(notes),
    )


def _death_reason(cause: Factor, cond: GrowthConditions, label: str) -> str:
    if cause.key == "photoperiod" and cond.dark_hours > 24.0:
        return f"слишком долгая ночь ({cond.dark_hours:.0f} ч без света)"
    value = f"{cause.value:.3g}".replace(".", ",").replace("-", "\u2212")
    return f"{label.lower()} ({value} {cause.unit})"


def _grams(value: float) -> str:
    text = f"{value:.0f}" if value >= 10 else f"{value:.2g}"
    return text.replace(".", ",") + " г"


_ORGAN_EVENT_RU: dict[str, str] = {
    "tuber": "Начали завязываться клубни.",
    "root": "Начал утолщаться корнеплод.",
    "grain": "Начался налив зерна.",
    "fruit": "Завязались плоды.",
    "pod": "Завязались бобы.",
}


def _stage_events(day: int, new: Stage) -> list[Event]:
    if new == "germination":
        return [Event(day, "germination", "Семя проросло.")]
    if new == "flowering":
        return [Event(day, "flowering", "Началось цветение.")]
    return []


def _append_dead_tail(days: list[DayState], step_days: float) -> None:
    last = days[-1]
    for i in range(1, DEAD_TAIL_DAYS + 1):
        days.append(
            replace(
                last,
                day=last.day + i,
                earth_day=(last.day + i) * step_days,
                height_m=last.height_m * 0.8,
            )
        )
