"""Prices and costs (data/seed/economics_world.csv); the farmer may override any value."""

from __future__ import annotations

import csv
from dataclasses import dataclass, replace
from functools import lru_cache

from app import config


@dataclass(frozen=True, slots=True)
class CropEconomics:
    crop: str
    price_usd_t: float
    seed_usd_ha: float
    ops_usd_ha: float
    labour_h_ha: float
    machinery: str | None
    estimate: bool
    reference: str


@dataclass(frozen=True, slots=True)
class Economics:
    crops: dict[str, CropEconomics]
    n_usd_kg: float
    water_usd_m3: float
    references: tuple[str, ...]

    def with_prices(self, prices: dict[str, float]) -> Economics:
        crops = {
            k: (replace(v, price_usd_t=float(prices[k])) if k in prices else v)
            for k, v in self.crops.items()
        }
        return replace(
            self,
            crops=crops,
            n_usd_kg=float(prices.get("_n_fertiliser", self.n_usd_kg * 1000)) / 1000,
            water_usd_m3=float(prices.get("_water", self.water_usd_m3)),
        )


@lru_cache(maxsize=1)
def default_economics() -> Economics:
    crops: dict[str, CropEconomics] = {}
    n_price = 0.735
    water = 0.02
    refs: set[str] = set()
    with open(config.SEED_DIR / "economics_world.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["reference"]:
                refs.add(r["reference"])
            if r["item"] == "_n_fertiliser":
                n_price = float(r["price_usd_t"]) / 1000
                continue
            if r["item"] == "_water":
                water = float(r["price_usd_t"])
                continue
            crops[r["item"]] = CropEconomics(
                r["item"],
                float(r["price_usd_t"]),
                float(r["seed_usd_ha"] or 0),
                float(r["ops_usd_ha"] or 0),
                float(r["labour_h_ha"] or 0),
                r["machinery"] or None,
                r["estimate"] == "true",
                r["reference"],
            )
    return Economics(crops, n_price, water, tuple(sorted(refs)))
