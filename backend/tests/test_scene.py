from __future__ import annotations

import pytest
from astropy import units as u
from astropy.coordinates import SkyCoord
from hypothesis import given, settings
from hypothesis import strategies as st

from app.physics.coords import galactic_lb_deg, galactic_xyz_pc
from app.physics.environment import compute_environment
from app.scene import GALAXIES, hypothetical_position_pc, planet_look, star_rgb_hex


def test_galactic_centre_maps_to_l0_b0() -> None:
    # Sgr A*: RA 266.41683, Dec -29.00781 → l ≈ 359.944°, b ≈ -0.046°.
    l_deg, b_deg = galactic_lb_deg(266.41683, -29.00781)
    assert min(l_deg, 360 - l_deg) < 0.1
    assert abs(b_deg) < 0.1


@settings(max_examples=40, deadline=None)
@given(st.floats(0, 360), st.floats(-89, 89))
def test_matches_astropy(ra: float, dec: float) -> None:
    ref = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs").galactic
    l_deg, b_deg = galactic_lb_deg(ra, dec)
    assert b_deg == pytest.approx(ref.b.deg, abs=1e-3)
    if abs(b_deg) < 89.9:
        diff = (l_deg - ref.l.deg + 180) % 360 - 180
        assert abs(diff) < 1e-3


def test_distance_is_preserved() -> None:
    x, y, z = galactic_xyz_pc(10.0, 20.0, 100.0)
    assert (x * x + y * y + z * z) ** 0.5 == pytest.approx(100.0)


def test_star_colours() -> None:
    assert star_rgb_hex(3000).startswith("#ff")  # red dwarf: red channel saturated
    sun = star_rgb_hex(5772)
    assert int(sun[1:3], 16) == 255 and int(sun[5:7], 16) > 200
    hot = star_rgb_hex(15000)
    assert int(hot[5:7], 16) == 255


def test_sky_of_solar_system_bodies(bodies) -> None:
    mars = planet_look(compute_environment(bodies["mars"]), "mars", 1.0, 1.524)
    assert mars.surface_type == "desert" and mars.weather == "dust"
    assert mars.sky_day == "#c9a27a"  # butterscotch day sky
    moon = planet_look(compute_environment(bodies["moon"]), "moon", 1.0, 1.0)
    assert moon.sky_day == "#000000" and moon.atmosphere_glow is None
    earth = planet_look(compute_environment(bodies["earth"]), "earth", 1.0, 1.0)
    assert earth.surface_type == "ocean"
    assert earth.star_angular_diameter_deg == pytest.approx(0.53, abs=0.01)
    jupiter = planet_look(compute_environment(bodies["jupiter"]), "jupiter", 1.0, 5.2)
    assert jupiter.surface_type == "gas"


def test_hypothetical_positions_are_deterministic_and_inside() -> None:
    for galaxy in GALAXIES.values():
        a = hypothetical_position_pc("star-x", galaxy)
        assert a == hypothetical_position_pc("star-x", galaxy)
        assert (a[0] ** 2 + a[1] ** 2) ** 0.5 < galaxy.radius_pc * 2


def test_universe_endpoint(client) -> None:
    data = client.get("/scene/universe").json()
    ids = [g["id"] for g in data["galaxies"]]
    assert ids[:4] == ["milky_way", "lmc", "smc", "m31"]
    m31 = next(g for g in data["galaxies"] if g["id"] == "m31")
    assert m31["confirmed_planets"] == 0 and m31["hypothetical_planets"] > 0
    assert m31["distance_reference"].startswith("doi:")


def test_galaxy_endpoint_has_sun(client) -> None:
    data = client.get("/scene/galaxy/milky_way").json()
    assert data["sun_position_pc"][0] == pytest.approx(-8178.0)
    assert data["stars"][0]["id"] == "sun"
    assert any(s["hypothetical"] for s in data["stars"])
    assert client.get("/scene/galaxy/nowhere").status_code == 404


def test_solar_system_scene_and_verdicts(client) -> None:
    data = client.get("/scene/system/sun").json()
    names = [p["id"] for p in data["planets"]]
    assert names[:4] == ["mercury", "venus", "earth", "mars"]
    moon = next(p for p in data["planets"] if p["id"] == "moon")
    assert moon["parent_id"] == "earth"
    earth = next(p for p in data["planets"] if p["id"] == "earth")
    assert earth["verdict"]["best_scenario"] == "open_surface"
    mars = next(p for p in data["planets"] if p["id"] == "mars")
    assert mars["verdict"]["best_scenario"] in ("greenhouse", "closed_farm")
    open_mars = next(s for s in mars["verdict"]["scenarios"] if s["scenario"] == "open_surface")
    assert open_mars["yield_rel"] == 0.0
    lo, hi = data["habitable_zone_au"]
    assert lo < 1.0 < hi


def test_planet_scene_mars(client) -> None:
    data = client.get("/scene/planet/mars").json()
    assert data["day_unit_ru"] == "сол"
    assert data["galaxy_id"] == "milky_way"
    assert data["day_hours"] == pytest.approx(24.7, abs=0.1)
    hyp = client.get("/scene/planet/hyp-dwarf-42-001").json()
    assert hyp["galaxy_id"] == "dwarf" and hyp["hypothetical"]


def test_red_dwarf_sky_is_burgundy(bodies) -> None:
    from dataclasses import replace

    env = compute_environment(replace(bodies["earth"], teff_k=2600.0, luminosity_lsun=0.0005))
    look = planet_look(env, "x", 0.12, 0.03)
    r, g, b = (int(look.sky_day[i : i + 2], 16) for i in (1, 3, 5))
    assert r > b and r > g
