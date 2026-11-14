"""Scene endpoints feeding the interactive 3D views."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlmodel import Session, col, select

from app.api.planets import star_class
from app.convert import body_from_rows, crop_params
from app.database import get_session
from app.ingest import galaxies as galaxy_presets
from app.models.db import Crop, Planet, Star
from app.models.scene_schemas import (
    GalaxyOut,
    GalaxySceneOut,
    GalaxyStarOut,
    PlanetSceneOut,
    SystemPlanetOut,
    SystemSceneOut,
    SystemStarOut,
    UniverseOut,
    VerdictOut,
    VerdictScenarioOut,
)
from app.physics.climate import habitable_zone_au
from app.physics.coords import galactic_xyz_pc
from app.physics.environment import InsufficientDataError, compute_environment
from app.scene import (
    GALAXIES,
    MOON_PARENTS,
    SUN_GALACTOCENTRIC_PC,
    GalaxyDef,
    galaxy_of_planet,
    hypothetical_position_pc,
    hypothetical_prefix,
    planet_look,
    star_rgb_hex,
)
from app.simulate import simulate

router = APIRouter(prefix="/scene", tags=["scene"])
SessionDep = Annotated[Session, Depends(get_session)]
SCENARIOS = ("open_surface", "greenhouse", "closed_farm")
VIABLE_YIELD = 0.3
_SCENARIO_RU = {
    "open_surface": "в открытом грунте",
    "greenhouse": "под куполом",
    "closed_farm": "в закрытой ферме",
}
_verdict_cache: dict[str, VerdictOut] = {}


def clear_caches() -> None:
    _verdict_cache.clear()


def _ensure_hypothetical(session: Session, galaxy: GalaxyDef) -> None:
    prefix = hypothetical_prefix(galaxy)
    exists = session.exec(
        select(Planet.id).where(col(Planet.id).startswith(prefix)).limit(1)
    ).first()
    if exists is None:
        generated = galaxy_presets.generate(
            galaxy.preset, galaxy_presets.BOOTSTRAP_COUNT, galaxy.seed
        )
        galaxy_presets.persist(session, generated)


def _galaxy_out(session: Session, galaxy: GalaxyDef) -> GalaxyOut:
    confirmed = 0
    if galaxy.id == "milky_way":
        confirmed = session.exec(
            select(func.count()).select_from(Planet).where(Planet.kind == "exoplanet")
        ).one()
    hypothetical = session.exec(
        select(func.count())
        .select_from(Planet)
        .where(col(Planet.id).startswith(hypothetical_prefix(galaxy)))
    ).one()
    return GalaxyOut(
        id=galaxy.id,
        name_ru=galaxy.name_ru,
        real=galaxy.real,
        shape=galaxy.shape,  # type: ignore[arg-type]
        description_ru=galaxy.description_ru,
        distance_kpc=galaxy.distance_kpc,
        distance_reference=galaxy.distance_reference,
        radius_pc=galaxy.radius_pc,
        arms=galaxy.arms,
        confirmed_planets=confirmed,
        hypothetical_planets=hypothetical,
        preset=galaxy.preset,
    )


@router.get("/universe", response_model=UniverseOut)
def universe(session: SessionDep) -> UniverseOut:
    for galaxy in GALAXIES.values():
        _ensure_hypothetical(session, galaxy)
    return UniverseOut(
        galaxies=[_galaxy_out(session, g) for g in GALAXIES.values()],
        note_ru=(
            "Расположение галактик схематичное, не в масштабе. Форма и размеры — визуальная "
            "модель; расстояния до реальных галактик — измеренные."
        ),
    )


@router.get("/galaxy/{galaxy_id}", response_model=GalaxySceneOut)
def galaxy_scene(galaxy_id: str, session: SessionDep) -> GalaxySceneOut:
    galaxy = GALAXIES.get(galaxy_id)
    if galaxy is None:
        raise HTTPException(404, f"Галактика не найдена: {galaxy_id}")
    _ensure_hypothetical(session, galaxy)
    stars: list[GalaxyStarOut] = []
    missing = 0
    sun_position: tuple[float, float, float] | None = None

    if galaxy.id == "milky_way":
        sun_position = (-SUN_GALACTOCENTRIC_PC, 0.0, 0.0)
        sun = session.get(Star, "sun")
        if sun is not None:
            stars.append(
                GalaxyStarOut(
                    id="sun",
                    name="Солнце",
                    x_pc=sun_position[0],
                    y_pc=0.0,
                    z_pc=0.0,
                    distance_pc=0.0,
                    teff_k=sun.teff_k,
                    star_class="G",
                    planets=12,
                    habitable=True,
                    hypothetical=False,
                    coords_source=None,
                )
            )
        rows = session.exec(
            select(
                Star,
                func.count(col(Planet.id)),
                func.max(col(Planet.potentially_habitable)),
                func.max(col(Planet.in_habitable_zone)),
            )
            .join(Planet, col(Planet.star_id) == col(Star.id))
            .where(Planet.kind == "exoplanet")
            .group_by(col(Star.id))
        ).all()
        for star, count, phl, hz in rows:
            if star.ra_deg is None or star.dec_deg is None or star.distance_pc is None:
                missing += 1
                continue
            x, y, z = galactic_xyz_pc(star.ra_deg, star.dec_deg, star.distance_pc)
            stars.append(
                GalaxyStarOut(
                    id=star.id,
                    name=star.name,
                    x_pc=x - SUN_GALACTOCENTRIC_PC,
                    y_pc=y,
                    z_pc=z,
                    distance_pc=star.distance_pc,
                    teff_k=star.teff_k,
                    star_class=star_class(star.teff_k),
                    planets=int(count),
                    habitable=bool(phl) or bool(hz),
                    hypothetical=False,
                    coords_source=star.coords_source,
                )
            )

    hyp = session.exec(
        select(Planet, Star)
        .join(Star, col(Planet.star_id) == col(Star.id))
        .where(col(Planet.id).startswith(hypothetical_prefix(galaxy)))
    ).all()
    for planet, star in hyp:
        x, y, z = hypothetical_position_pc(star.id, galaxy)
        stars.append(
            GalaxyStarOut(
                id=star.id,
                name=star.name,
                x_pc=x,
                y_pc=y,
                z_pc=z,
                distance_pc=None,
                teff_k=star.teff_k,
                star_class=star_class(star.teff_k),
                planets=1,
                habitable=bool(planet.in_habitable_zone),
                hypothetical=True,
                coords_source=None,
            )
        )
    note = (
        "Реальные звёзды — по координатам и расстояниям каталогов; гипотетические системы "
        "размещены условно. Форма галактики — визуальная модель."
    )
    return GalaxySceneOut(
        galaxy=_galaxy_out(session, galaxy),
        sun_position_pc=sun_position,
        stars=stars,
        stars_without_coordinates=missing,
        note_ru=note,
    )


def _verdict(session: Session, planet: Planet, star: Star) -> VerdictOut:
    cached = _verdict_cache.get(planet.id)
    if cached is not None:
        return cached
    body = body_from_rows(planet, star)
    crops = session.exec(select(Crop)).all()
    scenarios: list[VerdictScenarioOut] = []
    for scenario in SCENARIOS:
        best: tuple[float, Crop | None, bool, bool] = (0.0, None, False, True)
        for crop in crops:
            result = simulate(
                body,
                crop_params(crop),
                scenario,  # type: ignore[arg-type]
                crop_is_estimate=crop.estimate,
                yield_kg_m2_cycle=crop.yield_kg_m2_cycle,
            )
            feasible = result.outcome.engineering.get("feasible") is not False
            if best[1] is None or result.growth.yield_rel > best[0]:
                best = (result.growth.yield_rel, crop, result.growth.survival, feasible)
        scenarios.append(
            VerdictScenarioOut(
                scenario=scenario,  # type: ignore[arg-type]
                best_crop_id=best[1].id if best[1] else None,
                best_crop_name=best[1].name_ru if best[1] else None,
                yield_rel=best[0],
                survival=best[2],
                feasible=best[3],
            )
        )
    viable = [s for s in scenarios if s.feasible and s.yield_rel >= VIABLE_YIELD]
    if viable:
        top = viable[0]
        prefix = "Да" if top.scenario == "open_surface" else "Да, но только"
        headline = (
            f"{prefix} {_SCENARIO_RU[top.scenario]}: {top.best_crop_name} — "
            f"{top.yield_rel:.0%} от земного урожая."
        )
        best_scenario = top.scenario
    elif any(s.survival and s.feasible for s in scenarios):
        top = max((s for s in scenarios if s.survival and s.feasible), key=lambda s: s.yield_rel)
        headline = (
            f"С трудом: лучший вариант {_SCENARIO_RU[top.scenario]} — {top.best_crop_name}, "
            f"{top.yield_rel:.0%}."
        )
        best_scenario = top.scenario
    else:
        headline = "Нет: ни одна культура не выживает даже в закрытой ферме."
        best_scenario = None
    verdict = VerdictOut(headline_ru=headline, best_scenario=best_scenario, scenarios=scenarios)
    _verdict_cache[planet.id] = verdict
    return verdict


def _system_planet(session: Session, planet: Planet, star: Star) -> SystemPlanetOut:
    parent = MOON_PARENTS.get(planet.id)
    error = None
    verdict = None
    gravity = temp = None
    look = None
    try:
        env = compute_environment(body_from_rows(planet, star))
        gravity, temp = env.gravity_g, env.surface_temp_k
        look = planet_look(env, planet.id, star.radius_rsun, planet.semi_major_axis_au)
        verdict = _verdict(session, planet, star)
    except InsufficientDataError as exc:
        error = str(exc)
    return SystemPlanetOut(
        id=planet.id,
        name=planet.name_ru or planet.name,
        kind=planet.kind,
        hypothetical=planet.hypothetical,
        parent_id=parent[0] if parent else None,
        moon_orbit_km=parent[1] if parent else None,
        semi_major_axis_au=planet.semi_major_axis_au,
        orbital_period_days=planet.orbital_period_days,
        eccentricity=planet.eccentricity,
        radius_earth=planet.radius_earth,
        mass_earth=planet.mass_earth,
        gravity_g=gravity,
        surface_temp_k=temp,
        insolation_earth=planet.insolation_earth,
        in_habitable_zone=planet.in_habitable_zone,
        potentially_habitable=planet.potentially_habitable,
        palette=list(look.palette) if look else ["#888888"],
        surface_type=look.surface_type if look else None,
        verdict=verdict,
        error=error,
    )


@router.get("/system/{star_id}", response_model=SystemSceneOut)
def system_scene(star_id: str, session: SessionDep) -> SystemSceneOut:
    star = session.get(Star, star_id)
    if star is None:
        raise HTTPException(404, f"Звезда не найдена: {star_id}")
    planets = session.exec(select(Planet).where(Planet.star_id == star_id)).all()
    if not planets:
        raise HTTPException(404, f"У звезды нет планет в базе: {star_id}")
    ordered = sorted(
        planets,
        key=lambda p: (p.id in MOON_PARENTS, p.semi_major_axis_au or 0.0, p.id),
    )
    hz = None
    if star.luminosity_lsun and star.teff_k:
        hz = habitable_zone_au(star.luminosity_lsun, star.teff_k)
    first = ordered[0]
    return SystemSceneOut(
        star=SystemStarOut(
            id=star.id,
            name="Солнце" if star.id == "sun" else star.name,
            teff_k=star.teff_k,
            radius_rsun=star.radius_rsun,
            luminosity_lsun=star.luminosity_lsun,
            spectral_type=star.spectral_type,
            distance_pc=star.distance_pc,
            color=star_rgb_hex(star.teff_k or 5772.0),
        ),
        galaxy_id=galaxy_of_planet(first.id, first.kind),
        planets=[_system_planet(session, p, star) for p in ordered],
        habitable_zone_au=hz,
        note_ru=(
            "Расстояния и размеры сжаты для обзора; порядок планет и соотношение размеров "
            "сохранены. Включите «реальный масштаб», чтобы увидеть настоящие пропорции."
        ),
    )


@router.get("/planet/{planet_id}", response_model=PlanetSceneOut)
def planet_scene(planet_id: str, session: SessionDep) -> PlanetSceneOut:
    planet = session.get(Planet, planet_id)
    if planet is None:
        raise HTTPException(404, f"Планета не найдена: {planet_id}")
    star = session.get(Star, planet.star_id)
    assert star is not None
    try:
        env = compute_environment(body_from_rows(planet, star))
    except InsufficientDataError as exc:
        raise HTTPException(422, str(exc)) from exc
    look = planet_look(env, planet.id, star.radius_rsun, planet.semi_major_axis_au)
    return PlanetSceneOut(
        id=planet.id,
        name=planet.name_ru or planet.name,
        star_id=star.id,
        galaxy_id=galaxy_of_planet(planet.id, planet.kind),
        hypothetical=planet.hypothetical,
        kind=planet.kind,
        surface_type=look.surface_type,
        palette=list(look.palette),
        sky_day=look.sky_day,
        sky_horizon=look.sky_horizon,
        sky_sunset=look.sky_sunset,
        atmosphere_glow=look.atmosphere_glow,
        ground=look.ground,
        weather=look.weather,  # type: ignore[arg-type]
        star_color=look.star_color,
        star_teff_k=env.teff_k,
        star_angular_diameter_deg=look.star_angular_diameter_deg,
        sun_intensity_rel=look.sun_intensity_rel,
        day_hours=env.day_hours,
        tidally_locked=env.tidally_locked,
        surface_temp_k=env.surface_temp_k,
        gravity_g=env.gravity_g,
        pressure_pa=env.pressure_pa,
        has_solid_surface=env.has_solid_surface,
        radius_earth=planet.radius_earth,
        day_unit_ru="сол" if planet.id == "mars" else "сутки",
    )
