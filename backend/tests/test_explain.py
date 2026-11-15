"""Stage 7.7: explanations use only computed numbers; data-gaps block (ROTATION.md §3.3, §5.2)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.explain.explain import allowed_numbers, explain, facts, numbers_in, template
from app.main import app

client = TestClient(app)


def _scheme(sid: str, y: float, inc: float, water: float, ero: float, cover: str | None) -> dict:
    def d(v: float) -> dict:
        return {"p10": v * 0.8, "p50": v, "p90": v * 1.2}

    return {
        "id": sid,
        "plan": [{"main_ru": "Пшеница", "cover_ru": cover}, {"main_ru": "Горох", "cover_ru": None}],
        "metrics": {
            "yield": d(y),
            "income": d(inc),
            "water": d(water),
            "erosion": d(ero),
            "bare": d(60 if cover else 120),
            "risk": d(0.1),
        },
    }


def test_explanation_has_no_invented_numbers() -> None:
    a, b = _scheme("s2", 72, 640, 1800, 2.0, "Вика"), _scheme("s1", 80, 700, 3000, 4.4, None)
    f = facts(a, b)
    text = template(f)
    assert numbers_in(text) <= allowed_numbers(f), (numbers_in(text) - allowed_numbers(f), text)
    assert "Вика" in text and "1200" in text.replace(" ", "")
    out = explain(a, b)
    assert out["source"] == "template" or numbers_in(out["text"]) <= allowed_numbers(f)


def test_number_guard_catches_extra_numbers() -> None:
    f = facts(_scheme("s2", 72, 640, 1800, 2.0, None), _scheme("s1", 80, 700, 3000, 4.4, None))
    assert not numbers_in("урожай выше на 37 %") <= allowed_numbers(f)


def test_gaps_block_names_missing_and_coarse_layers() -> None:
    g = client.get("/fields/tj-hissar/gaps").json()
    text = " ".join(g["data"])
    assert "SMAP" in text and "грубее поля" in text
    assert any("pH" in c for c in g["checklist"])
    assert "не замена агроному" in g["disclaimer"]
