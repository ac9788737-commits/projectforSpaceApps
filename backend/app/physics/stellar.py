"""Stellar spectrum and irradiance. Pure functions, wavelengths in metres, SI units."""

from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
from astropy import constants as const

H_J_S: float = const.h.value
C_M_S: float = const.c.value
KB_J_K: float = const.k_B.value
SIGMA_W_M2_K4: float = const.sigma_sb.value
N_A_PER_MOL: float = const.N_A.value
L_SUN_W: float = const.L_sun.value
R_SUN_M: float = const.R_sun.value
M_SUN_KG: float = const.M_sun.value
AU_M: float = const.au.value
PC_M: float = const.pc.value

SOLAR_CONSTANT_W_M2 = 1361.0  # IAU 2015 B3 nominal total solar irradiance
SUN_TEFF_K = 5772.0  # IAU 2015 B3 nominal solar effective temperature

PAR_MIN_M = 400e-9
PAR_MAX_M = 700e-9
FAR_RED_MAX_M = 800e-9
UV_MIN_M = 200e-9
UV_MAX_M = 315e-9

_GRID_POINTS = 2000


def planck_exitance_w_m3(wavelength_m: np.ndarray, teff_k: float) -> np.ndarray:
    """Black-body spectral exitance M_lambda (W/m^2 per metre of wavelength)."""
    x = H_J_S * C_M_S / (wavelength_m * KB_J_K * teff_k)
    # expm1 of a very large number overflows; such wavelengths emit nothing anyway.
    with np.errstate(over="ignore"):
        denominator = np.expm1(np.minimum(x, 700.0))
    return 2.0 * math.pi * H_J_S * C_M_S**2 / wavelength_m**5 / denominator


def _band_grid(lam_min_m: float, lam_max_m: float) -> np.ndarray:
    return np.linspace(lam_min_m, lam_max_m, _GRID_POINTS)


@lru_cache(maxsize=4096)
def band_energy_fraction(teff_k: float, lam_min_m: float, lam_max_m: float) -> float:
    """Fraction of total black-body power emitted between two wavelengths."""
    if teff_k <= 0:
        raise ValueError("teff_k must be positive")
    grid = _band_grid(lam_min_m, lam_max_m)
    band = float(np.trapezoid(planck_exitance_w_m3(grid, teff_k), grid))
    return band / (SIGMA_W_M2_K4 * teff_k**4)


@lru_cache(maxsize=4096)
def band_photons_per_joule_umol(teff_k: float, lam_min_m: float, lam_max_m: float) -> float:
    """Photon flux (umol/s) inside a band per watt of *total* stellar irradiance."""
    grid = _band_grid(lam_min_m, lam_max_m)
    exitance = planck_exitance_w_m3(grid, teff_k)
    photons_per_s = float(np.trapezoid(exitance * grid / (H_J_S * C_M_S), grid))
    return photons_per_s / N_A_PER_MOL * 1e6 / (SIGMA_W_M2_K4 * teff_k**4)


def par_fraction(teff_k: float) -> float:
    """Energy fraction in the photosynthetically active band (400-700 nm)."""
    return band_energy_fraction(teff_k, PAR_MIN_M, PAR_MAX_M)


def far_red_fraction(teff_k: float) -> float:
    """Energy fraction in the far-red band (700-800 nm)."""
    return band_energy_fraction(teff_k, PAR_MAX_M, FAR_RED_MAX_M)


def uv_fraction(teff_k: float) -> float:
    """Energy fraction in the biologically damaging UV-B/UV-C band (200-315 nm)."""
    return band_energy_fraction(teff_k, UV_MIN_M, UV_MAX_M)


def far_red_to_par_photon_ratio(teff_k: float) -> float:
    """Far-red (700-800 nm) to PAR photon ratio, the photomorphogenesis indicator."""
    far_red = band_photons_per_joule_umol(teff_k, PAR_MAX_M, FAR_RED_MAX_M)
    par = band_photons_per_joule_umol(teff_k, PAR_MIN_M, PAR_MAX_M)
    return far_red / par


def ppfd_from_irradiance_umol_m2_s(irradiance_w_m2: float, teff_k: float) -> float:
    """Convert total irradiance from a black-body star to PPFD (400-700 nm)."""
    return irradiance_w_m2 * band_photons_per_joule_umol(teff_k, PAR_MIN_M, PAR_MAX_M)


def luminosity_w(radius_rsun: float, teff_k: float) -> float:
    """Stefan-Boltzmann luminosity."""
    return 4.0 * math.pi * (radius_rsun * R_SUN_M) ** 2 * SIGMA_W_M2_K4 * teff_k**4


def irradiance_w_m2(luminosity_lsun: float, semi_major_axis_au: float) -> float:
    """Top-of-atmosphere irradiance L / (4 pi a^2)."""
    distance_m = semi_major_axis_au * AU_M
    return luminosity_lsun * L_SUN_W / (4.0 * math.pi * distance_m**2)


def spectrum_curve(
    teff_k: float,
    lam_min_nm: float = 250.0,
    lam_max_nm: float = 2000.0,
    points: int = 176,
) -> list[tuple[float, float]]:
    """Normalised spectrum for plotting: (wavelength_nm, exitance / total power, per nm)."""
    grid_nm = np.linspace(lam_min_nm, lam_max_nm, points)
    exitance = planck_exitance_w_m3(grid_nm * 1e-9, teff_k)
    per_nm = exitance * 1e-9 / (SIGMA_W_M2_K4 * teff_k**4)
    return [(float(w), float(v)) for w, v in zip(grid_nm, per_nm, strict=True)]
