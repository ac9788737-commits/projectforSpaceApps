"""Single-factor plant response curves. Every function returns a value in [0, 1].

The reference for "1" is a crop in good terrestrial conditions: yield is reported relative
to Earth, so conditions better than Earth's (such as CO2 enrichment) saturate at 1.
"""

from __future__ import annotations

import math

import numpy as np

EARTH_REF_PPFD_UMOL_M2_S = 750.0
EARTH_REF_DLI_MOL_M2_D = 30.0
EARTH_PCO2_PA = 43.0
SOLAR_FAR_RED_RATIO = 0.33

_PHOTOSYNTHETIC_CURVATURE = 0.9
_QUANTUM_YIELD = 0.05
_CO2_CURVES: dict[str, tuple[float, float]] = {
    # (CO2 compensation point Pa, half-saturation Pa)
    "C3": (5.0, 40.0),
    "C4": (0.5, 6.0),
    "CCM": (0.5, 6.0),
}
_GRAVITY_POINTS_G = (0.0, 0.16, 0.38, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0)
_GRAVITY_VALUES = (0.70, 0.85, 0.92, 1.0, 0.95, 0.85, 0.65, 0.30, 0.0)


def _clip01(value: float) -> float:
    return float(max(0.0, min(1.0, value)))


def _ramp(value: float, zero_at: float, one_at: float) -> float:
    """Linear ramp from 0 at `zero_at` to 1 at `one_at`, in either direction."""
    if one_at == zero_at:
        return 1.0 if value >= one_at else 0.0
    return _clip01((value - zero_at) / (one_at - zero_at))


def temperature_response(t_c: float, t_min_c: float, t_opt_c: float, t_max_c: float) -> float:
    """Beta function of cardinal temperatures (Yan & Hunt, 1999)."""
    if t_c <= t_min_c or t_c >= t_max_c:
        return 0.0
    exponent = (t_opt_c - t_min_c) / (t_max_c - t_opt_c)
    falling = (t_max_c - t_c) / (t_max_c - t_opt_c)
    rising = (t_c - t_min_c) / (t_opt_c - t_min_c)
    return _clip01(falling * rising**exponent)


def temperature_plateau_response(
    t_c: float, t_min_c: float, t_opt_min_c: float, t_opt_max_c: float, t_max_c: float
) -> float:
    """Beta function with a flat top over EcoCrop's optimal range."""
    if t_c < t_opt_min_c:
        return temperature_response(t_c, t_min_c, t_opt_min_c, t_max_c)
    if t_c > t_opt_max_c:
        return temperature_response(t_c, t_min_c, t_opt_max_c, t_max_c)
    return 1.0


def diurnal_temperature_response(
    t_mean_c: float,
    amplitude_k: float,
    t_kill_c: float,
    t_min_c: float,
    t_opt_min_c: float,
    t_opt_max_c: float,
    t_max_c: float,
) -> float:
    """Daily mean of the temperature response; lethal if the daily extremes kill the plant."""
    half_swing = amplitude_k / 2.0
    if t_mean_c - half_swing < t_kill_c or t_mean_c + half_swing > t_max_c + 10.0:
        return 0.0
    phases = np.linspace(0.0, 2.0 * math.pi, 24, endpoint=False)
    temps = t_mean_c + half_swing * np.sin(phases)
    responses = [
        temperature_plateau_response(float(t), t_min_c, t_opt_min_c, t_opt_max_c, t_max_c)
        for t in temps
    ]
    return float(np.mean(responses))


def non_rectangular_hyperbola(ppfd: float, a_max: float, curvature: float, quantum: float) -> float:
    """Gross photosynthesis as a non-rectangular hyperbola of PPFD."""
    term = quantum * ppfd + a_max
    root = term * term - 4.0 * curvature * quantum * ppfd * a_max
    return (term - math.sqrt(max(root, 0.0))) / (2.0 * curvature)


def light_response(ppfd: float, ppfd_comp: float, ppfd_sat: float) -> float:
    """Net photosynthesis at PPFD relative to a crop in the Earth reference light."""
    if ppfd <= ppfd_comp:
        return 0.0
    # a_max chosen so that the curve bends over at the crop's saturation PPFD.
    a_max = _QUANTUM_YIELD * ppfd_sat
    reference = min(ppfd_sat, EARTH_REF_PPFD_UMOL_M2_S)
    gross = non_rectangular_hyperbola(ppfd, a_max, _PHOTOSYNTHETIC_CURVATURE, _QUANTUM_YIELD)
    gross_ref = non_rectangular_hyperbola(
        reference, a_max, _PHOTOSYNTHETIC_CURVATURE, _QUANTUM_YIELD
    )
    respiration = non_rectangular_hyperbola(
        ppfd_comp, a_max, _PHOTOSYNTHETIC_CURVATURE, _QUANTUM_YIELD
    )
    return _clip01((gross - respiration) / (gross_ref - respiration))


