"""Sowing calendar adapted to the field (estimate-based rules, docs/ASSUMPTIONS.md). Pure.

Crop-table sowing dates are for the northern mid-latitudes. On a real field:
- in the southern hemisphere (south of 15° S) the calendar is shifted by half a year;
- frost-sensitive crops are sown 5 days after the late (90th percentile) last spring frost.
"""

from __future__ import annotations

import numpy as np

from app.rotation.crops import rotation_crops
from app.rotation.weather import DAYS, Weather, doy_of, mmdd_of

SOUTH_SHIFT_LAT = -15.0
AFTER_FROST_DAYS = 5


def late_last_frost_doy(weather: Weather, threshold_c: float = 0.0) -> int | None:
    """90th percentile of the last spring frost day (field calendar), or None if frost-free."""
    shift = 182 if weather.lat < SOUTH_SHIFT_LAT else 0
    lasts = []
    for wy in weather.years:
        days = [(d - shift) % DAYS for d in range(DAYS) if wy.tmin[d] <= threshold_c]
        spring = [d for d in days if d < 182]
        if spring:
            lasts.append(max(spring))
    if len(lasts) < max(1, len(weather.years) // 10):
        return None
    return (int(np.percentile(lasts, 90)) + shift) % DAYS


def sowing_dates(weather: Weather) -> dict[str, str]:
    shift = 182 if weather.lat < SOUTH_SHIFT_LAT else 0
    late = late_last_frost_doy(weather)
    out: dict[str, str] = {}
    for c in rotation_crops().values():
        if not c.sow_mmdd:
            continue
        d = (doy_of(c.sow_mmdd) + shift) % DAYS
        if c.frost_sensitive and late is not None:
            rel = (d - shift) % DAYS
            late_rel = (late - shift) % DAYS
            if rel < late_rel + AFTER_FROST_DAYS:
                d = (late + AFTER_FROST_DAYS) % DAYS
        out[c.id] = mmdd_of(d)
    return out
