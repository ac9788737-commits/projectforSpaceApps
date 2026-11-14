"""Galaxy environment presets and a generator of hypothetical planets.

No confirmed planets exist outside the Milky Way, so everything produced here is a labelled
hypothesis. Preset numbers are coarse estimates, see docs/ASSUMPTIONS.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.random import Generator
from sqlmodel import Session

from app.ingest.common import log_ingest, provenance_for
from app.models.db import Planet, Star
from app.physics.climate import habitable_zone_au

SOURCE = "galaxies"
SOURCE_LABEL = "AstroCrop generator (hypothetical, estimate)"
SOURCE_URL = ""
RETRIEVED_AT = "2026-11-09"
BOOTSTRAP_COUNT = 12
BOOTSTRAP_SEED = 42
# Extra generated sets so that galaxies sharing a preset get their own hypothetical systems.
EXTRA_SETS: tuple[tuple[str, int], ...] = (("magellanic", 1001), ("milky_way", 2001))

# Representative main-sequence stars per class: Teff K, L/Lsun, M/Msun, R/Rsun.
_STAR_CLASSES: dict[str, tuple[float, float, float, float]] = {
    "F": (6500.0, 3.2, 1.3, 1.4),
    "G": (5770.0, 1.0, 1.0, 1.0),
    "K": (4600.0, 0.25, 0.75, 0.75),
    "M": (3300.0, 0.02, 0.3, 0.35),
}
_PLANET_FIELDS = [
    "insolation_earth",
    "mass_earth",
    "radius_earth",
    "semi_major_axis_au",
    "extra_radiation_msv_yr",
]
_BASE_GCR_MSV_YR = 336.0


@dataclass(frozen=True, slots=True)
class GalaxyPreset:
    id: str
    name_ru: str
    description_ru: str
    metallicity_feh: float
    cosmic_ray_factor: float
    supernova_rate_factor: float
    spectral_mix: dict[str, float]
    estimate: bool = True


PRESETS: dict[str, GalaxyPreset] = {
    "milky_way": GalaxyPreset(
        "milky_way",
        "Млечный Путь",
        "Диск спиральной галактики, солнечная окрестность: опорный вариант.",
        0.0,
        1.0,
        1.0,
        {"F": 0.05, "G": 0.15, "K": 0.25, "M": 0.55},
    ),
    "magellanic": GalaxyPreset(
        "magellanic",
        "Магеллановы Облака",
        "Карликовые спутники Млечного Пути с пониженной металличностью.",
        -0.5,
        0.8,
        1.5,
        {"F": 0.07, "G": 0.15, "K": 0.23, "M": 0.55},
    ),
    "elliptical": GalaxyPreset(
        "elliptical",
        "Эллиптическая галактика",
        "Старое звёздное население: мало массивных звёзд и новых сверхновых.",
        0.2,
        0.5,
        0.3,
        {"F": 0.01, "G": 0.10, "K": 0.29, "M": 0.60},
    ),
    "dwarf": GalaxyPreset(
        "dwarf",
        "Карликовая галактика",
        "Малая масса и низкая металличность, каменистые планеты редки.",
        -1.3,
        0.6,
        0.5,
        {"F": 0.05, "G": 0.15, "K": 0.25, "M": 0.55},
    ),
    "starburst": GalaxyPreset(
        "starburst",
        "Галактика со вспышкой звёздообразования",
        "Много молодых массивных звёзд, высокий фон космических лучей и сверхновых.",
        0.0,
        20.0,
        30.0,
        {"F": 0.12, "G": 0.20, "K": 0.25, "M": 0.43},
    ),
}


def _draw_class(rng: Generator, mix: dict[str, float]) -> str:
    classes = list(mix)
    probabilities = np.array([mix[c] for c in classes], dtype=float)
    return str(rng.choice(classes, p=probabilities / probabilities.sum()))


def generate(preset_id: str, count: int, seed: int) -> list[tuple[Star, Planet]]:
    """Deterministically generate hypothetical habitable-zone rocky planets for a preset."""
    preset = PRESETS[preset_id]
    rng = np.random.default_rng(seed)
    # Lower metallicity shifts planet formation towards smaller bodies.
    mass_scale = 10.0 ** (0.3 * preset.metallicity_feh)
    result: list[tuple[Star, Planet]] = []
    for index in range(count):
        klass = _draw_class(rng, preset.spectral_mix)
        teff, luminosity, star_mass, star_radius = _STAR_CLASSES[klass]
        teff = float(teff * rng.uniform(0.95, 1.05))
        inner, outer = habitable_zone_au(luminosity, teff)
        a_au = float(rng.uniform(inner, outer))
        mass = float(10.0 ** rng.uniform(-0.5, 0.7) * mass_scale)
        radius = float(mass**0.27)
        extra = max(0.0, (preset.cosmic_ray_factor - 1.0) * _BASE_GCR_MSV_YR)
        extra += max(0.0, preset.supernova_rate_factor - 1.0) * 10.0

        label = f"{preset.name_ru} — гипотетическая {index + 1:03d}"
        planet_id = f"hyp-{preset_id}-{seed}-{index + 1:03d}"
        star_id = f"star-{planet_id}"
        star = Star(
            id=star_id,
            name=f"Звезда класса {klass} ({label})",
            teff_k=teff,
            radius_rsun=star_radius,
            mass_msun=star_mass,
            luminosity_lsun=luminosity,
            spectral_type=f"{klass}V",
            source=SOURCE_LABEL,
            source_url=SOURCE_URL,
            retrieved_at=RETRIEVED_AT,
        )
        values: dict[str, Any] = {
            "insolation_earth": luminosity / a_au**2,
            "mass_earth": mass,
            "radius_earth": radius,
            "semi_major_axis_au": a_au,
            "extra_radiation_msv_yr": extra,
        }
        planet = Planet(
            id=planet_id,
            name=label,
            name_ru=label,
            kind="hypothetical",
            hypothetical=True,
            galaxy_preset=preset_id,
            star_id=star_id,
            has_solid_surface=True,
            in_habitable_zone=True,
            source=SOURCE_LABEL,
            source_url=SOURCE_URL,
            retrieved_at=RETRIEVED_AT,
            provenance=provenance_for(
                _PLANET_FIELDS, values, SOURCE_LABEL, SOURCE_URL, RETRIEVED_AT, set(_PLANET_FIELDS)
            ),
            **values,
        )
        result.append((star, planet))
    return result


def persist(session: Session, generated: list[tuple[Star, Planet]]) -> int:
    for star, _ in generated:
        session.merge(star)
    session.commit()
    for _, planet in generated:
        session.merge(planet)
    session.commit()
    return len(generated)


def ingest(session: Session) -> tuple[str, int, str | None]:
    total = 0
    for preset_id in PRESETS:
        total += persist(session, generate(preset_id, BOOTSTRAP_COUNT, BOOTSTRAP_SEED))
    for preset_id, seed in EXTRA_SETS:
        total += persist(session, generate(preset_id, BOOTSTRAP_COUNT, seed))
    log_ingest(session, SOURCE, "seed", total)
    return "seed", total, None
