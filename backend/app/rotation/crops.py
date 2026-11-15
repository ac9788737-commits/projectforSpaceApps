"""Field crops for rotations: FAO-56 water parameters, EcoCrop temperatures, agronomy. Pure."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache

from app import config

DEEP_ROOT_M = 1.2  # docs/ROTATION.md §1.3: deep roots improve soil structure


@dataclass(frozen=True, slots=True)
class RotCrop:
    id: str
    name_ru: str
    family: str
    family_ru: str
    is_cover: bool
    sow_mmdd: str | None
    kc_ini: float
    kc_mid: float
    kc_end: float
    stages: tuple[int, int, int, int]  # FAO-56 L_ini, L_dev, L_mid, L_late (days)
    root_depth_m: float
    p_depletion: float
    ky: float
    ymax_t_ha: float  # attainable yield of the marketed product (estimate)
    harvest_index: float
    dm_frac: float  # dry-matter share of the marketed product
    residue_cn: float
    residue_removed_frac: float  # residues usually taken off the field (cotton stalks: estimate)
    n_product_pct: float
    n_fixation_kg_ha: float
    min_break_years: int
    feed_protein_pct: float
    feed_me_mj_kg: float
    t_base_c: float
    gdd_total: float  # thermal time from sowing to maturity above t_base_c (estimate)
    t_min_c: float | None  # EcoCrop absolute minimum for growth
    t_opt_min_c: float | None
    t_opt_max_c: float | None
    t_max_c: float | None
    frost_kill_c: float
    young_frost_margin_c: float  # seedlings/vegetative plants survive this far below KTMP
    heat_c: float
    sensitive_stage: str  # ini | dev | mid | late | none
    allow_consecutive: bool
    estimate: bool
    references: tuple[str, ...]

    @property
    def season_days(self) -> int:
        return sum(self.stages)

    @property
    def deep_roots(self) -> bool:
        return self.root_depth_m >= DEEP_ROOT_M

    @property
    def frost_sensitive(self) -> bool:
        return self.young_frost_margin_c < 5

    @property
    def is_legume(self) -> bool:
        return self.family == "fabaceae"


# Dry-matter share of the marketed product (estimates: grain at storage moisture, fresh
# tubers and fruit, hay). Kept here because it is a property of the product, not the crop row.
DM_FRAC = {
    "wheat": 0.87,
    "winter_wheat": 0.87,
    "barley": 0.87,
    "maize": 0.86,
    "pea": 0.87,
    "chickpea": 0.9,
    "alfalfa": 0.88,
    "soybean": 0.87,
    "potato": 0.2,
    "tomato": 0.06,
    "cotton": 0.92,
    "sunflower": 0.92,
}


def _f(v: str) -> float | None:
    v = v.strip()
    return float(v) if v else None


@lru_cache(maxsize=1)
def _ecocrop() -> dict[str, dict[str, str]]:
    with open(config.SEED_DIR / "ecocrop.csv", newline="", encoding="utf-8") as f:
        return {r["SCIENTNAME"]: r for r in csv.DictReader(f)}


@lru_cache(maxsize=1)
def rotation_crops() -> dict[str, RotCrop]:
    eco = _ecocrop()
    out: dict[str, RotCrop] = {}
    with open(config.SEED_DIR / "rotation_crops.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            e = eco.get(r["ecocrop_scientname"]) if r["ecocrop_scientname"] else None
            ktmp = _f(e["KTMP"]) if e else None
            frost = ktmp if ktmp is not None else _f(r["frost_kill_c"])
            refs = tuple(
                x for x in (r["kc_ref"], r["stages_ref"], r["root_ref"], r["ky_ref"]) if x.strip()
            )
            if e:
                refs = (*refs, f"FAO EcoCrop: {r['ecocrop_scientname']} (temperatures)")
            out[r["id"]] = RotCrop(
                id=r["id"],
                name_ru=r["name_ru"],
                family=r["family"],
                family_ru=r["family_ru"],
                is_cover=r["is_cover_crop"] == "true",
                sow_mmdd=r["sow_mmdd"] or None,
                kc_ini=float(r["kc_ini"]),
                kc_mid=float(r["kc_mid"]),
                kc_end=float(r["kc_end"]),
                stages=(int(r["l_ini"]), int(r["l_dev"]), int(r["l_mid"]), int(r["l_late"])),
                root_depth_m=float(r["root_depth_m"]),
                p_depletion=float(r["p_depletion"]),
                ky=float(r["ky"]),
                ymax_t_ha=float(r["ymax_t_ha"]),
                harvest_index=float(r["harvest_index"]),
                dm_frac=DM_FRAC.get(r["id"], 0.9),
                residue_cn=float(r["residue_cn"]),
                residue_removed_frac=float(r["residue_removed_frac"] or 0),
                n_product_pct=float(r["n_product_pct"]),
                n_fixation_kg_ha=float(r["n_fixation_kg_ha"]),
                min_break_years=int(r["min_break_years"]),
                feed_protein_pct=float(r["feed_protein_pct"]),
                feed_me_mj_kg=float(r["feed_me_mj_kg"]),
                t_base_c=float(r["t_base_c"]),
                gdd_total=float(r["gdd_total"]),
                t_min_c=_f(e["TMIN"]) if e else None,
                t_opt_min_c=_f(e["TOPMN"]) if e else None,
                t_opt_max_c=_f(e["TOPMX"]) if e else None,
                t_max_c=_f(e["TMAX"]) if e else None,
                frost_kill_c=frost if frost is not None else -5.0,
                young_frost_margin_c=float(r["young_frost_margin_c"]),
                heat_c=float(r["heat_c"]),
                sensitive_stage=r["sensitive_stage"],
                allow_consecutive=r["allow_consecutive"] == "true",
                estimate=r["estimate"] == "true",
                references=refs,
            )
    return out


@dataclass(frozen=True, slots=True)
class TextureClass:
    id: str
    name_ru: str
    theta_fc: float
    theta_wp: float
    rew_mm: float
    tew_mm: float
    hydro_group: str
    estimate: bool


@lru_cache(maxsize=1)
def texture_classes() -> dict[str, TextureClass]:
    with open(config.SEED_DIR / "soil_texture_classes.csv", newline="", encoding="utf-8") as f:
        return {
            r["id"]: TextureClass(
                r["id"],
                r["name_ru"],
                float(r["theta_fc"]),
                float(r["theta_wp"]),
                float(r["rew_mm"]),
                float(r["tew_mm"]),
                r["hydro_group"],
                r["estimate"] == "true",
            )
            for r in csv.DictReader(f)
        }


def usda_texture(sand: float, clay: float) -> str:
    """USDA texture triangle (percent sand, clay; silt is the rest)."""
    silt = 100.0 - sand - clay
    if silt + 1.5 * clay < 15:
        return "sand"
    if silt + 1.5 * clay < 30:
        return "loamy_sand"
    if (7 <= clay < 20 and sand > 52 and silt + 2 * clay >= 30) or (
        clay < 7 and silt < 50 and silt + 2 * clay >= 30
    ):
        return "sandy_loam"
    if 7 <= clay < 27 and 28 <= silt < 50 and sand <= 52:
        return "loam"
    if (silt >= 50 and 12 <= clay < 27) or (50 <= silt < 80 and clay < 12):
        return "silt_loam"
    if silt >= 80 and clay < 12:
        return "silt"
    if 20 <= clay < 35 and silt < 28 and sand > 45:
        return "sandy_clay_loam"
    if 27 <= clay < 40 and 20 < sand <= 45:
        return "clay_loam"
    if 27 <= clay < 40 and sand <= 20:
        return "silty_clay_loam"
    if clay >= 35 and sand > 45:
        return "sandy_clay"
    if clay >= 40 and silt >= 40:
        return "silty_clay"
    return "clay"
