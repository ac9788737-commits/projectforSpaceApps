"""Bring layers of different resolution to the field (ROTATION.md §2.3). Pure.

The unit of analysis is the field polygon. A raster finer than the field is averaged over the
polygon with pixel∩polygon area weights; a raster coarser than the field gives the value of
the pixel under the field plus `coarse=True` and the pixel-to-field area ratio.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass
from typing import Any

from shapely.geometry import Polygon, box, shape

EARTH_R = 6371008.8


@dataclass(frozen=True, slots=True)
class Grid:
    """Regular lon/lat raster: rows go south from `lat_top`, columns east from `lon_left`."""

    lon_left: float
    lat_top: float
    dlon: float
    dlat: float
    values: list[list[float | None]]  # None = no data / cloud / bad quality

    def cell(self, r: int, c: int) -> Polygon:
        x0 = self.lon_left + c * self.dlon
        y0 = self.lat_top - (r + 1) * self.dlat
        return box(x0, y0, x0 + self.dlon, y0 + self.dlat)


@dataclass(frozen=True, slots=True)
class Zonal:
    value: float | None
    missing_share: float  # of the field area without valid data
    coarse: bool
    pixel_to_field: float  # pixel area / field area
    pixels: int


def polygon_of(geojson: dict[str, Any]) -> Polygon:
    g = shape(geojson.get("geometry", geojson))
    if g.geom_type == "MultiPolygon":
        g = max(g.geoms, key=lambda p: p.area)
    if g.geom_type != "Polygon" or not g.is_valid or g.is_empty:
        raise ValueError("ожидался один корректный полигон")
    return g


def area_ha(poly: Polygon) -> float:
    """Geodesic-enough area for fields: local equirectangular projection at the centroid."""
    lat0 = math.radians(poly.centroid.y)
    kx = EARTH_R * math.cos(lat0) * math.pi / 180
    ky = EARTH_R * math.pi / 180
    pts = [(x * kx, y * ky) for x, y in poly.exterior.coords]
    s = 0.0
    for (x1, y1), (x2, y2) in itertools.pairwise(pts):
        s += x1 * y2 - x2 * y1
    return abs(s) / 2 / 1e4


def deg_cell_area_ha(lat: float, dlon: float, dlat: float) -> float:
    return (
        EARTH_R**2
        * math.radians(dlon)
        * abs(math.sin(math.radians(lat + dlat / 2)) - math.sin(math.radians(lat - dlat / 2)))
        / 1e4
    )


def zonal_mean(grid: Grid, poly: Polygon) -> Zonal:
    """Area-weighted mean of the grid over the polygon (None cells are excluded)."""
    field_ha = area_ha(poly)
    pix_ha = deg_cell_area_ha(poly.centroid.y, grid.dlon, grid.dlat)
    ratio = pix_ha / field_ha if field_ha > 0 else math.inf
    minx, miny, maxx, maxy = poly.bounds
    c0 = max(0, math.floor((minx - grid.lon_left) / grid.dlon))
    c1 = min(len(grid.values[0]) - 1, math.floor((maxx - grid.lon_left) / grid.dlon))
    r0 = max(0, math.floor((grid.lat_top - maxy) / grid.dlat))
    r1 = min(len(grid.values) - 1, math.floor((grid.lat_top - miny) / grid.dlat))
    total = 0.0
    weighted = 0.0
    valid = 0.0
    n = 0
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            a = grid.cell(r, c).intersection(poly).area
            if a <= 0:
                continue
            total += a
            n += 1
            v = grid.values[r][c]
            if v is None or (isinstance(v, float) and math.isnan(v)):
                continue
            weighted += a * v
            valid += a
    value = weighted / valid if valid > 0 else None
    missing = 1 - valid / total if total > 0 else 1.0
    return Zonal(value, round(missing, 4), ratio > 1.0, round(ratio, 3), n)


def point_layer(value: float | None, pixel_deg: float, poly: Polygon) -> Zonal:
    """A layer read at one point (e.g. a 0.5° climate cell): always coarse for a field."""
    ratio = deg_cell_area_ha(poly.centroid.y, pixel_deg, pixel_deg) / max(1e-9, area_ha(poly))
    return Zonal(value, 0.0 if value is not None else 1.0, ratio > 1.0, round(ratio, 1), 1)
