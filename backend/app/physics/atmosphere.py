"""Atmosphere presets and simple gas relations. Pure data and functions."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AtmospherePreset:
    id: str
    label_ru: str
    pressure_pa: float
    pco2_pa: float
    po2_pa: float
    tau_ir: float  # grey infrared optical depth at the surface
    vis_transmission: float  # surface / top-of-atmosphere daytime sunlight


# tau_ir values solve T_s = T_eq (1 + 0.75 tau)^(1/4) for the measured surface temperatures.
# vis_transmission values are coarse estimates, see docs/ASSUMPTIONS.md.
PRESETS: dict[str, AtmospherePreset] = {
    "earth_like": AtmospherePreset(
        id="earth_like",
        label_ru="Как Земля",
        pressure_pa=101_325.0,
        pco2_pa=43.0,
        po2_pa=21_223.0,
        tau_ir=0.84,
        vis_transmission=0.55,
    ),
    "mars_like": AtmospherePreset(
        id="mars_like",
        label_ru="Как Марс",
        pressure_pa=636.0,
        pco2_pa=605.0,
        po2_pa=1.0,
        tau_ir=0.10,
        vis_transmission=0.65,
    ),
    "venus_like": AtmospherePreset(
        id="venus_like",
        label_ru="Как Венера",
        pressure_pa=9_200_000.0,
        pco2_pa=8_900_000.0,
        po2_pa=0.0,
        tau_ir=147.0,
        vis_transmission=0.02,
    ),
    "dense_co2": AtmospherePreset(
        id="dense_co2",
        label_ru="Плотная CO₂",
        pressure_pa=500_000.0,
        pco2_pa=480_000.0,
        po2_pa=0.0,
        tau_ir=8.0,
        vis_transmission=0.35,
    ),
    "none": AtmospherePreset(
        id="none",
        label_ru="Нет атмосферы",
        pressure_pa=0.0,
        pco2_pa=0.0,
        po2_pa=0.0,
        tau_ir=0.0,
        vis_transmission=1.0,
    ),
}

EARTH_PCO2_PA = 43.0
EARTH_PO2_PA = 21_223.0
EARTH_PRESSURE_PA = 101_325.0


def column_mass_kg_m2(pressure_pa: float, gravity_g: float) -> float:
    """Atmospheric column mass above the surface, P / g."""
    if gravity_g <= 0:
        return 0.0
    return pressure_pa / (gravity_g * 9.80665)


def has_ozone_shield(po2_pa: float) -> bool:
    """Whether an O2 atmosphere plausibly maintains a UV-absorbing ozone layer."""
    return po2_pa >= 2_000.0
