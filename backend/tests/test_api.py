from __future__ import annotations

import pytest


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_openapi_lists_routes(client):
    paths = client.get("/openapi.json").json()["paths"]
    for path in ("/planets", "/planets/{planet_id}", "/crops", "/simulate", "/compare"):
        assert path in paths


def test_list_planets_filters(client):
    all_items = client.get("/planets", params={"kind": "solar_system"}).json()
    assert all_items["total"] == 12
    mars = client.get("/planets", params={"q": "марс"}).json()
    assert [p["id"] for p in mars["items"]] == ["mars"]
    assert (
        client.get("/planets", params={"star_type": "G", "kind": "solar_system"}).json()["total"]
        == 12
    )


def test_planet_detail_has_spectrum_and_provenance(client):
    data = client.get("/planets/mars").json()
    assert data["environment"]["gravity_g"] == pytest.approx(0.38, abs=0.01)
    assert len(data["spectrum"]) > 100
    entry = data["planet"]["provenance"]["surface_pressure_pa"]
    assert entry["source"] and entry["retrieved_at"]
    assert entry["estimate"] is False
    assert data["planet"]["provenance"]["water"]["estimate"] is True


def test_missing_planet(client):
    assert client.get("/planets/nope").status_code == 404


def test_crops_have_estimate_flag(client):
    crops = client.get("/crops").json()
    assert len(crops) == 10
    assert all(c["estimate"] for c in crops)
    # No fabricated references: estimates carry no citation.
    assert all(not c["reference"] for c in crops)


def test_simulate_earth(client):
    body = {"planet_id": "earth", "crop_id": "wheat", "scenario": "open_surface"}
    data = client.post("/simulate", json=body).json()
    assert data["yield_rel"] >= 0.9 and data["survival"] is True
    assert len(data["factors"]) == 12
    assert data["limiting_factor_label"]


def test_simulate_mars_open_is_zero(client):
    body = {"planet_id": "mars", "crop_id": "lettuce", "scenario": "open_surface"}
    data = client.post("/simulate", json=body).json()
    assert data["survival"] is False and data["yield_rel"] == 0.0
    assert data["recommendations"]


def test_simulate_with_preset_and_ranges(client):
    body = {
        "planet_id": "mars",
        "crop_id": "wheat",
        "scenario": "greenhouse",
        "atmosphere_preset": "mars_like",
        "ranges": {"albedo": [0.1, 0.4]},
        "monte_carlo_n": 20,
    }
    data = client.post("/simulate", json=body).json()
    assert data["monte_carlo"]["p10"] <= data["monte_carlo"]["p90"]


def test_simulate_custom_planet_records_assumptions(client):
    body = {
        "custom_planet": {"mass_earth": 1.0, "radius_earth": 1.0, "insolation_earth": 1.0},
        "crop_id": "wheat",
        "scenario": "greenhouse",
    }
    data = client.post("/simulate", json=body).json()
    codes = {a["code"] for a in data["assumptions"]}
    assert "atmosphere_default" in codes and "teff_default" in codes


def test_simulate_requires_one_planet(client):
    body = {"crop_id": "wheat", "scenario": "greenhouse"}
    assert client.post("/simulate", json=body).status_code == 422


def test_simulate_insufficient_data_is_422(client):
    body = {
        "custom_planet": {"mass_earth": 1.0},
        "crop_id": "wheat",
        "scenario": "greenhouse",
    }
    assert client.post("/simulate", json=body).status_code == 422


def test_compare_matrix(client):
    body = {
        "planet_ids": ["earth", "mars"],
        "crop_ids": ["wheat", "lettuce", "rice"],
        "scenario": "open_surface",
    }
    data = client.post("/compare", json=body).json()
    assert len(data["cells"]) == 6


def test_ingest_requires_token(client, monkeypatch):
    assert client.post("/ingest/solar_system").status_code == 403
    monkeypatch.setenv("ASTROCROP_ADMIN_TOKEN", "secret")
    assert client.post("/ingest/solar_system").status_code == 401
    headers = {"X-Admin-Token": "secret"}
    assert client.post("/ingest/unknown", headers=headers).status_code == 404
    assert client.post("/ingest/solar_system", headers=headers).json()["status"] == "seed"


def test_galaxy_presets_and_generation(client):
    presets = client.get("/galaxies").json()
    assert {p["id"] for p in presets} >= {
        "milky_way",
        "magellanic",
        "elliptical",
        "dwarf",
        "starburst",
    }
    generated = client.post(
        "/galaxies/generate", json={"galaxy_preset": "dwarf", "count": 3, "seed": 5}
    ).json()
    assert len(generated) == 3
    assert all(p["hypothetical"] for p in generated)
    assert client.post("/galaxies/generate", json={"galaxy_preset": "x"}).status_code == 404


def test_atmosphere_presets(client):
    assert len(client.get("/atmosphere-presets").json()) == 5


def test_timeline_endpoint_mars_potato(client) -> None:
    body = {"planet_id": "mars", "crop_id": "potato", "scenario": "greenhouse"}
    response = client.post("/simulate/timeline", json=body)
    assert response.status_code == 200
    data = response.json()
    assert data["day_unit"] == "sol"
    assert data["days"][0]["stage"] == "seed"
    assert {"heightM", "organCount", "stress", "health"} <= set(data["days"][-1])
    static = client.post("/simulate", json=body).json()
    assert data["summary"]["static_yield_rel"] == static["yield_rel"]
    assert client.post("/simulate/timeline", json=body).json() == data


def test_timeline_endpoint_open_mars_dies(client) -> None:
    body = {"planet_id": "mars", "crop_id": "potato", "scenario": "open_surface"}
    data = client.post("/simulate/timeline", json=body).json()
    assert data["summary"]["survival"] is False
    assert data["events"][0]["type"] == "death"
    assert data["events"][0]["day"] == 1


def test_timeline_endpoint_rejects_bad_override(client) -> None:
    body = {
        "planet_id": "mars",
        "crop_id": "potato",
        "scenario": "greenhouse",
        "overrides": {"heating_k": 1000},
    }
    assert client.post("/simulate/timeline", json=body).status_code == 422
