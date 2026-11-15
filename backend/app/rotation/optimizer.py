"""Generate, simulate and rank rotations for a farmer (ROTATION.md §3.2, §4). Deterministic.

1. Candidates: sequences of main crops the farmer can grow, pruned by the agronomic rules;
   each with and without cover crops in the gaps.
2. Weather ensemble: every historical year is a possible start; the plan runs on consecutive
   years from there (wrapping), giving a distribution instead of one number.
3. Two passes: a quick screen on a few starts, then the best candidates on all starts.
4. Metrics with P10/P50/P90; score = weighted sum of normalised metrics; Pareto front.
"""

from __future__ import annotations

import hashlib
import itertools
import random
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.rotation.calendar import sowing_dates
from app.rotation.crops import RotCrop, rotation_crops
from app.rotation.economics import Economics, default_economics
from app.rotation.model import FieldSite, Rotation, rotation_from_plan
from app.rotation.rules import check_rotation
from app.rotation.simulate import RotationRun, run_rotation
from app.rotation.weather import Weather, WeatherYear

# Metric → (direction, label). +1 = more is better.
METRICS: dict[str, tuple[int, str]] = {
    "yield": (1, "урожай, % от потенциала"),
    "income": (1, "маржа, $/га в год"),
    "water": (-1, "полив, м³/га в год"),
    "feed": (1, "кормовой белок, кг/га в год"),
    "soil": (1, "органика, изменение % C"),
    "nitrogen": (1, "азот в почве в конце, кг/га"),
    "erosion": (-1, "эрозия, т/га в год"),
    "risk": (-1, "вероятность провала"),
    "labour": (-1, "труд, ч/га в год"),
    "bare": (-1, "голая почва, дней в год"),
}
# Farmer priorities → metrics (ROTATION.md §4.1).
PRIORITIES: dict[str, dict[str, float]] = {
    "yield": {"yield": 1.0},
    "income": {"income": 1.0},
    "water": {"water": 1.0},
    "feed": {"feed": 1.0},
    "soil": {"soil": 0.6, "nitrogen": 0.4},
    "erosion": {"erosion": 0.7, "bare": 0.3},
    "risk": {"risk": 1.0},
    "labour": {"labour": 1.0},
}
PRESETS: dict[str, dict[str, float]] = {
    "water": {"water": 5, "risk": 3, "income": 2, "yield": 2},
    "feed": {"feed": 5, "yield": 3, "risk": 2, "income": 1},
    "soil": {"soil": 5, "erosion": 4, "risk": 2, "income": 1},
    "income": {"income": 5, "risk": 3, "yield": 2},
}
FAIL_SHARE = 0.5  # a crop-year below half of that crop's median on this field is a failure
DEFAULT_N: dict[str, float] = {
    "wheat": 100,
    "winter_wheat": 110,
    "barley": 80,
    "maize": 150,
    "potato": 120,
    "tomato": 120,
    "cotton": 120,
    "sunflower": 60,
}
SCREEN_STARTS = 5
FINAL_TOP = 25
MAX_CANDIDATES = 400


@dataclass
class Profile:
    weights: dict[str, float] = field(default_factory=lambda: {"yield": 3, "income": 3, "risk": 3})
    years: int = 4
    horizon: int | None = None  # years simulated (rotation repeated); default = one cycle
    allowed: list[str] | None = None  # main crops the farmer can grow (None = all)
    required: list[str] = field(default_factory=list)
    forbidden: list[str] = field(default_factory=list)
    sellable: list[str] | None = None  # None = everything can be sold
    machinery: list[str] = field(default_factory=lambda: ["small_seed_drill"])
    irrigated: bool = False
    water_limit_m3_ha: float = 0.0
    budget_usd_ha: float | None = None  # money for the start of any season
    labour_days_max: float | None = None  # hand labour per season, person-days/ha
    max_expensive: int = 1  # very expensive / labour-heavy crops per cycle
    irrigation_cost_usd_ha: float = 0.0  # yearly cost of the irrigation method
    covers: list[str] = field(
        default_factory=lambda: ["vetch", "rye_cover", "mustard", "clover", "phacelia"]
    )
    prices: dict[str, float] = field(default_factory=dict)
    fert: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_N))
    seed: int = 7

    def key(self) -> str:
        return hashlib.sha1(repr(sorted(self.__dict__.items())).encode()).hexdigest()[:12]


