from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.biology import responses as r

finite = st.floats(allow_nan=False, allow_infinity=False, min_value=-1e7, max_value=1e7)
positive = st.floats(allow_nan=False, allow_infinity=False, min_value=0.0, max_value=1e8)


def test_temperature_optimum_and_cardinals():
    assert r.temperature_response(25.0, 10.0, 25.0, 35.0) == pytest.approx(1.0)
    assert r.temperature_response(10.0, 10.0, 25.0, 35.0) == 0.0
    assert r.temperature_response(35.0, 10.0, 25.0, 35.0) == 0.0


@given(finite)
def test_temperature_response_bounded(t):
    assert 0.0 <= r.temperature_response(t, 5.0, 20.0, 30.0) <= 1.0


def test_frost_is_lethal_even_if_mean_is_fine():
    assert r.diurnal_temperature_response(10.0, 40.0, 0.0, 5.0, 18.0, 22.0, 30.0) == 0.0


def test_light_saturates_at_reference():
    assert r.light_response(2000.0, 20.0, 600.0) == 1.0
    assert r.light_response(600.0, 20.0, 600.0) == pytest.approx(1.0)


def test_light_below_compensation_is_zero():
    assert r.light_response(10.0, 20.0, 600.0) == 0.0


@given(positive)
def test_light_response_bounded(ppfd):
    assert 0.0 <= r.light_response(ppfd, 20.0, 800.0) <= 1.0


def test_light_monotonic():
    values = [r.light_response(p, 20.0, 800.0) for p in (30, 100, 300, 600, 800)]
    assert values == sorted(values)


def test_long_night_kills():
    assert r.photoperiod_response(350, 350, 30, 6, 17, 48, True) == 0.0


def test_normal_day_is_fine():
    assert r.photoperiod_response(12, 12, 30, 6, 17, 48, True) == 1.0


def test_continuous_light_penalty():
    assert r.photoperiod_response(24, 0, 30, 6, 17, 48, False) == pytest.approx(0.6)
    assert r.photoperiod_response(24, 0, 30, 6, 17, 48, True) == 1.0


def test_co2_normalised_at_earth():
    assert r.co2_response(43.0, "C3") == pytest.approx(1.0)
    assert r.co2_response(43.0, "C4") == pytest.approx(1.0)


def test_c4_less_sensitive_to_low_co2_than_c3():
    assert r.co2_response(15.0, "C4") > r.co2_response(15.0, "C3")


def test_co2_extremes():
    assert r.co2_response(0.0, "C3") == 0.0
    assert r.co2_response(5_000_000.0, "C3") == 0.0


def test_o2_threshold():
    assert r.o2_response(1.0, 2.0) == 0.0
    assert r.o2_response(21_000.0, 2.0) == 1.0


def test_pressure_extremes():
    assert r.pressure_response(636.0, 10.0) == 0.0
    assert r.pressure_response(101_325.0, 10.0) == 1.0
    assert r.pressure_response(9_200_000.0, 10.0) == 0.0


def test_gravity_reference_and_extrapolation():
    assert r.gravity_response(1.0) == 1.0
    assert 0.5 < r.gravity_response(0.0) < 1.0
    assert r.gravity_response(3.0) < r.gravity_response(1.5)


def test_uv_tolerance():
    assert r.uv_response(1.0, 2.0) == 1.0
    assert r.uv_response(60.0, 2.0) == pytest.approx(0.0, abs=1e-9)


def test_perchlorate_at_phoenix_level_nearly_lethal():
    assert r.perchlorate_response(0.6) == 0.0
    assert r.perchlorate_response(0.0) == 1.0


def test_water_needs_liquid_outdoors():
    assert r.water_response("ice", False, False) == 0.0
    assert r.water_response("ice", True, True) == 1.0
    assert r.water_response("none", True, True) == 0.0


def test_ph_trapezoid():
    assert r.ph_response(6.5, 5.0, 7.5) == 1.0
    assert r.ph_response(8.0, 5.0, 7.5) == pytest.approx(0.5)
    assert r.ph_response(10.0, 5.0, 7.5) == 0.0
