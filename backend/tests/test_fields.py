"""Stage 7.2: fields, harmonisation of resolutions, offline demo fields (ROTATION.md §2, §8)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from shapely.geometry import box

from app.geo import fields as geo
from app.geo.harmonize import Grid, area_ha, point_layer, zonal_mean
from app.main import app
from app.rotation.weather import LAPSE_RATE_C_PER_M, weather_from_power

client = TestClient(app)


def test_zonal_mean_is_area_weighted() -> None:
    # 2×2 grid of 0.01° cells: values 1, 2 / 3, None. The field covers the left column fully
    # and half of the right column.
    g = Grid(0.0, 0.02, 0.01, 0.01, [[1.0, 2.0], [3.0, None]])
    field = box(0.0, 0.0, 0.015, 0.02)
    z = zonal_mean(g, field)
    # weights: cell(1)=1, cell(3)=1, cell(2)=0.5, cell(None)=0.5 (excluded)
    assert z.value == pytest.approx((1 * 1 + 3 * 1 + 2 * 0.5) / 2.5, rel=1e-3)
    assert z.missing_share == pytest.approx(0.5 / 3.0, abs=1e-3)
    assert z.coarse is False
    assert z.pixels == 4


def test_coarse_flag_when_pixel_bigger_than_field() -> None:
    g = Grid(0.0, 1.0, 1.0, 1.0, [[7.0]])
    small = box(0.4, 0.4, 0.401, 0.401)  # ~1.2 ha inside one 1° pixel
    z = zonal_mean(g, small)
    assert z.value == 7.0
    assert z.coarse is True
    assert z.pixel_to_field > 1000
    assert point_layer(5.0, 0.5, small).coarse is True


def test_area_of_a_known_rectangle() -> None:
    # 0.01° × 0.01° at the equator ≈ 1113 m × 1106 m ≈ 123 ha
    assert area_ha(box(0, 0, 0.01, 0.01)) == pytest.approx(123.6, rel=0.01)


def test_lapse_rate_moves_temperatures_to_the_field() -> None:
    payload = {
        "geometry": {"coordinates": [0.0, 0.0, 1000.0]},
        "properties": {
            "parameter": {
                p: {
                    f"2001{m:02d}{d:02d}": v
                    for m in range(1, 13)
                    for d in range(1, 32)
                    if _ok(m, d)
                }
                for p, v in (
                    ("T2M_MAX", 20.0),
                    ("T2M_MIN", 10.0),
                    ("RH2M", 60.0),
                    ("WS2M", 2.0),
                    ("ALLSKY_SFC_SW_DWN", 20.0),
                    ("PRECTOTCORR", 1.0),
                )
            }
        },
    }
    w = weather_from_power(payload, site_elevation_m=500)
    assert w.years[0].tmax[0] == pytest.approx(20 + 500 * LAPSE_RATE_C_PER_M)
    assert any("градиент" in n for n in w.notes)


def _ok(m: int, d: int) -> bool:
    return d <= (31 if m in (1, 3, 5, 7, 8, 10, 12) else 30 if m != 2 else 28)


@pytest.mark.parametrize("fid", ["tj-hissar", "us-iowa", "in-punjab", "ke-nakuru"])
def test_demo_fields_work_offline_from_cache(fid: str) -> None:
    layers = geo.load_layers(fid, offline=True)
    assert all(layers[k]["status"] == "cached" for k in ("power", "soilgrids", "terrain"))
    w = geo.field_weather(layers)
    assert w is not None and len(w.years) >= 15
    card = geo.data_card(fid, offline=True)
    ids = {r["id"] for r in card["layers"]}
    assert {"power", "soilgrids", "terrain", "smap", "ndvi"} <= ids
    power = next(r for r in card["layers"] if r["id"] == "power")
    assert power["coarse"] is True and power["pixel_to_field"] > 100


def test_fields_api_and_rotation_run() -> None:
    assert {f["id"] for f in client.get("/fields").json()} >= {"tj-hissar", "us-iowa"}
    r = client.post(
        "/fields/us-iowa/rotation/run",
        json={
            "plan": [["soybean", None], ["maize", "rye_cover"], ["wheat", "clover"]],
            "fert": {"maize": 150, "wheat": 90},
            "start_year": 2010,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["years"]) == 3
    assert body["years"][1]["yield_t_ha"] > 0
    assert body["years"][0]["weather_year"] == 2010
    assert (
        client.post("/fields/us-iowa/rotation/run", json={"plan": [["banana", None]]}).status_code
        == 422
    )
    assert client.get("/fields/nope").status_code == 404


def test_field_validation() -> None:
    bad = {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]]}
    assert client.post("/fields", json={"name": "x", "geometry": bad}).status_code == 422
