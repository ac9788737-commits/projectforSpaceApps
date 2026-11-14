"""Engine tests for the farmer simulator (docs/SIMULATOR.md §7)."""

from __future__ import annotations

from dataclasses import replace

import pytest
from sqlmodel import Session

from app.physics.environment import compute_environment
from app.scenarios import open_surface
from app.sim.actions import Action
from app.sim.engine import CropBook, PlotSpec, SimScenario, run
from app.sim.environment.base_climate import world_from_environment, world_from_preset
from app.sim.environment.events import Event
from app.sim.environment.overrides import OverrideChange
from app.sim.report import build_report
from app.sim.scenario import canonical_json, parse_scenario
from app.sim.worlds import crop_book, resolve_world
from app.simulate import simulate


@pytest.fixture(scope="module")
def book(engine) -> CropBook:
    with Session(engine) as s:
        return crop_book(s)


def _earth_like_old(bodies, crops, crop_id: str):
    """Planet Earth world with the same site temperature the old model picked for this crop."""
    env = compute_environment(bodies["earth"])
    c = open_surface(env, crops[crop_id]).conditions
    world = world_from_environment("planet:earth", "Земля", env)
    temps = OverrideChange(
        0.0,
        {
            "temp_day_c": c.t_mean_c + c.diurnal_amplitude_k / 2,
            "temp_night_c": c.t_mean_c - c.diurnal_amplitude_k / 2,
        },
    )
    return world, temps


@pytest.mark.parametrize("crop_id", ["potato", "wheat", "lettuce", "tomato"])
def test_earth_without_events_matches_simulate(bodies, crops, book, crop_id: str) -> None:
    world, temps = _earth_like_old(bodies, crops, crop_id)
    sc = SimScenario(
        world, (PlotSpec("A1", crop_id, "open", "auto"),), duration_days=220, overrides=(temps,)
    )
    new = run(sc, book).summary["A1"]["yield_rel"]
    old = simulate(bodies["earth"], crops[crop_id], "open_surface").growth.yield_rel
    assert new == pytest.approx(old, abs=0.02)


@pytest.mark.parametrize(
    "protection,scenario", [("greenhouse", "greenhouse"), ("closed", "closed_farm")]
)
def test_mars_protected_matches_simulate(
    bodies, crops, book, protection: str, scenario: str
) -> None:
    world = world_from_environment("planet:mars", "Марс", compute_environment(bodies["mars"]))
    new = run(
        SimScenario(world, (PlotSpec("A1", "potato", protection),), duration_days=200), book
    ).summary["A1"]["yield_rel"]
    old = simulate(bodies["mars"], crops["potato"], scenario).growth.yield_rel  # type: ignore[arg-type]
    assert new == pytest.approx(old, abs=0.01)


def test_mars_open_dies_on_first_day(bodies, book) -> None:
    world = world_from_environment("planet:mars", "Марс", compute_environment(bodies["mars"]))
    s = run(SimScenario(world, (PlotSpec("A1", "potato"),), duration_days=30), book).summary["A1"]
    assert not s["alive"] and s["death_day"] == 0 and s["death_cause"] == "frost"


def _temperate(*plots: PlotSpec, **kw) -> SimScenario:
    return SimScenario(world_from_preset("earth:temperate"), plots, **kw)


def test_short_frost_damages_and_hard_frost_kills_potato(book) -> None:
    day = 30 * 24
    light = run(
        _temperate(
            PlotSpec("A1", "potato", irrigation="auto"),
            duration_days=40,
            events=(Event("frost", day, 6, -1.0),),
        ),
        book,
    )
    hard = run(
        _temperate(
            PlotSpec("A1", "potato", irrigation="auto"),
            duration_days=40,
            events=(Event("frost", day, 10, -5.0),),
        ),
        book,
    )
    assert light.summary["A1"]["alive"]
    assert light.plots["A1"][30]["damage"]["leaf"] > 0.02
    assert not hard.summary["A1"]["alive"] and hard.summary["A1"]["death_cause"] == "frost"


def test_warm_nights_cut_tubers(book) -> None:
    def tubers(night: float) -> float:
        sc = _temperate(
            PlotSpec("A1", "potato", irrigation="auto"),
            duration_days=150,
            overrides=(OverrideChange(0, {"temp_day_c": 26, "temp_night_c": night}),),
        )
        return float(run(sc, book).summary["A1"]["yield_g"])

    cool, warm = tubers(12), tubers(22)
    assert warm < 0.85 * cool


