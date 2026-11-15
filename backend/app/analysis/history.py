"""History of a field over 10–20 years: bare soil, heat, drought, frost, vulnerable windows.

ROTATION.md §3.1. Pure functions over Weather and (optionally) daily NDVI.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.analysis.indices import (
    month_of,
    monthly_sums,
    nan_to_none,
    runs,
    spei,
    spi,
    window_percentile,
)
from app.rotation.calendar import sowing_dates
from app.rotation.crops import rotation_crops
from app.rotation.erosion import EROSIVE_RAIN_MM
from app.rotation.simulate import _phenology, _stage
from app.rotation.weather import DAYS, Weather, doy_of, mmdd_of

BARE_NDVI = 0.2  # default bare-soil threshold (ROTATION.md §3.1: ~0.2–0.25, calibrate per region)
BARE_MIN_DAYS = 14
HEAT_MIN_DAYS = 3
FROST_C = 0.0
MONTHS_RU = ("янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек")


def bare_threshold(ndvi: dict[int, list[float | None]]) -> float:
    """Regional calibration: 5th percentile of all NDVI + 0.1, kept within 0.15–0.3."""
    vals = [v for row in ndvi.values() for v in row if v is not None]
    if len(vals) < 50:
        return BARE_NDVI
    return float(min(0.3, max(0.15, np.percentile(vals, 5) + 0.1)))


def bare_soil(weather: Weather, ndvi: dict[int, list[float | None]] | None) -> dict[str, Any]:
    if not ndvi:
        return {"available": False, "reason": "нет рядов NDVI"}
    thr = bare_threshold(ndvi)
    per_year: list[dict[str, Any]] = []
    erosive_in_bare = [0] * 12
    erosive_total = [0] * 12
    for wy in weather.years:
        row = ndvi.get(wy.year)
        if not row or sum(v is None for v in row) > 0.5 * DAYS:
            continue
        mask = [v is not None and v < thr for v in row]
        periods = runs(mask, BARE_MIN_DAYS)
        bare = sum(n for _, n in periods)
        bare_days = {d for s, n in periods for d in range(s, s + n)}
        for d, p in enumerate(wy.precip):
            if p >= EROSIVE_RAIN_MM:
                erosive_total[month_of(d)] += 1
                if d in bare_days:
                    erosive_in_bare[month_of(d)] += 1
        per_year.append(
            {
                "year": wy.year,
                "bare_days": bare,
                "periods": [{"start": mmdd_of(s), "days": n} for s, n in periods],
                "missing_days": sum(v is None for v in row),
            }
        )
    if not per_year:
        return {"available": False, "reason": "в рядах NDVI слишком много пропусков"}
    n = len(per_year)
    return {
        "available": True,
        "threshold": round(thr, 3),
        "years": per_year,
        "mean_bare_days": round(sum(int(y["bare_days"]) for y in per_year) / n, 1),
        "erosive_rain_days_in_bare_by_month": [round(v / n, 2) for v in erosive_in_bare],
        "erosive_rain_days_by_month": [round(v / n, 2) for v in erosive_total],
        "risk_months": [MONTHS_RU[m] for m in range(12) if erosive_in_bare[m] / n >= 0.5],
    }


def heat(weather: Weather) -> dict[str, Any]:
    years = list(weather.years)
    p90 = window_percentile(years, "tmax", 90)
    per_year = []
    by_month = [0] * 12
    for wy in years:
        mask = [wy.tmax[d] > p90[d] for d in range(DAYS)]
        waves = runs(mask, HEAT_MIN_DAYS)
        for s, _ in waves:
            by_month[month_of(s)] += 1
        per_year.append(
            {
                "year": wy.year,
                "waves": len(waves),
                "days": sum(n for _, n in waves),
                "max_c": round(max(wy.tmax), 1),
            }
        )
    n = len(years)
    return {
        "p90_summer_c": round(max(p90), 1),
        "years": per_year,
        "mean_waves": round(sum(y["waves"] for y in per_year) / n, 2),
        "waves_by_month": [round(v / n, 2) for v in by_month],
        "days_above_35_mean": round(sum(sum(t > 35 for t in wy.tmax) for wy in years) / n, 1),
    }


def drought(weather: Weather) -> dict[str, Any]:
    years = list(weather.years)
    p = monthly_sums(years, "precip")
    pet = monthly_sums(years, "et0")
    out: dict[str, Any] = {"years": [y.year for y in years]}
    for scale in (1, 3):
        s = spi(p, scale)
        e = spei(p - pet, scale)
        out[f"spi{scale}"] = nan_to_none(s)
        out[f"spei{scale}"] = nan_to_none(e)
    s3 = np.array(out["spei3"], dtype=float)
    dry = np.nan_to_num(s3, nan=0.0) <= -1.0
    out["dry_months_per_year"] = [int(x) for x in dry.sum(axis=1)]
    out["dry_share_by_month"] = [round(float(x), 3) for x in dry.mean(axis=0)]
    out["annual_precip_mm"] = [round(float(x), 0) for x in p.sum(axis=1)]
    out["annual_et0_mm"] = [round(float(x), 0) for x in pet.sum(axis=1)]
    return out


def frost(weather: Weather) -> dict[str, Any]:
    """Last spring and first autumn frost (Tmin ≤ 0 °C). In the southern hemisphere the year is
    shifted by half a year so that winter sits at the turn of the year, as in the north."""
    shift = 182 if weather.lat < 0 else 0
    last: list[int | None] = []
    first: list[int | None] = []
    frost_free = []
    for wy in weather.years:
        days = sorted((d - shift) % DAYS for d in range(DAYS) if wy.tmin[d] <= FROST_C)
        ls = max((d for d in days if d < 182), default=None)
        fa = min((d for d in days if d >= 182), default=None)
        last.append(ls)
        first.append(fa)
        if ls is not None and fa is not None:
            frost_free.append(fa - ls)
    n = len(weather.years)
    frosts = [d for d in last if d is not None]

    def real(d: int | None) -> str | None:
        return mmdd_of((d + shift) % DAYS) if d is not None else None

    def prob_after(mmdd: str) -> float:
        t = (doy_of(mmdd) - shift) % DAYS
        return round(sum(1 for d in last if d is not None and d >= t) / n, 3)

    return {
        "years_with_frost": sum(1 for wy in weather.years if min(wy.tmin) <= FROST_C),
        "n_years": n,
        "last_spring": [real(d) for d in last],
        "first_autumn": [real(d) for d in first],
        "last_spring_median": real(int(np.median(frosts))) if frosts else None,
        "last_spring_p90": real(int(np.percentile(frosts, 90))) if frosts else None,
        "frost_free_days_median": int(np.median(frost_free)) if frost_free else None,
        "prob_frost_after": {
            m: prob_after(m) for m in ("03-15", "04-01", "04-15", "05-01", "05-15")
        },
    }


def vulnerability(
    weather: Weather, crops: list[str] | None = None, sow: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    """For each crop at its usual sowing date: in how many years the sensitive stage met heat,
    the season met a killing frost, or a dry spell (SPEI-3 ≤ −1) overlapped the season."""
    book = rotation_crops()
    ids = crops or [c.id for c in book.values() if not c.is_cover]
    years = list(weather.years)
    p = monthly_sums(years, "precip")
    pet = monthly_sums(years, "et0")
    s3 = np.nan_to_num(spei(p - pet, 3), nan=0.0)
    out = []
    for cid in ids:
        c = book[cid]
        sow_mmdd = (sow or {}).get(cid) or c.sow_mmdd or "04-15"
        sow_d = doy_of(sow_mmdd)
        heat_years = frost_years = dry_years = 0
        stage_from: list[int] = []
        for i, wy in enumerate(years):
            nxt = years[i + 1] if i + 1 < len(years) else wy
            tmax = list(wy.tmax) + list(nxt.tmax)
            tmin = list(wy.tmin) + list(nxt.tmin)
            tmean = [(x + y) / 2 for x, y in zip(tmax, tmin, strict=True)]
            end, ages = _phenology(c, sow_d, tmean, 2 * DAYS)
            stages = [_stage(c, age) for age in ages]
            sens = [sow_d + k for k, st in enumerate(stages) if st == c.sensitive_stage]
            if sens:
                stage_from.append(sens[0] % DAYS)
            if any(tmax[d] > c.heat_c for d in sens):
                heat_years += 1
            for k, st in enumerate(stages):
                if k < 4:
                    continue
                young = st in ("ini", "dev")
                if tmin[sow_d + k] < c.frost_kill_c - (c.young_frost_margin_c if young else 0.0):
                    frost_years += 1
                    break
            months = {(i + (d // DAYS), month_of(d % DAYS)) for d in range(sow_d, end)}
            if any(yi < len(years) and s3[yi, m] <= -1 for yi, m in months):
                dry_years += 1
        stage_ru = {
            "ini": "всходы",
            "dev": "рост",
            "mid": "цветение / налив",
            "late": "созревание",
        }.get(c.sensitive_stage, "")
        out.append(
            {
                "crop": cid,
                "name_ru": c.name_ru,
                "sow": sow_mmdd,
                "stage_ru": stage_ru,
                "stage_from": mmdd_of(int(np.median(stage_from))) if stage_from else None,
                "heat_c": c.heat_c,
                "heat_years": heat_years,
                "frost_years": frost_years,
                "dry_years": dry_years,
                "n_years": len(years),
            }
        )
    return out


def headline(analysis: dict[str, Any]) -> list[str]:
    """Plain-language findings built only from the computed numbers."""
    out = []
    b = analysis["bare_soil"]
    if b.get("available"):
        out.append(
            f"В среднем {b['mean_bare_days']:.0f} дней голой почвы в год "
            f"(NDVI < {b['threshold']:.2f})."
        )
        if b["risk_months"]:
            out.append(
                "Ливни часто приходятся на голую почву: " + ", ".join(b["risk_months"]) + "."
            )
    n = analysis["n_years"]
    for v in analysis["vulnerability"]:
        if v["crop"] in ("wheat", "winter_wheat") and v["heat_years"]:
            kind = "озимой" if v["crop"] == "winter_wheat" else "яровой"
            out.append(
                f"В {v['heat_years']} из {n} лет на {v['stage_ru']} {kind} пшеницы "
                f"приходилась жара > {v['heat_c']:.0f} °C."
            )
    f = analysis["frost"]
    if f["last_spring_median"]:
        out.append(
            f"Последний весенний заморозок — в среднем {f['last_spring_median']}, "
            f"в 1 году из 10 позже {f['last_spring_p90']}."
        )
    h = analysis["heat"]
    out.append(f"Дней жарче 35 °C — в среднем {h['days_above_35_mean']:.0f} в год.")
    d = analysis["drought"]
    out.append(
        f"Осадки {np.mean(d['annual_precip_mm']):.0f} мм в год "
        f"при испаряемости {np.mean(d['annual_et0_mm']):.0f} мм."
    )
    return out


def analyse(weather: Weather, ndvi: dict[int, list[float | None]] | None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "n_years": len(weather.years),
        "years": [w.year for w in weather.years],
        "bare_soil": bare_soil(weather, ndvi),
        "heat": heat(weather),
        "drought": drought(weather),
        "frost": frost(weather),
        "vulnerability": vulnerability(weather, sow=sowing_dates(weather)),
        "sowing": sowing_dates(weather),
    }
    result["headline"] = headline(result)
    return result
