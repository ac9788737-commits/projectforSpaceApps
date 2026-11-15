"""Field, rotation slots and the soil state carried from season to season (ROTATION.md §1.1)."""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Literal

from app import config
from app.rotation.crops import TextureClass, texture_classes, usda_texture
from app.rotation.erosion import epic_k_factor, ls_factor


@lru_cache(maxsize=1)
def irrigation_methods() -> dict[str, dict[str, object]]:
    """Irrigation methods: field application efficiency (FAO) and yearly cost (estimate)."""
    with open(config.SEED_DIR / "irrigation_methods.csv", newline="", encoding="utf-8") as f:
        return {
            r["id"]: {
                "name_ru": r["name_ru"],
                "efficiency": float(r["efficiency"]),
                "cost_usd_ha_yr": float(r["cost_usd_ha_yr"]),
                "reference": r["reference"],
                "estimate": r["estimate"] == "true",
            }
            for r in csv.DictReader(f)
        }


Season = Literal["main", "cover", "fallow"]
TOPSOIL_CM = 30.0
PROFILE_M = 1.5  # soil water profile that roots can explore (estimate)


@dataclass(frozen=True, slots=True)
class FieldSite:
    """A real field: where it is and what its soil and slope are."""

    id: str
    name: str
    lat: float
    lon: float
    area_ha: float
    sand_pct: float
    clay_pct: float
    soc_pct: float  # organic carbon, 0–30 cm
    bulk_density: float = 1.35  # g/cm3
    ph: float = 7.0
    slope_pct: float = 2.0
    slope_length_m: float = 50.0
    practice_p: float = 1.0  # RUSLE P: 1 = up and down the slope
    irrigated: bool = False
    irrigation_limit_mm: float = 0.0  # per year, water taken from the source; 1 mm = 10 m3/ha
    irrigation_method: str | None = None  # none | furrow | drip; None = net water (stage 7)
    n_mineral_kg_ha: float = 40.0  # at the start of the plan (estimate unless measured)

    @property
    def irrigation_efficiency(self) -> float:
        if not self.irrigation_method:
            return 1.0
        return float(irrigation_methods()[self.irrigation_method]["efficiency"]) or 1.0  # type: ignore[arg-type]

    @property
    def texture(self) -> TextureClass:
        return texture_classes()[usda_texture(self.sand_pct, self.clay_pct)]

    @property
    def taw_mm(self) -> float:
        t = self.texture
        return 1000 * (t.theta_fc - t.theta_wp) * PROFILE_M

    @property
    def k_factor(self) -> float:
        silt = max(0.0, 100 - self.sand_pct - self.clay_pct)
        return epic_k_factor(self.sand_pct, silt, self.clay_pct, self.soc_pct)

    @property
    def ls(self) -> float:
        return ls_factor(self.slope_pct, self.slope_length_m)

    def soc_kg_ha(self, soc_pct: float) -> float:
        return soc_pct / 100 * self.bulk_density * TOPSOIL_CM * 1e5 / 1000 * 1000

    def soc_pct_of(self, kg_ha: float) -> float:
        return kg_ha / (self.bulk_density * TOPSOIL_CM * 1e5) * 100


@dataclass(frozen=True, slots=True)
class Slot:
    year: int  # 0-based year of the rotation
    season: Season
    crop: str | None  # None = bare ("голое поле")
    sow_mmdd: str | None = None  # default from the crop table / after the main harvest
    end_mmdd: str | None = None  # cover crops: termination date (default: before next sowing)
    fert_n_kg_ha: float = 0.0
    irrigate: bool = True  # only matters when the field is irrigated


@dataclass(frozen=True, slots=True)
class Rotation:
    id: str
    name: str
    years: int
    slots: tuple[Slot, ...]

    def main(self, year: int) -> Slot | None:
        return next((s for s in self.slots if s.year == year and s.season == "main"), None)

    def cover(self, year: int) -> Slot | None:
        return next((s for s in self.slots if s.year == year and s.season == "cover"), None)


# Nitrogen fertiliser a farmer can skip after a legume (kg N/ha) — estimates within the usual
# 20–60 kg/ha after grain legumes and 40–100 kg/ha after green-manure legumes.
LEGUME_N_CREDIT: dict[str, float] = {
    "pea": 30.0,
    "chickpea": 30.0,
    "soybean": 30.0,
    "alfalfa": 60.0,
    "vetch": 40.0,
    "clover": 40.0,
}


def n_credit(plan: list[tuple[str | None, str | None]], year: int) -> float:
    """Fertiliser saved in `year` thanks to last year's legume crop and/or legume cover."""
    if year == 0:
        return 0.0
    m, c = plan[year - 1]
    return LEGUME_N_CREDIT.get(m or "", 0.0) + LEGUME_N_CREDIT.get(c or "", 0.0)


def rotation_from_plan(
    rid: str,
    name: str,
    plan: list[tuple[str | None, str | None]],
    fert: dict[str, float] | None = None,
    sow: dict[str, str] | None = None,
    irrigate: bool = True,
    legume_credit: bool = False,
) -> Rotation:
    """Shorthand: [(main crop, cover crop after it), ...] one tuple per year.

    With `legume_credit`, the N dose after a legume is cut by LEGUME_N_CREDIT (the farmer
    applies less fertiliser), so the saving shows up in the margin."""
    slots: list[Slot] = []
    for y, (main, cover) in enumerate(plan):
        n = (fert or {}).get(main or "", 0.0)
        if legume_credit:
            n = max(0.0, n - n_credit(plan, y))
        slots.append(
            Slot(
                y,
                "main" if main else "fallow",
                main,
                sow_mmdd=(sow or {}).get(main or ""),
                fert_n_kg_ha=n,
                irrigate=irrigate,
            )
        )
        if cover:
            slots.append(Slot(y, "cover", cover))
    return Rotation(rid, name, len(plan), tuple(slots))


@dataclass(slots=True)
class SoilState:
    """What one season hands over to the next (ROTATION.md §1.1)."""

    soc_kg_ha: float
    n_mineral_kg_ha: float
    residue_kg_ha: float = 0.0
    residue_cn: float = 40.0
    residue_surface: float = 1.0  # share of residues lying on the surface
    infiltration_idx: float = 1.0
    water_mm: float = 0.0  # in the profile above wilting point
    pest_pressure: dict[str, float] = field(default_factory=dict)
    erosion_loss_t_ha: float = 0.0
