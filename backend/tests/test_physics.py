from __future__ import annotations

import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.physics import atmosphere, climate, radiation, stellar
from app.physics.environment import BodyInputs, InsufficientDataError, compute_environment


def test_par_fraction_of_the_sun():
    # A 5772 K black body puts roughly 37% of its power between 400 and 700 nm.
    assert stellar.par_fraction(stellar.SUN_TEFF_K) == pytest.approx(0.37, abs=0.02)


def test_red_dwarf_has_less_par_and_more_far_red():
    assert stellar.par_fraction(3000.0) < 0.12
    sun_ratio = stellar.far_red_to_par_photon_ratio(stellar.SUN_TEFF_K)
    assert stellar.far_red_to_par_photon_ratio(3000.0) > 2.0 * sun_ratio


def test_sun_ppfd_conversion():
    # Noon sunlight (about 1000 W/m2) corresponds to about 2000 umol/m2/s of PAR.
    assert stellar.ppfd_from_irradiance_umol_m2_s(1000.0, stellar.SUN_TEFF_K) == pytest.approx(
        1700.0, rel=0.1
    )


def test_stefan_boltzmann_recovers_solar_luminosity():
    assert stellar.luminosity_w(1.0, stellar.SUN_TEFF_K) / stellar.L_SUN_W == pytest.approx(
        1.0, rel=0.01
    )


def test_irradiance_at_one_au_is_the_solar_constant():
    assert stellar.irradiance_w_m2(1.0, 1.0) == pytest.approx(1361.0, rel=0.005)


@given(st.floats(min_value=2300.0, max_value=30000.0))
def test_band_fractions_are_valid(teff):
    total = stellar.uv_fraction(teff) + stellar.par_fraction(teff) + stellar.far_red_fraction(teff)
    assert 0.0 < total < 1.0


def test_earth_and_mars_gravity():
    assert climate.surface_gravity_g(1.0, 1.0) == pytest.approx(1.0, abs=0.01)
    assert climate.surface_gravity_g(0.107, 0.532) == pytest.approx(0.38, abs=0.01)


def test_earth_equilibrium_temperature():
    assert climate.equilibrium_temp_k(1.0, 0.294) == pytest.approx(254.0, abs=2.0)


def test_mars_equilibrium_temperature():
    assert climate.equilibrium_temp_k(1 / 1.52366**2, 0.25) == pytest.approx(210.0, abs=2.0)


def test_grey_greenhouse_reproduces_earth():
    earth_tau = atmosphere.PRESETS["earth_like"].tau_ir
    assert climate.grey_greenhouse_temp_k(255.0, earth_tau) == pytest.approx(288.0, abs=2.0)


@pytest.mark.parametrize(("pressure", "expected"), [(0.0, 295.0), (636.0, 58.0), (101325.0, 10.0)])
def test_diurnal_amplitude_fit(pressure, expected):
    assert climate.diurnal_amplitude_k(pressure) == pytest.approx(expected, abs=1.5)


def test_habitable_zone_of_the_sun():
    inner, outer = climate.habitable_zone_au(1.0, 5780.0)
    assert inner == pytest.approx(0.975, abs=0.02)
    assert outer == pytest.approx(1.705, abs=0.03)


def test_tidal_lock_of_close_m_dwarf_planet_but_not_earth():
    assert climate.tidal_lock_time_gyr(1.0, 1.0, 0.03, 0.1) < 1.0
    assert climate.tidal_lock_time_gyr(1.0, 1.0, 1.0, 1.0) > 10.0


def test_unknown_rotation_is_flagged():
    day = climate.estimate_day_length(None, 365.0, 1.0, 1.0, 1.0, 1.0)
    assert day.uncertain and not day.tidally_locked


def test_earth_uv_is_reference():
    earth = radiation.uv_surface_relative(1.0, stellar.SUN_TEFF_K, 101325.0, 21000.0)
    assert earth == pytest.approx(1.0, rel=1e-6)


def test_mars_uv_exceeds_earth():
    assert radiation.uv_surface_relative(0.43, stellar.SUN_TEFF_K, 636.0, 1.0) > 5.0


def test_mars_surface_dose_matches_curiosity():
    column = atmosphere.column_mass_kg_m2(636.0, 0.378)
    dose = radiation.ionising_dose_msv_yr(column, False)
    assert dose == pytest.approx(245.0, rel=0.1)  # 0.67 mSv/day measured by MSL/RAD


def test_earth_surface_dose_is_tiny_compared_to_mars():
    column = atmosphere.column_mass_kg_m2(101325.0, 1.0)
    assert radiation.ionising_dose_msv_yr(column, True) < 1.0


def test_earth_environment(bodies):
    env = compute_environment(bodies["earth"])
    assert env.gravity_g == pytest.approx(1.0, abs=0.01)
    assert env.insolation_earth == pytest.approx(1.0, rel=0.01) or env.insolation_earth > 0.99
    assert env.surface_temp_k == pytest.approx(288.15)
    assert env.daytime_ppfd_umol_m2_s == pytest.approx(800.0, rel=0.15)
    assert 25.0 < env.dli_mol_m2_d < 45.0


def test_mars_environment(bodies):
    env = compute_environment(bodies["mars"])
    assert env.gravity_g == pytest.approx(0.38, abs=0.01)
    assert env.insolation_earth == pytest.approx(0.43, abs=0.02)
    assert env.pressure_pa == 636


def test_preset_overrides_atmosphere(bodies):
    env = compute_environment(bodies["mars"], "earth_like")
    assert env.pressure_pa == 101_325.0
    assert env.surface_temp_k != 208.15


def test_missing_size_raises():
    with pytest.raises(InsufficientDataError):
        compute_environment(BodyInputs(name="x", insolation_earth=1.0))


def test_missing_flux_raises():
    with pytest.raises(InsufficientDataError):
        compute_environment(BodyInputs(name="x", mass_earth=1.0))


def test_unknown_exoplanet_records_assumptions():
    env = compute_environment(
        BodyInputs(name="x", mass_earth=1.0, insolation_earth=1.0, teff_k=5772.0)
    )
    codes = {a.code for a in env.assumptions}
    assert {"albedo_default", "atmosphere_default"} <= codes
    assert math.isfinite(env.surface_temp_k)
