"""API tests for live sessions, scenarios and experiments (docs/SIMULATOR.md §4.3, §7)."""

from __future__ import annotations

from app.sim.session import store

SCENARIO = {
    "version": 1,
    "world": "earth:temperate",
    "seed": 42,
    "duration_days": 120,
    "crops": [{"crop": "potato", "plot": "A1", "protection": "open", "irrigation": "auto"}],
}


def _create(client, **extra):
    r = client.post("/sim/sessions", json={**SCENARIO, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def test_catalog_lists_controls(client) -> None:
    data = client.get("/sim/catalog").json()
    assert {e["id"] for e in data["events"]} >= {
        "heatwave",
        "frost",
        "drought",
        "hail",
        "dust_storm",
        "greenhouse_failure",
    }
    assert {p["key"] for p in data["parameters"]} >= {"temp_day_c", "co2_ppm", "soil", "gravity_g"}
    assert any(w["id"] == "mars" for w in data["worlds"])


def test_world_endpoint_returns_base_values(client) -> None:
    w = client.get("/sim/worlds/mars").json()
    assert w["pressure_kpa"] < 1.5 and w["water_available"] is False
    assert client.get("/sim/worlds/nowhere").status_code == 404


def test_session_live_changes_and_report(client) -> None:
    s = _create(client)
    sid = s["session_id"]
    traj = client.get(f"/sim/sessions/{sid}/trajectory").json()
    assert traj["days"] >= 100 and len(traj["plots"]["A1"]) == traj["days"]
    base_yield = traj["summary"]["A1"]["yield_g"]
    assert (
        client.post(
            f"/sim/sessions/{sid}/control", json={"action": "seek", "value": 40 * 24}
        ).json()["hour"]
        == 40 * 24
    )
    r = client.post(
        f"/sim/sessions/{sid}/events",
        json={"type": "heatwave", "intensity": "strong", "start": "now", "duration_hours": 10 * 24},
    )
    assert r.status_code == 201
    hot = client.get(f"/sim/sessions/{sid}/trajectory").json()
    assert hot["summary"]["A1"]["yield_g"] < base_yield
    event_id = r.json()["scenario"]["events"][0]["id"]
    client.patch(f"/sim/sessions/{sid}/conditions", json={"values": {"temp_night_c": 11}})
    client.post(f"/sim/sessions/{sid}/actions", json={"type": "irrigate", "params": {"mm": 25}})
    report = client.get(f"/sim/sessions/{sid}/report").json()
    assert report["plots"]["A1"]["harms"][0]["type"] == "heatwave"
    assert "от нормы" in report["plots"]["A1"]["headline_ru"]
    removed = client.delete(f"/sim/sessions/{sid}/events/{event_id}").json()
    assert removed["scenario"]["events"] == []


def test_rewind_and_replay_equals_continuous_play(client) -> None:
    s = _create(client)
    sid = s["session_id"]
    client.post(f"/sim/sessions/{sid}/control", json={"action": "seek", "value": 30 * 24})
    client.patch(f"/sim/sessions/{sid}/conditions", json={"values": {"temp_day_c": 30}})
    client.post(f"/sim/sessions/{sid}/control", json={"action": "seek", "value": 60 * 24})
    client.post(
        f"/sim/sessions/{sid}/events", json={"type": "frost", "intensity": "medium", "start": "now"}
    )
    live = client.get(f"/sim/sessions/{sid}/trajectory").json()
    # Rewind to the start and replay: same journal → identical trajectory.
    client.post(f"/sim/sessions/{sid}/control", json={"action": "seek", "value": 0})
    replay = client.get(f"/sim/sessions/{sid}/trajectory").json()
    assert replay["plots"] == live["plots"]
    # A fresh session from the journal-derived scenario gives the same result too.
    scenario = client.get(f"/sim/sessions/{sid}").json()["scenario"]
    fresh = client.post("/sim/sessions", json=scenario).json()
    again = client.get(f"/sim/sessions/{fresh['session_id']}/trajectory").json()
    assert again["plots"] == live["plots"]


def test_stream_sends_frames_and_accepts_control(client) -> None:
    sid = _create(client)["session_id"]
    with client.websocket_connect(f"/sim/sessions/{sid}/stream") as ws:
        first = ws.receive_json()
        assert first["trajectory_changed"] is True and "A1" in first["plants"]
        assert set(first["env"]) >= {"temp_c", "ppfd", "precip_mm", "wind_ms"}
        ws.send_json({"action": "speed", "value": 20})
        ws.send_json({"action": "play"})
        frames = [ws.receive_json() for _ in range(8)]
        assert frames[-1]["hour"] > 0
        assert frames[-1]["speed"] == 20


def test_scenario_save_and_load(client) -> None:
    saved = client.post("/sim/scenarios", json=SCENARIO).json()
    assert len(saved["id"]) == 10
    loaded = client.get(f"/sim/scenarios/{saved['id']}").json()
    assert loaded["scenario"]["world"] == "earth:temperate"
    assert client.get("/sim/scenarios/../etc").status_code == 404


def test_batch_parameter_sweep(client) -> None:
    body = {"scenario": SCENARIO, "parameter": "temp_day_c", "values": [10, 20, 35]}
    rows = client.post("/sim/batch", json=body).json()["rows"]
    yields = [r["plots"]["A1"]["yield_g"] for r in rows]
    assert yields[1] > yields[0] and yields[1] > yields[2]


def test_bad_scenarios_are_rejected(client) -> None:
    assert (
        client.post("/sim/sessions", json={**SCENARIO, "world": "planet:nowhere"}).status_code
        == 422
    )
    bad_event = {**SCENARIO, "events": [{"type": "meteor"}]}
    assert client.post("/sim/sessions", json=bad_event).status_code == 422
    assert (
        client.post("/sim/sessions", json={**SCENARIO, "overrides": {"magic": 1}}).status_code
        == 422
    )
    store.clear()
