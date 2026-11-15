"""Stage 7.4: history analysis (ROTATION.md §3.1)."""

from __future__ import annotations

import math
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np

from app.analysis.history import analyse, bare_soil, frost, heat
from app.analysis.indices import runs, spi
from app.rotation.weather import DAYS, Weather

sys.path.insert(0, str(Path(__file__).parent))
from test_rotation import synthetic_year


def weather(n: int = 12, **kw) -> Weather:
    return Weather(45.0, 10.0, 200.0, tuple(synthetic_year(2001 + i, **kw) for i in range(n)))


def test_runs() -> None:
    assert runs([True, True, False, True, True, True], 3) == [(3, 3)]


def test_spi_is_standardised() -> None:
    rng = np.random.default_rng(1)
    m = rng.gamma(2.0, 20.0, size=(30, 12))
    s = spi(m, 1)
    assert abs(np.nanmean(s)) < 0.2
    assert 0.7 < np.nanstd(s) < 1.3


def test_heatwave_detected_in_the_hot_year() -> None:
    w = weather()
    hot = w.years[5]
    tmax = list(hot.tmax)
    for d in range(190, 196):
        tmax[d] += 8
    w = replace(w, years=(*w.years[:5], replace(hot, tmax=tuple(tmax)), *w.years[6:]))
    h = heat(w)
    waves = {y["year"]: y["waves"] for y in h["years"]}
    assert waves[hot.year] >= 1
    assert waves[hot.year] >= max(v for k, v in waves.items() if k != hot.year)


def test_frost_dates_and_probabilities() -> None:
    f = frost(weather())
    assert f["years_with_frost"] == 12
    assert f["last_spring_median"] is not None and f["last_spring_median"] < "06-01"
    assert f["prob_frost_after"]["03-15"] >= f["prob_frost_after"]["05-15"]


def test_bare_soil_from_ndvi_and_erosive_rain() -> None:
    w = weather()
    ndvi = {wy.year: [0.1 if d < 120 or d > 300 else 0.7 for d in range(DAYS)] for wy in w.years}
    b = bare_soil(w, ndvi)
    assert b["available"]
    assert math.isclose(b["mean_bare_days"], 120 + 64, abs_tol=1)
    assert bare_soil(w, None)["available"] is False


def test_analyse_headline_uses_only_computed_numbers() -> None:
    a = analyse(weather(), None)
    assert a["n_years"] == 12
    assert any("Осадки" in h for h in a["headline"])
    assert {v["crop"] for v in a["vulnerability"]} >= {"wheat", "winter_wheat", "maize"}
