"""Conversions between stored rows, API schemas and the pure simulation inputs."""

from __future__ import annotations

from app.biology.growth import CropParams
from app.models.db import Crop, Planet, Star
from app.models.schemas import AssumptionOut, CustomPlanet, EnvironmentOut
from app.physics.environment import Assumption, BodyInputs, Environment

_ENV_FIELDS = tuple(EnvironmentOut.model_fields)


def body_from_rows(planet: Planet, star: Star) -> BodyInputs:
    return BodyInputs(
        name=planet.name_ru or planet.name,
        teff_k=star.teff_k,
        luminosity_lsun=star.luminosity_lsun,
        star_mass_msun=star.mass_msun,
        mass_earth=planet.mass_earth,
        radius_earth=planet.radius_earth,
        semi_major_axis_au=planet.semi_major_axis_au,
        orbital_period_days=planet.orbital_period_days,
        eccentricity=planet.eccentricity,
        albedo=planet.albedo,
        insolation_earth=planet.insolation_earth,
        day_hours=planet.day_hours,
        surface_temp_k=planet.surface_temp_k,
        diurnal_min_k=planet.diurnal_min_k,
        diurnal_max_k=planet.diurnal_max_k,
        surface_pressure_pa=planet.surface_pressure_pa,
        pco2_pa=planet.pco2_pa,
        po2_pa=planet.po2_pa,
        vis_transmission=planet.vis_transmission,
        has_magnetosphere=planet.has_magnetosphere,
        has_solid_surface=planet.has_solid_surface,
        water=planet.water,
        substrate=planet.substrate,
        soil_ph=planet.soil_ph,
        perchlorate_wt_pct=planet.perchlorate_wt_pct,
        extra_radiation_msv_yr=planet.extra_radiation_msv_yr,
    )


def body_from_custom(custom: CustomPlanet) -> BodyInputs:
    return BodyInputs(**custom.model_dump())


def crop_params(crop: Crop) -> CropParams:
    return CropParams(
        id=crop.id,
        photosynthesis=crop.photosynthesis,
        t_kill_c=crop.t_kill_c,
        t_min_c=crop.t_min_c,
        t_opt_min_c=crop.t_opt_min_c,
        t_opt_max_c=crop.t_opt_max_c,
        t_max_c=crop.t_max_c,
        ph_min=crop.ph_min,
        ph_max=crop.ph_max,
        cycle_days=crop.cycle_days,
        ppfd_comp=crop.ppfd_comp,
        ppfd_sat=crop.ppfd_sat,
        dli_min=crop.dli_min,
        dli_opt=crop.dli_opt,
        o2_min_kpa=crop.o2_min_kpa,
        uv_tolerance_rel=crop.uv_tolerance_rel,
        p_min_kpa=crop.p_min_kpa,
        max_dark_hours=crop.max_dark_hours,
        continuous_light_ok=crop.continuous_light_ok,
        aquatic=crop.aquatic,
    )


def environment_out(env: Environment) -> EnvironmentOut:
    return EnvironmentOut(**{name: getattr(env, name) for name in _ENV_FIELDS})


def assumption_out(note: Assumption) -> AssumptionOut:
    return AssumptionOut(code=note.code, text=note.text_ru, penalty=note.penalty)
