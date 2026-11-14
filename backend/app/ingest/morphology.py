"""Read the curated crop morphology table (data/seed/crop_morphology.csv)."""

from __future__ import annotations

import csv
from functools import lru_cache

from app import config
from app.biology.morphology import Morphology


def _optional_float(value: str) -> float | None:
    return float(value) if value.strip() else None


@lru_cache(maxsize=1)
def load_morphology() -> dict[str, Morphology]:
    path = config.SEED_DIR / "crop_morphology.csv"
    with path.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return {
        row["crop_id"]: Morphology(
            crop_id=row["crop_id"],
            harvest_organ=row["harvest_organ"],
            growth_form=row["growth_form"],
            height_max_m=float(row["height_max_m"]),
            biomass_max_g=float(row["biomass_max_g"]),
            harvest_index=float(row["harvest_index"]),
            organ_count_max=int(row["organ_count_max"]),
            leaf_count_max=int(row["leaf_count_max"]),
            lai_max=float(row["lai_max"]),
            flowering_frac=_optional_float(row["flowering_frac"]),
            organ_init_frac=float(row["organ_init_frac"]),
        )
        for row in rows
    }
