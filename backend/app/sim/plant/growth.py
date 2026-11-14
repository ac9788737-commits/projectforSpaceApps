"""Daily growth from the hourly conditions of one plot. Pure functions on the plot state.

The daily growth rate is the product of the same single-factor responses used by
/simulate, evaluated on the day's aggregated conditions, so with steady conditions and no
injuries the season ends with the same relative yield. Injuries scale the canopy and roots.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.biology.growth import (
    LETHAL_THRESHOLD,
    CropParams,
    Factor,
    GrowthConditions,
    days_to_harvest,
    evaluate_factors,
)
from app.biology.morphology import Morphology, potential_biomass_fraction, stage_of, visible_traits
from app.sim.data import stage_sensitivity
from app.sim.plant.state import DayAccumulator, PlotState
from app.sim.soil import soil_response

LIGHT_KEYS = frozenset({"light", "photoperiod"})
STARVATION_DAYS = 7.0
TUBER_NIGHT_SPAN_C = 8.0  # efficiency falls from 1 to 0.3 over 8 °C above the threshold (estimate)


@dataclass(frozen=True, slots=True)
class DaySoil:
    soil: str
    ph: float | None
    nutrients: str
    salinity: float
    perchlorate: float
    water_possible: bool  # liquid water can reach the roots on this plot


def conditions_of(acc: DayAccumulator) -> GrowthConditions:
    hours = max(acc.hours, 1)
    lit = acc.lit_hours
    pressure_pa = acc.pressure_sum / hours * 1000.0
    return GrowthConditions(
        t_mean_c=sum(acc.temps) / hours,
        diurnal_amplitude_k=max(acc.temps) - min(acc.temps) if acc.temps else 0.0,
        ppfd_umol_m2_s=acc.ppfd_sum / lit if lit else 0.0,
        light_hours=lit,
        dark_hours=hours - lit,
        dli_mol_m2_d=acc.ppfd_sum * 3600.0 / 1e6 * 24.0 / hours,
        far_red_ratio=acc.far_red_sum / hours,
        pco2_pa=acc.co2_sum / hours * 1e-6 * pressure_pa,
        po2_pa=acc.o2_sum / hours * 1000.0,
        pressure_pa=pressure_pa,
        gravity_g=acc.gravity,
        uv_relative=acc.uv_max,
        ionising_msv_yr=acc.radiation_sum / hours,
        water="abundant",
        liquid_water_stable=True,
        engineered_water=False,
        substrate="soil",
        soil_ph=None,
        perchlorate_wt_pct=0.0,
    )


def daily_factors(
    acc: DayAccumulator, crop: CropParams, soil: DaySoil
) -> tuple[GrowthConditions, dict[str, Factor]]:
    cond = conditions_of(acc)
    factors = {f.key: f for f in evaluate_factors(cond, crop)}
    water_f = (acc.ks_sum / max(acc.hours, 1)) if soil.water_possible else 0.0
    soil_f = soil_response(
        soil.soil, soil.ph, soil.nutrients, soil.salinity, soil.perchlorate, crop
    )
    for key, f in (("water", water_f), ("soil", soil_f)):
        old = factors[key]
        factors[key] = Factor(
            key,
            f if key == "water" else old.value,
            old.unit,
            f,
            "lethal" if f <= LETHAL_THRESHOLD else ("stress" if f < 0.8 else "ok"),
        )
    return cond, factors


def tuber_efficiency(night_mean_c: float | None, threshold: float | None) -> float:
    if night_mean_c is None or threshold is None or night_mean_c <= threshold:
        return 1.0
    return max(0.3, 1.0 - 0.7 * (night_mean_c - threshold) / TUBER_NIGHT_SPAN_C)


def yield_g(st: PlotState, morph: Morphology) -> float:
    from app.biology.morphology import harvest_share

    d = st.damage
    base = st.biomass * morph.harvest_index * harvest_share(st.progress, morph)
    organ = morph.harvest_organ
    if organ == "grain":
        return base * (1.0 - d.sterility) * (1.0 - 0.4 * d.stem)
    if organ in ("fruit", "pod"):
        return base * (1.0 - d.sterility) * (1.0 - d.fruit_loss) * (1.0 - 0.2 * d.stem)
    if organ == "tuber":
        eff = st.tuber_eff_sum / st.tuber_days if st.tuber_days > 0 else 1.0
        return base * eff
    if organ == "leaf":
        return base * (1.0 - 0.5 * d.leaf_irrev)
    return base


@dataclass(slots=True)
class DayOutcome:
    rate: float
    factors: dict[str, Factor]
    cond: GrowthConditions
    death_cause: str | None
    new_stage: str
    organ_started: bool


def grow_one_day(
    st: PlotState, crop: CropParams, morph: Morphology, soil: DaySoil, step_days: float
) -> DayOutcome:
    acc = st.day
    cond, factors = daily_factors(acc, crop, soil)
    rate = 1.0
    for f in factors.values():
        rate *= f.f
    lethal = {k for k, f in factors.items() if f.f <= LETHAL_THRESHOLD}
    # Temperature and water injuries are handled hour by hour (frost, heat, wilting).
    instant = lethal - LIGHT_KEYS - {"temperature", "water"}
    death: str | None = None
    if instant:
        death = sorted(instant, key=lambda k: factors[k].f)[0]
    elif lethal & LIGHT_KEYS:
        st.counters.starvation_days += step_days
        if st.counters.starvation_days >= STARVATION_DAYS:
            death = "darkness"
    else:
        st.counters.starvation_days = 0.0

    organ_started = False
    if death is None:
        d = st.damage
        capacity = (1.0 - d.leaf) * (1.0 - 0.6 * d.root)
        dth = days_to_harvest(cond, crop)
        new_progress = min(1.0, st.progress + step_days / dth)
        gain_frac = potential_biomass_fraction(new_progress) - potential_biomass_fraction(
            st.progress
        )
        gain = rate * capacity * morph.biomass_max_g * gain_frac
        if morph.harvest_organ == "tuber" and new_progress > morph.organ_init_frac:
            sens = stage_sensitivity()[(crop.id, "fruiting")]
            night = sum(acc.night_temps) / len(acc.night_temps) if acc.night_temps else None
            eff = tuber_efficiency(night, sens.warm_night_tuber_c)
            weight = max(gain_frac, 1e-9)
            st.tuber_eff_sum += eff * weight
            st.tuber_days += weight
            if eff < 0.95:
                acc.note("warm_nights", 1.0 - eff)
        st.biomass += gain
        if st.progress <= morph.organ_init_frac < new_progress:
            potential = potential_biomass_fraction(new_progress)
            st.organ_vigour = st.biomass / (morph.biomass_max_g * potential) if potential else rate
            organ_started = True
        st.progress = new_progress
    stage = stage_of(st.progress, morph, death is not None)
    return DayOutcome(rate, factors, cond, death, stage, organ_started)


def plant_day_record(
    st: PlotState,
    out: DayOutcome,
    morph: Morphology,
    day: int,
    step_days: float,
    ks_now: float,
    stresses: list[dict[str, object]],
) -> dict[str, object]:
    """One day of the plant in the PlantState format used by the 3D view."""
    f = {k: v.f for k, v in out.factors.items()}
    d = st.damage
    vigour_rate = out.rate * (1.0 - d.leaf) * (1.0 - 0.6 * d.root)
    st.health_ema = (
        vigour_rate if st.health_ema is None else 0.5 * st.health_ema + 0.5 * vigour_rate
    )
    dead = not st.alive
    health = 0.0 if dead else max(0.0, min(1.0, d.health() * (0.35 + 0.65 * st.health_ema)))
    potential = potential_biomass_fraction(st.progress)
    vigour = st.biomass / (morph.biomass_max_g * potential) if potential > 0 else out.rate
    light_stress = 1.0 - min(f["light"], f["photoperiod"], f["spectrum"])
    traits = visible_traits(
        st.progress, st.biomass, vigour, st.organ_vigour, light_stress, out.cond.gravity_g, morph
    )
    limiting = min(out.factors.values(), key=lambda x: x.f)
    return {
        "day": day,
        "earth_day": round(day * step_days, 4),
        "stage": "dead" if dead else out.new_stage,
        "progress": round(st.progress, 6),
        "heightM": round(traits.height_m * (0.85 if ks_now < 0.3 and not dead else 1.0), 5),
        "leafCount": traits.leaf_count,
        "leafAreaIndex": round(traits.leaf_area_index * (1.0 - d.leaf), 5),
        "biomassG": round(st.biomass, 5),
        "yieldG": round(st.salvage_g, 5) if dead else round(yield_g(st, morph), 5),
        "organCount": max(0, round(traits.organ_count * (1.0 - d.fruit_loss) * (1.0 - d.sterility)))
        if traits.organ_count
        else 0,
        "stress": {
            "temp": round(1.0 - f["temperature"], 5),
            "light": round(light_stress, 5),
            "water": round(1.0 - ks_now, 5),
            "gravity": round(1.0 - f["gravity"], 5),
            "radiation": round(max(1.0 - min(f["uv"], f["ionising"]), d.leaf_irrev), 5),
        },
        "factors": {k: round(v, 6) for k, v in f.items()},
        "health": round(health, 5),
        "growth_rate": 0.0 if dead else round(out.rate, 6),
        "limiting_factor": limiting.key,
        "limiting_f": round(limiting.f, 6),
        "t_mean_c": round(out.cond.t_mean_c, 3),
        "ppfd_umol_m2_s": round(out.cond.ppfd_umol_m2_s, 3),
        "storm": False,
        "flare": False,
        "water_mm": round(st.water_mm, 3),
        "ks": round(ks_now, 4),
        "damage": {
            "leaf": round(d.leaf, 5),
            "leaf_irreversible": round(d.leaf_irrev, 5),
            "root": round(d.root, 5),
            "stem": round(d.stem, 5),
            "sterility": round(d.sterility, 5),
            "fruit_loss": round(d.fruit_loss, 5),
        },
        "stresses": stresses,
        "t_min_c": round(min(st.day.temps), 3) if st.day.temps else None,
        "t_max_c": round(max(st.day.temps), 3) if st.day.temps else None,
    }
