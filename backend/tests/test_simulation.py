from __future__ import annotations

import pytest

from app.physics.environment import BodyInputs
from app.simulate import monte_carlo, simulate

ALL_CROPS = [
    "lettuce",
    "potato",
    "wheat",
    "tomato",
    "soybean",
    "rice",
    "radish",
    "spinach",
    "pea",
    "spirulina",
]


@pytest.mark.parametrize("crop_id", ALL_CROPS)
def test_earth_open_surface_is_about_100_percent(bodies, crops, crop_id):
    result = simulate(bodies["earth"], crops[crop_id], "open_surface")
    assert result.growth.survival
    assert result.growth.yield_rel >= 0.9


@pytest.mark.parametrize("crop_id", ALL_CROPS)
def test_mars_open_surface_is_lethal(bodies, crops, crop_id):
    result = simulate(bodies["mars"], crops[crop_id], "open_surface")
    assert not result.growth.survival
    assert result.growth.yield_rel == 0.0
    assert result.growth.days_to_harvest is None


@pytest.mark.parametrize("crop_id", ALL_CROPS)
def test_mars_closed_farm_survives_with_reduced_gravity_yield(bodies, crops, crop_id):
    result = simulate(bodies["mars"], crops[crop_id], "closed_farm", yield_kg_m2_cycle=1.0)
    assert result.growth.survival
    assert 0.8 < result.growth.yield_rel < 1.0
    assert result.growth.limiting_factor == "gravity"
    assert result.outcome.engineering["energy_kwh_per_kg"] is not None


def test_mars_greenhouse_is_viable_but_below_earth(bodies, crops):
    result = simulate(bodies["mars"], crops["potato"], "greenhouse")
    assert result.growth.survival
    assert 0.1 < result.growth.yield_rel < 0.95
    assert result.outcome.engineering["pressure_delta_kpa"] > 40.0


def test_earth_greenhouse_and_farm_stay_high(bodies, crops):
    for scenario in ("greenhouse", "closed_farm"):
        result = simulate(bodies["earth"], crops["wheat"], scenario)
        assert result.growth.yield_rel > 0.7


@pytest.mark.parametrize("body", ["venus", "moon", "mercury", "titan", "europa", "jupiter"])
def test_hostile_bodies_kill_outdoor_crops(bodies, crops, body):
    assert not simulate(bodies[body], crops["wheat"], "open_surface").growth.survival


def test_venus_greenhouse_is_not_feasible(bodies, crops):
    result = simulate(bodies["venus"], crops["wheat"], "greenhouse")
    assert not result.growth.survival
    assert result.outcome.engineering["feasible"] is False


def test_venus_closed_farm_is_flagged_as_infeasible(bodies, crops):
    result = simulate(bodies["venus"], crops["wheat"], "closed_farm")
    assert result.outcome.engineering["feasible"] is False
    assert any(a.code == "extreme_hull" for a in result.assumptions)
    assert result.confidence != "high"


def test_mars_closed_farm_is_not_high_confidence(bodies, crops):
    assert simulate(bodies["mars"], crops["wheat"], "closed_farm").confidence == "medium"


def test_lunar_night_kills_greenhouse_but_not_closed_farm(bodies, crops):
    assert not simulate(bodies["moon"], crops["lettuce"], "greenhouse").growth.survival
    assert simulate(bodies["moon"], crops["lettuce"], "closed_farm").growth.survival


def test_gas_giant_closed_farm_is_flagged(bodies, crops):
    result = simulate(bodies["jupiter"], crops["lettuce"], "closed_farm")
    assert result.outcome.engineering["feasible"] is False
    assert any(a.code == "floating_platform" for a in result.assumptions)


def test_high_gravity_lowers_confidence(crops):
    body = BodyInputs(
        name="heavy",
        mass_earth=8.0,
        radius_earth=1.3,
        insolation_earth=1.0,
        teff_k=5772.0,
        surface_pressure_pa=101325.0,
    )
    result = simulate(body, crops["wheat"], "closed_farm")
    assert any(a.code == "gravity_extrapolation" for a in result.assumptions)
    assert result.confidence != "high"


def test_earth_confidence_is_high(bodies, crops):
    assert simulate(bodies["earth"], crops["wheat"], "open_surface").confidence == "high"


def test_result_contains_required_fields(bodies, crops):
    result = simulate(bodies["mars"], crops["wheat"], "open_surface")
    assert len(result.growth.factors) == 12
    assert result.growth.limiting_factor
    assert result.recommendations


def test_cycle_is_longer_when_cool(bodies, crops):
    warm = simulate(bodies["earth"], crops["wheat"], "closed_farm").growth.days_to_harvest
    assert warm == pytest.approx(crops["wheat"].cycle_days)


def test_monte_carlo_is_deterministic_and_ordered(bodies, crops):
    args = (bodies["mars"], crops["potato"], "greenhouse", {"albedo": (0.1, 0.4)})
    first = monte_carlo(*args, n=50, seed=7)
    second = monte_carlo(*args, n=50, seed=7)
    assert first == second
    assert first.p10 <= first.p50 <= first.p90


def test_monte_carlo_spans_survival(crops):
    body = BodyInputs(
        name="edge",
        mass_earth=1.0,
        radius_earth=1.0,
        insolation_earth=1.0,
        teff_k=5772.0,
        day_hours=24.0,
        surface_pressure_pa=101325.0,
        pco2_pa=43.0,
        po2_pa=21000.0,
        vis_transmission=0.55,
        water="abundant",
        substrate="soil",
    )
    result = monte_carlo(
        body, crops["wheat"], "open_surface", {"surface_temp_k": (150.0, 300.0)}, n=200
    )
    assert 0.0 < result.survival_probability < 1.0
    assert result.p10 == 0.0


def test_monte_carlo_rejects_unknown_field(bodies, crops):
    with pytest.raises(ValueError):
        monte_carlo(bodies["mars"], crops["potato"], "greenhouse", {"teff_k": (1.0, 2.0)}, n=10)
