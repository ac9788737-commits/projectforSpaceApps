"""«Пробелы в данных и риски: что проверить агроному на месте» (ROTATION.md §5.2). Pure."""

from __future__ import annotations

from typing import Any

MODEL_LIMITS = (
    "Вредители и болезни — упрощённая эвристика по повтору семейств, а не модель конкретных видов.",
    "Азот — упрощённый баланс; фосфор, калий и микроэлементы не учитываются.",
    "Местные сорта не учтены: длины стадий и урожайный потенциал — типичные значения (оценки).",
    "Сорняки, полегание, качество зерна и уборочные потери не моделируются.",
    "Погода — климат ячейки ≈ 50 км; микроклимат поля (низины, склоны) может отличаться.",
    "Экономика — мировые цены 2024 года и оценки затрат, а не цены у ворот вашего хозяйства.",
)

CHECKLIST = (
    "Анализ почвы: pH, азот, фосфор, калий, органика (0–30 см), отбор по всему полю.",
    "Засолённость (электропроводность) — особенно на орошаемых землях.",
    "Дренаж и уровень грунтовых вод весной и после поливов.",
    "История вредителей и болезней на поле за 3–5 лет.",
    "Местные сорта и принятые сроки сева.",
    "Качество и доступность поливной воды, лимиты и график подачи.",
    "Уклоны, промоины и места застоя воды — осмотр на месте.",
)


def gaps(
    card: dict[str, Any], crop_estimates: list[str], history: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Build the block from the data card (layers), crop parameters and the history analysis."""
    data: list[str] = []
    for layer in card["layers"]:
        st = layer["status"]
        if st in ("no_access", "missing", "failed", "not_loaded"):
            reason = layer["notes"][0] if layer["notes"] else "слой не загружен"
            data.append(f"{layer['source']}: нет данных — {reason}.")
            continue
        if layer.get("coarse") and layer.get("pixel_to_field"):
            data.append(
                f"{layer['source']}: разрешение {layer['space']} грубее поля "
                f"в {layer['pixel_to_field']:.0f} раз — значения усреднены по большой площади."
            )
        if layer.get("missing_share", 0) > 0.05:
            data.append(f"{layer['source']}: пропуски {layer['missing_share'] * 100:.0f} %.")
        for n in layer.get("notes", []):
            if "сдвинуты" in n:
                data.append(f"{layer['source']}: {n}.")
    if history and not history.get("bare_soil", {}).get("available", True):
        data.append("Периоды голой почвы по снимкам не оценены: нет ряда NDVI.")
    if crop_estimates:
        data.append(
            "Параметры культур без проверенного источника (оценки): "
            + ", ".join(sorted(crop_estimates))
            + "."
        )
    return {
        "data": data,
        "model": list(MODEL_LIMITS),
        "checklist": list(CHECKLIST),
        "disclaimer": "Это инструмент поддержки решений, а не замена агроному.",
    }
