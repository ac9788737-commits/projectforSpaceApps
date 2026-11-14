"""Plot conditions: outdoor weather → protection (open / greenhouse / closed) → farmer
measures. Pure."""

from __future__ import annotations

from dataclasses import dataclass

from app.biology.growth import CropParams
from app.sim.environment.base_climate import HourEnv

GLASS_TRANSMISSION = 0.8
GLASS_UV = 0.1
MAX_HEATING_K = 120.0
MAX_COOLING_K = 50.0
DOME_MIN_KPA = 50.0
DOME_MAX_EXTERNAL_KPA = 300.0
DOME_CO2_PA = 100.0
SOLAR_GAIN_K = 10.0  # passive warming of a dome at full sun (estimate)
LED_HOURS = 16.0
FROST_COVER_K = 3.0  # agro-fleece keeps the canopy a few degrees warmer at night (estimate)


@dataclass(frozen=True, slots=True)
class PlotEffects:
    """Temporary farmer measures active in this hour."""

    frost_cover: bool = False
    shade: bool = False


def greenhouse_env(out: HourEnv, crop: CropParams) -> HourEnv:
    """Scenario B per hour: pressurised dome, thermostat between the crop's optimum limits."""
    env = out.copy()
    if out.pressure_kpa > DOME_MAX_EXTERNAL_KPA:
        inside_kpa = out.pressure_kpa  # the dome cannot hold back a crushing atmosphere
        env.o2_kpa, env.co2_ppm = out.o2_kpa, out.co2_ppm
    else:
        inside_kpa = max(min(out.pressure_kpa, 101.325), DOME_MIN_KPA)
        env.o2_kpa = min(21.0, inside_kpa * 0.4)
        env.co2_ppm = DOME_CO2_PA / (inside_kpa * 1000.0) * 1e6
    env.pressure_kpa = inside_kpa
    passive = out.temp_c + SOLAR_GAIN_K * min(1.0, out.ppfd / 2000.0)
    heated = max(passive, min(crop.t_opt_min_c, out.temp_c + MAX_HEATING_K))
    env.temp_c = min(heated, max(crop.t_opt_max_c, out.temp_c - MAX_COOLING_K))
    env.soil_temp_c = (env.temp_c + crop.t_opt_c) / 2.0
    env.ppfd = out.ppfd * GLASS_TRANSMISSION
    env.uv_rel = out.uv_rel * GLASS_UV
    env.precip_mm = 0.0
    env.wind_ms = 0.0
    env.hail = 0.0
    env.flood = False
    env.rh = 0.7
    env.et_mult = 1.0
    return env


def closed_farm_env(out: HourEnv, crop: CropParams) -> HourEnv:
    """Scenario C per hour: LED 16 h a day, climate at the crop optimum, shielded."""
    env = out.copy()
    led_on = (out.hour % 24) < LED_HOURS
    env.ppfd = min(crop.ppfd_sat, 750.0) if led_on else 0.0
    env.lit = 1.0 if led_on else 0.0
    env.far_red = 0.33
    # Thermostat: lights-on at the optimum, a cooler night inside the optimal range.
    env.temp_c = crop.t_opt_c + 1.0 if led_on else min(crop.t_opt_c - 1.0, crop.t_opt_min_c + 1.0)
    env.soil_temp_c = crop.t_opt_c
    env.pressure_kpa = 101.3
    env.o2_kpa = 21.0
    env.co2_ppm = DOME_CO2_PA / 101_300.0 * 1e6
    env.uv_rel = 0.0
    env.radiation_msv_yr = out.radiation_msv_yr * 0.01
    env.precip_mm = 0.0
    env.wind_ms = 0.0
    env.hail = 0.0
    env.flood = False
    env.rh = 0.7
    env.et_mult = 1.0
    return env


def plot_env(
    out: HourEnv, protection: str, crop: CropParams, failure: bool, effects: PlotEffects
) -> HourEnv:
    """Conditions the plants of one plot experience in this hour."""
    if protection == "greenhouse" and not failure:
        env = greenhouse_env(out, crop)
    elif protection == "closed" and not failure:
        env = closed_farm_env(out, crop)
    else:
        env = out.copy()
    if effects.frost_cover:
        env.temp_c += FROST_COVER_K if env.ppfd <= 0 else FROST_COVER_K / 3.0
        env.ppfd *= 0.85
        env.hail *= 0.5
    if effects.shade:
        env.ppfd *= 0.6
        env.uv_rel *= 0.6
        if env.ppfd > 0:
            env.temp_c -= 2.0
    return env
