"""«Подобрать лучший план» for the builder: a lighter optimiser pass with a disk cache, plus a
one-line reason for every crop in the advised plan (docs/UX.md §3.3)."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from app.geo import fields as geo
from app.rotation.crops import rotation_crops
from app.rotation.optimizer import Profile, optimise
from app.rotation.quick import context, deck

ADVICE_SCREEN, ADVICE_FINAL, ADVICE_CANDIDATES = 3, 8, 160
ADVICE_TEXT_VERSION = 2  # bump when the wording of the answer changes: cached answers carry it
PRIORITY_RU = {
    "water": "вода",
    "income": "доход",
    "soil": "почва",
    "risk": "риск",
    "feed": "корма",
    "erosion": "смыв почвы",
    "yield": "урожай",
    "labour": "труд",
}


def _method_cost(irrigated: bool, method: str | None) -> float:
    from app.rotation.model import irrigation_methods

    if not irrigated or not method:
        return 0.0
    return float(irrigation_methods()[method]["cost_usd_ha_yr"])  # type: ignore[arg-type]


def _weights(priorities: list[str]) -> dict[str, float]:
    w = {"yield": 1.0, "income": 1.0, "risk": 1.0}
    for p in priorities:
        w[p] = 5.0
        if p == "soil":
            w["erosion"] = 3.0
    return w


def advice(
    fid: str,
    priorities: list[str],
    years: int = 4,
    irrigated: bool = False,
    water_limit_m3_ha: float = 0.0,
    scenario: str = "history",
    allowed: list[str] | None = None,
    method: str | None = None,
    budget_usd_ha: float | None = None,
    labour_days_max: float | None = None,
) -> dict[str, Any]:
    key = hashlib.sha1(
        json.dumps(
            [
                priorities,
                years,
                irrigated,
                water_limit_m3_ha,
                scenario,
                allowed,
                method,
                budget_usd_ha,
                labour_days_max,
                ADVICE_TEXT_VERSION,
            ]
        ).encode()
    ).hexdigest()[:12]
    path = geo.CACHE_DIR / fid / f"advice_{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    ctx = context(fid, irrigated, water_limit_m3_ha / 10, scenario, method)
    prof = Profile(
        weights=_weights(priorities),
        budget_usd_ha=budget_usd_ha,
        labour_days_max=labour_days_max,
        irrigation_cost_usd_ha=_method_cost(irrigated, method),
        years=years,
        irrigated=irrigated,
        water_limit_m3_ha=water_limit_m3_ha,
        allowed=allowed,
    )
    res = optimise(
        ctx.site,
        ctx.weather,
        prof,
        top=3,
        screen_starts=ADVICE_SCREEN,
        final_top=ADVICE_FINAL,
        max_candidates=ADVICE_CANDIDATES,
    )
    if not res["schemes"]:
        return {"plan": [], "reasons": [], "label": "Не нашлось схемы под эти ограничения"}
    best = res["schemes"][0]
    plan = [[p["main"], p["cover"]] for p in best["plan"]]
    out = {
        "plan": plan,
        "reasons": reasons(plan),
        "label": "План под ваши приоритеты: "
        + " и ".join(PRIORITY_RU.get(p, p) for p in priorities),
        "n_candidates": res["n_candidates"],
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass  # a read-only or foreign-owned cache only costs speed
    return out


def reasons(plan: list[list[str | None]]) -> list[dict[str, str | None]]:
    """One sentence per slot: why this crop here (from crop properties and neighbours)."""
    crops = rotation_crops()
    cards = {d["id"]: d for d in deck()}
    hungry = max(
        (c for c in crops.values() if not c.is_cover), key=lambda c: c.kc_mid * c.season_days
    )
    out = []
    for i, (m, c) in enumerate(plan):
        prev = plan[i - 1][0] if i > 0 else None
        nxt = plan[i + 1][0] if i + 1 < len(plan) else None
        parts = []
        if m:
            cm = crops[m]
            if cm.is_legume and nxt:
                parts.append(f"даёт азот культуре следующего года ({crops[nxt].name_ru.lower()})")
            if prev and crops[prev].family != cm.family:
                parts.append(
                    f"сменяет семейство ({crops[prev].family_ru} → {cm.family_ru}) — "
                    "меньше вредителей"
                )
            ratio = 1 - (cm.kc_mid * cm.season_days) / (hungry.kc_mid * hungry.season_days)
            if ratio >= 0.2:
                parts.append(
                    f"пьёт примерно на {round(ratio * 100 / 5) * 5} % меньше воды, "
                    f"чем самая влаголюбивая культура ({hungry.name_ru.lower()})"
                )
        main_text = (
            f"{crops[m].name_ru} здесь, потому что " + ", ".join(parts) + "."
            if m and parts
            else (cards[m]["hint"] + "." if m else None)
        )
        cover_text = None
        if c:
            cc = crops[c]
            cover_text = (
                f"{cards[c]['name_ru']} после уборки закрывает почву"
                + (" и добавляет азот" if cc.is_legume else "")
                + "."
            )
        out.append({"main": main_text, "cover": cover_text})
    return out
