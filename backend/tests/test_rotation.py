"""Stage 7.1: multi-year rotation with carry-over soil state (docs/ROTATION.md §8)."""

from __future__ import annotations

import math

import pytest

from app.rotation.crops import rotation_crops, usda_texture
from app.rotation.erosion import epic_k_factor, ls_factor, renard_freimund_r
from app.rotation.model import FieldSite, rotation_from_plan
from app.rotation.rules import check_rotation
from app.rotation.simulate import run_rotation
from app.rotation.weather import DAYS, WeatherYear, et0_penman_monteith


def synthetic_year(
    year: int,
    t_mean: float = 14.0,
    amp: float = 12.0,
    rain_every: int = 4,
    rain_mm: float = 8.0,
    storm_mm: float = 45.0,
) -> WeatherYear:
    """Temperate continental year: sinusoidal temperature, regular rain, two summer storms."""
    tmax, tmin, rh, wind, rs, precip, et0 = [], [], [], [], [], [], []
    for d in range(DAYS):
        t = t_mean - amp * math.cos(2 * math.pi * (d - 15) / DAYS)
        hi, lo = t + 6, t - 6
        r = 8 + 18 * max(0.0, math.sin(math.pi * (d - 20) / 330))
        p = rain_mm if d % rain_every == 0 else 0.0
        if d in (190, 230):
            p = storm_mm
        tmax.append(hi)
        tmin.append(lo)
        rh.append(65.0)
        wind.append(2.0)
        rs.append(r)
        precip.append(p)
        et0.append(et0_penman_monteith(hi, lo, 65, 2, r, 45, 200, d + 1))
    return WeatherYear(year, *(tuple(x) for x in (tmax, tmin, rh, wind, rs, precip, et0)))


WEATHER = [synthetic_year(2001 + i) for i in range(5)]
SITE = FieldSite("t", "Тест", 45.0, 10.0, 10.0, sand_pct=35, clay_pct=20, soc_pct=1.2, slope_pct=6)


def run(plan, site=SITE, fert=None):
    return run_rotation(site, rotation_from_plan("r", "r", plan, fert), WEATHER[: len(plan)])


def test_fao56_example_et0() -> None:
    # FAO-56 Example 18 (Brussels, 6 July): ET0 ≈ 3.9 mm/day with RHmax/RHmin; RHmean here.
    v = et0_penman_monteith(21.5, 12.3, 73.5, 2.078, 22.07, 50.8, 100, 187)
    assert 3.6 < v < 4.2


def test_rusle_helpers() -> None:
    assert renard_freimund_r(500) == pytest.approx(0.0483 * 500**1.61)
    assert ls_factor(0, 50) == pytest.approx(0.03)
    assert ls_factor(10, 100) > ls_factor(3, 100)
    assert 0.01 < epic_k_factor(30, 50, 20, 1.0) < 0.07
    assert epic_k_factor(30, 50, 20, 3.0) < epic_k_factor(30, 50, 20, 0.5)


def test_texture_triangle() -> None:
    assert usda_texture(90, 3) == "sand"
    assert usda_texture(40, 20) == "loam"
    assert usda_texture(10, 15) == "silt_loam"
    assert usda_texture(20, 55) == "clay"


def test_crop_table_has_sources_or_estimate_flag() -> None:
    crops = rotation_crops()
    for cid in (
        "wheat",
        "barley",
        "maize",
        "pea",
        "chickpea",
        "alfalfa",
        "soybean",
        "potato",
        "tomato",
        "cotton",
        "sunflower",
        "vetch",
        "clover",
        "rye_cover",
        "mustard",
        "phacelia",
    ):
        c = crops[cid]
        assert c.references or c.estimate
    assert crops["maize"].ky == 1.25  # FAO-33 via FAO-56 Table 24
    assert crops["wheat"].t_opt_max_c == 23  # EcoCrop


def test_legume_before_wheat_gives_more_nitrogen_and_yield() -> None:
    after_pea = run([("pea", None), ("wheat", None)])
    after_wheat = run([("wheat", None), ("wheat", None)])
    w_pea, w_wheat = after_pea.years[1], after_wheat.years[1]
    assert after_pea.years[0].n_fixed_kg_ha > 0
    assert w_pea.factors["nitrogen"] > w_wheat.factors["nitrogen"]
    assert w_pea.yield_t_ha > w_wheat.yield_t_ha


def test_cover_crop_beats_fallow() -> None:
    cover = run([("wheat", "vetch"), ("maize", "rye_cover"), ("wheat", "vetch")])
    bare = run([("wheat", None), ("maize", None), ("wheat", None)])
    assert sum(y.bare_days for y in cover.years) < sum(y.bare_days for y in bare.years)
    assert sum(y.erosion_t_ha for y in cover.years) < sum(y.erosion_t_ha for y in bare.years)
    assert cover.years[-1].soc_pct_end > bare.years[-1].soc_pct_end


def test_nightshade_repeat_raises_pest_pressure_and_warns() -> None:
    after_tomato = run([("tomato", None), ("potato", None)])
    after_wheat = run([("wheat", None), ("potato", None)])
    assert after_tomato.years[1].pest_pressure > after_wheat.years[1].pest_pressure
    assert after_tomato.years[1].factors["pest"] < after_wheat.years[1].factors["pest"]
    codes = {
        v.code
        for v in check_rotation(rotation_from_plan("r", "r", [("tomato", None), ("potato", None)]))
    }
    assert "family_break" in codes
    assert not check_rotation(rotation_from_plan("r", "r", [("wheat", None), ("potato", None)]))


def test_deep_roots_improve_infiltration_and_cut_runoff() -> None:
    deep = run([("sunflower", None), ("wheat", None)])
    shallow = run([("potato", None), ("wheat", None)])
    assert deep.years[0].infiltration_idx > shallow.years[0].infiltration_idx
    assert deep.years[1].runoff_mm < shallow.years[1].runoff_mm


def test_rules_flag_legumes_and_bare_years() -> None:
    v = check_rotation(
        rotation_from_plan("r", "r", [("pea", None), ("soybean", None), (None, None)])
    )
    codes = {x.code for x in v}
    assert {"legume_after_legume", "bare_year"} <= codes
    assert all(x.message_ru for x in v)


def test_alfalfa_may_follow_itself() -> None:
    v = check_rotation(
        rotation_from_plan("r", "r", [("alfalfa", None), ("alfalfa", None), ("wheat", None)])
    )
    assert not [x for x in v if x.code == "family_break" and x.year == 1]


def test_irrigation_respects_the_limit() -> None:
    dry = [synthetic_year(2001, rain_every=30) for _ in range(2)]
    site = FieldSite(
        "t", "Тест", 45.0, 10.0, 10.0, 35, 20, 1.2, irrigated=True, irrigation_limit_mm=150
    )
    r = run_rotation(site, rotation_from_plan("r", "r", [("maize", None), ("maize", None)]), dry)
    assert all(y.irrigation_mm <= 150.0001 for y in r.years)
    rainfed = run_rotation(
        SITE, rotation_from_plan("r", "r", [("maize", None), ("maize", None)]), dry
    )
    assert r.years[0].yield_t_ha > rainfed.years[0].yield_t_ha


def test_deterministic() -> None:
    a = run([("pea", "mustard"), ("wheat", None), ("maize", "vetch")])
    b = run([("pea", "mustard"), ("wheat", None), ("maize", "vetch")])
    assert [y.yield_t_ha for y in a.years] == [y.yield_t_ha for y in b.years]
    assert a.soil_cover == b.soil_cover
