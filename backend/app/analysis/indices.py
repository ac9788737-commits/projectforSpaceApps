"""Climate indices: calendar-window percentiles, SPI and SPEI. Pure.

SPI: McKee et al. 1993 — gamma fit of accumulated precipitation per calendar month, with the
probability of zero precipitation, transformed to a standard normal variate.
SPEI: Vicente-Serrano et al. 2010 (doi:10.1175/2009JCLI2909.1) — climatic water balance
P − ET0, three-parameter log-logistic fit (scipy `fisk` with a location parameter).
"""

from __future__ import annotations

import math

import numpy as np
from scipy import stats

from app.rotation.weather import DAYS, WeatherYear

MONTH_STARTS = (0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365)


def month_of(doy: int) -> int:
    for m in range(12):
        if doy < MONTH_STARTS[m + 1]:
            return m
    return 11


def window_percentile(
    years: list[WeatherYear], attr: str, q: float, half_window: int = 7
) -> list[float]:
    """q-th percentile of a daily variable in a ±half_window calendar window, all years."""
    data = np.array([getattr(y, attr) for y in years])  # years × 365
    out = []
    for d in range(DAYS):
        idx = [(d + k) % DAYS for k in range(-half_window, half_window + 1)]
        out.append(float(np.percentile(data[:, idx], q)))
    return out


def monthly_sums(years: list[WeatherYear], attr: str) -> np.ndarray:
    """years × 12 monthly totals."""
    out = np.zeros((len(years), 12))
    for i, y in enumerate(years):
        v = getattr(y, attr)
        for m in range(12):
            out[i, m] = sum(v[MONTH_STARTS[m] : MONTH_STARTS[m + 1]])
    return out


def _accumulate(monthly: np.ndarray, scale: int) -> np.ndarray:
    """Running sum over `scale` months on the flattened series (first months use what exists)."""
    flat = monthly.flatten()
    acc = np.array([flat[max(0, i - scale + 1) : i + 1].sum() for i in range(len(flat))])
    return acc.reshape(monthly.shape)


def spi(monthly_precip: np.ndarray, scale: int = 3) -> np.ndarray:
    acc = _accumulate(monthly_precip, scale)
    out = np.full(acc.shape, np.nan)
    for m in range(12):
        x = acc[:, m]
        if scale > 1:
            x = x[1:] if len(x) > 1 else x  # the first year lacks a full window in Jan–Feb
        pos = x[x > 0]
        q = 1 - len(pos) / len(x)
        if len(pos) < 4 or np.allclose(pos, pos[0]):
            continue
        a, loc, b = stats.gamma.fit(pos, floc=0)
        col = acc[:, m]
        cdf = q + (1 - q) * stats.gamma.cdf(col, a, loc=loc, scale=b)
        cdf = np.clip(cdf, 1e-6, 1 - 1e-6)
        out[:, m] = stats.norm.ppf(cdf)
    return out


def spei(monthly_balance: np.ndarray, scale: int = 3) -> np.ndarray:
    acc = _accumulate(monthly_balance, scale)
    out = np.full(acc.shape, np.nan)
    for m in range(12):
        x = acc[:, m]
        if len(x) < 5 or np.allclose(x, x[0]):
            continue
        c, loc, s = stats.fisk.fit(x, floc=float(x.min() - 1e-3 - abs(x.min()) * 0.01))
        cdf = np.clip(stats.fisk.cdf(x, c, loc=loc, scale=s), 1e-6, 1 - 1e-6)
        out[:, m] = stats.norm.ppf(cdf)
    return out


def runs(mask: list[bool], min_len: int) -> list[tuple[int, int]]:
    """(start, length) of runs of True at least `min_len` long."""
    out = []
    start = None
    for i, v in enumerate([*mask, False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                out.append((start, i - start))
            start = None
    return out


def daily_from_composites(
    dates_doy: list[tuple[int, int, float | None]], years: list[int]
) -> dict[int, list[float | None]]:
    """Linear interpolation of 16-day composites to days; gaps longer than 48 days stay None.

    `dates_doy`: (year, day-of-year 0..364, value or None)."""
    pts = sorted((y * DAYS + d, v) for y, d, v in dates_doy if v is not None)
    out: dict[int, list[float | None]] = {}
    for y in years:
        row: list[float | None] = []
        for d in range(DAYS):
            t = y * DAYS + d
            lo = next((p for p in reversed(pts) if p[0] <= t), None)
            hi = next((p for p in pts if p[0] >= t), None)
            if lo is None or hi is None or hi[0] - lo[0] > 48:
                row.append(None)
            elif hi[0] == lo[0]:
                row.append(lo[1])
            else:
                row.append(lo[1] + (hi[1] - lo[1]) * (t - lo[0]) / (hi[0] - lo[0]))
        out[y] = row
    return out


def nan_to_none(a: np.ndarray) -> list[list[float | None]]:
    return [[None if math.isnan(v) else round(float(v), 3) for v in row] for row in a]
