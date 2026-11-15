"""Instant evaluation of one rotation for the plan builder (docs/UX.md §3, §8). Deterministic.

Same engine and metrics as the stage-7 planner (`optimizer.run_metrics`), packaged for a
person: four indicators, 20 «years like the real ones», links that explain «why» (each one a
short counterfactual run), and a weekly trajectory for playback. Results are cached per field,
plan and scenario, so repeated drags cost nothing.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import numpy as np

from app.climate.stress_scenarios import PRESETS as STRESS
from app.climate.stress_scenarios import apply
from app.geo import fields as geo
from app.rotation.calendar import sowing_dates
from app.rotation.crops import rotation_crops
from app.rotation.economics import default_economics
from app.rotation.model import LEGUME_N_CREDIT, FieldSite, irrigation_methods, rotation_from_plan
from app.rotation.optimizer import DEFAULT_N, Profile, run_metrics
from app.rotation.rules import check_rotation
from app.rotation.salinity import salinity_risk
from app.rotation.simulate import DAILY_FIELDS, RotationRun, run_rotation
from app.rotation.weather import DAYS, Weather

Plan = list[tuple[str | None, str | None]]
LINK_STARTS = 3  # weather starts for the «why» counterfactuals (quick, enough for direction)
GOOD, FAIL = 0.9, 0.6  # mean yield vs the field's normal: ≥ good, < fail
MONTHS_RU = ("янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек")


@dataclass
class FieldContext:
    fid: str
    site: FieldSite
    weather: Weather
    sow: dict[str, str]
    irrigated: bool
    normal: dict[str, float] = field(default_factory=dict)  # crop → median t/ha on this field


_CTX: dict[tuple[str, bool, float, str, str | None], FieldContext] = {}
_RESULTS: dict[str, dict[str, Any]] = {}


def context(
    fid: str, irrigated: bool, limit_mm: float, scenario: str = "history", method: str | None = None
) -> FieldContext:
    key = (fid, irrigated, limit_mm, scenario, method)
    if key not in _CTX:
        layers = geo.load_layers(fid, offline=False)
        weather = geo.field_weather(layers)
        if weather is None:
            raise ValueError("нет погоды для поля")
        base_sow = sowing_dates(weather)
        weather = apply(weather, STRESS.get(scenario, STRESS["history"]))
        site = geo.field_site(layers, irrigated, limit_mm, method)
        ctx = FieldContext(fid, site, weather, base_sow, irrigated)
        ctx.normal = (
            _normal_yields(ctx)
            if scenario == "history"
            else context(fid, irrigated, limit_mm, method=method).normal
        )
        _CTX[key] = ctx
    return _CTX[key]


def _sequence(w: Weather, start: int, years: int) -> list:
    ys = list(w.years)
    return [ys[(start + k) % len(ys)] for k in range(years)]


def _normal_yields(ctx: FieldContext) -> dict[str, float]:
    """A crop's normal yield on this field: median over all years after a fallow year."""
    out = {}
    for c in rotation_crops().values():
        if c.is_cover:
            continue
        rot = rotation_from_plan(
            "n", "n", [(None, None), (c.id, None)], DEFAULT_N, ctx.sow, ctx.irrigated
        )
        ys = [
            run_rotation(ctx.site, rot, _sequence(ctx.weather, s, 2)).years[1].yield_t_ha
            for s in range(len(ctx.weather.years))
        ]
        out[c.id] = float(np.median(ys))
    return out


def _runs(
    ctx: FieldContext, plan: Plan, starts: list[int], record_start: int | None = None
) -> list[RotationRun]:
    rot = rotation_from_plan("q", "q", plan, DEFAULT_N, ctx.sow, ctx.irrigated, legume_credit=True)
    return [
        run_rotation(
            ctx.site, rot, _sequence(ctx.weather, s, len(plan)), record=(s == record_start)
        )
        for s in starts
    ]


# ---------- indicators ----------


def _level(x: float, good: float, bad: float, higher_better: bool = True) -> str:
    if higher_better:
        return "good" if x >= good else "bad" if x < bad else "ok"
    return "good" if x <= good else "bad" if x > bad else "ok"