def test_heat_at_flowering_hurts_more_than_in_vegetative_stage(book) -> None:
    base = _temperate(PlotSpec("A1", "wheat", irrigation="auto"), duration_days=170)
    records = run(base, book).plots["A1"]
    flowering = next(r["day"] for r in records if r["stage"] == "flowering")

    def with_heat(day: int) -> float:
        ev = Event("heatwave", day * 24, 6 * 24, 12.0)
        return float(run(replace(base, events=(ev,)), book).summary["A1"]["yield_g"])

    no_heat = float(run(base, book).summary["A1"]["yield_g"])
    loss_flowering = no_heat - with_heat(int(flowering))  # type: ignore[arg-type]
    loss_vegetative = no_heat - with_heat(20)
    assert loss_flowering > 1.5 * max(loss_vegetative, 1e-6)


def test_drought_hurts_and_irrigation_partly_restores(book) -> None:
    drought = Event("drought", 30 * 24, 40 * 24, 1.3)
    plain = _temperate(PlotSpec("A1", "potato"), duration_days=150)
    dry = replace(plain, events=(drought,))
    watered = replace(
        dry,
        actions=tuple(
            Action("irrigate", (35 + 5 * i) * 24 + 8, None, {"mm": 25}) for i in range(7)
        ),
    )
    y = {
        k: float(run(sc, book).summary["A1"]["yield_g"])
        for k, sc in {"plain": plain, "dry": dry, "watered": watered}.items()
    }
    assert y["dry"] < 0.9 * y["plain"]
    assert y["watered"] > y["dry"] * 1.1


def test_waterlogging_damages_roots(book) -> None:
    sc = _temperate(
        PlotSpec("A1", "potato", irrigation="auto"),
        duration_days=40,
        events=(Event("downpour", 20 * 24, 4 * 24, 20.0),),
    )
    r = run(sc, book)
    assert max(rec["damage"]["root"] for rec in r.plots["A1"]) > 0.05


def test_same_scenario_same_seed_gives_identical_report(engine, book) -> None:
    raw = {
        "version": 1,
        "world": "earth:temperate",
        "seed": 7,
        "duration_days": 120,
        "crops": [{"crop": "potato", "plot": "A1", "protection": "open"}],
        "overrides": {"temp_day_c": 22, "temp_night_c": 12},
        "events": [
            {"type": "heatwave", "start_day": 45, "duration_days": 7, "intensity": "strong"},
            {"type": "frost", "start_day": 90, "duration_hours": 6, "min_temp_c": -4},
        ],
        "actions": [{"type": "irrigate", "day": 50, "mm": 20}],
    }
    with Session(engine) as s:
        reports = []
        for _ in range(2):
            sc = parse_scenario(raw, lambda w: resolve_world(s, w))
            reports.append(canonical_json(build_report(sc, run(sc, book), book)))
    assert reports[0] == reports[1]
    other = dict(raw, seed=8)
    with Session(engine) as s:
        sc = parse_scenario(other, lambda w: resolve_world(s, w))
        assert canonical_json(build_report(sc, run(sc, book), book)) != reports[0]


def test_report_names_heat_during_tuber_formation(engine, book) -> None:
    with Session(engine) as s:
        sc = parse_scenario(
            {
                "world": "earth:temperate",
                "crops": [{"crop": "potato", "plot": "A1", "irrigation": "auto"}],
                "events": [
                    {
                        "type": "heatwave",
                        "start_day": 55,
                        "duration_days": 12,
                        "intensity": "strong",
                    }
                ],
            },
            lambda w: resolve_world(s, w),
        )
    report = build_report(sc, run(sc, book), book)
    plot = report["plots"]["A1"]
    assert plot["yield_vs_norm"] < 0.98
    assert plot["harms"][0]["type"] == "heatwave"
    assert "жара во время" in plot["headline_ru"]


def test_daytime_frost_reaches_the_coming_night() -> None:
    from app.sim.scenario import parse_event

    noon = parse_event({"type": "frost", "start_hour": 90 * 24 + 13}, 24.0, 0)
    assert noon.start_hour + noon.duration_hours >= 91 * 24 + 3  # covers 03:00 next morning
    night = parse_event({"type": "frost", "start_hour": 90 * 24 + 1}, 24.0, 0)
    assert night.duration_hours == 8


def test_late_frost_kills_tops_but_tubers_stay_in_the_soil(book) -> None:
    sc = _temperate(PlotSpec("A1", "potato", irrigation="auto"), duration_days=110)
    normal = run(sc, book).summary["A1"]
    frosted = run(replace(sc, events=(Event("frost", 90 * 24, 10, -6.0),)), book).summary["A1"]
    assert not frosted["alive"] and frosted["death_cause"] == "frost"
    assert 0 < frosted["yield_g"] < normal["yield_g"]  # type: ignore[operator]
    early = run(replace(sc, events=(Event("frost", 20 * 24, 10, -6.0),)), book).summary["A1"]
    assert early["yield_g"] == 0  # no tubers yet