def photoperiod_response(
    light_hours: float,
    dark_hours: float,
    dli_mol_m2_d: float,
    dli_min: float,
    dli_opt: float,
    max_dark_hours: float,
    continuous_light_ok: bool,
) -> float:
    """Combined day-length and daily-light-integral factor."""
    target = min(dli_opt, EARTH_REF_DLI_MOL_M2_D)
    # Square root: PPFD saturation is already counted by light_response.
    dli_factor = min(1.0, math.sqrt(max(dli_mol_m2_d, 0.0) / target))
    if dli_mol_m2_d < dli_min:
        dli_factor *= max(dli_mol_m2_d, 0.0) / dli_min
    if dark_hours > max_dark_hours:
        return 0.0
    # Dark periods longer than ~14 h deplete carbohydrate reserves.
    dark_factor = 1.0 if dark_hours <= 14.0 else _ramp(dark_hours, max_dark_hours, 14.0)
    # Very short days limit assimilation windows.
    short_factor = 1.0 if light_hours >= 8.0 else 0.5 + 0.5 * light_hours / 8.0
    continuous_factor = 1.0
    if dark_hours <= 0.0 and not continuous_light_ok:
        continuous_factor = 0.6
    return _clip01(dli_factor * dark_factor * short_factor * continuous_factor)


def spectrum_response(far_red_ratio: float) -> float:
    """Penalty for far-red-rich starlight (shade-avoidance syndrome), floored at 0.6."""
    if far_red_ratio <= SOLAR_FAR_RED_RATIO * 1.2:
        return 1.0
    return 1.0 - 0.4 * _ramp(far_red_ratio, SOLAR_FAR_RED_RATIO * 1.2, SOLAR_FAR_RED_RATIO * 4.0)


def co2_response(pco2_pa: float, photosynthesis: str) -> float:
    """C3/C4 rectangular hyperbola, normalised at Earth CO2, with high-CO2 toxicity."""
    compensation, half_sat = _CO2_CURVES[photosynthesis]
    if pco2_pa <= compensation:
        return 0.0

    def curve(c: float) -> float:
        return (c - compensation) / (c - compensation + half_sat)

    assimilation = _clip01(curve(pco2_pa) / curve(EARTH_PCO2_PA))
    toxicity = 1.0 if pco2_pa <= 3_000.0 else _ramp(pco2_pa, 100_000.0, 3_000.0)
    return assimilation * toxicity


def o2_response(po2_pa: float, o2_min_kpa: float) -> float:
    """Threshold response to O2 (root-zone and dark respiration) with hyperoxia decline."""
    po2_kpa = po2_pa / 1000.0
    low = _ramp(po2_kpa, o2_min_kpa, max(o2_min_kpa * 4.0, 16.0))
    high = 1.0 if po2_kpa <= 60.0 else _ramp(po2_kpa, 200.0, 60.0)
    return min(low, high)


def pressure_response(pressure_pa: float, p_min_kpa: float) -> float:
    """Total pressure threshold: transpiration fails near vacuum, hyperbaria at high pressure."""
    pressure_kpa = pressure_pa / 1000.0
    low = _ramp(pressure_kpa, p_min_kpa, max(p_min_kpa * 3.0, 50.0))
    high = 1.0 if pressure_kpa <= 300.0 else _ramp(pressure_kpa, 5000.0, 300.0)
    return min(low, high)


def gravity_response(gravity_g: float) -> float:
    """Empirical gravity response; values above 1 g are a low-confidence extrapolation."""
    return float(np.interp(gravity_g, _GRAVITY_POINTS_G, _GRAVITY_VALUES))


def uv_response(uv_relative: float, tolerance_relative: float) -> float:
    """Log-linear decline from the crop's tolerance to 30 times that dose."""
    if uv_relative <= tolerance_relative:
        return 1.0
    log_excess = math.log(uv_relative / tolerance_relative) / math.log(30.0)
    return _clip01(1.0 - log_excess)


def ionising_response(dose_msv_yr: float) -> float:
    """Log-linear decline between 2 Sv/yr (no effect) and 1000 Sv/yr (lethal)."""
    if dose_msv_yr <= 2_000.0:
        return 1.0
    log_excess = math.log(dose_msv_yr / 2_000.0) / math.log(500.0)
    return _clip01(1.0 - log_excess)


def water_response(availability: str, liquid_stable: bool, engineered: bool) -> float:
    """Water supply. Natural supply needs stable liquid; engineered supply needs a source."""
    if engineered:
        return {"abundant": 1.0, "ice": 1.0, "trace": 0.6, "unknown": 0.7, "none": 0.0}[
            availability
        ]
    if not liquid_stable:
        return 0.0
    return {"abundant": 1.0, "ice": 0.5, "trace": 0.2, "unknown": 0.5, "none": 0.0}[availability]


def ph_response(ph: float, ph_min: float, ph_max: float) -> float:
    """Trapezoid over the crop's pH range with one unit of tolerance outside it."""
    if ph_min <= ph <= ph_max:
        return 1.0
    distance = ph_min - ph if ph < ph_min else ph - ph_max
    return _clip01(1.0 - distance)


def perchlorate_response(perchlorate_wt_pct: float) -> float:
    """Toxicity of soil perchlorates: harmless below 0.01 wt%, lethal from 0.5 wt%."""
    if perchlorate_wt_pct <= 0.01:
        return 1.0
    log_excess = math.log(perchlorate_wt_pct / 0.01) / math.log(50.0)
    return _clip01(1.0 - log_excess)
