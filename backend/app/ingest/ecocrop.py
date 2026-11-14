"""Crop parameters: FAO EcoCrop export joined with the curated physiology table."""

from __future__ import annotations

from typing import Any

import polars as pl
from sqlmodel import Session

from app import config
from app.ingest.common import log_ingest, provenance_for
from app.models.db import Crop

SOURCE = "ecocrop"
ECOCROP_SOURCE = "FAO EcoCrop (R package Recocrop export)"
ECOCROP_URL = "https://cran.r-project.org/package=Recocrop"
ECOCROP_RETRIEVED_AT = "2026-11-09"
_CYCLE_QUARTILE = 0.25
_ECOCROP_FIELDS = [
    "t_kill_c",
    "t_min_c",
    "t_opt_min_c",
    "t_opt_max_c",
    "t_max_c",
    "ph_min",
    "ph_max",
    "cycle_days",
]
_PHYSIOLOGY_FIELDS = [
    "photosynthesis",
    "ppfd_comp",
    "ppfd_sat",
    "dli_min",
    "dli_opt",
    "o2_min_kpa",
    "uv_tolerance_rel",
    "p_min_kpa",
    "max_dark_hours",
    "continuous_light_ok",
    "aquatic",
    "yield_kg_m2_cycle",
]
_FLOATS = [
    "ppfd_comp",
    "ppfd_sat",
    "dli_min",
    "dli_opt",
    "o2_min_kpa",
    "uv_tolerance_rel",
    "p_min_kpa",
    "max_dark_hours",
    "yield_kg_m2_cycle",
    "t_kill_c",
    "t_min_c",
    "t_opt_min_c",
    "t_opt_max_c",
    "t_max_c",
    "ph_min",
    "ph_max",
    "cycle_days",
]


def read_merged() -> pl.DataFrame:
    """Physiology rows with EcoCrop thresholds; own columns win for crops absent from EcoCrop."""
    physiology = pl.read_csv(config.SEED_DIR / "crop_physiology.csv", infer_schema_length=0)
    physiology = physiology.with_columns(pl.col(_FLOATS).cast(pl.Float64))
    ecocrop = pl.read_csv(config.SEED_DIR / "ecocrop.csv", infer_schema_length=0).select(
        pl.col("NAME").alias("ecocrop_name"),
        pl.col("KTMP").cast(pl.Float64).alias("eco_t_kill_c"),
        pl.col("TMIN").cast(pl.Float64).alias("eco_t_min_c"),
        pl.col("TOPMN").cast(pl.Float64).alias("eco_t_opt_min_c"),
        pl.col("TOPMX").cast(pl.Float64).alias("eco_t_opt_max_c"),
        pl.col("TMAX").cast(pl.Float64).alias("eco_t_max_c"),
        pl.col("PHMIN").cast(pl.Float64).alias("eco_ph_min"),
        pl.col("PHMAX").cast(pl.Float64).alias("eco_ph_max"),
        (
            pl.col("GMIN").cast(pl.Float64)
            + _CYCLE_QUARTILE * (pl.col("GMAX").cast(pl.Float64) - pl.col("GMIN").cast(pl.Float64))
        ).alias("eco_cycle_days"),
    )
    merged = physiology.join(ecocrop, on="ecocrop_name", how="left")
    return merged.with_columns(
        pl.coalesce(f"eco_{name}", name).alias(name) for name in _ECOCROP_FIELDS
    )


def _row_to_crop(row: dict[str, Any]) -> Crop:
    has_ecocrop = row["ecocrop_name"] is not None
    values: dict[str, Any] = {name: row[name] for name in _ECOCROP_FIELDS + _PHYSIOLOGY_FIELDS}
    values["continuous_light_ok"] = row["continuous_light_ok"] == "true"
    values["aquatic"] = row["aquatic"] == "true"
    estimate = row["estimate"] == "true"
    curated = "data/seed/crop_physiology.csv"
    provenance = provenance_for(
        _PHYSIOLOGY_FIELDS,
        values,
        row["reference"] or curated,
        "",
        ECOCROP_RETRIEVED_AT,
        set(_PHYSIOLOGY_FIELDS) if estimate else None,
    )
    provenance |= provenance_for(
        _ECOCROP_FIELDS,
        values,
        ECOCROP_SOURCE if has_ecocrop else curated,
        ECOCROP_URL if has_ecocrop else "",
        ECOCROP_RETRIEVED_AT,
        None if has_ecocrop else set(_ECOCROP_FIELDS),
    )
    return Crop(
        id=row["id"],
        name_ru=row["name_ru"],
        name_en=row["name_en"],
        group=row["group"],
        estimate=estimate,
        reference=row["reference"],
        notes=row["notes"],
        source=ECOCROP_SOURCE if has_ecocrop else curated,
        source_url=ECOCROP_URL if has_ecocrop else "",
        retrieved_at=ECOCROP_RETRIEVED_AT,
        provenance=provenance,
        **values,
    )


def ingest(session: Session) -> tuple[str, int, str | None]:
    rows = read_merged().to_dicts()
    for row in rows:
        session.merge(_row_to_crop(row))
    session.commit()
    log_ingest(session, SOURCE, "seed", len(rows))
    return "seed", len(rows), None
