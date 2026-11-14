"""Soil response: substrate type, pH, salinity, nutrients and perchlorates. Pure."""

from __future__ import annotations

from app.biology import responses as r
from app.biology.growth import CropParams
from app.sim.data import soil_types

NUTRIENT_FACTOR = {"low": 0.75, "norm": 1.0, "high": 1.0}


def salinity_response(ec_ds_m: float) -> float:
    """Yield decline with soil salinity: none up to 4 dS/m, 30 % left at 16 dS/m (estimate)."""
    if ec_ds_m <= 4.0:
        return 1.0
    return max(0.0, 1.0 - 0.7 * (ec_ds_m - 4.0) / 12.0)


def soil_response(
    soil: str,
    ph: float | None,
    nutrients: str,
    salinity: float,
    perchlorate: float,
    crop: CropParams,
) -> float:
    if crop.aquatic:
        return 1.0
    base = soil_types()[soil].soil_factor if soil in soil_types() else 0.5
    ph_f = r.ph_response(ph, crop.ph_min, crop.ph_max) if ph is not None else 1.0
    return (
        base
        * ph_f
        * NUTRIENT_FACTOR.get(nutrients, 1.0)
        * salinity_response(salinity)
        * r.perchlorate_response(perchlorate)
    )
