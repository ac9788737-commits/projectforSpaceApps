"""Curated tables for the farmer simulator (data/seed/*.csv). Read-only, cached."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache

from app import config


def _f(value: str) -> float | None:
    return float(value) if value.strip() else None


@dataclass(frozen=True, slots=True)
class SoilType:
    id: str
    name_ru: str
    field_capacity: float  # volumetric fraction
    wilting_point: float
    saturation: float
    drainage_mm_h: float
    soil_factor: float
    estimate: bool


@dataclass(frozen=True, slots=True)
class StageSensitivity:
    crop_id: str
    stage: str  # vegetative | flowering | fruiting
    frost_onset_c: float
    frost_kill_c: float | None  # None → EcoCrop KTMP of the crop
    frost_kill_hours: float
    heat_onset_c: float
    sterility_onset_c: float | None
    sterility_per_degree_hour: float
    warm_night_tuber_c: float | None
    waterlog_onset_h: float | None  # None → tolerant (paddy rice, culture tank)
    lodging_wind_ms: float
    estimate: bool
    reference: str


@lru_cache(maxsize=1)
def soil_types() -> dict[str, SoilType]:
    with (config.SEED_DIR / "soil_types.csv").open(encoding="utf-8") as fh:
        return {
            r["soil"]: SoilType(
                id=r["soil"],
                name_ru=r["name_ru"],
                field_capacity=float(r["field_capacity_frac"]),
                wilting_point=float(r["wilting_point_frac"]),
                saturation=float(r["saturation_frac"]),
                drainage_mm_h=float(r["drainage_mm_h"]),
                soil_factor=float(r["soil_factor"]),
                estimate=r["estimate"] == "true",
            )
            for r in csv.DictReader(fh)
        }


@lru_cache(maxsize=1)
def stage_sensitivity() -> dict[tuple[str, str], StageSensitivity]:
    with (config.SEED_DIR / "crop_stage_sensitivity.csv").open(encoding="utf-8") as fh:
        out: dict[tuple[str, str], StageSensitivity] = {}
        for r in csv.DictReader(fh):
            out[(r["crop_id"], r["stage"])] = StageSensitivity(
                crop_id=r["crop_id"],
                stage=r["stage"],
                frost_onset_c=float(r["frost_onset_c"]),
                frost_kill_c=_f(r["frost_kill_c"]),
                frost_kill_hours=float(r["frost_kill_hours"]),
                heat_onset_c=float(r["heat_onset_c"]),
                sterility_onset_c=_f(r["sterility_onset_c"]),
                sterility_per_degree_hour=_f(r["sterility_per_degree_hour"]) or 0.0,
                warm_night_tuber_c=_f(r["warm_night_tuber_c"]),
                waterlog_onset_h=_f(r["waterlog_onset_h"]),
                lodging_wind_ms=float(r["lodging_wind_ms"]),
                estimate=r["estimate"] == "true",
                reference=r["reference"],
            )
        return out


@lru_cache(maxsize=1)
def world_preset_rows() -> dict[str, dict[str, str]]:
    with (config.SEED_DIR / "world_presets.csv").open(encoding="utf-8") as fh:
        return {r["id"]: r for r in csv.DictReader(fh)}
