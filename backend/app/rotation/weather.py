"""Daily weather for a field (NASA POWER) and FAO-56 Penman-Monteith reference ET. Pure.

Every year is kept at 365 days (29 February is dropped) so that years can be shuffled
freely in the weather ensemble.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import date, timedelta

POWER_PARAMS = ("T2M_MAX", "T2M_MIN", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN", "PRECTOTCORR")
POWER_FILL = -999.0
DAYS = 365


@dataclass(frozen=True, slots=True)
class WeatherYear:
    year: int
    tmax: tuple[float, ...]
    tmin: tuple[float, ...]
    rh: tuple[float, ...]  # %
    wind: tuple[float, ...]  # m/s at 2 m
    rs: tuple[float, ...]  # MJ m-2 d-1
    precip: tuple[float, ...]  # mm d-1
    et0: tuple[float, ...]  # mm d-1
    gaps: int = 0  # days filled by interpolation


@dataclass(frozen=True, slots=True)
class Weather:
    lat: float
    lon: float
    elevation_m: float
    years: tuple[WeatherYear, ...]
    source: str = "NASA POWER (daily, AG community)"
    resolution: str = "0.5° × 0.625° (MERRA-2) / 1° (CERES radiation)"
    notes: tuple[str, ...] = field(default_factory=tuple)

    def year(self, y: int) -> WeatherYear:
        for w in self.years:
            if w.year == y:
                return w
        raise KeyError(y)


# ---------- FAO-56 reference evapotranspiration ----------


def _es(t: float) -> float:
    return 0.6108 * math.exp(17.27 * t / (t + 237.3))


def extraterrestrial_radiation(lat_deg: float, doy: int) -> float:
    """Ra, MJ m-2 d-1 (FAO-56 eq. 21)."""
    phi = math.radians(lat_deg)
    dr = 1 + 0.033 * math.cos(2 * math.pi / 365 * doy)
    delta = 0.409 * math.sin(2 * math.pi / 365 * doy - 1.39)
    ws = math.acos(max(-1.0, min(1.0, -math.tan(phi) * math.tan(delta))))
    return (
        24
        * 60
        / math.pi
        * 0.0820
        * dr
        * (ws * math.sin(phi) * math.sin(delta) + math.cos(phi) * math.cos(delta) * math.sin(ws))
    )


def et0_penman_monteith(
    tmax: float, tmin: float, rh: float, wind: float, rs: float, lat: float, elev: float, doy: int
) -> float:
    """Daily ET0, mm (FAO-56 eq. 6, G = 0, ea from mean relative humidity, eq. 19)."""
    t = (tmax + tmin) / 2
    es = (_es(tmax) + _es(tmin)) / 2
    ea = max(0.0, min(es, es * rh / 100))
    delta = 4098 * _es(t) / (t + 237.3) ** 2
    pressure = 101.3 * ((293 - 0.0065 * elev) / 293) ** 5.26
    gamma = 0.000665 * pressure
    ra = extraterrestrial_radiation(lat, doy)
    rso = (0.75 + 2e-5 * elev) * ra
    rns = 0.77 * rs
    ratio = min(1.0, rs / rso) if rso > 0 else 0.5
    sigma = 4.903e-9
    rnl = (
        sigma
        * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4)
        / 2
        * (0.34 - 0.14 * math.sqrt(ea))
        * (1.35 * ratio - 0.35)
    )
    rn = rns - rnl
    num = 0.408 * delta * rn + gamma * 900 / (t + 273) * wind * (es - ea)
    return max(0.0, num / (delta + gamma * (1 + 0.34 * wind)))


# ---------- NASA POWER ----------


def _fill(values: list[float | None]) -> tuple[list[float], int]:
    """Linear interpolation over missing days; edges take the nearest value."""
    n = len(values)
    known = [i for i, v in enumerate(values) if v is not None]
    if not known:
        raise ValueError("no data")
    out = [0.0] * n
    gaps = 0
    for i, v in enumerate(values):
        if v is not None:
            out[i] = v
            continue
        gaps += 1
        lo = max((k for k in known if k < i), default=None)
        hi = min((k for k in known if k > i), default=None)
        if lo is None:
            out[i] = values[hi]  # type: ignore[index,assignment]
        elif hi is None:
            out[i] = values[lo]  # type: ignore[assignment]
        else:
            a, b = values[lo], values[hi]
            out[i] = a + (b - a) * (i - lo) / (hi - lo)  # type: ignore[operator]
    return out, gaps


LAPSE_RATE_C_PER_M = 0.0065  # ICAO standard atmosphere


def weather_from_power(
    payload: dict, min_coverage: float = 0.9, site_elevation_m: float | None = None
) -> Weather:
    """Parse a NASA POWER daily point response into complete 365-day years.

    With `site_elevation_m`, temperatures are moved from the grid-cell mean elevation to the
    field with the standard lapse rate (6.5 °C/km), and ET0 uses the field elevation.
    """
    coords = payload["geometry"]["coordinates"]
    lon, lat = float(coords[0]), float(coords[1])
    cell_elev = float(coords[2]) if len(coords) > 2 else 0.0
    elev = site_elevation_m if site_elevation_m is not None else cell_elev
    dt = (cell_elev - elev) * LAPSE_RATE_C_PER_M
    params = payload["properties"]["parameter"]
    by_year: dict[int, dict[str, list[float | None]]] = {}
    for key in params["T2M_MAX"]:
        d = date(int(key[:4]), int(key[4:6]), int(key[6:8]))
        if d.month == 2 and d.day == 29:
            continue
        row = by_year.setdefault(d.year, {p: [] for p in POWER_PARAMS})
        for p in POWER_PARAMS:
            v = params[p].get(key)
            row[p].append(None if v is None or float(v) <= POWER_FILL else float(v))
    years: list[WeatherYear] = []
    notes: list[str] = []
    for y in sorted(by_year):
        row = by_year[y]
        if len(row["T2M_MAX"]) < DAYS:
            notes.append(f"{y}: неполный год ({len(row['T2M_MAX'])} сут) — не используется")
            continue
        present = sum(v is not None for v in row["T2M_MAX"]) / DAYS
        if present < min_coverage:
            notes.append(f"{y}: пропусков {100 - present * 100:.0f}% — год не используется")
            continue
        filled: dict[str, list[float]] = {}
        gaps = 0
        for p in POWER_PARAMS:
            filled[p], g = _fill(row[p])
            gaps = max(gaps, g)
        if dt:
            filled["T2M_MAX"] = [t + dt for t in filled["T2M_MAX"]]
            filled["T2M_MIN"] = [t + dt for t in filled["T2M_MIN"]]
        et0 = tuple(
            round(
                et0_penman_monteith(
                    filled["T2M_MAX"][i],
                    filled["T2M_MIN"][i],
                    filled["RH2M"][i],
                    filled["WS2M"][i],
                    filled["ALLSKY_SFC_SW_DWN"][i],
                    lat,
                    elev,
                    i + 1,
                ),
                3,
            )
            for i in range(DAYS)
        )
        years.append(
            WeatherYear(
                y,
                tuple(filled["T2M_MAX"]),
                tuple(filled["T2M_MIN"]),
                tuple(filled["RH2M"]),
                tuple(filled["WS2M"]),
                tuple(filled["ALLSKY_SFC_SW_DWN"]),
                tuple(max(0.0, x) for x in filled["PRECTOTCORR"]),
                et0,
                gaps,
            )
        )
    if abs(dt) >= 0.1:
        notes.append(
            f"Температуры сдвинуты на {dt:+.1f} °C: ячейка POWER на {cell_elev:.0f} м, "
            f"поле на {elev:.0f} м (градиент 6,5 °C/км)"
        )
    return Weather(lat, lon, elev, tuple(years), notes=tuple(notes))


def doy_of(mmdd: str) -> int:
    """Day index 0..364 of a month-day in a non-leap year."""
    m, d = (int(x) for x in mmdd.split("-"))
    return (date(2001, m, d) - date(2001, 1, 1)).days


def mmdd_of(doy: int) -> str:
    d = date(2001, 1, 1) + timedelta(days=doy % DAYS)
    return f"{d.month:02d}-{d.day:02d}"


def shift_year(w: WeatherYear, year: int) -> WeatherYear:
    return replace(w, year=year)
