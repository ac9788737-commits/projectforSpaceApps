from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.biology.morphology import potential_biomass_fraction, stage_of
from app.ingest.morphology import load_morphology
from app.simulate import simulate
from app.timeline import Overrides, simulate_timeline

MORPH = load_morphology()


def test_morphology_covers_all_crops(crops) -> None:
    assert set(crops) == set(MORPH)


@given(st.floats(0.0, 1.0), st.floats(0.0, 1.0))
def test_potential_biomass_is_monotonic_from_zero_to_one(a: float, b: float) -> None:
    lo, hi = sorted((a, b))
    assert potential_biomass_fraction(lo) <= potential_biomass_fraction(hi) + 1e-12
    assert potential_biomass_fraction(0.0) == pytest.approx(0.0)
    assert potential_biomass_fraction(1.0) == pytest.approx(1.0)


def test_stage_order_for_potato() -> None:
    m = MORPH["potato"]
    stages = [stage_of(p / 100, m, dead=False) for p in range(0, 101)]
    order = ["seed", "germination", "vegetative", "flowering", "fruiting", "mature"]
    assert [s for i, s in enumerate(stages) if i == 0 or stages[i - 1] != s] == order


@pytest.mark.parametrize("crop_id", sorted(MORPH))
@pytest.mark.parametrize("scenario", ["open_surface", "greenhouse", "closed_farm"])
def test_earth_timeline_matches_simulate(bodies, crops, crop_id: str, scenario: str) -> None:
    crop = crops[crop_id]
    result = simulate_timeline(bodies["earth"], crop, MORPH[crop_id], scenario)  # type: ignore[arg-type]
    static = simulate(bodies["earth"], crop, scenario)  # type: ignore[arg-type]
    assert result.survival
    assert result.harvest_day is not None
    assert result.yield_rel == pytest.approx(static.growth.yield_rel, abs=1e-9)
    assert static.growth.days_to_harvest is not None
    assert result.harvest_earth_days == pytest.approx(static.growth.days_to_harvest, abs=1.0)


def test_earth_potato_is_healthy(bodies, crops) -> None:
    result = simulate_timeline(bodies["earth"], crops["potato"], MORPH["potato"], "open_surface")
    final = result.days[-1]
    assert result.yield_rel > 0.95
    assert final.stage == "mature"
    assert final.organ_count >= 8
    assert final.health > 0.9


def test_mars_open_surface_dies_on_first_day(bodies, crops) -> None:
    result = simulate_timeline(bodies["mars"], crops["potato"], MORPH["potato"], "open_surface")
    assert not result.survival
    assert result.yield_rel == 0.0
    death = [e for e in result.events if e.type == "death"]
    assert len(death) == 1 and death[0].day == 1
    assert result.days[1].stage == "dead"


def test_mars_dome_grows_light_limited(bodies, crops) -> None:
    crop = crops["potato"]
    result = simulate_timeline(
        bodies["mars"], crop, MORPH["potato"], "greenhouse", events_enabled=False
    )
    static = simulate(bodies["mars"], crop, "greenhouse")
    assert result.survival
    assert result.yield_rel == pytest.approx(static.growth.yield_rel, abs=1e-9)
    assert static.growth.limiting_factor in ("light", "photoperiod")
    assert 0.0 < result.yield_rel < 0.5
    assert result.days[-1].stress["light"] > 0.3


def test_mars_steps_are_sols(bodies, crops) -> None:
    result = simulate_timeline(bodies["mars"], crops["lettuce"], MORPH["lettuce"], "closed_farm")
    assert result.step_hours == pytest.approx(24.66, abs=0.05)


def test_mars_closed_farm_is_close_to_earth(bodies, crops) -> None:
    result = simulate_timeline(bodies["mars"], crops["potato"], MORPH["potato"], "closed_farm")
    assert result.survival
    assert result.yield_rel > 0.85


def test_events_are_reproducible_and_only_reduce_yield(bodies, crops) -> None:
    args = (bodies["mars"], crops["wheat"], MORPH["wheat"], "greenhouse")
    first = simulate_timeline(*args, seed=7)  # type: ignore[arg-type]
    again = simulate_timeline(*args, seed=7)  # type: ignore[arg-type]
    assert first.events == again.events
    assert first.yield_rel == again.yield_rel
    assert first.yield_rel <= first.static_yield_rel + 1e-9
    storms = [e for e in first.events if e.type == "dust_storm"]
    if storms:
        assert any(d.storm for d in first.days)


def test_no_dust_storms_in_closed_farm_or_on_earth(bodies, crops) -> None:
    for planet, scenario in (("mars", "closed_farm"), ("earth", "open_surface")):
        result = simulate_timeline(bodies[planet], crops["wheat"], MORPH["wheat"], scenario, seed=1)  # type: ignore[arg-type]
        assert not [e for e in result.events if e.type == "dust_storm"]


def test_moon_dome_starves_in_the_long_night(bodies, crops) -> None:
    result = simulate_timeline(bodies["moon"], crops["lettuce"], MORPH["lettuce"], "greenhouse")
    assert not result.survival
    death = next(e for e in result.events if e.type == "death")
    assert death.day >= 7
    assert result.days[-1].limiting_factor in ("light", "photoperiod")


def test_supplemental_light_helps_mars_dome(bodies, crops) -> None:
    args = (bodies["mars"], crops["potato"], MORPH["potato"], "greenhouse")
    base = simulate_timeline(*args, events_enabled=False)  # type: ignore[arg-type]
    lit = simulate_timeline(  # type: ignore[misc]
        *args,
        overrides=Overrides(supplemental_ppfd_umol_m2_s=300.0),
        events_enabled=False,
    )
    assert lit.yield_rel > base.yield_rel
    assert lit.yield_rel == pytest.approx(lit.static_yield_rel, abs=1e-9)


def test_tubers_grow_over_time(bodies, crops) -> None:
    result = simulate_timeline(bodies["earth"], crops["potato"], MORPH["potato"], "closed_farm")
    yields = [d.yield_g for d in result.days]
    assert yields == sorted(yields)
    assert yields[-1] > 0
