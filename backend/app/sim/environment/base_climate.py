"""Base climate of a starting world and its hourly course. Pure functions.

A world is a set of climate parameters (`WorldClimate`). Presets come from
data/seed/world_presets.csv; planets from the catalogue are turned into a world from their
computed environment. The user can then override any parameter (overrides.py).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace

import numpy as np

from app.physics import stellar
from app.physics.environment import Environment
from app.sim.data import world_preset_rows

KELVIN = 273.15
GARDEN_SITE_TARGET_C = 20.0  # planet worlds: pick the site closest to a mild 20 °C
REPORT_DAY_MAX_H = 48.0


def spectrum_far_red_ratio(spectrum: str, star_ratio: float | None = None) -> float:
    """Far-red/PAR photon ratio of a light source."""
    if spectrum == "star" and star_ratio is not None:
        return star_ratio
    temps = {"solar": 5772.0, "warm": 3000.0, "red_dwarf": 2600.0}
    if spectrum == "led":
        return 0.05  # red/blue horticultural LEDs emit almost no far red (estimate)
    return stellar.far_red_to_par_photon_ratio(temps.get(spectrum, 5772.0))


@dataclass(frozen=True, slots=True)
class WorldClimate:
    id: str
    name_ru: str
    temp_day_c: float
    temp_night_c: float
    temp_soil_c: float | None
    precip_mm_day: float
    rain_prob: float
    rh: float
    ppfd_max: float  # clear-sky noon PPFD (or constant PPFD when the star does not move)
    light_hours: float
    day_hours: float
    clouds: float
    spectrum: str
    far_red_ratio: float
    co2_ppm: float
    o2_kpa: float
    pressure_kpa: float
    wind_ms: float
    soil: str
    ph: float
    nutrients: str  # low | norm | high
    salinity_ds_m: float
    gravity_g: float
    uv_rel: float
    radiation_msv_yr: float
    groundwater_m: float
    perchlorate_wt_pct: float = 0.0
    water_available: bool = True  # liquid water can exist / a source is assumed
    constant_light: bool = False  # tidally locked: the star stands still
    estimate: bool = True
    notes: tuple[str, ...] = field(default_factory=tuple)

    @property
    def report_day_hours(self) -> float:
        """Timeline step: a local solar day, or an Earth day when local days are very long."""
        return (
            self.day_hours
            if self.day_hours <= REPORT_DAY_MAX_H and not self.constant_light
            else 24.0
        )


OVERRIDABLE = frozenset(
    {
        "temp_day_c",
        "temp_night_c",
        "temp_soil_c",
        "precip_mm_day",
        "rain_prob",
        "rh",
        "ppfd_max",
        "light_hours",
        "clouds",
        "spectrum",
        "co2_ppm",
        "o2_kpa",
        "pressure_kpa",
        "wind_ms",
        "soil",
        "ph",
        "nutrients",
        "salinity_ds_m",
        "gravity_g",
        "uv_rel",
        "radiation_msv_yr",
        "groundwater_m",
    }
)


def world_from_preset(preset_id: str) -> WorldClimate:
    r = world_preset_rows()[preset_id]
    spectrum = r["spectrum"]
    return WorldClimate(
        id=preset_id,
        name_ru=r["name_ru"],
        temp_day_c=float(r["temp_day_c"]),
        temp_night_c=float(r["temp_night_c"]),
        temp_soil_c=None,
        precip_mm_day=float(r["precip_mm_day"]),
        rain_prob=float(r["rain_prob"]),
        rh=float(r["rh"]),
        ppfd_max=float(r["ppfd_max"]),
        light_hours=float(r["light_hours"]),
        day_hours=float(r["day_hours"]),
        clouds=float(r["clouds"]),
        spectrum=spectrum,
        far_red_ratio=spectrum_far_red_ratio(spectrum),
        co2_ppm=float(r["co2_ppm"]),
        o2_kpa=float(r["o2_kpa"]),
        pressure_kpa=float(r["pressure_kpa"]),
        wind_ms=float(r["wind_ms"]),
        soil=r["soil"],
        ph=float(r["ph"]),
        nutrients=r["nutrients"],
        salinity_ds_m=float(r["salinity_ds_m"]),
        gravity_g=float(r["gravity_g"]),
        uv_rel=float(r["uv_rel"]),
        radiation_msv_yr=float(r["radiation_msv_yr"]),
        groundwater_m=float(r["groundwater_m"]),
        water_available=True,
        estimate=r["estimate"] == "true",
        notes=(r["notes"],) if r["notes"] else (),
    )


def world_from_environment(world_id: str, name_ru: str, env: Environment) -> WorldClimate:
    """Starting world from a catalogue body: its computed outdoor environment at a mild site."""
    spread = env.site_spread_k
    site_c = (
        max(
            env.surface_temp_k - spread,
            min(env.surface_temp_k + spread, GARDEN_SITE_TARGET_C + KELVIN),
        )
        - KELVIN
    )
    amp = env.diurnal_amplitude_k
    pressure_kpa = env.pressure_pa / 1000.0
    liquid = env.pressure_pa >= 611.7 and env.water in ("abundant",)
    soil = {"soil": "loam", "regolith": "regolith", "ice": "regolith", "none": "regolith"}.get(
        env.substrate, "regolith"
    )
    if env.tidally_locked:
        ppfd_max, light_hours, day_hours = env.daytime_ppfd_umol_m2_s, 24.0, 24.0
    else:
        # Mean of a half-sine over the lit hours is 2/π of its peak.
        ppfd_max = env.daytime_ppfd_umol_m2_s * math.pi / 2.0
        light_hours = env.light_hours
        day_hours = env.light_hours + env.dark_hours
    notes = [
        f"Мир построен из рассчитанной среды тела «{name_ru}»; участок выбран ближе к +20 °C.",
    ]
    if not liquid:
        notes.append("Жидкая вода на поверхности не держится: без укрытия полив невозможен.")
    return WorldClimate(
        id=world_id,
        name_ru=name_ru,
        temp_day_c=site_c + amp / 2.0,
        temp_night_c=site_c - amp / 2.0,
        temp_soil_c=None,
        precip_mm_day=2.5 if liquid else 0.0,
        rain_prob=0.35 if liquid else 0.0,
        rh=0.65 if liquid else 0.05,
        ppfd_max=ppfd_max,
        light_hours=light_hours,
        day_hours=day_hours,
        clouds=0.0,
        spectrum="star",
        far_red_ratio=env.far_red_to_par_ratio,
        co2_ppm=(env.pco2_pa / env.pressure_pa * 1e6) if env.pressure_pa > 0 else 0.0,
        o2_kpa=env.po2_pa / 1000.0,
        pressure_kpa=pressure_kpa,
        wind_ms=3.0 if pressure_kpa > 1.0 else (5.0 if pressure_kpa > 0.1 else 0.0),
        soil=soil,
        ph=env.soil_ph if env.soil_ph is not None else 6.5,
        nutrients="norm" if soil == "loam" else "low",
        salinity_ds_m=0.5,
        gravity_g=env.gravity_g,
        uv_rel=env.uv_relative,
        radiation_msv_yr=env.ionising_msv_yr,
        groundwater_m=3.0 if liquid else 99.0,
        perchlorate_wt_pct=env.perchlorate_wt_pct or 0.0,
        water_available=liquid,
        constant_light=env.tidally_locked,
        estimate=True,
        notes=tuple(notes),
    )


def apply_overrides(world: WorldClimate, values: dict[str, float | str]) -> WorldClimate:
    unknown = set(values) - OVERRIDABLE
    if unknown:
        raise ValueError(f"unknown condition(s): {sorted(unknown)}")
    patch: dict[str, object] = dict(values)
    if "spectrum" in values:
        patch["far_red_ratio"] = spectrum_far_red_ratio(
            str(values["spectrum"]), world.far_red_ratio
        )
    if "light_hours" in values:
        patch["light_hours"] = min(float(values["light_hours"]), world.day_hours)
    if (
        "precip_mm_day" in values
        and float(values["precip_mm_day"]) > 0
        and world.rain_prob == 0
        and "rain_prob" not in values
    ):
        patch["rain_prob"] = 0.35
    return replace(world, **patch)  # type: ignore[arg-type]


@dataclass(slots=True)
class HourEnv:
    """Conditions in one hour. Mutable: events, protection and actions adjust a copy."""

    hour: int
    hod: float  # hour of the local day
    temp_c: float
    soil_temp_c: float
    rh: float
    precip_mm: float
    ppfd: float
    far_red: float
    co2_ppm: float
    o2_kpa: float
    pressure_kpa: float
    wind_ms: float
    uv_rel: float
    radiation_msv_yr: float
    gravity_g: float
    lit: float = 0.0  # share of this hour in daylight (for day length)
    hail: float = 0.0
    et_mult: float = 1.0
    flood: bool = False

    def copy(self) -> HourEnv:
        return replace(self)


def _rain_today(world: WorldClimate, seed: int, day: int) -> float:
    """Deterministic daily rain amount (mm), independent of everything else that happens."""
    if world.rain_prob <= 0 or world.precip_mm_day <= 0 or not world.water_available:
        return 0.0
    rng = np.random.default_rng([seed, day, 7])
    if rng.random() >= world.rain_prob:
        return 0.0
    mean = world.precip_mm_day / world.rain_prob
    return float(min(80.0, rng.exponential(mean)))


def base_hour(world: WorldClimate, hour: int, seed: int) -> HourEnv:
    """Undisturbed weather in one hour: diurnal temperature and light, daily rain."""
    d = world.day_hours
    hod = (hour + 0.5) % d
    local_day = int((hour + 0.5) // d)
    mid = (world.temp_day_c + world.temp_night_c) / 2.0
    amp = world.temp_day_c - world.temp_night_c
    t_max_at = d / 2.0 + 0.125 * d  # warmest early afternoon
    temp = mid + amp / 2.0 * math.cos(2.0 * math.pi * (hod - t_max_at) / d)

    rain = _rain_today(world, seed, local_day)
    rain_start = 0.6 * d
    raining = rain > 0 and rain_start <= hod < rain_start + 3.0
    # Presets give clear-sky light, so rain days darken them; catalogue worlds already use a
    # mean transmission that includes clouds.
    clouds = max(world.clouds, 0.8) if rain > 0 and world.clouds > 0 else world.clouds
    if world.constant_light or world.light_hours >= d:
        light, lit = 1.0, 1.0
    else:
        sunrise = (d - world.light_hours) / 2.0
        x = (hod - sunrise) / world.light_hours
        light = math.sin(math.pi * x) if 0.0 <= x <= 1.0 else 0.0
        lit = max(0.0, min(hod + 0.5, sunrise + world.light_hours) - max(hod - 0.5, sunrise))
    ppfd = world.ppfd_max * light * (1.0 - 0.6 * clouds)
    daylight = 1.0 if light > 0 else 0.0
    rh = min(
        1.0,
        max(
            0.02,
            world.rh
            + 0.1 * math.cos(2.0 * math.pi * (hod - 0.125 * d) / d)
            + (0.2 if raining else 0.0),
        ),
    )
    return HourEnv(
        hour=hour,
        hod=hod,
        temp_c=temp,
        soil_temp_c=world.temp_soil_c if world.temp_soil_c is not None else mid,
        rh=rh,
        precip_mm=rain / 3.0 if raining else 0.0,
        ppfd=ppfd,
        far_red=world.far_red_ratio,
        co2_ppm=world.co2_ppm,
        o2_kpa=world.o2_kpa,
        pressure_kpa=world.pressure_kpa,
        wind_ms=world.wind_ms * (0.7 + 0.5 * daylight),
        uv_rel=world.uv_rel * light,
        radiation_msv_yr=world.radiation_msv_yr,
        gravity_g=world.gravity_g,
        lit=lit,
    )
