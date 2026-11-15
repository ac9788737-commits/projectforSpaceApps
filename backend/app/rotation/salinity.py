"""Salinity risk trigger (docs/IMPROVEMENTS.md B8): a clear warning, not a salt model.

Irrigated field + heavy soil + high evaporative demand + much irrigation water (or furrows).
Thresholds: data/seed/salinity_rules.csv (estimates; direction from FAO-29).
"""

from __future__ import annotations

import csv
from functools import lru_cache
from typing import Any

from app import config


@lru_cache(maxsize=1)
def rules() -> dict[str, float]:
    with open(config.SEED_DIR / "salinity_rules.csv", newline="", encoding="utf-8") as f:
        return {r["id"]: float(r["threshold"]) for r in csv.DictReader(f)}


def salinity_risk(
    irrigated: bool, method: str | None, clay_pct: float, et0_mm: float, irrigation_m3: float
) -> dict[str, Any]:
    r = rules()
    heavy = clay_pct >= r["clay_pct_min"]
    arid = et0_mm >= r["et0_mm_min"]
    much_water = irrigation_m3 >= r["irrigation_m3_min"] or (
        method == "furrow" and r["furrow_counts"] > 0
    )
    risk = irrigated and heavy and arid and much_water
    reasons = []
    if irrigated and risk:
        reasons = [
            f"тяжёлая почва ({round(clay_pct)} % глины)",
            f"сильное испарение ({round(et0_mm, -1):.0f} мм в год)",
            "полив по бороздам"
            if method == "furrow"
            else f"много воды ({round(irrigation_m3, -2):.0f} м³/га)",
        ]
    return {
        "risk": risk,
        "reasons": reasons,
        "text": (
            "Риск засоления: проверьте дренаж; помогут промывка, капельный полив "
            "и глубококорневые культуры"
        )
        if risk
        else None,
    }
