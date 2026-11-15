"""B12: with lang=en the server's sentences carry no Russian (docs/IMPROVEMENTS.md)."""

import re
from typing import Any

from fastapi.testclient import TestClient

from app.i18n import en, names, translate
from app.main import app

CY = re.compile("[А-Яа-яЁё]")
client = TestClient(app)


def _russian(o: Any, path: str = "") -> list[str]:
    if isinstance(o, dict):
        return [x for k, v in o.items() for x in _russian(v, f"{path}.{k}")]
    if isinstance(o, list):
        return [x for v in o for x in _russian(v, path)]
    return [f"{path}: {o}"] if isinstance(o, str) and CY.search(o) else []


def test_templates() -> None:
    assert en("Год 2, июнь: ливень 40 мм на голую почву — смыло ≈ 1,5 т/га") == (
        "Year 2, June: 40 mm downpour on bare soil — ≈ 1.5 t/ha washed away"
    )
    assert names("tg")["cotton"] == "Пахта"
    assert translate({"text": "Уборка"}, "ru") == {"text": "Уборка"}


def test_quick_and_passport_in_english() -> None:
    plan = [["cotton", None], ["chickpea", "vetch"], ["winter_wheat", None], ["maize", "rye_cover"]]
    q = client.post(
        "/rotation/quick",
        json={"field_id": "tj-hissar", "plan": plan, "irrigation": "furrow", "lang": "en"},
    ).json()
    assert _russian(q) == []
    p = client.get("/fields/tj-hissar/passport?lang=en")
    if p.status_code == 200:
        assert _russian(p.json()) == []
    assert _russian(client.get("/rotation/deck?lang=en").json()) == []
