"""Development stage of the crop and the sensitivity row that applies to it. Pure."""

from __future__ import annotations

from app.biology.morphology import Morphology, stage_of
from app.sim.data import StageSensitivity, stage_sensitivity


def sensitivity_stage(progress: float, morph: Morphology) -> str:
    stage = stage_of(progress, morph, dead=False)
    if stage == "flowering":
        return "flowering"
    if stage in ("fruiting", "mature"):
        return "fruiting"
    return "vegetative"


def sensitivity(crop_id: str, progress: float, morph: Morphology) -> StageSensitivity:
    return stage_sensitivity()[(crop_id, sensitivity_stage(progress, morph))]
