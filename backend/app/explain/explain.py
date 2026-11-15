"""Short explanations of a scheme for the farmer (ROTATION.md §3.3).

Rule: every number in the text must be present in the input facts (tested). Templates are the
default; with ANTHROPIC_API_KEY set, Claude may rephrase the same facts, and the result is
rejected (template kept) if it contains a number that is not in the facts.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

NUM = re.compile(r"[−-]?\d+(?:[.,]\d+)?")
MODEL = "claude-opus-5-5"


def _fmt(x: float, digits: int = 0) -> str:
    s = f"{abs(x):.{digits}f}".replace(".", ",")
    return ("−" if x < 0 else "") + s


def facts(scheme: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    """The numbers an explanation may use: scheme vs the comparison scheme (medians)."""
    m, b = scheme["metrics"], baseline["metrics"]

    def diff_pct(k: str) -> float:
        base = b[k]["p50"]
        return round((m[k]["p50"] - base) / abs(base) * 100) if abs(base) > 1e-9 else 0.0

    return {
        "name": f"№{scheme.get('rank', scheme['id'])}",
        "base": f"№{baseline.get('rank', baseline['id'])}",
        "crops": [p["main_ru"] for p in scheme["plan"]],
        "covers": [p["cover_ru"] for p in scheme["plan"] if p["cover_ru"]],
        "yield_diff_pct": diff_pct("yield"),
        "income_diff_usd": round(m["income"]["p50"] - b["income"]["p50"]),
        "water_diff_m3": round(m["water"]["p50"] - b["water"]["p50"]),
        "erosion_ratio": round(b["erosion"]["p50"] / m["erosion"]["p50"], 1)
        if m["erosion"]["p50"] > 1e-6
        else None,
        "bare_days_diff": round(m["bare"]["p50"] - b["bare"]["p50"]),
        "risk_pct": round(m["risk"]["p50"] * 100),
        "income_p10": round(m["income"]["p10"]),
        "income_p90": round(m["income"]["p90"]),
    }


def template(f: dict[str, Any]) -> str:
    parts = [f"Схема {f['name']}: {' → '.join(f['crops'])}."]
    if f["name"] != f["base"]:
        y = f["yield_diff_pct"]
        parts.append(
            f"По сравнению со схемой {f['base']} урожай в среднем "
            + ("на уровне" if y == 0 else f"{'выше' if y > 0 else 'ниже'} на {_fmt(abs(y))} %")
            + ", маржа "
            + (
                "та же"
                if f["income_diff_usd"] == 0
                else f"{'больше' if f['income_diff_usd'] > 0 else 'меньше'} "
                f"на {_fmt(abs(f['income_diff_usd']))} $ с гектара в год"
            )
            + "."
        )
        if f["water_diff_m3"] < 0:
            parts.append(
                f"Она экономит {_fmt(abs(f['water_diff_m3']))} м³ поливной воды на гектар в год."
            )
        if f["erosion_ratio"] and f["erosion_ratio"] >= 1.2:
            why = f" за счёт покровных культур ({', '.join(f['covers'])})" if f["covers"] else ""
            parts.append(f"Эрозия в {_fmt(f['erosion_ratio'], 1)} раза ниже{why}.")
        if f["bare_days_diff"] < 0:
            parts.append(f"Голой почвы на {_fmt(abs(f['bare_days_diff']))} дней в году меньше.")
    parts.append(
        f"В 8 из 10 лет маржа от {_fmt(f['income_p10'])} до {_fmt(f['income_p90'])} $/га; "
        f"вероятность провала культуры — {_fmt(f['risk_pct'])} %."
    )
    return " ".join(parts)


def numbers_in(text: str) -> set[str]:
    return {n.replace("−", "-").replace(",", ".").lstrip("-") for n in NUM.findall(text)}


def allowed_numbers(f: dict[str, Any]) -> set[str]:
    out = {"8", "10"}  # «в 8 из 10 лет» = P10–P90
    for v in f.values():
        if isinstance(v, (int, float)) and v is not None:
            out |= numbers_in(_fmt(v, 0)) | numbers_in(_fmt(v, 1)) | numbers_in(str(v))
        if isinstance(v, str):
            out |= numbers_in(v)
        if isinstance(v, list):
            for x in v:
                out |= numbers_in(str(x))
    return out


def explain(scheme: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    f = facts(scheme, baseline)
    text = template(f)
    source = "template"
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        try:
            llm = _claude(f, key)
            if llm and numbers_in(llm) <= allowed_numbers(f):
                text, source = llm, "claude"
        except Exception:
            pass
    return {"text": text, "source": source, "facts": f}


def _claude(f: dict[str, Any], key: str) -> str | None:
    import anthropic

    client = anthropic.Anthropic(api_key=key, timeout=60.0)
    prompt = (
        "Объясни фермеру в 2–3 коротких предложениях на русском, чем хороша и чем плоха эта схема "
        "севооборота. Используй только числа из JSON ниже, не добавляй новых чисел и оценок.\n"
        + json.dumps(f, ensure_ascii=False)
    )
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=4000,
        output_config={"effort": "low"},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        messages=[{"role": "user", "content": prompt}],
    )
    if response.stop_reason == "refusal":
        return None
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    return text or None
