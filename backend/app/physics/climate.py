"""Bulk planetary climate: gravity, equilibrium temperature, day length. Pure functions."""

from __future__ import annotations

import math
from dataclasses import dataclass

from astropy import constants as const

from app.physics.stellar import AU_M, M_SUN_KG

G_SI: float = const.G.value
M_EARTH_KG: float = const.M_earth.value
R_EARTH_M: float = const.R_earth.value
G_EARTH_M_S2 = 9.80665
EARTH_FLUX_TEQ_K = 278.5  # T_eq of a zero-albedo fast rotator receiving 1 S_earth

SECONDS_PER_DAY = 86400.0

# Fit through Moon (P=0, 295 K), Mars (636 Pa, 58 K), Earth (101325 Pa, 10 K).
_AIRLESS_DIURNAL_AMPLITUDE_K = 295.0
_DIURNAL_P0_PA = 16.1
_DIURNAL_EXPONENT = 0.383

# Barnes (2017) style constant-Q tidal parameters.
_TIDAL_Q = 100.0
_TIDAL_K2 = 0.3
_INITIAL_ROTATION_PERIOD_S = 13.5 * 3600.0
_MOMENT_OF_INERTIA_FACTOR = 0.33
LOCK_SURE_GYR = 1.0
LOCK_UNLIKELY_GYR = 10.0


def surface_gravity_g(mass_earth: float, radius_earth: float) -> float:
    """Surface gravity g = G M / R^2 in units of standard Earth gravity."""
    if radius_earth <= 0:
        raise ValueError("radius must be positive")
    gravity = G_SI * mass_earth * M_EARTH_KG / (radius_earth * R_EARTH_M) ** 2
    return gravity / G_EARTH_M_S2


def equilibrium_temp_k(insolation_earth: float, albedo: float) -> float:
    """Equilibrium temperature of a fast-rotating planet."""
    if insolation_earth < 0:
        raise ValueError("insolation must be non-negative")
    return EARTH_FLUX_TEQ_K * ((1.0 - albedo) * insolation_earth) ** 0.25


def grey_greenhouse_temp_k(teq_k: float, tau_ir: float) -> float:
    """Grey-atmosphere surface temperature T_s = T_eq (1 + 3/4 tau)^(1/4)."""
    return teq_k * (1.0 + 0.75 * tau_ir) ** 0.25


def diurnal_amplitude_k(pressure_pa: float) -> float:
    """Peak-to-peak diurnal temperature swing from surface pressure (empirical)."""
    if pressure_pa <= 0:
        return _AIRLESS_DIURNAL_AMPLITUDE_K
    ratio = (pressure_pa / _DIURNAL_P0_PA) ** _DIURNAL_EXPONENT
    return _AIRLESS_DIURNAL_AMPLITUDE_K / (1.0 + ratio)


def tidal_lock_time_gyr(
    mass_earth: float,
    radius_earth: float,
    semi_major_axis_au: float,
    star_mass_msun: float,
) -> float:
    """Characteristic spin-down time to tidal lock (constant-Q estimate)."""
    mass_kg = mass_earth * M_EARTH_KG
    radius_m = radius_earth * R_EARTH_M
    a_m = semi_major_axis_au * AU_M
    star_kg = star_mass_msun * M_SUN_KG
    omega = 2.0 * math.pi / _INITIAL_ROTATION_PERIOD_S
    inertia = _MOMENT_OF_INERTIA_FACTOR * mass_kg * radius_m**2
    seconds = (
        omega * a_m**6 * inertia * _TIDAL_Q / (3.0 * G_SI * star_kg**2 * _TIDAL_K2 * radius_m**5)
    )
    return seconds / (365.25 * SECONDS_PER_DAY * 1e9)


@dataclass(frozen=True, slots=True)
class DayLength:
    day_hours: float | None  # None means a permanent day side (tidally locked)
    tidally_locked: bool
    uncertain: bool


def estimate_day_length(
    known_day_hours: float | None,
    orbital_period_days: float | None,
    mass_earth: float,
    radius_earth: float,
    semi_major_axis_au: float | None,
    star_mass_msun: float | None,
) -> DayLength:
    """Use the measured day if known, otherwise a tidal-locking heuristic."""
    if known_day_hours is not None:
        return DayLength(known_day_hours, tidally_locked=False, uncertain=False)
    if semi_major_axis_au is None or star_mass_msun is None:
        return DayLength(24.0, tidally_locked=False, uncertain=True)
    lock_gyr = tidal_lock_time_gyr(mass_earth, radius_earth, semi_major_axis_au, star_mass_msun)
    if lock_gyr < LOCK_SURE_GYR:
        return DayLength(None, tidally_locked=True, uncertain=False)
    if lock_gyr < LOCK_UNLIKELY_GYR:
        return DayLength(None, tidally_locked=True, uncertain=True)
    return DayLength(24.0, tidally_locked=False, uncertain=True)


def stellar_flux_earth_units(luminosity_lsun: float, semi_major_axis_au: float) -> float:
    """Insolation in units of the flux received by Earth."""
    return luminosity_lsun / semi_major_axis_au**2


def orbit_mean_flux_factor(eccentricity: float) -> float:
    """Orbit-averaged flux boost relative to a circular orbit, 1/sqrt(1-e^2)."""
    return 1.0 / math.sqrt(1.0 - min(eccentricity, 0.99) ** 2)


def habitable_zone_au(luminosity_lsun: float, teff_k: float) -> tuple[float, float]:
    """Conservative habitable zone from Kopparapu et al. (2013), runaway to maximum greenhouse."""
    t_star = max(min(teff_k, 7200.0), 2600.0) - 5780.0
    inner = 1.0512 + 1.3242e-4 * t_star + 1.5418e-8 * t_star**2
    inner += -7.9895e-12 * t_star**3 - 1.8328e-15 * t_star**4
    outer = 0.3438 + 5.8942e-5 * t_star + 1.6558e-9 * t_star**2
    outer += -3.0045e-12 * t_star**3 - 5.2983e-16 * t_star**4
    return math.sqrt(luminosity_lsun / inner), math.sqrt(luminosity_lsun / outer)


def daily_mean_cosine(tidally_locked: bool) -> float:
    """Mean cos(zenith) over the daylight hours at the best-lit site."""
    return 1.0 if tidally_locked else 2.0 / math.pi
