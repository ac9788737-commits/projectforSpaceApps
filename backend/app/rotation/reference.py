"""«Откуда цифры»: every crop parameter the model uses, with its source (docs/IMPROVEMENTS.md B13).

A parameter whose source is None is an estimate; the page marks it «оценка». Sources come
straight from the seed tables (rotation_crops.csv *_ref columns, FAO EcoCrop, World Bank
Pink Sheet in economics_world.csv), so the page cannot claim more than the data does.
"""

from __future__ import annotations

import csv
from typing import Any

from app import config
from app.rotation.crops import rotation_crops
from app.rotation.economics import default_economics

NOT_LEGUME = "@not_legume"  # the page translates this: no symbiotic fixation, a fact


def _p(value: Any, source: str | None) -> dict[str, Any]:
    return {"value": value, "source": source or None}


def _r(x: float | None) -> float | None:
    return None if x is None else round(x, 2)


def crop_reference() -> list[dict[str, Any]]:
    with open(config.SEED_DIR / "rotation_crops.csv", newline="", encoding="utf-8") as f:
        raw = {r["id"]: r for r in csv.DictReader(f)}
    econ = default_economics()
    rows = []
    for c in rotation_crops().values():
        r = raw[c.id]
        e = econ.crops.get(c.id)
        eco = next((x for x in c.references if x.startswith("FAO EcoCrop")), None)
        topt = (
            f"{c.t_opt_min_c:g}–{c.t_opt_max_c:g}"
            if c.t_opt_min_c is not None and c.t_opt_max_c is not None
            else None
        )
        rows.append(
            {
                "id": c.id,
                "name_ru": c.name_ru,
                "family_ru": c.family_ru,
                "is_cover": c.is_cover,
                "params": {
                    "kc": _p(f"{c.kc_ini:g} / {c.kc_mid:g} / {c.kc_end:g}", r.get("kc_ref")),
                    "stages": _p(" / ".join(str(d) for d in c.stages), r.get("stages_ref")),
                    "topt": _p(topt, eco if topt else None),
                    "heat": _p(c.heat_c, None),
                    "nfix": _p(c.n_fixation_kg_ha, None if c.n_fixation_kg_ha else NOT_LEGUME),
                    "root": _p(c.root_depth_m, r.get("root_ref")),
                    "ky": _p(c.ky, r.get("ky_ref")),
                    "ymax": _p(c.ymax_t_ha, None),
                    "cost": _p(_r(e.seed_usd_ha + e.ops_usd_ha) if e else None, None),
                    "labour": _p(e.labour_h_ha if e else None, None),
                    "price": _p(
                        e.price_usd_t if e else None,
                        e.reference if e and not e.estimate else None,
                    ),
                },
            }
        )
    return rows
