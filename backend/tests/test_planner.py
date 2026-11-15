"""Stages 7.5–7.6: ranking rotations, constraints, Pareto, climate stress test (ROTATION.md §8)."""

from __future__ import annotations

import pytest

from app.climate.stress_scenarios import PRESETS, apply
from app.geo import fields as geo
from app.rotation.calendar import sowing_dates
from app.rotation.model import rotation_from_plan
from app.rotation.optimizer import METRICS, Profile, _pareto, optimise
from app.rotation.simulate import run_rotation

FID = "us-iowa"
SMALL = ["maize", "soybean", "wheat", "pea", "sunflower"]


@pytest.fixture(scope="module")
def field():
    layers = geo.load_layers(FID, offline=True)
    return geo.field_site(layers), geo.field_weather(layers)


def test_same_input_same_ranking(field) -> None:
    site, w = field
    p = Profile(years=3, allowed=SMALL)
    a = optimise(site, w, p)
    b = optimise(site, w, p)
    assert [s["plan"] for s in a["schemes"]] == [s["plan"] for s in b["schemes"]]
    assert [s["score"] for s in a["schemes"]] == [s["score"] for s in b["schemes"]]


def test_constraints_are_respected(field) -> None:
    site, w = field
    p = Profile(years=3, allowed=None, forbidden=["sunflower"], machinery=[], required=["pea"])
    r = optimise(site, w, p)
    mains = {x["main"] for s in r["schemes"] for x in s["plan"]}
    covers = {x["cover"] for s in r["schemes"] for x in s["plan"]}
    assert "sunflower" not in mains
    assert "potato" not in mains and "cotton" not in mains  # no digger / picker
    assert not covers & {"clover", "mustard", "phacelia"}  # no small-seed drill
    assert all(any(x["main"] == "pea" for x in s["plan"]) for s in r["schemes"])


def test_pareto_front_is_non_dominated() -> None:
    vals = [{"income": 10, "water": 5}, {"income": 8, "water": 2}, {"income": 7, "water": 6}]
    front = _pareto(vals, ["income", "water"])
    assert front == {0, 1}
    assert METRICS["water"][0] == -1


def test_priorities_change_the_winner(field) -> None:
    site, w = field
    soil = optimise(site, w, Profile(years=3, allowed=SMALL, weights={"soil": 5, "erosion": 4}))
    money = optimise(site, w, Profile(years=3, allowed=SMALL, weights={"income": 5}))
    assert any(x["cover"] for x in soil["schemes"][0]["plan"])
    assert (
        soil["schemes"][0]["metrics"]["erosion"]["p50"]
        <= money["schemes"][0]["metrics"]["erosion"]["p50"]
    )
    assert (
        money["schemes"][0]["metrics"]["income"]["p50"]
        >= soil["schemes"][0]["metrics"]["income"]["p50"]
    )
    s = soil["schemes"][0]["metrics"]["income"]
    assert s["p10"] <= s["p50"] <= s["p90"]


def test_hot_dry_stress_never_improves_rainfed_water_balance(field) -> None:
    site, w = field
    hot = apply(w, PRESETS["plus15_dry"])
    sow = sowing_dates(w)
    for plan in (
        [("maize", None), ("soybean", None), ("wheat", "vetch")],
        [("sunflower", None), ("pea", None), ("maize", "rye_cover")],
    ):
        rot = rotation_from_plan("r", "r", plan, {"maize": 150, "wheat": 100}, sow)
        for start in (0, 7, 14):
            base = run_rotation(site, rot, list(w.years[start : start + 3]))
            stress = run_rotation(site, rot, list(hot.years[start : start + 3]))
            ratio_b = sum(y.eta_mm for y in base.years) / max(
                1e-9, sum(y.etc_mm for y in base.years)
            )
            ratio_s = sum(y.eta_mm for y in stress.years) / max(
                1e-9, sum(y.etc_mm for y in stress.years)
            )
            assert ratio_s <= ratio_b + 1e-9
            assert sum(y.precip_mm for y in stress.years) < sum(y.precip_mm for y in base.years)


def test_stress_raises_temperature_and_et0(field) -> None:
    _, w = field
    hot = apply(w, PRESETS["plus15_dry"])
    assert hot.years[0].tmax[180] == pytest.approx(w.years[0].tmax[180] + 1.5)
    assert sum(hot.years[0].et0) > sum(w.years[0].et0)
    assert apply(w, PRESETS["history"]) is w
