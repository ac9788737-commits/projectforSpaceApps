"""Elevation and slope of a field from Terrarium terrain tiles (AWS Open Data).

Tiles: https://registry.opendata.aws/terrain-tiles/ — compiled by Tilezen/Mapzen mainly from
SRTM (outside the US), with NED, GMTED and ETOPO1; ~30 m where SRTM is the source. Open, no
login. Elevation = R·256 + G + B/256 − 32768 (metres).
"""

from __future__ import annotations

import io
import math
from typing import Any

import httpx
from PIL import Image
from shapely.geometry import Polygon

from app.geo.harmonize import Grid, zonal_mean
from app.ingest.common import TIMEOUT_S, USER_AGENT

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ZOOM = 13
SIZE = 256


def _tile_xy(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2**z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def _lat_of(y: float, z: int) -> float:
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2**z))))


def decode_terrarium(png: bytes) -> list[list[float]]:
    img = Image.open(io.BytesIO(png)).convert("RGB")
    px = img.load()
    assert px is not None
    w, h = img.size
    out: list[list[float]] = []
    for r in range(h):
        row = []
        for c in range(w):
            red, g, b = px[c, r]  # type: ignore[misc]
            row.append(red * 256 + g + b / 256 - 32768)
        out.append(row)
    return out


def slope_grid(
    elev: list[list[float]], cell_m_x: float, cell_m_y: float
) -> list[list[float | None]]:
    """Slope in percent (Horn 1981 3×3 kernel); edges are None."""
    h, w = len(elev), len(elev[0])
    out: list[list[float | None]] = [[None] * w for _ in range(h)]
    for r in range(1, h - 1):
        for c in range(1, w - 1):
            e = elev
            dzdx = (
                (e[r - 1][c + 1] + 2 * e[r][c + 1] + e[r + 1][c + 1])
                - (e[r - 1][c - 1] + 2 * e[r][c - 1] + e[r + 1][c - 1])
            ) / (8 * cell_m_x)
            dzdy = (
                (e[r + 1][c - 1] + 2 * e[r + 1][c] + e[r + 1][c + 1])
                - (e[r - 1][c - 1] + 2 * e[r - 1][c] + e[r - 1][c + 1])
            ) / (8 * cell_m_y)
            out[r][c] = 100 * math.hypot(dzdx, dzdy)
    return out


def _plane_slope(
    elev: list[list[float]],
    poly: Polygon,
    lon_left: float,
    lat_top: float,
    dlon: float,
    dlat: float,
    cell_x: float,
    cell_y: float,
) -> float | None:
    from shapely.geometry import Point

    xs: list[float] = []
    ys: list[float] = []
    zs: list[float] = []
    for r, row in enumerate(elev):
        for c, z in enumerate(row):
            if poly.contains(Point(lon_left + (c + 0.5) * dlon, lat_top - (r + 0.5) * dlat)):
                xs.append(c * cell_x)
                ys.append(-r * cell_y)
                zs.append(z)
    if len(zs) < 3:
        return None
    import numpy as np

    a = np.column_stack([np.array(xs), np.array(ys), np.ones(len(xs))])
    coef, *_ = np.linalg.lstsq(a, np.array(zs), rcond=None)
    return float(100 * math.hypot(coef[0], coef[1]))


def field_terrain(poly: Polygon, fetch: Any = None) -> dict[str, Any]:
    """Mean elevation and slope over the field from the zoom-13 tile under its centroid."""
    get = fetch or (
        lambda url: httpx.get(url, timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT}).content
    )
    cx, cy = poly.centroid.x, poly.centroid.y
    fx, fy = _tile_xy(cx, cy, ZOOM)
    tx, ty = int(fx), int(fy)
    elev = decode_terrarium(get(TILE_URL.format(z=ZOOM, x=tx, y=ty)))
    lon_left = tx / 2**ZOOM * 360 - 180
    lat_top = _lat_of(ty, ZOOM)
    lat_bottom = _lat_of(ty + 1, ZOOM)
    dlon = 360 / 2**ZOOM / SIZE
    dlat = (lat_top - lat_bottom) / SIZE  # Mercator rows are close to uniform within one tile
    cell_x = dlon * math.pi / 180 * 6371008.8 * math.cos(math.radians(cy))
    cell_y = dlat * math.pi / 180 * 6371008.8
    slopes = slope_grid(elev, cell_x, cell_y)
    plane = _plane_slope(elev, poly, lon_left, lat_top, dlon, dlat, cell_x, cell_y)
    z_el = zonal_mean(Grid(lon_left, lat_top, dlon, dlat, [list(r) for r in elev]), poly)
    z_sl = zonal_mean(Grid(lon_left, lat_top, dlon, dlat, slopes), poly)
    return {
        "elevation_m": round(z_el.value, 1) if z_el.value is not None else None,
        # Field-scale slope from a least-squares plane: robust to the metre-level DEM noise
        # that inflates pixel slopes on flat land. Pixel slope is kept as a diagnostic.
        "slope_pct": round(plane, 2) if plane is not None else None,
        "pixel_slope_pct": round(z_sl.value, 2) if z_sl.value is not None else None,
        "pixel_m": round(cell_x, 1),
        "pixels": z_sl.pixels,
        "missing_share": z_sl.missing_share,
        "tile": [ZOOM, tx, ty],
    }
