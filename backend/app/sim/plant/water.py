"""Root-zone water bucket (FAO-56 style): rain + irrigation − evapotranspiration − drainage. Pure.

Depletion factor p = 0.5 and the Ks formula follow FAO Irrigation and Drainage Paper 56
(Allen et al., 1998); the hourly reference evapotranspiration is a simplified light-driven
estimate calibrated to ~5 mm/day on a sunny temperate day (estimate).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.sim.data import SoilType
from app.sim.environment.base_climate import HourEnv

ROOT_ZONE_MM = 600.0  # effective rooting depth, FAO-56 Table 22 range for field crops (estimate)
DEPLETION_P = 0.5
ET_LIGHT_COEFF = 0.34  # mm per (1000 µmol/m²/s · h)
NIGHT_ET_MM_H = 0.02


@dataclass(frozen=True, slots=True)
class Bucket:
    fc: float
    wp: float
    sat: float
    drainage: float

    @staticmethod
    def of(soil: SoilType) -> Bucket:
        return Bucket(
            fc=soil.field_capacity * ROOT_ZONE_MM,
            wp=soil.wilting_point * ROOT_ZONE_MM,
            sat=soil.saturation * ROOT_ZONE_MM,
            drainage=soil.drainage_mm_h,
        )

    @property
    def waterlog_level(self) -> float:
        return self.fc + 0.7 * (self.sat - self.fc)


def ks(water_mm: float, b: Bucket) -> float:
    """FAO-56 water stress coefficient: 1 until half of the available water is used."""
    taw = b.fc - b.wp
    if taw <= 0:
        return 1.0
    return min(1.0, max(0.0, (water_mm - b.wp) / ((1.0 - DEPLETION_P) * taw)))


def reference_et_mm_h(env: HourEnv) -> float:
    if env.pressure_kpa < 1.0:
        return 0.0
    temp_f = max(0.0, 1.0 + 0.03 * (env.temp_c - 20.0))
    hum_f = max(0.1, 1.2 - 0.6 * env.rh)
    wind_f = 1.0 + 0.05 * env.wind_ms
    light = ET_LIGHT_COEFF * max(env.ppfd, 0.0) / 1000.0
    return (light + NIGHT_ET_MM_H) * temp_f * hum_f * wind_f * env.et_mult


def crop_coefficient(lai: float) -> float:
    """Kc rises with canopy cover from bare soil (0.4) to full canopy (~1.15)."""
    return 0.4 + 0.75 * min(1.0, lai / 3.0)


def step_water(
    water_mm: float,
    b: Bucket,
    env: HourEnv,
    lai: float,
    auto: bool,
    mulch: bool,
    drained: bool,
    groundwater_m: float,
) -> tuple[float, float]:
    """One hour of water balance. Returns (new water, water added by auto-irrigation)."""
    w = water_mm + env.precip_mm
    if env.flood:
        w = max(w, b.sat)
    et = reference_et_mm_h(env) * crop_coefficient(lai) * (0.7 if mulch else 1.0)
    w -= et * min(1.0, ks(w, b) + 0.2)
    if w > b.fc:
        w -= min(w - b.fc, b.drainage * (2.0 if drained else 1.0))
    if groundwater_m < 1.5 and w < b.fc:
        w += 0.05 * (1.5 - groundwater_m)
    w = min(max(w, 0.0), b.sat)
    added = 0.0
    if auto and w < 0.95 * b.fc:
        added = b.fc - w
        w = b.fc
    return w, added
