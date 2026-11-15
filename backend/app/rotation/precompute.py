"""Precompute «Подобрать лучший план» for demo fields (docs/UX.md §8).

Run: python -m app.rotation.precompute
"""

from __future__ import annotations

import itertools

from app.geo import fields as geo
from app.rotation.advice import advice
from app.rotation.quick import quick

CHIPS = ("water", "income", "soil", "risk")


def main() -> None:
    for f in geo.demo_fields():
        p = f["properties"]
        irrigated, limit = bool(p.get("irrigated")), float(p.get("water_limit_m3_ha", 0))
        if p.get("current_plan"):
            quick(p["id"], [tuple(x) for x in p["current_plan"]], irrigated, limit / 10)
        combos = [[c] for c in CHIPS] + [list(c) for c in itertools.combinations(CHIPS, 2)]
        for combo in combos:
            advice(p["id"], combo, 4, irrigated, limit)
            print(p["id"], combo, flush=True)


if __name__ == "__main__":
    main()