def _usable(c: RotCrop, p: Profile, econ: Economics) -> bool:
    e = econ.crops.get(c.id)
    if c.id in p.forbidden:
        return False
    if (
        not c.is_cover
        and p.allowed is not None
        and c.id not in p.allowed
        and c.id not in p.required
    ):
        return False
    return not (e and e.machinery and e.machinery not in p.machinery)


def season_start_cost(
    main: str | None,
    cover: str | None,
    prev: tuple[str | None, str | None] | None,
    p: Profile,
    econ: Economics,
) -> float:
    """Money to put in at the start of a season: seed, field work, N after the legume credit,
    and the irrigation method's yearly cost (same rule as the builder, quick.season_costs)."""
    from app.rotation.model import LEGUME_N_CREDIT

    total = p.irrigation_cost_usd_ha
    for cid in (main, cover):
        e = econ.crops.get(cid or "")
        if e:
            total += e.seed_usd_ha + e.ops_usd_ha
    if main:
        credit = (
            (LEGUME_N_CREDIT.get(prev[0] or "", 0.0) + LEGUME_N_CREDIT.get(prev[1] or "", 0.0))
            if prev
            else 0.0
        )
        total += max(0.0, p.fert.get(main, 0.0) - credit) * econ.n_usd_kg
    return total


def _affordable(seq: list[str], p: Profile, econ: Economics) -> bool:
    """Budget, hand labour and «not more than one very costly crop» (docs/IMPROVEMENTS.md B6)."""
    expensive = 0
    for i, cid in enumerate(seq):
        e = econ.crops.get(cid)
        if not e:
            continue
        start = season_start_cost(cid, None, (seq[i - 1], None) if i else None, p, econ)
        days = e.labour_h_ha / 8
        if start - p.irrigation_cost_usd_ha > 800 or days > 20:
            expensive += 1
        if p.budget_usd_ha is not None and start > p.budget_usd_ha:
            return False
        if p.labour_days_max is not None and days > p.labour_days_max:
            return False
    return expensive <= p.max_expensive


