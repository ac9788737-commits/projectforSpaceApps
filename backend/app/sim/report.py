"""Season report: yield vs norm, what harmed most, what helped. Deterministic.

"Norm" is the same world, crops, protection and overrides without events or farmer
actions. Harm and help are measured by re-running the season without one event or one
action at a time (counterfactuals).
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from app.sim.actions import ACTION_TYPES
from app.sim.engine import DEATH_RU, STRESS_RU, CropBook, SimResult, SimScenario, run
from app.sim.environment.events import EVENT_TYPES

MAX_COUNTERFACTUALS = 8

EVENT_LABEL_RU = {
    "heatwave": "жара",
    "frost": "заморозок",
    "cold_snap": "похолодание",
    "drought": "засуха",
    "downpour": "ливень",
    "hail": "град",
    "storm": "буря",
    "dust_storm": "пылевая буря",
    "flare": "вспышка звезды",
    "eclipse": "долгая ночь",
    "greenhouse_failure": "сбой теплицы",
}

STAGE_GENITIVE = {
    "seed": "прорастания",
    "germination": "прорастания",
    "vegetative": "роста листвы",
    "flowering": "цветения",
    "mature": "созревания",
    "dead": "гибели",
}
FRUITING_GENITIVE = {
    "tuber": "клубнеобразования",
    "grain": "налива зерна",
    "fruit": "созревания плодов",
    "pod": "налива бобов",
    "root": "роста корнеплода",
    "leaf": "роста листвы",
    "biomass": "роста культуры",
}


def _stage_at(
    records: list[dict[str, Any]], day: float, organ: str, organ_init_day: int | None
) -> str:
    if not records:
        return "сезона"
    i = max(0, min(int(day), len(records) - 1))
    # An event that killed the plant is named by the stage it struck, not by "death".
    while i > 0 and records[i]["stage"] == "dead":
        i -= 1
    stage = str(records[i]["stage"])
    if (
        organ == "tuber"
        and organ_init_day is not None
        and i >= organ_init_day
        and stage in ("vegetative", "flowering", "fruiting")
    ):
        return FRUITING_GENITIVE["tuber"]
    if stage == "fruiting":
        return FRUITING_GENITIVE.get(organ, "формирования урожая")
    return STAGE_GENITIVE.get(stage, "сезона")


def _yields(result: SimResult) -> dict[str, float]:
    return {pid: float(s["yield_g"]) for pid, s in result.summary.items()}  # type: ignore[arg-type]


def build_report(sc: SimScenario, result: SimResult, book: CropBook) -> dict[str, Any]:
    baseline = run(replace(sc, events=(), actions=()), book)
    base_y = _yields(baseline)
    actual_y = _yields(result)

    harms: dict[str, list[dict[str, Any]]] = {pid: [] for pid in result.summary}
    for ev in sc.events[:MAX_COUNTERFACTUALS]:
        without = _yields(run(replace(sc, events=tuple(e for e in sc.events if e is not ev)), book))
        for pid in result.summary:
            loss = without[pid] - actual_y[pid]
            harms[pid].append(
                {
                    "kind": "event",
                    "type": ev.type,
                    "start_day": round(ev.start_hour / result.report_day_hours, 2),
                    "loss_g": round(loss, 4),
                }
            )
    helps: dict[str, list[dict[str, Any]]] = {pid: [] for pid in result.summary}
    for act in sc.actions[:MAX_COUNTERFACTUALS]:
        without = _yields(
            run(replace(sc, actions=tuple(a for a in sc.actions if a is not act)), book)
        )
        for pid in result.summary:
            if act.plot not in (None, pid):
                continue
            gain = actual_y[pid] - without[pid]
            helps[pid].append(
                {
                    "type": act.type,
                    "name_ru": ACTION_TYPES[act.type]["name_ru"],
                    "day": round(act.hour / result.report_day_hours, 2),
                    "gain_g": round(gain, 4),
                }
            )

    plots: dict[str, Any] = {}
    for pid, s in result.summary.items():
        records = result.plots[pid]
        crop_id = str(s["crop_id"])
        morph = book.morph[crop_id]
        organ_day = next(
            (
                int(str(e["day"]))
                for e in result.log
                if e["plot"] == pid and e["type"] == "organ_init"
            ),
            None,
        )
        norm = base_y[pid]
        vs_norm = actual_y[pid] / norm if norm > 0 else (0.0 if actual_y[pid] <= 0 else 1.0)
        plot_harms = sorted(
            (h for h in harms[pid] if h["loss_g"] > 1e-6), key=lambda h: -h["loss_g"]
        )
        for h in plot_harms:
            h["label_ru"] = EVENT_TYPES[h["type"]].name_ru
            h["during_ru"] = _stage_at(records, h["start_day"], morph.harvest_organ, organ_day)
            h["loss_rel_norm"] = round(h["loss_g"] / norm, 4) if norm > 0 else None
        plot_helps = sorted(
            (h for h in helps[pid] if h["gain_g"] > 1e-6), key=lambda h: -h["gain_g"]
        )
        stress_days: dict[str, int] = {}
        for rec in records:
            day_stresses: list[dict[str, Any]] = rec.get("stresses", [])  # type: ignore[assignment]
            for st in day_stresses:
                key = str(st["cause"])
                stress_days[key] = stress_days.get(key, 0) + 1
        main = _main_cause(s, plot_harms, stress_days, records)
        pct = round(vs_norm * 100)
        if not s["alive"] and actual_y[pid] > 0:
            cause = DEATH_RU.get(str(s["death_cause"]), str(s["death_cause"]))
            headline = (
                f"Ботва погибла на {s['death_day']}-е сутки ({cause}), но урожай в почве "
                f"уцелел: {pct}% от нормы" + (f", главная причина — {main}." if main else ".")
            )
        elif not s["alive"]:
            cause = DEATH_RU.get(str(s["death_cause"]), str(s["death_cause"]))
            headline = f"Растение погибло на {s['death_day']}-е сутки: {cause}."
            if main:
                headline += f" Главная причина — {main}."
        else:
            headline = f"Урожай {pct}% от нормы" + (
                f", главная причина — {main}." if main and pct < 98 else "."
            )
        plots[pid] = {
            "crop_id": crop_id,
            "protection": s["protection"],
            "alive": s["alive"],
            "death_cause": s["death_cause"],
            "death_day": s["death_day"],
            "harvest_day": s["harvest_day"],
            "yield_g": s["yield_g"],
            "yield_rel_earth": s["yield_rel"],
            "norm_yield_g": round(norm, 4),
            "yield_vs_norm": round(min(vs_norm, 9.99), 4),
            "water_used_mm": s["water_used_mm"],
            "damage": s["damage"],
            "health": [rec["health"] for rec in records],
            "stress_days": dict(sorted(stress_days.items())),
            "harms": plot_harms,
            "helps": plot_helps,
            "headline_ru": headline,
        }
    return {
        "world": {"id": result.world.id, "name_ru": result.world.name_ru},
        "seed": sc.seed,
        "days": result.days,
        "report_day_hours": result.report_day_hours,
        "plots": plots,
        "events": [
            {
                "type": e.type,
                "start_hour": e.start_hour,
                "duration_hours": e.duration_hours,
                "intensity": e.intensity,
            }
            for e in sc.events
        ],
        "actions": [{"type": a.type, "hour": a.hour, "plot": a.plot} for a in sc.actions],
        "notes": result.notes,
    }


def _main_cause(
    summary: dict[str, Any],
    harms: list[dict[str, Any]],
    stress_days: dict[str, int],
    records: list[dict[str, Any]],
) -> str | None:
    if harms:
        h = harms[0]
        return f"{EVENT_LABEL_RU[h['type']]} во время {h['during_ru']}"
    if stress_days:
        key = max(stress_days, key=lambda k: (stress_days[k], k))
        return STRESS_RU.get(key, key).lower()
    if records:
        lim: dict[str, int] = {}
        for rec in records:
            if float(rec["limiting_f"]) < 0.8:
                lim[str(rec["limiting_factor"])] = lim.get(str(rec["limiting_factor"]), 0) + 1
        if lim:
            from app.simulate import FACTOR_LABELS_RU

            key = max(lim, key=lambda k: (lim[k], k))
            return f"ограничивает {FACTOR_LABELS_RU.get(key, key).lower()}"
    return None
