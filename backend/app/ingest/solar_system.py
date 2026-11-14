"""Load the curated Solar System table (NASA fact sheets) from data/seed."""

from __future__ import annotations

from typing import Any

import pint
import polars as pl
from sqlmodel import Session

from app import config
from app.ingest.common import log_ingest, provenance_for
from app.models.db import Planet, Star
from app.physics.climate import M_EARTH_KG, R_EARTH_M, habitable_zone_au

SOURCE = "solar_system"
SUN_ID = "sun"
_ureg = pint.UnitRegistry()
_FLOAT_COLUMNS = [
    "mass_1e24kg",
    "radius_km",
    "semi_major_axis_au",
    "orbital_period_days",
    "eccentricity",
    "albedo",
    "day_hours",
    "surface_temp_k",
    "diurnal_min_k",
    "diurnal_max_k",
    "surface_pressure_pa",
    "pco2_pa",
    "po2_pa",
    "vis_transmission",
    "soil_ph",
    "perchlorate_wt_pct",
    "extra_radiation_msv_yr",
]
_VALUE_FIELDS = [
    "insolation_earth",
    "mass_earth",
    "radius_earth",
    "semi_major_axis_au",
    "orbital_period_days",
    "eccentricity",
    "albedo",
    "day_hours",
    "surface_temp_k",
    "diurnal_min_k",
    "diurnal_max_k",
    "surface_pressure_pa",
    "pco2_pa",
    "po2_pa",
    "vis_transmission",
    "has_magnetosphere",
    "has_solid_surface",
    "water",
    "substrate",
    "soil_ph",
    "perchlorate_wt_pct",
    "extra_radiation_msv_yr",
]


def sun() -> Star:
    return Star(
        id=SUN_ID,
        name="Солнце",
        teff_k=5772.0,
        radius_rsun=1.0,
        mass_msun=1.0,
        luminosity_lsun=1.0,
        spectral_type="G2V",
        distance_pc=0.0,
        source="IAU 2015 Resolution B3 (nominal solar values)",
        source_url="https://www.iau.org/static/resolutions/IAU2015_English.pdf",
        retrieved_at="2026-11-09",
    )


def read_table() -> pl.DataFrame:
    frame = pl.read_csv(config.SEED_DIR / "solar_system.csv", infer_schema_length=0)
    return frame.with_columns(pl.col(_FLOAT_COLUMNS).cast(pl.Float64))


def _row_to_planet(row: dict[str, Any]) -> Planet:
    mass_kg = _ureg.Quantity(row["mass_1e24kg"] * 1e24, "kg").to("kg").magnitude
    radius_m = _ureg.Quantity(row["radius_km"], "km").to("m").magnitude
    estimates = set(filter(None, (row["estimate_fields"] or "").split(";")))
    values: dict[str, Any] = {
        "mass_earth": mass_kg / M_EARTH_KG,
        "radius_earth": radius_m / R_EARTH_M,
        "insolation_earth": 1.0 / row["semi_major_axis_au"] ** 2,
        "has_magnetosphere": row["has_magnetosphere"] == "true",
        "has_solid_surface": row["has_solid_surface"] == "true",
        "water": row["water"],
        "substrate": row["substrate"],
    }
    for name in _VALUE_FIELDS:
        if name not in values:
            values[name] = row[name]
    extra = values.pop("extra_radiation_msv_yr") or 0.0
    inner_au, outer_au = habitable_zone_au(1.0, 5772.0)
    return Planet(
        id=row["id"],
        name=row["name_en"],
        name_ru=row["name_ru"],
        kind="solar_system",
        hypothetical=False,
        star_id=SUN_ID,
        extra_radiation_msv_yr=extra,
        potentially_habitable=row["id"] == "earth",
        in_habitable_zone=inner_au <= row["semi_major_axis_au"] <= outer_au,
        source=row["source"],
        source_url=row["source_url"],
        retrieved_at=row["retrieved_at"],
        provenance=provenance_for(
            _VALUE_FIELDS,
            {**values, "extra_radiation_msv_yr": extra or None},
            row["source"],
            row["source_url"],
            row["retrieved_at"],
            estimates,
        ),
        **values,
    )


def ingest(session: Session) -> tuple[str, int, str | None]:
    session.merge(sun())
    session.commit()
    rows = read_table().to_dicts()
    for row in rows:
        session.merge(_row_to_planet(row))
    session.commit()
    log_ingest(session, SOURCE, "seed", len(rows))
    return "seed", len(rows), None
