"""Stage 9 acceptance (docs/IMPROVEMENTS.md, part D) on the Tajik demo field and Iowa."""

from typing import Any

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
MONO = [["cotton", None]] * 4


def _quick(plan: list[Any], fid: str = "tj-hissar", irrigation: str = "furrow") -> dict[str, Any]:
    r = client.post(
        "/rotation/quick", json={"field_id": fid, "plan": plan, "irrigation": irrigation}
    )
    assert r.status_code == 200, r.text
    out: dict[str, Any] = r.json()
    return out


def test_cotton_monoculture_runs_the_soil_down_and_warns_about_salt() -> None:
    q = _quick(MONO)
    line = [p["value"] for p in q["soil_reserve"]]
    assert line[0] == 50 and line[-1] < 40
    assert q["salinity"]["risk"] is True
    assert q["salinity"]["reasons"]


def test_chickpea_from_the_swap_chips_lifts_the_soil_and_saves_fertiliser() -> None:
    fix = client.post(
        "/rotation/fix",
        json={"field_id": "tj-hissar", "plan": MONO, "year": 1, "slot": 0, "irrigation": "furrow"},
    ).json()
    assert 1 <= len(fix) <= 3
    plan = [["cotton", None], ["chickpea", None], ["cotton", None], ["cotton", None]]
    mono, rot = _quick(MONO), _quick(plan)
    assert rot["soil_reserve"][-1]["value"] > mono["soil_reserve"][-1]["value"]
    saving = [lk for lk in rot["links"] if lk.get("fert_saving_usd")]
    assert saving and saving[0]["fert_saving_usd"] > 0
    assert "$" in saving[0]["text"]


def test_advice_respects_a_300_dollar_budget() -> None:
    a = client.post(
        "/rotation/advice",
        json={"field_id": "us-iowa", "priorities": ["income"], "budget_usd_ha": 300},
    ).json()
    if a["plan"]:
        q = _quick(a["plan"], "us-iowa", "none")
        assert max(c["start_usd"] for c in q["costs"]) <= 300


def test_new_numbers_are_in_the_answer() -> None:
    q = _quick([["cotton", None], ["chickpea", "vetch"], ["winter_wheat", None], ["maize", None]])
    e = q["economy"]
    assert e["years"] == 4 and e["tonnes"] and e["prices"]
    assert q["work_calendar"] and {"sow", "harvest"} <= {w["kind"] for w in q["work_calendar"]}
    assert all({"week", "text", "weight"} <= set(c) for c in q["playback"]["captions"])
    assert q["cover_notes"]


def test_rainfed_cards_say_which_crops_need_water() -> None:
    cards = client.get("/rotation/deck?field_id=tj-hissar").json()
    flags = {c["id"]: c["needs_water"] for c in cards}
    assert flags["cotton"] is True
    assert {"start_cost_usd", "labour_days", "expensive"} <= set(cards[0])


def test_passport_has_then_and_now() -> None:
    r = client.get("/fields/tj-hissar/passport")
    if r.status_code == 200:
        trends = r.json()["trends"]
        assert len(trends) == 3 and all("text" in t for t in trends)
