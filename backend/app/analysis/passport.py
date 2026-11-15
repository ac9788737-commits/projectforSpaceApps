"""«Паспорт поля» and the 20-year field calendar in plain words (docs/UX.md §2). Pure."""

from __future__ import annotations

from typing import Any

import numpy as np

from app.analysis.indices import MONTH_STARTS, month_of
from app.rotation.erosion import EROSIVE_RAIN_MM
from app.rotation.weather import DAYS, Weather

MONTHS_GEN = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)
SEASONS = {"зимой": (11, 0, 1), "весной": (2, 3, 4), "летом": (5, 6, 7), "осенью": (8, 9, 10)}


def plural_ru(n: int, one: str, few: str, many: str) -> str:
    n = abs(n) % 100
    if 11 <= n <= 14:
        return many
    return one if n % 10 == 1 else few if 2 <= n % 10 <= 4 else many


def _date_ru(mmdd: str | None) -> str | None:
    if not mmdd:
        return None
    m, d = (int(x) for x in mmdd.split("-"))
    return f"{d} {MONTHS_GEN[m - 1]}"


def passport(history: dict[str, Any], weather: Weather, layers: dict[str, Any]) -> dict[str, Any]:
    n = len(weather.years)
    hot = history["heat"]["days_above_35_mean"]
    precip = float(np.mean(history["drought"]["annual_precip_mm"]))
    et0 = float(np.mean(history["drought"]["annual_et0_mm"]))
    season_share = {
        name: float(
            np.mean(
                [
                    sum(sum(w.precip[MONTH_STARTS[m] : MONTH_STARTS[m + 1]]) for m in ms)
                    for w in weather.years
                ]
            )
        )
        / max(1.0, precip)
        for name, ms in SEASONS.items()
    }
    top = sorted(season_share.items(), key=lambda kv: -kv[1])[:2]
    cards = []
    cards.append(
        {
            "icon": "sun",
            "title": "Жарко летом"
            if hot >= 10
            else "Умеренное лето"
            if hot >= 1
            else "Жары почти не бывает",
            "text": f"в среднем {round(hot)} {plural_ru(round(hot), 'день', 'дня', 'дней')} "
            "в году выше 35 °C"
            if hot >= 1
            else "дней выше 35 °C почти нет",
            "level": "bad" if hot >= 30 else "ok" if hot >= 5 else "good",
        }
    )
    dry = precip < 0.5 * et0
    cards.append(
        {
            "icon": "drop",
            "title": "Мало дождей"
            if dry
            else "Дождей хватает не всегда"
            if precip < et0
            else "Дождей много",
            "text": f"{round(precip / 10) * 10} мм в год, больше всего — {top[0][0]} и {top[1][0]}",
            "level": "bad" if dry else "ok" if precip < et0 else "good",
        }
    )
    b = history["bare_soil"]
    if b.get("available"):
        risk = b["risk_months"]
        cards.append(
            {
                "icon": "soil",
                "title": "Почва подолгу голая"
                if b["mean_bare_days"] > 120
                else "Почва чаще укрыта",
                "text": f"голая около {round(b['mean_bare_days'] / 10) * 10} дней в году"
                + (f"; ливни на голую почву — {', '.join(risk)}" if risk else ""),
                "level": "bad" if b["mean_bare_days"] > 120 else "ok",
            }
        )
    else:
        storms = sum(sum(p >= EROSIVE_RAIN_MM for p in w.precip) for w in weather.years) / n
        cards.append(
            {
                "icon": "soil",
                "title": "Сильные ливни" if storms >= 6 else "Ливни нечасто",
                "text": (
                    f"в среднем {round(storms)} "
                    f"{plural_ru(round(storms), 'ливень', 'ливня', 'ливней')} в год "
                    "смывают голую почву; "
                    "снимков со спутника для этого поля пока нет"
                ),
                "level": "bad" if storms >= 10 else "ok",
            }
        )
    f = history["frost"]
    last = _date_ru(f["last_spring_median"])
    cards.append(
        {
            "icon": "frost",
            "title": "Весенние заморозки" if last else "Заморозков нет",
            "text": f"последний обычно до {last}, "
            f"в 1 году из 10 — до {_date_ru(f['last_spring_p90'])}"
            if last
            else f"за {n} лет ни одного заморозка",
            "level": "ok" if last else "good",
        }
    )
    return {
        "cards": cards,
        "trends": trends(weather),
        "calendar": calendar(history, weather),
        "sources": sources(layers),
    }


