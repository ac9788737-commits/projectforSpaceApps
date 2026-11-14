"""UV and ionising radiation at the surface. Pure functions, doses relative to Earth or in mSv."""

from __future__ import annotations

import math

from app.physics.atmosphere import has_ozone_shield
from app.physics.stellar import SUN_TEFF_K, uv_fraction

# Earth's ozone layer passes only a few percent of the 200-315 nm band.
_OZONE_FREE_UV_BOOST = 30.0
_RAYLEIGH_UV_SCALE_PA = 200_000.0

_GCR_FREE_SPACE_MSV_YR = 672.0  # MSL/RAD cruise, 1.84 mSv/day (Zeitlin et al. 2013)
_GCR_BODY_SHADOW = 0.5  # the planet hides half of the sky
_GCR_COLUMN_SCALE_KG_M2 = 543.0  # fit to MSL/RAD Mars surface 0.67 mSv/day (Hassler et al. 2014)
_GROUND_FLOOR_MSV_YR = 0.3  # sea-level cosmic-ray dose order of magnitude
_MAGNETOSPHERE_FACTOR = 0.5

_FLARE_TEFF_LIMIT_K = 3900.0
_FLARE_TEFF_ACTIVE_K = 3200.0


def flare_uv_relative(teff_k: float) -> float:
    """Time-averaged extra UV from flares of M dwarfs, per unit of insolation (estimate)."""
    if teff_k >= _FLARE_TEFF_LIMIT_K:
        return 0.0
    return 2.0 if teff_k < _FLARE_TEFF_ACTIVE_K else 0.5


def uv_surface_relative(
    insolation_earth: float, teff_k: float, pressure_pa: float, po2_pa: float
) -> float:
    """Surface UV-B/C dose relative to the present-day Earth surface."""
    photospheric = insolation_earth * uv_fraction(teff_k) / uv_fraction(SUN_TEFF_K)
    top_of_atmosphere = photospheric + insolation_earth * flare_uv_relative(teff_k)
    if has_ozone_shield(po2_pa):
        return top_of_atmosphere
    scattering = math.exp(-pressure_pa / _RAYLEIGH_UV_SCALE_PA)
    return top_of_atmosphere * _OZONE_FREE_UV_BOOST * scattering


def ionising_dose_msv_yr(
    column_mass_kg_m2: float,
    has_magnetosphere: bool | None,
    extra_msv_yr: float = 0.0,
) -> float:
    """Annual ionising dose from galactic cosmic rays plus a body-specific extra term."""
    dose = _GCR_FREE_SPACE_MSV_YR * _GCR_BODY_SHADOW
    dose *= math.exp(-column_mass_kg_m2 / _GCR_COLUMN_SCALE_KG_M2)
    if has_magnetosphere:
        dose *= _MAGNETOSPHERE_FACTOR
    return dose + _GROUND_FLOOR_MSV_YR + extra_msv_yr
