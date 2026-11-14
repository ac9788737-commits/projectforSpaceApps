"""Combine single-factor responses into yield, survival and cycle length. Pure functions."""

from __future__ import annotations

from dataclasses import dataclass

from app.biology import responses as r

LETHAL_THRESHOLD = 0.02
STRESS_THRESHOLD = 0.8
KELVIN = 273.15
_MAX_CYCLE_STRETCH = 4.0


@dataclass(frozen=True, slots=True)
class CropParams:
    id: str
    photosynthesis: str
    t_kill_c: float
    t_min_c: float
    t_opt_min_c: float
    t_opt_max_c: float
    t_max_c: float
    ph_min: float
    ph_max: float
    cycle_days: float
    ppfd_comp: float
    ppfd_sat: float
    dli_min: float
    dli_opt: float
    o2_min_kpa: float
    uv_tolerance_rel: float
    p_min_kpa: float
    max_dark_hours: float
    continuous_light_ok: bool
    aquatic: bool

    @property
    def t_opt_c(self) -> float:
        return (self.t_opt_min_c + self.t_opt_max_c) / 2.0


@dataclass(frozen=True, slots=True)
class GrowthConditions:
    """Conditions experienced by the plant after the scenario has been applied."""

    t_mean_c: float
    diurnal_amplitude_k: float
    ppfd_umol_m2_s: float
    light_hours: float
    dark_hours: float
    dli_mol_m2_d: float
    far_red_ratio: float
    pco2_pa: float
    po2_pa: float
    pressure_pa: float
    gravity_g: float
    uv_relative: float
    ionising_msv_yr: float
    water: str
    liquid_water_stable: bool
    engineered_water: bool
    substrate: str
    soil_ph: float | None
    perchlorate_wt_pct: float | None


@dataclass(frozen=True, slots=True)
class Factor:
    key: str
    value: float
    unit: str
    f: float
    status: str


@dataclass(frozen=True, slots=True)
class GrowthResult:
    factors: tuple[Factor, ...]
    yield_rel: float
    survival: bool
    limiting_factor: str
    days_to_harvest: float | None


def status_of(f: float) -> str:
    if f <= LETHAL_THRESHOLD:
        return "lethal"
    return "stress" if f < STRESS_THRESHOLD else "ok"


def soil_response(c: GrowthConditions, crop: CropParams) -> float:
    """Growth substrate: terrestrial soil, processed regolith, hydroponics or nothing."""
    if c.substrate == "none":
        return 0.0
    if c.substrate == "hydroponic":
        return 1.0
    if crop.aquatic:
        return 1.0
    if c.substrate == "ice":
        return 0.0
    base = {"soil": 1.0, "regolith": 0.7, "treated_regolith": 0.85, "unknown": 0.5}[c.substrate]
    ph = r.ph_response(c.soil_ph, crop.ph_min, crop.ph_max) if c.soil_ph is not None else 1.0
    salts = r.perchlorate_response(c.perchlorate_wt_pct or 0.0)
    return base * ph * salts


def evaluate_factors(c: GrowthConditions, crop: CropParams) -> list[Factor]:
    raw: list[tuple[str, float, str, float]] = [
        (
            "temperature",
            c.t_mean_c,
            "°C",
            r.diurnal_temperature_response(
                c.t_mean_c,
                c.diurnal_amplitude_k,
                crop.t_kill_c,
                crop.t_min_c,
                crop.t_opt_min_c,
                crop.t_opt_max_c,
                crop.t_max_c,
            ),
        ),
        (
            "light",
            c.ppfd_umol_m2_s,
            "мкмоль/м²/с",
            r.light_response(c.ppfd_umol_m2_s, crop.ppfd_comp, crop.ppfd_sat),
        ),
        (
            "photoperiod",
            c.dli_mol_m2_d,
            "моль/м²/сут",
            r.photoperiod_response(
                c.light_hours,
                c.dark_hours,
                c.dli_mol_m2_d,
                crop.dli_min,
                crop.dli_opt,
                crop.max_dark_hours,
                crop.continuous_light_ok,
            ),
        ),
        ("spectrum", c.far_red_ratio, "FR/PAR", r.spectrum_response(c.far_red_ratio)),
        ("co2", c.pco2_pa, "Па", r.co2_response(c.pco2_pa, crop.photosynthesis)),
        ("o2", c.po2_pa / 1000.0, "кПа", r.o2_response(c.po2_pa, crop.o2_min_kpa)),
        (
            "pressure",
            c.pressure_pa / 1000.0,
            "кПа",
            r.pressure_response(c.pressure_pa, crop.p_min_kpa),
        ),
        ("gravity", c.gravity_g, "g", r.gravity_response(c.gravity_g)),
        ("uv", c.uv_relative, "× Земля", r.uv_response(c.uv_relative, crop.uv_tolerance_rel)),
        ("ionising", c.ionising_msv_yr, "мЗв/год", r.ionising_response(c.ionising_msv_yr)),
        (
            "water",
            1.0 if c.liquid_water_stable or c.engineered_water else 0.0,
            "доступность",
            r.water_response(c.water, c.liquid_water_stable, c.engineered_water),
        ),
        ("soil", c.perchlorate_wt_pct or 0.0, "мас.% перхлоратов", soil_response(c, crop)),
    ]
    return [Factor(k, v, u, f, status_of(f)) for k, v, u, f in raw]


def days_to_harvest(c: GrowthConditions, crop: CropParams) -> float:
    """Scale the terrestrial cycle by accumulated thermal time and daily light."""
    effective = max(c.t_mean_c, crop.t_min_c + 1.0)
    capped = min(effective, crop.t_opt_min_c)
    thermal = (crop.t_opt_min_c - crop.t_min_c) / (capped - crop.t_min_c)
    target = min(crop.dli_opt, r.EARTH_REF_DLI_MOL_M2_D)
    light = (target / c.dli_mol_m2_d) ** 0.25 if 0 < c.dli_mol_m2_d < target else 1.0
    return crop.cycle_days * min(thermal * light, _MAX_CYCLE_STRETCH)


def evaluate_growth(c: GrowthConditions, crop: CropParams) -> GrowthResult:
    factors = evaluate_factors(c, crop)
    yield_rel = 1.0
    for factor in factors:
        yield_rel *= factor.f
    survival = all(f.status != "lethal" for f in factors)
    limiting = min(factors, key=lambda f: f.f)
    return GrowthResult(
        factors=tuple(factors),
        yield_rel=yield_rel if survival else 0.0,
        survival=survival,
        limiting_factor=limiting.key,
        days_to_harvest=days_to_harvest(c, crop) if survival else None,
    )