def trend_line(label: str, unit: str, values: list[float], years: list[int]) -> dict[str, Any]:
    """«Тогда и сейчас»: the two halves of the period; a change counts only if the difference of
    means exceeds half the year-to-year standard deviation (docs/IMPROVEMENTS.md B1)."""
    h = len(values) // 2
    a, b = values[:h], values[h:]
    ma, mb = float(np.mean(a)), float(np.mean(b))
    sd = float(np.std(values))
    changed = abs(mb - ma) > 0.5 * sd and max(ma, mb) >= 1 if sd > 0 else False
    pct = (mb - ma) / ma * 100 if ma else 0.0
    first, second = f"{years[0]}–{years[h - 1]}", f"{years[h]}–{years[-1]}"

    def r(x: float) -> str:
        return f"{x:.1f}".replace(".", ",") if abs(x) < 10 else str(round(x))

    if changed:
        text = f"{label}: было {round(ma)}{unit} в {first}, стало {round(mb)}{unit} в {second}" + (
            f" ({'+' if pct >= 0 else '−'}{abs(round(pct))} %)" if ma else ""
        )
    else:
        text = f"{label}: почти без изменений ({r(ma)}{unit} в {first}, {r(mb)}{unit} в {second})"
    return {
        "label": label,
        "first": [years[0], years[h - 1]],
        "second": [years[h], years[-1]],
        "mean_first": round(ma, 1),
        "mean_second": round(mb, 1),
        "changed": changed,
        "text": text,
    }


def trends(weather: Weather) -> list[dict[str, Any]]:
    years = [w.year for w in weather.years]
    hot = [float(sum(t > 35 for t in w.tmax)) for w in weather.years]
    rain = [float(sum(w.precip)) for w in weather.years]
    frost = [float(sum(t <= 0 for t in w.tmin)) for w in weather.years]
    return [
        trend_line("Жарких дней (> 35 °C)", "", hot, years),
        trend_line("Осадков за год", " мм", rain, years),
        trend_line("Морозных дней", "", frost, years),
    ]


def calendar(history: dict[str, Any], weather: Weather) -> list[dict[str, Any]]:
    """20 rows × 12 months: covered/bare (satellite, if any), heat, drought, downpour."""
    bare = (
        {y["year"]: y for y in history["bare_soil"].get("years", [])}
        if history["bare_soil"].get("available")
        else {}
    )
    spei = history["drought"]["spei3"]
    rows = []
    for i, w in enumerate(weather.years):
        months = []
        for m in range(12):
            days = range(MONTH_STARTS[m], MONTH_STARTS[m + 1])
            heat = sum(w.tmax[d] > 35 for d in days)
            storms = sum(w.precip[d] >= EROSIVE_RAIN_MM for d in days)
            drought = spei[i][m] is not None and spei[i][m] <= -1
            cover = None
            if w.year in bare:
                bare_days = sum(
                    1
                    for p in bare[w.year]["periods"]
                    for d in range(_doy(p["start"]), _doy(p["start"]) + p["days"])
                    if month_of(d % DAYS) == m
                )
                cover = "bare" if bare_days > 15 else "covered"
            months.append(
                {"heat": int(heat), "storm": int(storms), "drought": bool(drought), "cover": cover}
            )
        notes = _year_notes(months)
        rows.append(
            {"year": w.year, "months": months, "notes": notes, "precip_mm": round(sum(w.precip))}
        )
    return rows


def _doy(mmdd: str) -> int:
    from app.rotation.weather import doy_of

    return doy_of(mmdd)


def _year_notes(months: list[dict[str, Any]]) -> list[str]:
    names = (
        "январе",
        "феврале",
        "марте",
        "апреле",
        "мае",
        "июне",
        "июле",
        "августе",
        "сентябре",
        "октябре",
        "ноябре",
        "декабре",
    )
    out = []
    dry = [m for m in range(12) if months[m]["drought"]]
    if dry:
        seasons = {s for s, ms in SEASONS.items() if any(m in ms for m in dry)}
        out.append("засуха " + ", ".join(sorted(seasons)))
    hot = [m for m in range(12) if months[m]["heat"] >= 5]
    if hot:
        out.append("жара в " + ", ".join(names[m] for m in hot))
    storms = sum(months[m]["storm"] for m in range(12))
    if storms >= 8:
        out.append(f"{storms} сильных ливней")
    return out or ["спокойный год"]


def sources(layers: dict[str, Any]) -> list[dict[str, Any]]:
    terr = layers["terrain"]["data"] if layers["terrain"]["status"] in ("ok", "cached") else None
    slope = terr.get("slope_pct") if terr else None
    return [
        {
            "icon": "sun",
            "text": "Погода за 20 лет — NASA POWER",
            "ok": layers["power"]["status"] in ("ok", "cached"),
        },
        {
            "icon": "soil",
            "text": "Почва — SoilGrids",
            "ok": layers["soilgrids"]["status"] in ("ok", "cached"),
        },
        {
            "icon": "slope",
            "text": f"Уклон {slope:.0f} %" if slope is not None else "Уклон",
            "ok": slope is not None,
        },
        {"icon": "satellite", "text": "Снимки со спутника", "ok": bool(layers.get("ndvi_ok"))},
    ]
