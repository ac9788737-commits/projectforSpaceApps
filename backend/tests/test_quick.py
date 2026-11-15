"""Stage 8.2: instant plan evaluation for the builder (docs/UX.md §8, §10)."""

from __future__ import annotations

import time

import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.rotation.economics import default_economics
from app.rotation.model import rotation_from_plan
from app.rotation.optimizer import DEFAULT_N, Profile, run_metrics
from app.rotation.quick import _runs, context, deck, quick

client = TestClient(app)
FID = "tj-hissar"
COTTON = [("cotton", None)] * 4
MIXED = [("cotton", None), ("chickpea", "vetch"), ("cotton", "rye_cover"), ("winter_wheat", None)]


def test_drag_answer_under_half_a_second() -> None:
    quick(FID, COTTON, True, 900.0)  # field context warm-up (normal yields once per field)
    t = time.perf_counter()
    quick(FID, MIXED, True, 900.0)
    assert time.perf_counter() - t < 0.5
    t = time.perf_counter()
    quick(FID, MIXED, True, 900.0)  # cached
    assert time.perf_counter() - t < 0.01


def test_numbers_match_the_stage7_planner() -> None:
    r = quick(FID, MIXED, True, 900.0)
    ctx = context(FID, True, 900.0)
    runs = _runs(ctx, MIXED, list(range(len(ctx.weather.years))))
    rot = rotation_from_plan("q", "q", MIXED, DEFAULT_N, ctx.sow, True, legume_credit=True)
    mets = [
        run_metrics(
            x, rot, Profile(irrigated=True), default_economics(), ctx.site, ctx.site.soc_pct
        )
        for x in runs
    ]
    income = float(np.median([m["income"] for m in mets]))
    water = float(np.median([m["water"] for m in mets]))
    assert r["indicators"]["money"]["value"] == round(income, -1)
    assert r["indicators"]["water"]["value"] == round(water, -1)
    assert r["indicators"]["_raw"]["erosion"] == round(
        float(np.median([m["erosion"] for m in mets])), 4
    )


def test_twenty_years_and_playback() -> None:
    r = quick(FID, MIXED, True, 900.0)
    s = r["summary"]
    assert s["good_years"] + s["ok_years"] + s["fail_years"] == s["n_years"] == 20
    weeks = r["playback"]["weeks"]
    assert 200 <= len(weeks) <= 212
    assert {"crop", "soil_cover", "water", "soc_pct", "erosion_cum", "storm", "heat"} <= set(
        weeks[0]
    )
    dice = quick(FID, MIXED, True, 900.0, start_year=2008)
    assert dice["playback"]["start_year"] == 2008


def test_links_explain_why() -> None:
    mono = quick(FID, COTTON, True, 900.0)
    assert any(link["kind"] == "warning" and "вредител" in link["text"] for link in mono["links"])
    mixed = quick(FID, MIXED, True, 900.0)
    assert any(link["kind"] == "erosion" for link in mixed["links"])
    assert mixed["indicators"]["water"]["value"] < mono["indicators"]["water"]["value"]


def test_stress_scenario_changes_the_answer() -> None:
    base = quick(FID, MIXED, True, 900.0)
    hot = quick(FID, MIXED, True, 900.0, scenario="plus15_dry")
    assert hot["indicators"]["water"]["value"] >= base["indicators"]["water"]["value"]


def test_api_quick_deck_advice() -> None:
    body = {
        "field_id": FID,
        "plan": [["pea", None], ["wheat", "vetch"], ["maize", None]],
        "irrigated": True,
        "water_limit_m3_ha": 9000,
    }
    r = client.post("/rotation/quick", json=body)
    assert r.status_code == 200 and set(r.json()["indicators"]) >= {
        "water",
        "money",
        "soil",
        "risk",
    }
    assert (
        client.post("/rotation/quick", json={**body, "plan": [["banana", None]]}).status_code == 422
    )
    cards = client.get("/rotation/deck").json()
    assert len(cards) == 17 and all(c["hint"] for c in cards)
    assert len(deck()) == 17
    a = client.post(
        "/rotation/advice",
        json={
            "field_id": FID,
            "priorities": ["water", "soil"],
            "years": 3,
            "irrigated": True,
            "water_limit_m3_ha": 9000,
        },
    ).json()
    assert len(a["plan"]) == 3 and len(a["reasons"]) == 3
    assert a["label"] == "План под ваши приоритеты: вода и почва"
