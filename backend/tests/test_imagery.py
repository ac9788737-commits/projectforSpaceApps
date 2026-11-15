"""Stage 9.1: field picture cascade (docs/IMPROVEMENTS.md A.4).

No network: STAC and COGs are mocked.
"""

from __future__ import annotations

import io
import time
from datetime import date

import numpy as np
import pytest
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from shapely.geometry import box

from app.geo import imagery as im

# A small field in UTM zone 42N (Gissar valley) and its lon/lat polygon.
TODAY = date(2026, 11, 14)


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(im, "CACHE", tmp_path / "cache")
    monkeypatch.setenv("ASTROCROP_DEMO_IMAGERY", str(tmp_path / "demo"))
    im._JOBS.clear()
    yield


def _utm_raster(path, value_fn, size=200, res=10.0):
    # origin chosen so that the field below falls inside
    transform = from_origin(434000, 4266000, res, res)
    data = np.fromfunction(value_fn, (size, size), dtype=float).astype("uint16")
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=size,
        height=size,
        count=1,
        dtype="uint16",
        crs="EPSG:32642",
        transform=transform,
    ) as ds:
        ds.write(data, 1)
    return transform


def _field():
    # lon/lat box well inside the synthetic raster
    from rasterio.warp import transform_bounds

    b = transform_bounds("EPSG:32642", "EPSG:4326", 434600, 4264600, 435000, 4264900)
    return box(*b)


def test_window_reprojection_hits_the_right_pixels(tmp_path) -> None:
    t = _utm_raster(tmp_path / "x.tif", lambda r, c: c)
    poly = _field()
    w = im.window_for(poly.bounds, "EPSG:32642", t)
    # field spans x 434600–435000 (cols 60–100) and y 4264900–4264600 (rows 110–140)
    assert 58 <= w.col_off <= 61 and 39 <= w.width <= 43
    assert 108 <= w.row_off <= 111 and 29 <= w.height <= 33


def test_cloudy_field_rejected_even_if_scene_is_clear(tmp_path) -> None:
    poly = _field()
    # scene A (newest, scene cloud 2 %): SCL says cloud (9) over the field; scene B: clear (4)
    cloudy = tmp_path / "scl_a.tif"
    clear = tmp_path / "scl_b.tif"
    _utm_raster(cloudy, lambda r, c: np.where((r > 100) & (r < 150), 9, 4))
    _utm_raster(clear, lambda r, c: np.full_like(r, 4))
    band = tmp_path / "band.tif"
    _utm_raster(band, lambda r, c: np.full_like(r, 1500))
    feats = [
        {
            "id": "A",
            "properties": {"datetime": "2026-11-10T06:00:00Z", "eo:cloud_cover": 2},
            "assets": {
                "scl": {"href": str(cloudy)},
                **{k: {"href": str(band)} for k in ("red", "green", "blue", "nir")},
            },
        },
        {
            "id": "B",
            "properties": {"datetime": "2026-11-01T06:00:00Z", "eo:cloud_cover": 20},
            "assets": {
                "scl": {"href": str(clear)},
                **{k: {"href": str(band)} for k in ("red", "green", "blue", "nir")},
            },
        },
    ]
    res = im.level1(poly, TODAY, timeout=10, search=lambda *a, **k: feats)
    assert res is not None and res["date"] == "2026-11-01"
    assert res["cloud_pct"] == 0.0
    assert "Copernicus Sentinel" in res["attribution"]


def test_scl_share() -> None:
    assert im.scl_cloud_share(np.array([[4, 9], [3, 4]])) == 0.5


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (256, 256), (90, 120, 60)).save(buf, "JPEG")
    return buf.getvalue()


def test_level1_timeout_falls_back_to_mosaic(monkeypatch) -> None:
    poly = _field()

    def slow(*a, **k):
        time.sleep(0.3)
        return None

    monkeypatch.setattr(im, "level1", slow)
    monkeypatch.setattr(
        im,
        "mosaic",
        lambda poly, template, z, timeout, fetch=None: Image.new("RGB", (64, 64)),
    )
    pic, _ = im.picture("x", poly, "truecolor", TODAY, background=False)
    assert pic.level == 2 and "мозаику" in pic.note
    ndvi, _ = im.picture("x", poly, "ndvi", TODAY, background=False)
    assert ndvi.level == 2 and "зелени" in ndvi.note


def test_no_mosaic_gives_local_picture(monkeypatch) -> None:
    poly = _field()
    monkeypatch.setattr(im, "level1", lambda *a, **k: None)

    def broken(*a, **k):
        raise OSError("offline")

    monkeypatch.setattr(im, "mosaic", broken)
    pic, _ = im.picture("x", poly, "truecolor", TODAY, background=False)
    assert pic.level == 3 and "недоступен" in pic.note
    assert im.file_path(pic.file) is not None


META = (
    '{"level": 1, "date": "2026-11-14", "cloud_pct": 0, "source": "Sentinel-2 L2A", '
    '"attribution": "Contains modified Copernicus Sentinel data 2026"}'
)


def test_offline_demo_field_is_instant(tmp_path) -> None:
    poly = _field()
    demo = tmp_path / "demo"
    demo.mkdir()
    for k in ("truecolor", "ndvi"):
        Image.new("RGB", (32, 32)).save(demo / f"demo1_{k}.png")
        (demo / f"demo1_{k}.json").write_text(META)
    t = time.perf_counter()
    pic, pending = im.picture("demo1", poly, "ndvi", TODAY, offline=True)
    assert time.perf_counter() - t < 0.5
    assert pic.level == 1 and pic.date == "2026-11-14" and not pending
    assert im.file_path(pic.file) is not None


def test_api_always_answers_with_a_picture(monkeypatch) -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setattr(im, "level1", lambda *a, **k: None)
    monkeypatch.setattr(im, "mosaic", lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
    c = TestClient(app)
    r = c.get("/fields/us-iowa/imagery", params={"kind": "ndvi", "offline": True})
    assert r.status_code == 200
    body = r.json()
    img = c.get(body["url"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    assert c.get("/fields/us-iowa/imagery", params={"kind": "x"}).status_code == 422