def candidates(
    p: Profile, econ: Economics, max_candidates: int = MAX_CANDIDATES
) -> list[list[tuple[str | None, str | None]]]:
    crops = rotation_crops()
    mains = [c.id for c in crops.values() if not c.is_cover and _usable(c, p, econ)]
    covers = [c for c in p.covers if c in crops and _usable(crops[c], p, econ)]
    seqs: list[list[str]] = []
    for combo in itertools.product(mains, repeat=p.years):
        seq = list(combo)
        if any(r not in seq for r in p.required):
            continue
        plan: list[tuple[str | None, str | None]] = [(m, None) for m in seq]
        if any(
            v.code in ("family_break", "legume_after_legume")
            for v in check_rotation(rotation_from_plan("x", "x", plan))
        ):
            continue
        if not _affordable(seq, p, econ):
            continue
        seqs.append(seq)
    rng = random.Random(p.seed)
    if len(seqs) > max_candidates // 2:
        seqs = rng.sample(seqs, max_candidates // 2)
    out: list[list[tuple[str | None, str | None]]] = []
    for seq in seqs:
        out.append([(m, None) for m in seq])
        if covers:
            plan = []
            for i, m in enumerate(seq):
                nxt = seq[i + 1] if i + 1 < len(seq) else seq[0]
                legume_next = crops[nxt].is_legume
                fam = crops[m].family
                options = [
                    c
                    for c in covers
                    if crops[c].family != fam and (not legume_next or not crops[c].is_legume)
                ]
                # legume cover before a non-legume (N), otherwise a non-legume one
                pref = [c for c in options if crops[c].is_legume] if not legume_next else options
                choice: list[str | None] = [*pref] or [*options] or [None]
                cover = choice[0]
                prev = plan[i - 1] if i else None
                if (
                    cover
                    and p.budget_usd_ha is not None
                    and season_start_cost(m, cover, prev, p, econ) > p.budget_usd_ha
                ):
                    cover = None  # the cover would break the season budget
                plan.append((m, cover))
            out.append(plan)
    return out


def _sequence(weather: Weather, start: int, years: int) -> list[WeatherYear]:
    ys = list(weather.years)
    return [ys[(start + k) % len(ys)] for k in range(years)]


def evaluate(
    site: FieldSite,
    plan: list[tuple[str | None, str | None]],
    weather: Weather,
    starts: list[int],
    p: Profile,
    econ: Economics,
    sow: dict[str, str],
) -> list[RotationRun]:
    full = _horizon_plan(plan, p)
    rot = rotation_from_plan(
        "c", "c", full, dict(p.fert), sow, irrigate=p.irrigated, legume_credit=True
    )
    return [run_rotation(site, rot, _sequence(weather, s, len(full))) for s in starts]


def _horizon_plan(
    plan: list[tuple[str | None, str | None]], p: Profile
) -> list[tuple[str | None, str | None]]:
    h = p.horizon or len(plan)
    return [plan[k % len(plan)] for k in range(h)]


def run_metrics(
    run: RotationRun, rot: Rotation, p: Profile, econ: Economics, site: FieldSite, soc0: float
) -> dict[str, float]:
    crops = rotation_crops()
    h = len(run.years)
    income = protein = labour = 0.0
    for y in run.years:
        for cid, is_main in ((y.crop, True), (y.cover, False)):
            if not cid:
                continue
            e = econ.crops.get(cid)
            if not e:
                continue
            sellable = p.sellable is None or cid in p.sellable
            revenue = e.price_usd_t * y.yield_t_ha if is_main and sellable else 0.0
            income += revenue - e.seed_usd_ha - e.ops_usd_ha
            labour += e.labour_h_ha
            if is_main:
                c = crops[cid]
                protein += y.yield_t_ha * 1000 * c.dm_frac * c.feed_protein_pct / 100
        income -= y.irrigation_mm * 10 * econ.water_usd_m3
        income -= y.n_fert_kg_ha * econ.n_usd_kg  # the nitrogen actually applied that year
    if site.irrigated and site.irrigation_method:
        from app.rotation.model import irrigation_methods

        income -= float(irrigation_methods()[site.irrigation_method]["cost_usd_ha_yr"]) * h  # type: ignore[arg-type]
    return {
        "yield": float(np.mean([y.yield_rel for y in run.years if y.crop])) * 100
        if any(y.crop for y in run.years)
        else 0.0,
        "income": income / h,
        "water": sum(y.irrigation_mm for y in run.years) * 10 / h,
        "feed": protein / h,
        "soil": run.years[-1].soc_pct_end - soc0,
        "nitrogen": run.years[-1].n_mineral_end,
        "erosion": sum(y.erosion_t_ha for y in run.years) / h,
        "labour": labour / h,
        "bare": sum(y.bare_days for y in run.years) / h,
    }


def _pct(v: list[float]) -> dict[str, float]:
    a = np.array(v)
    return {
        "p10": round(float(np.percentile(a, 10)), 3),
        "p50": round(float(np.percentile(a, 50)), 3),
        "p90": round(float(np.percentile(a, 90)), 3),
    }


def optimise(
    site: FieldSite,
    weather: Weather,
    p: Profile,
    econ: Economics | None = None,
    top: int = 5,
    screen_starts: int = SCREEN_STARTS,
    final_top: int = FINAL_TOP,
    max_candidates: int = MAX_CANDIDATES,
) -> dict[str, Any]:
    econ = (econ or default_economics()).with_prices(p.prices)
    sow = sowing_dates(weather)
    soc0 = site.soc_pct
    n = len(weather.years)
    screen = sorted({round(i * n / screen_starts) % n for i in range(screen_starts)})
    plans = candidates(p, econ, max_candidates)
    if not plans:
        return {
            "schemes": [],
            "pareto": [],
            "n_candidates": 0,
            "message": "Нет культур, подходящих под ограничения",
        }

    def summarise(plan, starts):
        rot = rotation_from_plan(
            "c", "c", _horizon_plan(plan, p), p.fert, sow, irrigate=p.irrigated, legume_credit=True
        )
        runs = evaluate(site, plan, weather, starts, p, econ, sow)
        mets = [run_metrics(r, rot, p, econ, site, soc0) for r in runs]
        return rot, runs, mets

    # pass 1: quick screen
    screened = []
    for plan in plans:
        _, _, mets = summarise(plan, screen)
        screened.append((plan, {k: float(np.median([m[k] for m in mets])) for k in mets[0]}))
    scores = _scores([m for _, m in screened], p.weights)
    best = sorted(range(len(screened)), key=lambda i: (-scores[i], i))[:final_top]

    # pass 2: full ensemble on the best
    all_starts = list(range(n))
    finals = []
    medians: dict[str, list[float]] = {}
    for i in best:
        plan = screened[i][0]
        rot, runs, mets = summarise(plan, all_starts)
        finals.append((plan, rot, runs, mets))
        for r in runs:
            for y in r.years:
                if y.crop:
                    medians.setdefault(y.crop, []).append(y.yield_t_ha)
    crop_median = {k: float(np.median(v)) for k, v in medians.items()}
    rows = []
    for plan, rot, runs, mets in finals:
        fails = [
            1.0 if y.yield_t_ha < FAIL_SHARE * crop_median.get(y.crop, 0) else 0.0
            for r in runs
            for y in r.years
            if y.crop
        ]
        risk = float(np.mean(fails)) if fails else 0.0
        med = {k: float(np.median([m[k] for m in mets])) for k in mets[0]}
        med["risk"] = risk
        cost = _annual_cost(plan, p, econ)
        rows.append((plan, rot, runs, mets, med, risk, cost))
    if p.budget_usd_ha is not None:
        within = [r for r in rows if r[6] <= p.budget_usd_ha]
        rows = within or rows
    sc = _scores([r[4] for r in rows], p.weights)
    order = sorted(range(len(rows)), key=lambda i: (-sc[i], i))
    pareto = _pareto([r[4] for r in rows], [k for k in _metric_weights(p.weights)])
    crops = rotation_crops()
    schemes: list[dict[str, Any]] = []
    for rank, i in enumerate(order):
        plan, rot, runs, mets, med, risk, cost = rows[i]
        dist = {k: _pct([m[k] for m in mets]) for k in mets[0]}
        dist["risk"] = {"p10": round(risk, 3), "p50": round(risk, 3), "p90": round(risk, 3)}
        per_crop: dict[str, list[float]] = {}
        for r in runs:
            for y in r.years:
                if y.crop:
                    per_crop.setdefault(y.crop, []).append(y.yield_t_ha)
        schemes.append(
            {
                "id": f"s{rank + 1}",
                "rank": rank + 1,
                "score": round(sc[i], 4),
                "pareto": i in pareto,
                "plan": [
                    {
                        "main": m,
                        "cover": c,
                        "main_ru": crops[m].name_ru if m else "голое поле",
                        "cover_ru": crops[c].name_ru if c else None,
                        "family": crops[m].family if m else None,
                        "sow": sow.get(m or ""),
                    }
                    for m, c in plan
                ],
                "metrics": dist,
                "crop_yields": {k: _pct(v) for k, v in per_crop.items()},
                "contributions": _contributions([r[4] for r in rows], i, p.weights),
                "annual_cost_usd_ha": round(cost, 0),
                "rules": [v.message_ru for v in check_rotation(rot)],
                "trajectory": _trajectory(runs),
            }
        )
    return {
        "n_candidates": len(plans),
        "n_weather_years": n,
        "screen_starts": screen,
        "schemes": schemes[:top],
        "pareto_ids": [s["id"] for s in schemes if s["pareto"]],
        "all_points": [
            {"id": s["id"], **{k: v["p50"] for k, v in s["metrics"].items()}} for s in schemes
        ],
        "metrics": {k: {"direction": d, "label": lab} for k, (d, lab) in METRICS.items()},
        "economics_refs": list(econ.references),
    }


def _annual_cost(plan, p: Profile, econ: Economics) -> float:
    total = 0.0
    for m, c in plan:
        for cid, main in ((m, True), (c, False)):
            e = econ.crops.get(cid or "")
            if e:
                total += (
                    e.seed_usd_ha
                    + e.ops_usd_ha
                    + (p.fert.get(cid or "", 0) * econ.n_usd_kg if main else 0)
                )
    return total / max(1, len(plan))


def _metric_weights(weights: dict[str, float]) -> dict[str, float]:
    out: dict[str, float] = {}
    for prio, w in weights.items():
        for m, share in PRIORITIES.get(prio, {}).items():
            out[m] = out.get(m, 0.0) + w * share
    return {k: v for k, v in out.items() if v > 0}


def _normalised(values: list[dict[str, float]], metric: str) -> list[float]:
    d = METRICS[metric][0]
    xs = [v[metric] for v in values]
    lo, hi = min(xs), max(xs)
    if hi - lo < 1e-9:
        return [0.5] * len(xs)
    return [((x - lo) / (hi - lo)) if d > 0 else ((hi - x) / (hi - lo)) for x in xs]


def _scores(values: list[dict[str, float]], weights: dict[str, float]) -> list[float]:
    mw = _metric_weights(weights)
    total = sum(mw.values()) or 1.0
    out = [0.0] * len(values)
    for m, w in mw.items():
        if m not in values[0]:
            continue
        for i, x in enumerate(_normalised(values, m)):
            out[i] += w / total * x
    return out


def _contributions(
    values: list[dict[str, float]], i: int, weights: dict[str, float]
) -> dict[str, float]:
    mw = _metric_weights(weights)
    total = sum(mw.values()) or 1.0
    return {
        m: round(w / total * _normalised(values, m)[i], 4) for m, w in mw.items() if m in values[0]
    }


def _pareto(values: list[dict[str, float]], metrics: list[str]) -> set[int]:
    ms = [m for m in metrics if m in values[0]] or ["yield", "income"]
    front = set()
    for i, a in enumerate(values):
        dominated = False
        for j, b in enumerate(values):
            if i == j:
                continue
            better_eq = all(METRICS[m][0] * (b[m] - a[m]) >= -1e-9 for m in ms)
            strictly = any(METRICS[m][0] * (b[m] - a[m]) > 1e-9 for m in ms)
            if better_eq and strictly:
                dominated = True
                break
        if not dominated:
            front.add(i)
    return front


def _trajectory(runs: list[RotationRun]) -> dict[str, list[float]]:
    """Median soil organic carbon, mineral N and bare days by year across the ensemble."""
    h = len(runs[0].years)
    return {
        "soc_pct": [
            round(float(np.median([r.years[k].soc_pct_end for r in runs])), 4) for k in range(h)
        ],
        "n_mineral": [
            round(float(np.median([r.years[k].n_mineral_end for r in runs])), 1) for k in range(h)
        ],
        "bare_days": [
            round(float(np.median([r.years[k].bare_days for r in runs])), 0) for k in range(h)
        ],
        "cover_weekly": [
            round(float(np.median([r.soil_cover[k] for r in runs])), 3)
            for k in range(len(runs[0].soil_cover))
        ],
    }
