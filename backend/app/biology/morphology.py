"""Plant morphology over the crop cycle: stages, biomass partitioning, visible traits.

Pure functions. Morphology parameters are estimates (see data/seed/crop_morphology.csv);
they shape how a plant looks and how its biomass is split, while the relative yield
itself comes only from the growth factors in `growth.py`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

Stage = Literal["seed", "germination", "vegetative", "flowering", "fruiting", "mature", "dead"]

SEED_END = 0.02
GERMINATION_END = 0.08
_BIOMASS_STEEPNESS = 10.0
_BIOMASS_MIDPOINT = 0.5
_HEIGHT_STEEPNESS = 9.0
_HEIGHT_MIDPOINT = 0.35
_ORGAN_SET_SPAN = 0.15
# Visual modifiers: an etiolated plant is up to 30% taller, a low-gravity one up to 15%.
ETIOLATION_STRETCH = 0.3
LOW_GRAVITY_STRETCH = 0.15


@dataclass(frozen=True, slots=True)
class Morphology:
    crop_id: str
    harvest_organ: str
    growth_form: str
    height_max_m: float
    biomass_max_g: float
    harvest_index: float
    organ_count_max: int
    leaf_count_max: int
    lai_max: float
    flowering_frac: float | None
    organ_init_frac: float


def _logistic(x: float, steepness: float, midpoint: float) -> float:
    return 1.0 / (1.0 + math.exp(-steepness * (x - midpoint)))


def _normalised_logistic(p: float, steepness: float, midpoint: float) -> float:
    """Logistic curve rescaled so that it is exactly 0 at p=0 and 1 at p=1."""
    p = min(max(p, 0.0), 1.0)
    low = _logistic(0.0, steepness, midpoint)
    high = _logistic(1.0, steepness, midpoint)
    return (_logistic(p, steepness, midpoint) - low) / (high - low)


def potential_biomass_fraction(progress: float) -> float:
    """Share of final biomass accumulated by a crop in ideal conditions at this progress."""
    return _normalised_logistic(progress, _BIOMASS_STEEPNESS, _BIOMASS_MIDPOINT)


def height_fraction(progress: float) -> float:
    """Share of final height reached at this progress; stems finish growing early."""
    return _normalised_logistic(min(progress / 0.8, 1.0), _HEIGHT_STEEPNESS, _HEIGHT_MIDPOINT)


def harvest_share(progress: float, morph: Morphology) -> float:
    """Fraction of the harvest index realised: zero before organ initiation, one at maturity."""
    if morph.organ_init_frac <= 0.0:
        return 1.0
    if progress <= morph.organ_init_frac:
        return 0.0
    return min(1.0, (progress - morph.organ_init_frac) / (1.0 - morph.organ_init_frac))


def stage_of(progress: float, morph: Morphology, dead: bool) -> Stage:
    if dead:
        return "dead"
    if progress < SEED_END:
        return "seed"
    if progress < GERMINATION_END:
        return "germination"
    if progress >= 1.0:
        return "mature"
    if morph.flowering_frac is None or progress < morph.flowering_frac:
        return "vegetative"
    if progress < max(morph.organ_init_frac, morph.flowering_frac + 0.05):
        return "flowering"
    return "fruiting"


@dataclass(frozen=True, slots=True)
class VisibleTraits:
    height_m: float
    leaf_count: int
    leaf_area_index: float
    yield_g: float
    organ_count: int


def visible_traits(
    progress: float,
    biomass_g: float,
    vigour: float,
    organ_vigour: float,
    light_stress: float,
    gravity_g: float,
    morph: Morphology,
) -> VisibleTraits:
    """Traits drawn by the 3D view.

    `vigour` is actual / potential biomass so far, `organ_vigour` the vigour when the
    harvest organs were set. Stretching by low light and low gravity is a visual model.
    """
    vigour = min(max(vigour, 0.0), 1.0)
    stretch = 1.0 + ETIOLATION_STRETCH * min(max(light_stress, 0.0), 1.0)
    stretch *= 1.0 + LOW_GRAVITY_STRETCH * min(max(1.0 - gravity_g, 0.0), 1.0)
    height = morph.height_max_m * height_fraction(progress) * (0.4 + 0.6 * vigour) * stretch
    canopy = height_fraction(progress) * (0.3 + 0.7 * vigour)
    leaves = round(morph.leaf_count_max * canopy)
    lai = morph.lai_max * canopy
    yield_g = biomass_g * morph.harvest_index * harvest_share(progress, morph)
    organs = 0
    if morph.organ_count_max > 0 and progress > morph.organ_init_frac:
        if morph.organ_init_frac <= 0.0:
            organs = morph.organ_count_max if biomass_g > 0 else 0
        else:
            set_share = min(1.0, (progress - morph.organ_init_frac) / _ORGAN_SET_SPAN)
            vigour_share = min(max(organ_vigour, 0.1), 1.0)
            organs = max(1, round(morph.organ_count_max * set_share * vigour_share))
    return VisibleTraits(height, leaves, lai, yield_g, organs)