def indicators(
    ctx: FieldContext, plan: Plan, runs: list[RotationRun], prices: dict[str, float] | None = None
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    econ = default_economics().with_prices(prices or {})
    prof = Profile(irrigated=ctx.irrigated)
    rot = rotation_from_plan("q", "q", plan, DEFAULT_N, ctx.sow, ctx.irrigated, legume_credit=True)
    mets = [run_metrics(r, rot, prof, econ, ctx.site, ctx.site.soc_pct) for r in runs]
    med = {k: float(np.median([m[k] for m in mets])) for k in mets[0]}
    eta = sum(y.eta_mm for r in runs for y in r.years)
    etc = sum(y.etc_mm for r in runs for y in r.years)
    demand_met = eta / etc if etc > 0 else 1.0
    # outcomes per year-like-the-real-ones
    outcomes = []
    fails = []
    for s, r in enumerate(runs):
        rel = [
            y.yield_t_ha / ctx.normal[y.crop]
            for y in r.years
            if y.crop and ctx.normal.get(y.crop, 0) > 0
        ]
        mean = float(np.mean(rel)) if rel else 1.0
        fails += [1.0 if x < 0.5 else 0.0 for x in rel]
        outcomes.append(
            {
                "start_year": ctx.weather.years[s].year,
                "score": round(mean, 3),
                "class": "good" if mean >= GOOD else "fail" if mean < FAIL else "ok",
            }
        )
    risk = float(np.mean(fails)) if fails else 0.0
    h = len(plan)
    soc_per_year = med["soil"] / h
    soil_parts = {
        "organic": float(np.clip(0.5 + soc_per_year / 0.04, 0, 1)),
        "erosion": float(np.clip(1 - med["erosion"] / 8, 0, 1)),
        "cover": float(np.clip(1 - med["bare"] / 220, 0, 1)),
        "nitrogen": float(np.clip(med["nitrogen"] / 120, 0, 1)),
    }
    # nitrogen is shown but not scored: fertiliser saturates it on most fields
    soil_score = (
        0.4 * soil_parts["organic"] + 0.3 * soil_parts["erosion"] + 0.3 * soil_parts["cover"]
    )
    water = {
        "key": "water",
        "irrigated": ctx.irrigated,
        "value": round(med["water"], -1) if ctx.irrigated else round(demand_met * 100),
        "unit": "м³/га в год" if ctx.irrigated else "% потребности",
        "level": _level(med["water"], 2000, 5000, False)
        if ctx.irrigated
        else _level(demand_met, 0.8, 0.55),
        "detail": {
            "irrigation_m3": round(med["water"], -1),
            "demand_met_pct": round(demand_met * 100),
            "crop_water_mm": round(eta / max(1, len(runs)) / h),
        },
    }
    good_years = sum(o["class"] == "good" for o in outcomes)
    fail_years = sum(o["class"] == "fail" for o in outcomes)
    ind = {
        "water": water,
        "money": {
            "key": "money",
            "value": round(med["income"], -1),
            "unit": "$/га в год",
            "level": _level(med["income"], 300, 0),
            "detail": {
                "labour_h": round(med["labour"]),
                "yield_pct": round(med["yield"]),
                "start_cost_usd": round(max(c["start_usd"] for c in season_costs(ctx, plan)), -1),
                "labour_days_max": round(max(c["labour_days"] for c in season_costs(ctx, plan)), 1),
            },
        },
        "soil": {
            "key": "soil",
            "value": round(soil_score * 100),
            "unit": "из 100",
            "level": _level(soil_score, 0.6, 0.4),
            "detail": {
                "organic_change_pct": round(med["soil"], 3),
                "erosion_t_ha": round(med["erosion"], 1),
                "bare_days": round(med["bare"]),
                "nitrogen_kg_ha": round(med["nitrogen"]),
                "parts": {k: round(v, 2) for k, v in soil_parts.items()},
            },
        },
        "risk": {
            "key": "risk",
            "value": round(risk * 100),
            "unit": "% неурожайных",
            "level": _level(risk, 0.1, 0.25, False),
            "detail": {
                "good_years": good_years,
                "fail_years": fail_years,
                "n_years": len(outcomes),
            },
        },
    }
    raw = {**med, "risk": risk, "demand_met": demand_met}
    ind["_raw"] = {k: round(v, 4) for k, v in raw.items()}
    return ind, outcomes


# ---------- «why» links ----------


def _swap(
    plan: Plan, year: int, main: str | object | None = ..., cover: str | object | None = ...
) -> Plan:
    out = list(plan)
    m, c = out[year]
    out[year] = (m if main is ... else main, c if cover is ... else cover)  # type: ignore[assignment]
    return out


def season_costs(ctx: FieldContext, plan: Plan) -> list[dict[str, float]]:
    """Money to put in at the start of each season and hand labour (docs/IMPROVEMENTS.md B6)."""
    econ = default_economics()
    method_cost = (
        float(irrigation_methods()[ctx.site.irrigation_method]["cost_usd_ha_yr"])  # type: ignore[arg-type]
        if ctx.site.irrigated and ctx.site.irrigation_method
        else 0.0
    )
    out = []
    for y, (m, c) in enumerate(plan):
        start = labour = 0.0
        for cid in (m, c):
            e = econ.crops.get(cid or "")
            if e:
                start += e.seed_usd_ha + e.ops_usd_ha
                labour += e.labour_h_ha / 8
        if m:
            from app.rotation.model import n_credit

            start += max(0.0, DEFAULT_N.get(m, 0.0) - n_credit(plan, y)) * econ.n_usd_kg
        out.append({"start_usd": start + method_cost, "labour_days": labour})
    return out


COVER_ACC = {
    "vetch": "вику",
    "clover": "клевер",
    "rye_cover": "рожь",
    "mustard": "горчицу",
    "phacelia": "фацелию",
}


def economy(
    ctx: FieldContext, plan: Plan, runs: list[RotationRun], prices: dict[str, float] | None
) -> dict[str, Any]:
    """What the browser needs to re-price the plan instantly (docs/IMPROVEMENTS.md B10):
    median yields and amounts per year; margin = server margin + Σ Δprice · amount / years."""
    econ = default_economics().with_prices(prices or {})
    h = len(plan)
    yields: dict[str, float] = {}
    for k, (m, _) in enumerate(plan):
        if m:
            yields[m] = yields.get(m, 0.0) + float(np.median([r.years[k].yield_t_ha for r in runs]))
    n_kg = float(np.median([sum(y.n_fert_kg_ha for y in r.years) for r in runs]))
    water_m3 = float(np.median([sum(y.irrigation_mm for y in r.years) * 10 for r in runs]))
    return {
        "years": h,
        "tonnes": {c: round(v, 3) for c, v in yields.items()},  # over the whole plan
        "n_kg": round(n_kg, 1),
        "water_m3": round(water_m3),
        "prices": {c: econ.crops[c].price_usd_t for c in yields if c in econ.crops},
        "world_prices": {
            c: default_economics().crops[c].price_usd_t
            for c in yields
            if c in default_economics().crops
        },
        "n_usd_kg": econ.n_usd_kg,
        "water_usd_m3": econ.water_usd_m3,
        "world_n_usd_kg": default_economics().n_usd_kg,
        "world_water_usd_m3": default_economics().water_usd_m3,
    }


def work_calendar(ctx: FieldContext, plan: Plan, run: RotationRun) -> list[dict[str, Any]]:
    """First-year field work on a 12-month strip (B11), from the played season."""
    crops = rotation_crops()
    weeks = weekly(run)
    m, c = plan[0]
    out: list[dict[str, Any]] = []
    if not m:
        return out
    crop = crops[m]
    mine = [i for i, w in enumerate(weeks) if w["crop"] == m and not w["is_cover"] and i < 104]
    if mine:
        out.append(
            {
                "kind": "sow",
                "label": f"Сев: {crop.name_ru.lower()}",
                "start": mine[0] * 7 % DAYS,
                "end": mine[0] * 7 % DAYS + 10,
            }
        )
        crit = [i for i in mine if weeks[i]["stage"] == crop.sensitive_stage]
        if crit:
            out.append(
                {
                    "kind": "critical",
                    "label": "Критический период: полив и жара"
                    if ctx.irrigated
                    else "Критический период: жара и засуха",
                    "start": crit[0] * 7 % DAYS,
                    "end": crit[-1] * 7 % DAYS + 7,
                }
            )
        out.append(
            {
                "kind": "harvest",
                "label": "Уборка",
                "start": mine[-1] * 7 % DAYS - 7,
                "end": mine[-1] * 7 % DAYS + 7,
            }
        )
    if c:
        cov = [i for i, w in enumerate(weeks) if w["crop"] == c and w["is_cover"] and i < 104]
        if cov:
            out.append(
                {
                    "kind": "cover_sow",
                    "label": f"Сев покровной: {crops[c].name_ru.split(' (')[0].lower()}",
                    "start": cov[0] * 7 % DAYS,
                    "end": cov[0] * 7 % DAYS + 10,
                }
            )
            out.append(
                {
                    "kind": "cover_end",
                    "label": "Заделка покровной",
                    "start": cov[-1] * 7 % DAYS - 7,
                    "end": cov[-1] * 7 % DAYS + 7,
                }
            )
    return out


def cover_notes(ctx: FieldContext, plan: Plan, ind: dict[str, Any]) -> list[dict[str, Any]]:
    """When to turn the cover crop in so it does not drink the spring water (B9). The model
    stops the cover 14 days before the next sowing; on dry fields this is worth saying."""
    from app.rotation.weather import doy_of, mmdd_of

    crops = rotation_crops()
    dry = not ctx.irrigated or ind["water"]["detail"]["demand_met_pct"] < 80
    out = []
    for y, (_, c) in enumerate(plan):
        nxt = plan[y + 1][0] if y + 1 < len(plan) else None
        if not c or not nxt:
            continue
        sow = ctx.sow.get(nxt) or crops[nxt].sow_mmdd or "04-15"
        end = mmdd_of(doy_of(sow) - 14)
        what = COVER_ACC.get(c, crops[c].name_ru.lower())
        text = (
            f"Заделать {what} до {end[3:]}.{end[:2]} — за 2–3 недели до сева: "
            f"{crops[nxt].name_ru.lower()} сеют {sow[3:]}.{sow[:2]}"
        )
        if dry:
            text += ", иначе покровная заберёт весеннюю влагу"
        out.append({"year": y, "end": end, "next_sow": sow, "dry": dry, "text": text})
    return out


def soil_reserve(ctx: FieldContext, runs: list[RotationRun]) -> list[dict[str, float]]:
    """«Запас почвы» 0–100 by year (50 = start), three parts (B3):
    organic matter — humus plus the residues returned so far (mean over the plan years, so the
    date of harvest does not saw the line): ±0.1 % C → ±12 points;
    nitrogen balance since the start (fixation + fertiliser − harvest − leaching, a gross
    soil-surface balance), mean per year: ±100 kg N → ±15 points;
    soil-borne disease load from repeating a family (0–1): −20 points at full load.
    Mean mineral N is not used: it mostly mirrors the fertiliser bought that year.
    The weights are a display scale (estimate); the parts are shown in the tooltip."""
    soc0 = ctx.site.soc_pct
    per_pct = ctx.site.bulk_density * 3e6 / 100  # kg C per 1 % C in 0–30 cm
    out = [{"year": 0, "value": 50.0, "soc_pct": round(soc0, 2), "n_kg": 0, "pest_pct": 0}]
    for k in range(len(runs[0].years)):
        upto = [r.years[: k + 1] for r in runs]
        soc = float(np.median([ys[-1].soc_pct_end for ys in upto]))
        res = float(np.median([np.mean([y.residue_kg_end for y in ys]) for ys in upto]))
        bal = float(
            np.median(
                [
                    sum(
                        y.n_fixed_kg_ha + y.n_fert_kg_ha - y.n_removed_kg_ha - y.n_leached_kg_ha
                        for y in ys
                    )
                    / (k + 1)
                    for ys in upto
                ]
            )
        )
        pest = float(np.median([ys[-1].pest_pressure for ys in upto]))
        om = (soc + res * 0.45 / per_pct - soc0) / 0.1 * 12
        v = 50 + om + float(np.clip(bal / 100, -1, 1)) * 15 - pest * 20
        out.append(
            {
                "year": k + 1,
                "value": round(float(np.clip(v, 0, 100)), 1),
                "soc_pct": round(soc, 2),
                "n_kg": round(bal),
                "pest_pct": round(pest * 100),
            }
        )
    return out


def links(ctx: FieldContext, plan: Plan, base_runs: list[RotationRun]) -> list[dict[str, Any]]:
    crops = rotation_crops()
    starts = list(range(LINK_STARTS))
    base = base_runs[:LINK_STARTS]

    def med(runs: list[RotationRun], fn) -> float:
        return float(np.median([fn(r) for r in runs]))

    out: list[dict[str, Any]] = []
    n = len(plan)
    for i, (m, c) in enumerate(plan):
        nxt_year = i + 1
        nxt = plan[nxt_year][0] if nxt_year < n else None
        for slot, cid in (("main", m), ("cover", c)):
            if not cid or not crops[cid].is_legume or not nxt:
                continue
            alt = (
                _swap(plan, i, main="barley")
                if slot == "main"
                else _swap(plan, i, cover="rye_cover")
            )
            alt_runs = _runs(ctx, alt, starts)
            y_base = med(base, lambda r, k=nxt_year: r.years[k].yield_t_ha)
            y_alt = med(alt_runs, lambda r, k=nxt_year: r.years[k].yield_t_ha)
            n_base = med(base, lambda r, k=i: r.years[k].n_mineral_end)
            n_alt = med(alt_runs, lambda r, k=i: r.years[k].n_mineral_end)
            gain = (y_base - y_alt) / y_alt * 100 if y_alt > 0 else 0.0
            saved = min(LEGUME_N_CREDIT.get(cid, 0.0), DEFAULT_N.get(nxt, 0.0))
            if saved <= 0 and abs(gain) < 2:
                continue
            usd = saved * default_economics().n_usd_kg
            name = crops[cid].name_ru.split(" (")[0]
            sign = "+" if gain >= 0 else "−"
            if saved > 0:
                text = (
                    f"{name} в {i + 1}-й год → в {nxt_year + 1}-й год на {round(saved)} кг/га "
                    f"меньше азотных удобрений (экономия ≈ ${round(usd)}/га)"
                    + (
                        f", урожай {crops[nxt].name_ru.lower()} {sign}{abs(round(gain))} %"
                        if abs(gain) >= 2
                        else ""
                    )
                )
            else:
                text = f"{name} → азот и остатки → {crops[nxt].name_ru} {sign}{abs(round(gain))} %"
            out.append(
                {
                    "kind": "nitrogen",
                    "good": gain >= -2,
                    "from": {"year": i, "slot": slot},
                    "to": {"year": nxt_year, "slot": "main"},
                    "n_kg": round(n_base - n_alt),
                    "fert_saving_kg": round(saved),
                    "fert_saving_usd": round(usd),
                    "yield_pct": round(gain),
                    "text": text,
                }
            )
        if c:
            alt_runs = _runs(ctx, _swap(plan, i, cover=None), starts)
            e_base = med(base, lambda r: sum(y.erosion_t_ha for y in r.years))
            e_alt = med(alt_runs, lambda r: sum(y.erosion_t_ha for y in r.years))
            cut = (e_alt - e_base) / e_alt * 100 if e_alt > 0 else 0.0
            if cut >= 5:
                out.append(
                    {
                        "kind": "erosion",
                        "good": True,
                        "from": {"year": i, "slot": "cover"},
                        "to": None,
                        "erosion_pct": round(-cut),
                        "text": (
                            f"{crops[c].name_ru.split(' (')[0]} в межсезонье → "
                            f"смыв почвы −{round(cut)} %"
                        ),
                    }
                )
    rot = rotation_from_plan("q", "q", plan)
    for v in check_rotation(rot):
        if v.code in ("family_break", "legume_after_legume", "cover_same_family"):
            yrs = [r.years[v.year] for r in base_runs]
            pest = float(np.median([y.factors.get("pest", 1.0) for y in yrs if y.factors] or [1.0]))
            prev = plan[v.year - 1][0] if v.year > 0 else None
            cur = plan[v.year][0]
            text = (
                f"Снова {crops[cur].family_ru}: {crops[prev].name_ru.lower()} → "
                f"{crops[cur].name_ru.lower()} — больше вредителей и болезней, "
                f"урожай −{round((1 - pest) * 100)} %"
                if v.code == "family_break"
                and cur
                and prev
                and crops[cur].family == crops[prev].family
                else v.message_ru
            )
            out.append(
                {
                    "kind": "warning",
                    "good": False,
                    "from": {"year": max(0, v.year - 1), "slot": "main"},
                    "to": {"year": v.year, "slot": "main"},
                    "code": v.code,
                    "text": text,
                }
            )
    return out


# ---------- playback ----------


def weekly(run: RotationRun) -> list[dict[str, Any]]:
    d = run.daily or []
    idx = {k: i for i, k in enumerate(DAILY_FIELDS)}
    out = []
    for w0 in range(0, len(d), 7):
        week = d[w0 : w0 + 7]
        crops = [x[idx["crop"]] for x in week if x[idx["crop"]]]
        crop = Counter(crops).most_common(1)[0][0] if crops else None
        stages = [x[idx["stage"]] for x in week if x[idx["crop"]] == crop and x[idx["stage"]]]
        day = w0 % DAYS
        out.append(
            {
                "year": w0 // DAYS,
                "month": min(11, int(day / DAYS * 12)),
                "crop": crop,
                "is_cover": bool(
                    crop and any(x[idx["is_cover"]] for x in week if x[idx["crop"]] == crop)
                ),
                "stage": Counter(stages).most_common(1)[0][0] if stages else None,
                "canopy": round(float(np.mean([x[idx["canopy"]] for x in week])), 3),
                "soil_cover": round(float(np.mean([x[idx["soil_cover"]] for x in week])), 3),
                "water": round(float(np.mean([x[idx["water"]] for x in week])), 3),
                "soc_pct": week[-1][idx["soc_pct"]],
                "n_mineral": week[-1][idx["n_mineral"]],
                "erosion_cum": week[-1][idx["erosion_cum"]],
                "rain": round(sum(x[idx["precip"]] for x in week), 1),
                "storm": any(x[idx["precip"]] >= 12.7 for x in week),
                "tmax": max(x[idx["tmax"]] for x in week),
                "heat": any(x[idx["tmax"]] > 35 for x in week),
                "frost": any(x[idx["tmin"]] < 0 for x in week),
                "pest": max(x[idx["pest"]] for x in week),
            }
        )
    return out


MONTHS_NOM = (
    "январь",
    "февраль",
    "март",
    "апрель",
    "май",
    "июнь",
    "июль",
    "август",
    "сентябрь",
    "октябрь",
    "ноябрь",
    "декабрь",
)
NAME_GEN = {
    "wheat": "яровой пшеницы",
    "winter_wheat": "озимой пшеницы",
    "barley": "ячменя",
    "maize": "кукурузы",
    "pea": "гороха",
    "chickpea": "нута",
    "alfalfa": "люцерны",
    "soybean": "сои",
    "potato": "картофеля",
    "tomato": "томата",
    "cotton": "хлопчатника",
    "sunflower": "подсолнечника",
}
STAGE_RU = {"ini": "всходах", "dev": "росте", "mid": "цветении", "late": "созревании"}
HEAT_EFFECT_MIN = 0.05  # a caption only for changes > 5 % (docs/IMPROVEMENTS.md B5)
STORM_LOSS_MIN_T = 0.3


def captions(ctx: FieldContext, run: RotationRun) -> list[dict[str, Any]]:
    """Events of the played years, from the model's own daily log — nothing made up.

    Heat on the sensitive stage that cost yield, downpours that washed bare soil (or that a
    cover crop held), killing frosts and the harvest against the field's normal."""
    crops = rotation_crops()
    weeks = weekly(run)
    out: list[dict[str, Any]] = []

    def add(w: int, text: str, weight: int) -> None:
        wk = weeks[min(w, len(weeks) - 1)]
        out.append(
            {
                "week": w,
                "year": wk["year"],
                "month": wk["month"],
                "weight": weight,
                "text": f"Год {wk['year'] + 1}, {MONTHS_NOM[wk['month']]}: {text}",
            }
        )

    heat_said: set[int] = set()
    storm_said: set[tuple[int, bool]] = set()
    for i, wk in enumerate(weeks):
        y = wk["year"]
        yr = run.years[y] if y < len(run.years) else None
        crop = crops.get(wk["crop"] or "")
        if crop and not wk["is_cover"] and yr and yr.factors and wk["heat"] and y not in heat_said:
            loss = 1 - yr.factors.get("heat", 1.0)
            if loss >= HEAT_EFFECT_MIN and wk["stage"] == crop.sensitive_stage:
                add(
                    i,
                    f"+{round(wk['tmax'])} °C на {STAGE_RU.get(wk['stage'], 'росте')} — "
                    f"урожай {NAME_GEN.get(crop.id, crop.name_ru.lower())} −{round(loss * 100)} %",
                    3,
                )
                heat_said.add(y)
        if wk["storm"]:
            washed = wk["erosion_cum"] - (weeks[i - 1]["erosion_cum"] if i else 0.0)
            held = wk["is_cover"] and wk["soil_cover"] > 0.5
            key = (y, held)
            if key not in storm_said and (washed >= STORM_LOSS_MIN_T or held):
                if held and crop:
                    add(
                        i,
                        f"ливень {round(wk['rain'])} мм, "
                        f"{crop.name_ru.split(' (')[0].lower()} удержала почву",
                        2,
                    )
                else:
                    add(
                        i,
                        f"ливень {round(wk['rain'])} мм на голую почву — "
                        f"смыло ≈ {washed:.1f} т/га".replace(".", ","),
                        2,
                    )
                storm_said.add(key)
    for y, yr in enumerate(run.years):
        for e in yr.events:
            if "заморозок" in e and "гибель" in e:
                idx = next(
                    (i for i, w in enumerate(weeks) if w["year"] == y and w["frost"]), y * 52
                )
                add(idx, e[0].lower() + e[1:], 3)
        if yr.crop and ctx.normal.get(yr.crop):
            last = max(
                (
                    i
                    for i, w in enumerate(weeks)
                    if w["crop"] == yr.crop and not w["is_cover"] and i // 52 <= y + 1
                ),
                default=None,
            )
            # a winter crop sown in the last year is cut off by the end of the plan: say nothing
            if last is not None and last < len(weeks) - 1:
                rel = yr.yield_t_ha / ctx.normal[yr.crop]
                if abs(rel - 1) >= HEAT_EFFECT_MIN:
                    word = "выше" if rel > 1 else "ниже"
                    add(
                        last,
                        f"урожай {NAME_GEN.get(yr.crop, crops[yr.crop].name_ru.lower())} "
                        f"{yr.yield_t_ha:.1f} т/га — на {abs(round((rel - 1) * 100))} % "
                        f"{word} обычного".replace(".", ","),
                        1,
                    )
    return sorted(out, key=lambda c: (c["week"], -c["weight"]))


def _key(*parts: Any) -> str:
    return hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()


def quick(
    fid: str,
    plan: Plan,
    irrigated: bool = False,
    limit_mm: float = 0.0,
    scenario: str = "history",
    start_year: int | None = None,
    method: str | None = None,
    prices: dict[str, float] | None = None,
) -> dict[str, Any]:
    key = _key(fid, plan, irrigated, limit_mm, scenario, start_year, method, prices)
    if key in _RESULTS:
        return _RESULTS[key]
    ctx = context(fid, irrigated, limit_mm, scenario, method)
    years = [w.year for w in ctx.weather.years]
    n = len(years)
    runs = _runs(ctx, plan, list(range(n)))
    ind, outcomes = indicators(ctx, plan, runs, prices)
    if start_year in years:
        play_start = years.index(start_year)
    else:  # the most ordinary year: median outcome
        order = sorted(range(n), key=lambda s: outcomes[s]["score"])
        play_start = order[n // 2]
    play = _runs(ctx, plan, [play_start], record_start=play_start)[0]
    crops = rotation_crops()
    result = {
        "field_id": fid,
        "plan": [list(p) for p in plan],
        "scenario": scenario,
        "indicators": ind,
        "outcomes": outcomes,
        "summary": {
            "good_years": sum(o["class"] == "good" for o in outcomes),
            "ok_years": sum(o["class"] == "ok" for o in outcomes),
            "fail_years": sum(o["class"] == "fail" for o in outcomes),
            "n_years": n,
        },
        "years": [
            {
                "crop": y.crop,
                "cover": y.cover,
                "yield_t_ha": round(float(np.median([r.years[k].yield_t_ha for r in runs])), 2),
                "normal_t_ha": round(ctx.normal.get(y.crop or "", 0.0), 2),
                "cover_biomass_t_ha": round(
                    float(np.median([r.years[k].cover_biomass_kg_ha for r in runs])) / 1000, 1
                ),
                "sow": ctx.sow.get(y.crop or ""),
            }
            for k, y in enumerate(runs[0].years)
        ],
        "links": links(ctx, plan, runs),
        "soil_reserve": soil_reserve(ctx, runs),
        "salinity": salinity_risk(
            ctx.irrigated,
            ctx.site.irrigation_method,
            ctx.site.clay_pct,
            float(np.mean([sum(w.et0) for w in ctx.weather.years])),
            ind["water"]["detail"]["irrigation_m3"],
        ),
        "cover_notes": cover_notes(ctx, plan, ind),
        "economy": economy(ctx, plan, runs, prices),
        "work_calendar": work_calendar(ctx, plan, play),
        "costs": [{k: round(v, 1) for k, v in c.items()} for c in season_costs(ctx, plan)],
        "playback": {
            "start_year": years[play_start],
            "weather_years": [years[(play_start + k) % n] for k in range(len(plan))],
            "weeks": weekly(play),
            "captions": captions(ctx, play),
        },
        "names": {c: crops[c].name_ru for p in plan for c in p if c},
        "estimate_note": (
            "Урожаи, цены и вредители — оценки модели, а не прогноз для вашего хозяйства."
        ),
    }
    if len(_RESULTS) > 2000:
        _RESULTS.clear()
    _RESULTS[key] = result
    return result


def needs_water(fid: str) -> dict[str, bool]:
    """Crops that on this field give < 40 % of their irrigated yield without irrigation."""
    dry = context(fid, False, 0.0).normal
    wet = context(fid, True, 900.0, method="drip").normal
    return {c: wet.get(c, 0) > 0 and dry.get(c, 0) < 0.4 * wet[c] for c in wet}


EXPENSIVE_USD = 800.0  # start cost per ha that marks a crop as «дорогая» (estimate)
LABOUR_HEAVY_DAYS = 20.0


def _card_costs(cid: str) -> dict[str, Any]:
    econ = default_economics()
    e = econ.crops.get(cid)
    if not e:
        return {"start_cost_usd": 0, "labour_days": 0, "expensive": False}
    start = e.seed_usd_ha + e.ops_usd_ha + DEFAULT_N.get(cid, 0.0) * econ.n_usd_kg
    days = e.labour_h_ha / 8
    return {
        "start_cost_usd": round(start, -1),
        "labour_days": round(days, 1),
        "expensive": start > EXPENSIVE_USD or days > LABOUR_HEAVY_DAYS,
    }


def alternatives(
    fid: str,
    plan: Plan,
    year: int,
    slot: int,
    priorities: list[str],
    irrigated: bool,
    limit_mm: float,
    method: str | None,
    budget_usd: float | None = None,
) -> list[dict[str, Any]]:
    """«Чем заменить?»: 2–3 crops for this cell that clear its warning and do best for the
    farmer's priorities (docs/IMPROVEMENTS.md B7)."""
    crops = rotation_crops()
    ctx = context(fid, irrigated, limit_mm, "history", method)
    want_cover = slot == 1
    rows = []
    for c in crops.values():
        if c.is_cover != want_cover or c.id == plan[year][slot]:
            continue
        alt = [list(p) for p in plan]
        alt[year][slot] = c.id
        cand = [(p[0], p[1]) for p in alt]
        bad = [
            v
            for v in check_rotation(rotation_from_plan("x", "x", cand))
            if v.year in (year, year + 1) and v.code != "bare_year"
        ]
        if bad:
            continue
        if budget_usd is not None and season_costs(ctx, cand)[year]["start_usd"] > budget_usd:
            continue
        rows.append((c.id, cand))
    scored = []
    for cid, cand in rows[:6]:
        q = quick(fid, cand, irrigated, limit_mm, "history", None, method)
        ind = q["indicators"]
        scored.append((cid, ind))
    if not scored:
        return []
    keys = {
        "water": ("water", -1),
        "income": ("money", 1),
        "soil": ("soil", 1),
        "risk": ("risk", -1),
    }

    def score(ind: dict[str, Any]) -> float:
        total = 0.0
        for p in priorities or ["income"]:
            k, sign = keys.get(p, ("money", 1))
            vals = [x[1][k]["value"] for x in scored]
            lo, hi = min(vals), max(vals)
            total += (
                0.5
                if hi == lo
                else (
                    (ind[k]["value"] - lo) / (hi - lo)
                    if sign > 0
                    else (hi - ind[k]["value"]) / (hi - lo)
                )
            )
        return total

    best = sorted(scored, key=lambda x: (-score(x[1]), x[0]))[:3]
    return [
        {
            "crop": cid,
            "name_ru": crops[cid].name_ru,
            "indicators": {k: ind[k]["value"] for k in ("water", "money", "soil", "risk")},
        }
        for cid, ind in best
    ]


@lru_cache(maxsize=1)
def deck() -> list[dict[str, Any]]:
    """Crop cards: icon key, name and one line of what the crop does for the field."""
    crops = rotation_crops()
    water = {c.id: c.kc_mid * c.season_days for c in crops.values()}
    hi, lo = max(water.values()), min(water.values())
    out = []
    for c in crops.values():
        lines = []
        if c.is_legume:
            lines.append("Даёт азот следующей культуре")
        if c.is_cover:
            lines.append("Закрывает почву между сезонами")
        if c.deep_roots and not c.is_cover:
            lines.append("Глубокие корни рыхлят почву")
        w = (water[c.id] - lo) / (hi - lo)
        if not c.is_cover and w > 0.55:
            lines.append("Пьёт много воды")
        elif not c.is_cover and w < 0.3:
            lines.append("Пьёт мало воды")
        if c.min_break_years >= 3:
            lines.append(f"Не чаще раза в {c.min_break_years + 1} года")
        out.append(
            {
                "id": c.id,
                "name_ru": c.name_ru.replace(" (покровная)", "").replace(" (покровный)", ""),
                "family": c.family,
                "family_ru": c.family_ru,
                "is_cover": c.is_cover,
                "is_legume": c.is_legume,
                "min_break_years": c.min_break_years,
                "allow_consecutive": c.allow_consecutive,
                "root_depth_m": c.root_depth_m,
                "water": "много" if w > 0.55 else "мало" if w < 0.3 else "средне",
                "hint": lines[0] if lines else "Основная культура",
                "hints": lines,
                **_card_costs(c.id),
                "estimate": c.estimate,
            }
        )
    return out
