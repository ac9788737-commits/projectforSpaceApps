"""Field picture that always arrives: a three-level cascade with a cache (docs/IMPROVEMENTS.md A).

1. Fresh Sentinel-2 L2A (10 m) from the Element84 Earth Search STAC (COGs on AWS Open Data,
   no keys): newest scene whose clouds *over the field* (SCL band) are < 5 %, windowed reads
   only around the field; true colour and NDVI.
2. Cloud-free mosaic tiles: EOX Sentinel-2 cloudless 2024 (CC BY-NC-SA 4.0), falling back to
   NASA GIBS MODIS true colour. No NDVI.
3. Local fallback that cannot fail: saved demo images, or a neutral schematic with the outline.

Every level has a hard timeout; the answer is always a picture plus where it came from.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import os
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import Polygon

from app import config
from app.ingest.common import USER_AGENT

STAC = "https://earth-search.aws.element84.com/v1/search"
COLLECTIONS = ("sentinel-2-c1-l2a", "sentinel-2-l2a")
EOX = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg"
GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2025-07-15/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg"
CACHE = config.DATA_DIR / "cache" / "imagery"
LEVEL1_TIMEOUT_S = 4.0  # foreground budget (fast networks); background jobs use LEVEL1_BACKGROUND_S
LEVEL1_BACKGROUND_S = 90.0
LEVEL2_TIMEOUT_S = 5.0
RETRY_AFTER_S = 1800
FIELD_CLOUD_MAX = 0.05
SCENE_CLOUD_MAX = 30
LOOKBACK_DAYS = 60
CANDIDATES = 5
PAD = 0.2
OUT_PX = 480
SCL_BAD = {0, 1, 3, 8, 9, 10}  # nodata, saturated, cloud shadow, cloud medium/high, cirrus
GDAL_ENV = {
    "AWS_NO_SIGN_REQUEST": "YES",
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
    "GDAL_HTTP_MULTIPLEX": "NO",
    "VSI_CACHE": "TRUE",
    "GDAL_HTTP_TIMEOUT": "30",
    "GDAL_HTTP_MAX_RETRY": "2",
}
# NDVI palette (bare → sparse → dense vegetation); a picture colour scale, not UI tokens.
NDVI_STOPS = (
    (-0.1, (120, 90, 60)),
    (0.15, (196, 170, 110)),
    (0.35, (220, 210, 90)),
    (0.55, (120, 180, 70)),
    (0.8, (30, 110, 40)),
)
# The field outline is drawn by the client over the picture (docs/DESIGN.md §7), not burned in.
CACHE_VERSION = 2


@dataclass
class Picture:
    kind: str  # truecolor | ndvi
    level: int
    date: str | None
    cloud_pct: float | None
    source: str
    attribution: str
    note: str
    file: str  # cache file name


# ---------- geometry ----------


def padded_bounds(poly: Polygon, pad: float = PAD) -> tuple[float, float, float, float]:
    minx, miny, maxx, maxy = poly.bounds
    dx, dy = (maxx - minx) * pad, (maxy - miny) * pad
    return minx - dx, miny - dy, maxx + dx, maxy + dy


def window_for(bounds_wgs84: tuple[float, float, float, float], crs: Any, transform: Any) -> Any:
    """Pixel window of a raster (any CRS) that covers lon/lat bounds."""
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds

    b = transform_bounds("EPSG:4326", crs, *bounds_wgs84, densify_pts=21)
    return from_bounds(*b, transform=transform).round_offsets().round_lengths()


def scl_cloud_share(scl: np.ndarray) -> float:
    """Share of field pixels that are cloud, cloud shadow, cirrus, saturated or no data."""
    if scl.size == 0:
        return 1.0
    return float(np.isin(scl, list(SCL_BAD)).mean())


def _upscale(img: Image.Image) -> Image.Image:
    w, h = img.size
    k = OUT_PX / max(w, h)
    return img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.Resampling.BILINEAR)


def ndvi_rgb(ndvi: np.ndarray) -> np.ndarray:
    out = np.zeros((*ndvi.shape, 3), dtype=np.uint8)
    xs = [s[0] for s in NDVI_STOPS]
    for c in range(3):
        out[..., c] = np.interp(
            np.nan_to_num(ndvi, nan=-0.1), xs, [s[1][c] for s in NDVI_STOPS]
        ).astype(np.uint8)
    return out


def truecolor_rgb(r: np.ndarray, g: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Reflectance 0–0.3 stretched with gamma 1/1.4 (a display choice)."""
    stack = np.stack([r, g, b], axis=-1)
    x = np.clip(stack / 0.3, 0, 1) ** (1 / 1.4)
    return (x * 255).astype(np.uint8)


