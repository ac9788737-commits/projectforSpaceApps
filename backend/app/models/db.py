"""Database tables. Physical quantities carry explicit units in their field names."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(UTC)


class Star(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    teff_k: float | None = None
    radius_rsun: float | None = None
    mass_msun: float | None = None
    luminosity_lsun: float | None = None
    spectral_type: str | None = None
    distance_pc: float | None = None
    ra_deg: float | None = None
    dec_deg: float | None = None
    coords_source: str | None = None  # where ra/dec came from
    source: str
    source_url: str
    retrieved_at: str


class Planet(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    name_ru: str | None = None
    kind: str = Field(index=True)  # solar_system | exoplanet | hypothetical
    hypothetical: bool = False
    galaxy_preset: str | None = None
    star_id: str = Field(foreign_key="star.id", index=True)
    mass_earth: float | None = None
    radius_earth: float | None = None
    semi_major_axis_au: float | None = None
    orbital_period_days: float | None = None
    eccentricity: float | None = None
    albedo: float | None = None
    insolation_earth: float | None = None
    eq_temp_k: float | None = None
    day_hours: float | None = None
    surface_temp_k: float | None = None
    diurnal_min_k: float | None = None
    diurnal_max_k: float | None = None
    surface_pressure_pa: float | None = None
    pco2_pa: float | None = None
    po2_pa: float | None = None
    vis_transmission: float | None = None
    has_magnetosphere: bool | None = None
    has_solid_surface: bool | None = None
    water: str = "unknown"
    substrate: str = "unknown"
    soil_ph: float | None = None
    perchlorate_wt_pct: float | None = None
    extra_radiation_msv_yr: float = 0.0
    potentially_habitable: bool = Field(default=False, index=True)
    in_habitable_zone: bool | None = None
    source: str
    source_url: str
    retrieved_at: str
    provenance: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))


class Crop(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name_ru: str
    name_en: str
    group: str
    photosynthesis: str
    t_kill_c: float
    t_min_c: float
    t_opt_min_c: float
    t_opt_max_c: float
    t_max_c: float
    ph_min: float
    ph_max: float
    cycle_days: float
    ppfd_comp: float
    ppfd_sat: float
    dli_min: float
    dli_opt: float
    o2_min_kpa: float
    uv_tolerance_rel: float
    p_min_kpa: float
    max_dark_hours: float
    continuous_light_ok: bool
    aquatic: bool
    yield_kg_m2_cycle: float | None = None
    estimate: bool = True
    reference: str | None = None
    notes: str | None = None
    source: str
    source_url: str
    retrieved_at: str
    provenance: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))


class IngestLog(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    source: str = Field(index=True)
    status: str  # ok | cached | seed | failed
    rows: int = 0
    message: str | None = None
    finished_at: datetime = Field(default_factory=utcnow)
