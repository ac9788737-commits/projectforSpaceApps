"""Planet catalogue, details and hypothetical planet generation."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlmodel import Session, select

from app.convert import assumption_out, body_from_rows, environment_out
from app.database import get_session
from app.ingest import galaxies
from app.models.db import Planet, Star
from app.models.schemas import (
    AtmospherePresetOut,
    GalaxyPresetOut,
    GenerateRequest,
    PlanetDetail,
    PlanetPage,
    PlanetSummary,
    SpectrumPoint,
    StarOut,
)
from app.physics import atmosphere, climate, stellar
from app.physics.environment import InsufficientDataError, compute_environment

router = APIRouter(tags=["planets"])
SessionDep = Annotated[Session, Depends(get_session)]

_HOME_GALAXY = "milky_way"
_STAR_CLASS_TEFF: dict[str, tuple[float, float]] = {
    "O": (30000.0, 1e9),
    "B": (10000.0, 30000.0),
    "A": (7500.0, 10000.0),
    "F": (6000.0, 7500.0),
    "G": (5200.0, 6000.0),
    "K": (3700.0, 5200.0),
    "M": (0.0, 3700.0),
}


def star_class(teff_k: float | None) -> str | None:
    if teff_k is None:
        return None
    for letter, (low, high) in _STAR_CLASS_TEFF.items():
        if low <= teff_k < high:
            return letter
    return None


def _summary(planet: Planet, star: Star) -> PlanetSummary:
    data = PlanetSummary.model_validate(planet)
    data.star_teff_k = star.teff_k
    data.star_type = star_class(star.teff_k)
    if data.insolation_earth is None and star.luminosity_lsun and planet.semi_major_axis_au:
        data.insolation_earth = climate.stellar_flux_earth_units(
            star.luminosity_lsun, planet.semi_major_axis_au
        )
    return data


@router.get("/planets", response_model=PlanetPage)
def list_planets(
    session: SessionDep,
    habitable: bool | None = None,
    in_habitable_zone: bool | None = None,
    star_type: Annotated[str | None, Query(pattern="^[OBAFGKMobafgkm]$")] = None,
    kind: Annotated[str | None, Query(pattern="^(solar_system|exoplanet|hypothetical)$")] = None,
    galaxy: str | None = None,
    scope: Annotated[str | None, Query(pattern="^(real|hypothetical|other_galaxies)$")] = None,
    q: str | None = None,
    min_insolation: float | None = None,
    max_insolation: float | None = None,
    min_mass: float | None = None,
    max_mass: float | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PlanetPage:
    query = select(Planet, Star).join(Star, Planet.star_id == Star.id)  # type: ignore[arg-type]
    if habitable is not None:
        query = query.where(Planet.potentially_habitable == habitable)
    if in_habitable_zone is not None:
        query = query.where(Planet.in_habitable_zone == in_habitable_zone)
    if kind:
        query = query.where(Planet.kind == kind)
    if galaxy:
        query = query.where(Planet.galaxy_preset == galaxy)
    if scope == "real":
        query = query.where(Planet.hypothetical == False)  # noqa: E712
    elif scope == "hypothetical":
        query = query.where(Planet.galaxy_preset == _HOME_GALAXY)
    elif scope == "other_galaxies":
        query = query.where(Planet.hypothetical == True, Planet.galaxy_preset != _HOME_GALAXY)  # noqa: E712
    if star_type:
        low, high = _STAR_CLASS_TEFF[star_type.upper()]
        query = query.where(Star.teff_k >= low, Star.teff_k < high)  # type: ignore[operator]
    if q:
        pattern = f"%{q.lower()}%"
        query = query.where(
            or_(
                func.lower(Planet.name).like(pattern),
                func.lower(func.coalesce(Planet.name_ru, "")).like(pattern),
                Planet.name_ru.like(f"%{q}%"),  # type: ignore[union-attr]
                Planet.name_ru.like(f"%{q.capitalize()}%"),  # type: ignore[union-attr]
            )
        )
    if min_insolation is not None:
        query = query.where(Planet.insolation_earth >= min_insolation)  # type: ignore[operator]
    if max_insolation is not None:
        query = query.where(Planet.insolation_earth <= max_insolation)  # type: ignore[operator]
    if min_mass is not None:
        query = query.where(Planet.mass_earth >= min_mass)  # type: ignore[operator]
    if max_mass is not None:
        query = query.where(Planet.mass_earth <= max_mass)  # type: ignore[operator]

    total = session.exec(select(func.count()).select_from(query.subquery())).one()
    ordered = query.order_by(Planet.kind.desc(), Planet.id).offset(offset).limit(limit)  # type: ignore[attr-defined]
    rows = session.exec(ordered).all()
    return PlanetPage(total=total, items=[_summary(p, s) for p, s in rows])


@router.get("/planets/{planet_id}", response_model=PlanetDetail)
def get_planet(planet_id: str, session: SessionDep) -> PlanetDetail:
    planet = session.get(Planet, planet_id)
    if planet is None:
        raise HTTPException(404, "Планета не найдена")
    star = session.get(Star, planet.star_id)
    assert star is not None

    environment = None
    assumptions: list[Any] = []
    error = None
    try:
        computed = compute_environment(body_from_rows(planet, star))
        environment = environment_out(computed)
        assumptions = [assumption_out(a) for a in computed.assumptions]
    except InsufficientDataError as exc:
        error = str(exc)

    teff = star.teff_k or stellar.SUN_TEFF_K
    star_curve = stellar.spectrum_curve(teff)
    sun_curve = stellar.spectrum_curve(stellar.SUN_TEFF_K)
    spectrum = [
        SpectrumPoint(wavelength_nm=w, star=value, sun=sun_value)
        for (w, value), (_, sun_value) in zip(star_curve, sun_curve, strict=True)
    ]
    zone = None
    if star.luminosity_lsun and star.teff_k:
        zone = climate.habitable_zone_au(star.luminosity_lsun, star.teff_k)
    return PlanetDetail(
        planet=planet.model_dump(),
        star=StarOut.model_validate(star),
        environment=environment,
        environment_error=error,
        assumptions=assumptions,
        spectrum=spectrum,
        habitable_zone_au=zone,
    )


@router.get("/atmosphere-presets", response_model=list[AtmospherePresetOut])
def atmosphere_presets() -> list[AtmospherePresetOut]:
    return [
        AtmospherePresetOut(
            id=p.id,
            label=p.label_ru,
            pressure_pa=p.pressure_pa,
            pco2_pa=p.pco2_pa,
            po2_pa=p.po2_pa,
            tau_ir=p.tau_ir,
            vis_transmission=p.vis_transmission,
        )
        for p in atmosphere.PRESETS.values()
    ]


@router.get("/galaxies", response_model=list[GalaxyPresetOut])
def galaxy_presets() -> list[GalaxyPresetOut]:
    return [
        GalaxyPresetOut(
            id=p.id,
            name_ru=p.name_ru,
            description_ru=p.description_ru,
            metallicity_feh=p.metallicity_feh,
            cosmic_ray_factor=p.cosmic_ray_factor,
            supernova_rate_factor=p.supernova_rate_factor,
            spectral_mix=p.spectral_mix,
            estimate=p.estimate,
        )
        for p in galaxies.PRESETS.values()
    ]


@router.post("/galaxies/generate", response_model=list[PlanetSummary])
def generate_planets(request: GenerateRequest, session: SessionDep) -> list[PlanetSummary]:
    if request.galaxy_preset not in galaxies.PRESETS:
        raise HTTPException(404, "Пресет галактики не найден")
    generated = galaxies.generate(request.galaxy_preset, request.count, request.seed)
    galaxies.persist(session, generated)
    ids = [planet.id for _, planet in generated]
    query = select(Planet, Star).join(Star, Planet.star_id == Star.id).where(Planet.id.in_(ids))  # type: ignore[arg-type, attr-defined]
    return [_summary(p, s) for p, s in session.exec(query).all()]
