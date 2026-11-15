"""RUSLE soil loss A = R·K·LS·C·P (Renard et al. 1997, USDA Agriculture Handbook 703). Pure."""

from __future__ import annotations

import math

EROSIVE_RAIN_MM = 12.7  # RUSLE: storms below 0.5 in are not counted
COVER_B = 0.035  # surface-cover subfactor exp(-b·cover%), Handbook 703 typical b


def renard_freimund_r(annual_precip_mm: float) -> float:
    """Annual rainfall erosivity R, MJ·mm/(ha·h·yr), from annual precipitation
    (Renard & Freimund 1994, doi:10.1016/0022-1694(94)90110-4)."""
    p = max(0.0, annual_precip_mm)
    if p <= 850:
        return 0.0483 * p**1.61
    return 587.8 - 1.219 * p + 0.004105 * p**2


def daily_erosivity(precip: tuple[float, ...] | list[float]) -> list[float]:
    """Spread the year's R over erosive days in proportion to P^1.5 (a modelling choice)."""
    r_year = renard_freimund_r(sum(precip))
    weights = [p**1.5 if p >= EROSIVE_RAIN_MM else 0.0 for p in precip]
    total = sum(weights)
    if total <= 0:
        return [0.0] * len(precip)
    return [r_year * w / total for w in weights]


def epic_k_factor(sand: float, silt: float, clay: float, oc_pct: float) -> float:
    """Soil erodibility K, t·ha·h/(ha·MJ·mm), EPIC equation (Sharpley & Williams 1990),
    converted from US units with 0.1317."""
    sn1 = 1 - sand / 100
    f_csand = 0.2 + 0.3 * math.exp(-0.256 * sand * (1 - silt / 100))
    f_clsi = (silt / (clay + silt)) ** 0.3 if clay + silt > 0 else 0.0
    f_orgc = 1 - 0.25 * oc_pct / (oc_pct + math.exp(3.72 - 2.95 * oc_pct))
    f_hisand = 1 - 0.7 * sn1 / (sn1 + math.exp(-5.51 + 22.9 * sn1))
    return f_csand * f_clsi * f_orgc * f_hisand * 0.1317


def ls_factor(slope_pct: float, length_m: float) -> float:
    """Topographic factor (McCool et al. 1987, 1989 as used in RUSLE)."""
    theta = math.atan(max(0.0, slope_pct) / 100)
    s = math.sin(theta)
    big_s = 10.8 * s + 0.03 if slope_pct < 9 else 16.8 * s - 0.50
    beta = (s / 0.0896) / (3 * s**0.8 + 0.56) if s > 0 else 0.0
    m = beta / (1 + beta)
    big_l = (max(1.0, length_m) / 22.13) ** m
    return big_l * big_s


def cover_factor(soil_cover: float) -> float:
    """C from the share of soil covered by canopy and residue (0 bare … 1 full)."""
    return math.exp(-COVER_B * 100 * max(0.0, min(1.0, soil_cover)))
