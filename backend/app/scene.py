"""Render parameters for the 3D views, derived from the computed environment. Pure functions.

Colours here are a visual model chosen to match the physics qualitatively (thin dusty CO2
gives a butterscotch sky, no atmosphere gives a black sky); they are not measurements.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

import numpy as np

from app.physics.environment import Environment

AU_KM = 149_597_870.7
RSUN_KM = 695_700.0
EARTH_RADIUS_KM = 6371.0

# Sun–Galactic Centre distance: GRAVITY Collaboration 2019, doi:10.1051/0004-6361/201935656.
SUN_GALACTOCENTRIC_PC = 8178.0
RED_DWARF_TEFF_K = 3900.0

# Moons in the solar-system seed share their parent's heliocentric orbit; the 3D system view
# draws them around the parent. Orbit radii from the NASA Planetary Fact Sheets.
MOON_PARENTS: dict[str, tuple[str, float]] = {
    "moon": ("earth", 384_400.0),
    "europa": ("jupiter", 671_100.0),
    "titan": ("saturn", 1_221_870.0),
    "enceladus": ("saturn", 238_020.0),
}

# Hand-picked globe palettes for solar-system bodies (procedural texture, no image assets).
KNOWN_PALETTES: dict[str, tuple[str, ...]] = {
    "mercury": ("#8c8580", "#6f6a66", "#a39e98"),
    "venus": ("#e3c98f", "#d4ad6a", "#f0dcb0"),
    "earth": ("#1f5fa8", "#2f7d3b", "#c9b27c", "#f2f5f7"),
    "moon": ("#9c9a96", "#6e6c69", "#b8b6b2"),
    "mars": ("#b5562f", "#8a3b22", "#d08a5b", "#f1e6dc"),
    "jupiter": ("#c9a37a", "#e8d7b9", "#9c6b48", "#f3ead8"),
    "saturn": ("#e2cf9c", "#cdb47d", "#f0e4c2"),
    "uranus": ("#9fd6dd", "#b6e3e8", "#86c4cc"),
    "neptune": ("#3f66c9", "#2c4ea6", "#5d84e0"),
    "titan": ("#d39a4b", "#b9802f", "#e6b46d"),
    "europa": ("#d9cfc0", "#a8794f", "#efe8dd"),
    "enceladus": ("#eef3f6", "#d6e2ea", "#ffffff"),
}

_TYPE_PALETTES: dict[str, tuple[str, ...]] = {
    "rocky": ("#8a7a6a", "#6b5d50", "#a8998a"),
    "desert": ("#b5562f", "#8a3b22", "#d08a5b"),
    "icy": ("#dfe9f2", "#b9cbd9", "#f4f8fb"),
    "ocean": ("#1f5fa8", "#2f6f9f", "#e8eef3"),
    "lava": ("#2b1d18", "#ff5a1f", "#5a3424"),
    "gas": ("#c9a37a", "#e8d7b9", "#9c6b48"),
}

_GROUND = {
    "soil": "#5b4a32",
    "ice": "#dfe9f2",
    "none": "#d8c9a8",
}


@dataclass(frozen=True, slots=True)
class PlanetLook:
    surface_type: str
    palette: tuple[str, ...]
    sky_day: str
    sky_horizon: str
    sky_sunset: str
    atmosphere_glow: str | None
    ground: str
    weather: str  # none | dust | snow | haze
    star_color: str
    star_angular_diameter_deg: float | None
    sun_intensity_rel: float


def star_rgb_hex(teff_k: float) -> str:
    """Approximate colour of a black body (Tanner Helland's fit to CIE data)."""
    t = max(1000.0, min(40000.0, teff_k)) / 100.0
    if t <= 66:
        r = 255.0
        g = 99.4708025861 * math.log(t) - 161.1195681661
        b = 0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307
    else:
        r = 329.698727446 * (t - 60) ** -0.1332047592
        g = 288.1221695283 * (t - 60) ** -0.0755148492
        b = 255.0

    def clamp(v: float) -> int:
        return int(max(0.0, min(255.0, v)))

    return f"#{clamp(r):02x}{clamp(g):02x}{clamp(b):02x}"


def surface_type(env: Environment) -> str:
    if not env.has_solid_surface:
        return "gas"
    if env.surface_temp_k > 1000.0:
        return "lava"
    if env.substrate == "ice" or (env.water in ("ice",) and env.surface_temp_k < 150.0):
        return "icy"
    if env.water == "abundant" and 273.15 < env.surface_temp_k < 373.15 and env.pressure_pa > 611.7:
        return "ocean"
    if env.substrate == "regolith" and 100.0 <= env.pressure_pa <= 2000.0:
        return "desert"
    return "rocky"


def _mix(a: str, b: str, t: float) -> str:
    ca = [int(a[i : i + 2], 16) for i in (1, 3, 5)]
    cb = [int(b[i : i + 2], 16) for i in (1, 3, 5)]
    c = [round(x + (y - x) * t) for x, y in zip(ca, cb, strict=True)]
    return "#" + "".join(f"{v:02x}" for v in c)


def sky_colours(env: Environment, kind: str) -> tuple[str, str, str, str | None]:
    """Day zenith, horizon, sunset and globe-limb glow colours."""
    p = env.pressure_pa
    if p < 100.0:
        return "#000000", "#05060a", "#000000", None
    if kind == "desert":  # dust-laden thin CO2: butterscotch day, bluish sunset
        return "#c9a27a", "#d9b892", "#6f8fb5", "#d9a77a"
    if env.surface_temp_k < 150.0 and p > 50_000.0:  # photochemical haze (Titan)
        return "#c98a3a", "#dba25a", "#8a5a2a", "#d9963f"
    if p > 1_000_000.0:  # very dense, cloudy
        return "#d9b36c", "#e3c48a", "#a8763a", "#f0d49a"
    strength = min(1.0, p / 101_325.0)
    day = _mix("#20283a", "#5f9fe0", strength)
    horizon = _mix("#2a3142", "#b9d6f2", strength)
    sunset, glow = "#f08a4b", _mix("#8fb8ff", "#6fa8ff", strength)
    if kind == "icy":  # cold, clear: pale blue
        day, horizon = _mix(day, "#a9c4dc", 0.6), _mix(horizon, "#dce8f2", 0.6)
    if env.teff_k < RED_DWARF_TEFF_K:
        # Little blue light to scatter under a red dwarf: a dark burgundy sky (visual model).
        k = min(1.0, (RED_DWARF_TEFF_K - env.teff_k) / 1400.0)
        day, horizon = _mix(day, "#3a1418", 0.5 + 0.5 * k), _mix(horizon, "#6a2a22", 0.5 + 0.5 * k)
        sunset, glow = "#a8402a", _mix(glow, "#c0504a", k)
    return day, horizon, sunset, glow


def angular_diameter_deg(star_radius_rsun: float | None, distance_au: float | None) -> float | None:
    if not star_radius_rsun or not distance_au:
        return None
    return math.degrees(2.0 * math.atan(star_radius_rsun * RSUN_KM / (distance_au * AU_KM)))


def planet_look(
    env: Environment,
    planet_id: str,
    star_radius_rsun: float | None,
    semi_major_axis_au: float | None,
) -> PlanetLook:
    kind = surface_type(env)
    palette = KNOWN_PALETTES.get(planet_id, _TYPE_PALETTES[kind])
    day, horizon, sunset, glow = sky_colours(env, kind)
    if env.substrate in _GROUND:
        ground = _GROUND[env.substrate]
    else:
        ground = palette[1] if planet_id in KNOWN_PALETTES else _TYPE_PALETTES[kind][1]
    if kind == "desert":
        weather = "dust"
    elif env.pressure_pa >= 100.0 and env.surface_temp_k < 273.15 and kind != "gas":
        weather = "haze" if env.surface_temp_k < 150.0 else "snow"
    else:
        weather = "none"
    return PlanetLook(
        surface_type=kind,
        palette=palette,
        sky_day=day,
        sky_horizon=horizon,
        sky_sunset=sunset,
        atmosphere_glow=glow,
        ground=ground,
        weather=weather,
        star_color=star_rgb_hex(env.teff_k),
        star_angular_diameter_deg=angular_diameter_deg(star_radius_rsun, semi_major_axis_au),
        sun_intensity_rel=env.insolation_earth * env.vis_transmission / 0.55,
    )


# --- Galaxies -------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class GalaxyDef:
    id: str
    name_ru: str
    real: bool
    shape: str
    description_ru: str
    distance_kpc: float | None
    distance_reference: str | None
    radius_pc: float
    arms: int
    preset: str
    seed: int


# Shapes, radii and arm counts are a visual model (estimates); distances are measured.
GALAXIES: dict[str, GalaxyDef] = {
    g.id: g
    for g in (
        GalaxyDef(
            "milky_way",
            "Млечный Путь",
            True,
            "spiral",
            "Наша галактика: все известные экзопланеты находятся в окрестности Солнца.",
            0.0,
            None,
            15_000.0,
            4,
            "milky_way",
            42,
        ),
        GalaxyDef(
            "lmc",
            "Большое Магелланово Облако",
            True,
            "irregular",
            "Спутник Млечного Пути. Подтверждённых планет нет — только гипотетические миры.",
            49.59,
            "doi:10.1038/s41586-019-0999-4",
            4_300.0,
            1,
            "magellanic",
            42,
        ),
        GalaxyDef(
            "smc",
            "Малое Магелланово Облако",
            True,
            "irregular",
            "Карликовый спутник Млечного Пути. Подтверждённых планет нет.",
            62.44,
            "doi:10.3847/1538-4357/abbb2b",
            2_800.0,
            0,
            "magellanic",
            1001,
        ),
        GalaxyDef(
            "m31",
            "Андромеда (M31)",
            True,
            "spiral",
            "Ближайшая крупная спиральная галактика. Подтверждённых планет нет.",
            785.0,
            "doi:10.1111/j.1365-2966.2004.08514.x",
            23_000.0,
            2,
            "milky_way",
            2001,
        ),
        GalaxyDef(
            "elliptical",
            "Эллиптическая галактика",
            False,
            "elliptical",
            "Гипотетическая: старое звёздное население, мало сверхновых.",
            None,
            None,
            20_000.0,
            0,
            "elliptical",
            42,
        ),
        GalaxyDef(
            "dwarf",
            "Карликовая галактика",
            False,
            "dwarf",
            "Гипотетическая: малая масса и низкая металличность.",
            None,
            None,
            1_500.0,
            0,
            "dwarf",
            42,
        ),
        GalaxyDef(
            "starburst",
            "Галактика со вспышкой звёздообразования",
            False,
            "starburst",
            "Гипотетическая: много молодых звёзд, высокий фон излучения.",
            None,
            None,
            6_000.0,
            2,
            "starburst",
            42,
        ),
    )
}


def hypothetical_prefix(galaxy: GalaxyDef) -> str:
    return f"hyp-{galaxy.preset}-{galaxy.seed}-"


def galaxy_of_planet(planet_id: str, kind: str) -> str:
    if kind != "hypothetical":
        return "milky_way"
    for galaxy in GALAXIES.values():
        if planet_id.startswith(hypothetical_prefix(galaxy)):
            return galaxy.id
    return "milky_way"


def hypothetical_position_pc(star_id: str, galaxy: GalaxyDef) -> tuple[float, float, float]:
    """Deterministic made-up position inside the galaxy's visual shape (galaxy-centred, pc)."""
    seed = int(hashlib.sha256(star_id.encode()).hexdigest()[:12], 16)
    rng = np.random.default_rng(seed)
    radius = galaxy.radius_pc
    if galaxy.shape in ("spiral", "starburst") and galaxy.arms > 0:
        r = radius * (0.15 + 0.8 * math.sqrt(rng.random()))
        arm = int(rng.integers(0, galaxy.arms))
        pitch = math.radians(12.0)
        theta = 2 * math.pi * arm / galaxy.arms + math.log(r / (0.15 * radius)) / math.tan(pitch)
        theta += rng.normal(0.0, 0.25)
        return r * math.cos(theta), r * math.sin(theta), float(rng.normal(0.0, radius * 0.01))
    if galaxy.shape == "elliptical":
        x, y, z = rng.normal(0.0, radius / 3.0, 3)
        return float(x), float(y), float(z * 0.7)
    x, y, z = rng.normal(0.0, radius / 2.5, 3)
    return float(x), float(y), float(z / 3.0)