# ---------- level 1: Sentinel-2 L2A ----------


def stac_search(
    bounds: tuple[float, float, float, float], today: date, timeout: float
) -> list[dict[str, Any]]:
    start = (today - timedelta(days=LOOKBACK_DAYS)).isoformat()
    for coll in COLLECTIONS:
        body = {
            "collections": [coll],
            "bbox": list(bounds),
            "datetime": f"{start}T00:00:00Z/{today.isoformat()}T23:59:59Z",
            "limit": CANDIDATES,
            "query": {"eo:cloud_cover": {"lt": SCENE_CLOUD_MAX}},
            "sortby": [{"field": "properties.datetime", "direction": "desc"}],
        }
        r = httpx.post(STAC, json=body, timeout=timeout, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        feats = r.json().get("features", [])
        if feats:
            return feats
    return []


def _band_scale(asset: dict[str, Any]) -> tuple[float, float]:
    bands = asset.get("raster:bands") or [{}]
    return float(bands[0].get("scale", 0.0001)), float(bands[0].get("offset", 0.0))


def read_window(
    href: str, bounds: tuple[float, float, float, float], attempts: int = 3
) -> tuple[np.ndarray, Any]:
    """Windowed COG read with retries: slow links sometimes cut a tile short."""
    import rasterio
    from rasterio.errors import RasterioIOError

    for k in range(attempts):
        try:
            with rasterio.Env(**GDAL_ENV), rasterio.open(href) as ds:
                win = window_for(bounds, ds.crs, ds.transform)
                return ds.read(1, window=win, boundless=True, fill_value=0), ds.crs
        except RasterioIOError:
            if k == attempts - 1:
                raise
    raise RuntimeError("unreachable")


def _field_cloud(
    feature: dict[str, Any], poly: Polygon, reader: Callable[..., tuple[np.ndarray, Any]]
) -> float:
    scl, _ = reader(feature["assets"]["scl"]["href"], poly.bounds)
    return scl_cloud_share(scl)


def level1(
    poly: Polygon,
    today: date,
    timeout: float = LEVEL1_TIMEOUT_S,
    search: Callable[..., list[dict[str, Any]]] = stac_search,
    reader: Callable[..., tuple[np.ndarray, Any]] = read_window,
) -> dict[str, Any] | None:
    """Newest scene with < 5 % clouds over the field → true colour + NDVI images."""
    deadline = datetime.now(UTC).timestamp() + timeout
    bounds = padded_bounds(poly)
    feats = search(bounds, today, timeout=min(2.0, timeout))
    if not feats:
        return None
    pool = ThreadPoolExecutor(max_workers=2)
    try:
        futs = {pool.submit(_field_cloud, f, poly, reader): f for f in feats[:CANDIDATES]}
        done, _ = wait(futs, timeout=max(0.1, deadline - datetime.now(UTC).timestamp()))
        clouds = {futs[fu]["id"]: fu.result() for fu in done if fu.exception() is None}
        ok = [f for f in feats if clouds.get(f["id"], 1.0) < FIELD_CLOUD_MAX]
        if not ok:
            return None
        best = max(ok, key=lambda f: f["properties"]["datetime"])
        a = best["assets"]
        keys = ("red", "green", "blue", "nir")
        bfuts = {k: pool.submit(reader, a[k]["href"], bounds) for k in keys}
        done_b, _ = wait(
            list(bfuts.values()), timeout=max(0.1, deadline - datetime.now(UTC).timestamp())
        )
        if len(done_b) < len(keys) or any(f.exception() for f in done_b):
            return None
        bands = {}
        for k in keys:
            arr, _ = bfuts[k].result()
            scale, offset = _band_scale(a[k])
            bands[k] = np.where(arr > 0, arr * scale + offset, np.nan).astype(np.float32)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    tc = Image.fromarray(
        truecolor_rgb(
            np.nan_to_num(bands["red"]), np.nan_to_num(bands["green"]), np.nan_to_num(bands["blue"])
        )
    )
    with np.errstate(invalid="ignore", divide="ignore"):
        ndvi = (bands["nir"] - bands["red"]) / (bands["nir"] + bands["red"])
    nd = Image.fromarray(ndvi_rgb(ndvi))
    field_ndvi = float(np.nanmean(ndvi)) if np.isfinite(ndvi).any() else None
    day = best["properties"]["datetime"][:10]
    return {
        "truecolor": _upscale(tc),
        "ndvi": _upscale(nd),
        "date": day,
        "cloud_pct": round(clouds[best["id"]] * 100, 1),
        "ndvi_mean": round(field_ndvi, 3) if field_ndvi is not None else None,
        "source": f"Sentinel-2 L2A, {best['id'].split('_')[0]}",
        "attribution": f"Contains modified Copernicus Sentinel data {day[:4]}",
    }


# ---------- level 2: cloud-free mosaic tiles ----------


def _tile_xy(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2**z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def mosaic(
    poly: Polygon,
    template: str,
    z: int,
    timeout: float,
    fetch: Callable[[str], bytes] | None = None,
) -> Image.Image:
    get = fetch or (
        lambda url: (
            httpx.get(url, timeout=timeout, headers={"User-Agent": USER_AGENT})
            .raise_for_status()
            .content
        )
    )
    minx, miny, maxx, maxy = padded_bounds(poly)
    x0, y0 = _tile_xy(minx, maxy, z)
    x1, y1 = _tile_xy(maxx, miny, z)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    canvas = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            tile = Image.open(io.BytesIO(get(template.format(z=z, x=tx, y=ty)))).convert("RGB")
            canvas.paste(tile.resize((256, 256)), ((tx - tx0) * 256, (ty - ty0) * 256))
    box = (
        round((x0 - tx0) * 256),
        round((y0 - ty0) * 256),
        round((x1 - tx0) * 256),
        round((y1 - ty0) * 256),
    )
    crop = canvas.crop((box[0], box[1], max(box[0] + 1, box[2]), max(box[1] + 1, box[3])))
    return _upscale(crop)


def level2(
    poly: Polygon, timeout: float = LEVEL2_TIMEOUT_S, fetch: Callable[[str], bytes] | None = None
) -> dict[str, Any] | None:
    for template, z, source, attribution in (
        (
            EOX,
            15,
            "Безоблачная мозаика Sentinel-2 (EOX, 2024)",
            "Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH "
            "(Contains modified Copernicus Sentinel data 2024)",
        ),
        (GIBS, 9, "NASA GIBS, MODIS Terra", "NASA GIBS / EOSDIS"),
    ):
        try:
            img = mosaic(poly, template, z, timeout, fetch)
            return {
                "truecolor": img,
                "date": None,
                "cloud_pct": None,
                "source": source,
                "attribution": attribution,
            }
        except (httpx.HTTPError, OSError, ValueError):
            continue
    return None


# ---------- level 3: local fallback ----------


def level3(fid: str, poly: Polygon) -> dict[str, Any]:
    """Saved demo images, or a neutral schematic with the field outline (never fails)."""
    for kind in ("truecolor", "ndvi"):
        meta = demo_dir() / f"{fid}_{kind}.json"
        if kind == "truecolor" and meta.exists():
            m = json.loads(meta.read_text(encoding="utf-8"))
            out = {
                k: Image.open(demo_dir() / f"{fid}_{k}.png").convert("RGB")
                for k in ("truecolor", "ndvi")
                if (demo_dir() / f"{fid}_{k}.png").exists()
            }
            return {
                **out,
                "date": m.get("date"),
                "cloud_pct": m.get("cloud_pct"),
                "source": m.get("source", ""),
                "attribution": m.get("attribution", ""),
                "saved": True,
            }
    w = OUT_PX
    # a blank field-journal sheet with a sparse hatch: «no picture», not a fake one
    # (paper and rule colours of docs/DESIGN.md §2.1)
    img = Image.new("RGB", (w, round(w * 0.75)), (233, 236, 227))
    d = ImageDraw.Draw(img)
    for i in range(0, w * 2, 24):
        d.line([(i, 0), (i - w, w)], fill=(201, 206, 192), width=2)
    return {
        "truecolor": img,
        "date": None,
        "cloud_pct": None,
        "source": "Схема",
        "attribution": "",
        "saved": False,
    }


def saved_demo(fid: str, kind: str) -> Picture | None:
    meta = demo_dir() / f"{fid}_{kind}.json"
    png = demo_dir() / f"{fid}_{kind}.png"
    if not (meta.exists() and png.exists()):
        return None
    m = json.loads(meta.read_text(encoding="utf-8"))
    return Picture(
        kind,
        int(m.get("level", 1)),
        m.get("date"),
        m.get("cloud_pct"),
        m.get("source", ""),
        m.get("attribution", ""),
        "Снимок сохранён заранее",
        f"demo:{fid}_{kind}.png",
    )


def demo_dir() -> Path:
    return Path(
        os.environ.get(
            "ASTROCROP_DEMO_IMAGERY",
            str(config.DATA_DIR.parent / "frontend" / "public" / "demo" / "imagery"),
        )
    )


# ---------- cascade with cache ----------

_LOCK = threading.Lock()


def _key(poly: Polygon, level: int, today: date) -> str:
    b = [round(v, 5) for v in poly.bounds]
    week = today.isocalendar()
    key = [b, level, week.year, week.week, CACHE_VERSION]
    return hashlib.sha1(json.dumps(key).encode()).hexdigest()[:16]


def _save(key: str, kind: str, img: Image.Image) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    name = f"{key}_{kind}.png"
    img.save(CACHE / name, optimize=True)
    return name


def _store(
    poly: Polygon, level: int, today: date, res: dict[str, Any], note: str
) -> dict[str, Picture]:
    key = _key(poly, level, today)
    out: dict[str, Picture] = {}
    for kind in ("truecolor", "ndvi"):
        if kind in res:
            out[kind] = Picture(
                kind,
                level,
                res.get("date"),
                res.get("cloud_pct"),
                res["source"],
                res["attribution"],
                note,
                _save(key, kind, res[kind]),
            )
    (CACHE / f"{key}.json").write_text(
        json.dumps(
            {k: asdict(v) for k, v in out.items()} | {"ndvi_mean": res.get("ndvi_mean")},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return out


def _cached(poly: Polygon, today: date, levels: tuple[int, ...]) -> dict[str, Picture] | None:
    for level in levels:
        meta = CACHE / f"{_key(poly, level, today)}.json"
        if meta.exists():
            data = json.loads(meta.read_text(encoding="utf-8"))
            return {k: Picture(**v) for k, v in data.items() if k in ("truecolor", "ndvi")}
    return None


NOTES = {
    1: "Свежий снимок",
    2: "Свежий снимок закрыт облаками или ещё не найден. Показываем мозаику за 2024 год",
    3: "Снимок временно недоступен, данные анализа не зависят от него",
}


_JOBS: set[str] = set()


def _failed_recently(key: str) -> bool:
    f = CACHE / f"{key}.fail"
    return f.exists() and datetime.now(UTC).timestamp() - f.stat().st_mtime < RETRY_AFTER_S


def _level1_job(poly: Polygon, today: date, key: str) -> None:
    try:
        res = level1(poly, today, timeout=LEVEL1_BACKGROUND_S)
    except Exception:
        res = None
    with _LOCK:
        if res:
            _store(poly, 1, today, res, NOTES[1])
        else:
            CACHE.mkdir(parents=True, exist_ok=True)
            (CACHE / f"{key}.fail").write_text(datetime.now(UTC).isoformat())
        _JOBS.discard(key)


def start_level1(poly: Polygon, today: date) -> bool:
    """Fetch the fresh scene in the background; True while it is (or just got) on its way."""
    key = _key(poly, 1, today)
    with _LOCK:
        if key in _JOBS:
            return True
        if _failed_recently(key):
            return False
        _JOBS.add(key)
    threading.Thread(target=_level1_job, args=(poly, today, key), daemon=True).start()
    return True


def picture(
    fid: str,
    poly: Polygon,
    kind: str,
    today: date | None = None,
    offline: bool = False,
    background: bool = True,
) -> tuple[Picture, bool]:
    """Best picture available right now and whether a fresher one is still coming.

    Order: cached fresh scene → (start it in the background) → cached/new mosaic → local fallback.
    With `background=False` the fresh scene is fetched in the foreground (precompute, tests).
    """
    today = today or datetime.now(UTC).date()
    with _LOCK:
        hit = _cached(poly, today, (1,))
    if hit and kind in hit:
        return hit[kind], False
    saved = saved_demo(fid, kind)
    if saved:  # demo fields: a real Sentinel-2 picture saved by `make precompute`, instantly
        return saved, (start_level1(poly, today) if not offline and background else False)
    pending = False
    if not offline:
        if background:
            pending = start_level1(poly, today)
        else:
            try:
                res = level1(poly, today, timeout=LEVEL1_BACKGROUND_S)
            except Exception:
                res = None
            if res:
                with _LOCK:
                    pics = _store(poly, 1, today, res, NOTES[1])
                return pics[kind], False
        with _LOCK:
            hit2 = _cached(poly, today, (2,))
        res2 = None
        if not (hit2 and "truecolor" in hit2):
            try:
                res2 = level2(poly)
            except Exception:
                res2 = None
            if res2:
                with _LOCK:
                    hit2 = _store(poly, 2, today, res2, NOTES[2])
        if hit2 and "truecolor" in hit2:
            if kind in hit2:
                return hit2[kind], pending
            local = level3(fid, poly)
            if kind not in local:  # no NDVI anywhere: show the mosaic and say why
                p = hit2["truecolor"]
                return Picture(
                    kind,
                    2,
                    p.date,
                    p.cloud_pct,
                    p.source,
                    p.attribution,
                    "Карта зелени есть только у свежего снимка",
                    p.file,
                ), pending
    res3 = level3(fid, poly)
    note = "Сохранённый снимок демо-поля" if res3.pop("saved") else NOTES[3]
    with _LOCK:
        pics = _store(poly, 3, today, res3, note)
    return pics.get(kind) or pics["truecolor"], pending


def file_path(name: str) -> Path | None:
    if name.startswith("demo:"):
        p = demo_dir() / name[5:]
        return p if p.parent == demo_dir() and p.exists() else None
    p = CACHE / name
    return p if p.parent == CACHE and p.exists() else None


def save_demo(fid: str, poly: Polygon, today: date) -> dict[str, Any]:
    """`make precompute`: fetch the fresh scene in the foreground and keep it for the demo."""
    # ask for the fresh scene directly: the saved demo picture must not answer for itself
    res = level1(poly, today, timeout=LEVEL1_BACKGROUND_S)
    if res:
        with _LOCK:
            pics = _store(poly, 1, today, res, NOTES[1])
    else:
        pics = {k: picture(fid, poly, k, today, background=False)[0] for k in ("truecolor", "ndvi")}
    out = demo_dir()
    out.mkdir(parents=True, exist_ok=True)
    for k, p in pics.items():
        src = file_path(p.file)
        if src and p.level == 1 and p.kind == k:
            (out / f"{fid}_{k}.png").write_bytes(src.read_bytes())
            (out / f"{fid}_{k}.json").write_text(
                json.dumps(asdict(p), ensure_ascii=False), encoding="utf-8"
            )
    return {k: asdict(p) for k, p in pics.items()}
