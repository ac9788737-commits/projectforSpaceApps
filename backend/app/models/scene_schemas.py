"""Schemas of the /scene endpoints used by the 3D views."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

GalaxyShape = Literal["spiral", "irregular", "elliptical", "dwarf", "starburst"]


class GalaxyOut(BaseModel):
    id: str
    name_ru: str
    real: bool
    shape: GalaxyShape
    description_ru: str
    distance_kpc: float | None
    distance_reference: str | None
    radius_pc: float
    arms: int
    confirmed_planets: int
    hypothetical_planets: int
    preset: str
    visual_estimate: bool = True


class UniverseOut(BaseModel):
    galaxies: list[GalaxyOut]
    note_ru: str


class GalaxyStarOut(BaseModel):
    id: str
    name: str
    x_pc: float
    y_pc: float
    z_pc: float
    distance_pc: float | None
    teff_k: float | None
    star_class: str | None
    planets: int
    habitable: bool
    hypothetical: bool
    coords_source: str | None


class GalaxySceneOut(BaseModel):
    galaxy: GalaxyOut
    sun_position_pc: tuple[float, float, float] | None
    stars: list[GalaxyStarOut]
    stars_without_coordinates: int
    note_ru: str


class VerdictScenarioOut(BaseModel):
    scenario: Literal["open_surface", "greenhouse", "closed_farm"]
    best_crop_id: str | None
    best_crop_name: str | None
    yield_rel: float
    survival: bool
    feasible: bool


class VerdictOut(BaseModel):
    headline_ru: str
    best_scenario: Literal["open_surface", "greenhouse", "closed_farm"] | None
    scenarios: list[VerdictScenarioOut]


class SystemPlanetOut(BaseModel):
    id: str
    name: str
    kind: str
    hypothetical: bool
    parent_id: str | None
    moon_orbit_km: float | None
    semi_major_axis_au: float | None
    orbital_period_days: float | None
    eccentricity: float | None
    radius_earth: float | None
    mass_earth: float | None
    gravity_g: float | None
    surface_temp_k: float | None
    insolation_earth: float | None
    in_habitable_zone: bool | None
    potentially_habitable: bool
    palette: list[str]
    surface_type: str | None
    verdict: VerdictOut | None
    error: str | None = None


class SystemStarOut(BaseModel):
    id: str
    name: str
    teff_k: float | None
    radius_rsun: float | None
    luminosity_lsun: float | None
    spectral_type: str | None
    distance_pc: float | None
    color: str


class SystemSceneOut(BaseModel):
    star: SystemStarOut
    galaxy_id: str
    planets: list[SystemPlanetOut]
    habitable_zone_au: tuple[float, float] | None
    note_ru: str


class PlanetSceneOut(BaseModel):
    id: str
    name: str
    star_id: str
    galaxy_id: str
    hypothetical: bool
    kind: str
    surface_type: str
    palette: list[str]
    sky_day: str
    sky_horizon: str
    sky_sunset: str
    atmosphere_glow: str | None
    ground: str
    weather: Literal["none", "dust", "snow", "haze"]
    star_color: str
    star_teff_k: float
    star_angular_diameter_deg: float | None
    sun_intensity_rel: float
    day_hours: float | None
    tidally_locked: bool
    surface_temp_k: float
    gravity_g: float
    pressure_pa: float
    has_solid_surface: bool
    radius_earth: float | None
    day_unit_ru: str
    visual_estimate: bool = True
