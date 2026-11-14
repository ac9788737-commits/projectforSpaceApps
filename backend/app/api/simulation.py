"""Crops, simulation, comparison and admin ingestion endpoints."""

from __future__ import annotations

import hashlib
import hmac
from collections import OrderedDict
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlmodel import Session, select

from app import config
from app.api import scene
from app.convert import (
    assumption_out,
    body_from_custom,
    body_from_rows,
    crop_params,
    environment_out,
)
from app.database import get_session
from app.ingest import LOADERS
from app.ingest.morphology import load_morphology
from app.models.db import Crop, Planet, Star
from app.models.schemas import (
    CompareCell,
    CompareOut,
    CompareRequest,
    CropOut,
    FactorOut,
    IngestOut,
    MonteCarloOut,
    MorphologyOut,
    PlantStateOut,
    SimulateRequest,
    SimulationOut,
    StressOut,
    TimelineEventOut,
    TimelineOut,
    TimelineRequest,
    TimelineSummaryOut,
)
from app.physics.environment import BodyInputs, InsufficientDataError
from app.simulate import FACTOR_LABELS_RU, RANGE_FIELDS, monte_carlo, simulate
from app.timeline import HOURS_PER_EARTH_DAY, Overrides, simulate_timeline

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]


def _load_body(session: Session, planet_id: str) -> BodyInputs:
    planet = session.get(Planet, planet_id)
    if planet is None:
        raise HTTPException(404, f"Планета не найдена: {planet_id}")
    star = session.get(Star, planet.star_id)
    assert star is not None
    return body_from_rows(planet, star)


def _load_crop(session: Session, crop_id: str) -> Crop:
    crop = session.get(Crop, crop_id)
    if crop is None:
        raise HTTPException(404, f"Культура не найдена: {crop_id}")
    return crop


@router.get("/crops", response_model=list[CropOut], tags=["crops"])
def list_crops(session: SessionDep) -> list[Crop]:
    return list(session.exec(select(Crop).order_by(Crop.name_ru)).all())


@router.post("/simulate", response_model=SimulationOut, tags=["simulate"])
def run_simulation(request: SimulateRequest, session: SessionDep) -> SimulationOut:
    if request.custom_planet is not None:
        body = body_from_custom(request.custom_planet)
    else:
        assert request.planet_id is not None
        body = _load_body(session, request.planet_id)
    crop = _load_crop(session, request.crop_id)
    params = crop_params(crop)

    try:
        result = simulate(
            body,
            params,
            request.scenario,
            request.atmosphere_preset,
            crop_is_estimate=crop.estimate,
            yield_kg_m2_cycle=crop.yield_kg_m2_cycle,
        )
    except InsufficientDataError as exc:
        raise HTTPException(422, str(exc)) from exc

    uncertainty = None
    if request.ranges:
        invalid = set(request.ranges) - RANGE_FIELDS
        if invalid or any(lo > hi for lo, hi in request.ranges.values()):
            raise HTTPException(422, f"Некорректные диапазоны: {sorted(invalid)}")
        computed = monte_carlo(
            body,
            params,
            request.scenario,
            request.ranges,
            request.atmosphere_preset,
            request.monte_carlo_n,
            yield_kg_m2_cycle=crop.yield_kg_m2_cycle,
        )
        uncertainty = MonteCarloOut(
            n=computed.n,
            p10=computed.p10,
            p50=computed.p50,
            p90=computed.p90,
            survival_probability=computed.survival_probability,
        )

    return SimulationOut(
        planet_name=body.name,
        crop_id=crop.id,
        crop_name=crop.name_ru,
        scenario=request.scenario,
        atmosphere_preset=request.atmosphere_preset,
        yield_rel=result.growth.yield_rel,
        survival=result.growth.survival,
        days_to_harvest=result.growth.days_to_harvest,
        limiting_factor=result.growth.limiting_factor,
        limiting_factor_label=FACTOR_LABELS_RU[result.growth.limiting_factor],
        factors=[
            FactorOut(
                key=f.key,
                label=FACTOR_LABELS_RU[f.key],
                value=f.value,
                unit=f.unit,
                f=f.f,
                status=f.status,  # type: ignore[arg-type]
            )
            for f in result.growth.factors
        ],
        confidence=result.confidence,  # type: ignore[arg-type]
        confidence_score=result.confidence_score,
        assumptions=[assumption_out(a) for a in result.assumptions],
        recommendations=list(result.recommendations),
        engineering=result.outcome.engineering,
        environment=environment_out(result.environment),
        monte_carlo=uncertainty,
    )


TIMELINE_CACHE_SIZE = 256
_timeline_cache: OrderedDict[str, TimelineOut] = OrderedDict()


def clear_timeline_cache() -> None:
    _timeline_cache.clear()


def _day_unit(planet_id: str | None, step_hours: float, day_hours: float | None) -> str:
    if planet_id == "mars" and step_hours != HOURS_PER_EARTH_DAY:
        return "sol"
    if step_hours == HOURS_PER_EARTH_DAY and day_hours != HOURS_PER_EARTH_DAY:
        return "earth_day"
    return "local_day"


@router.post("/simulate/timeline", response_model=TimelineOut, tags=["simulate"])
def run_timeline(request: TimelineRequest, session: SessionDep) -> TimelineOut:
    key = hashlib.sha256(request.model_dump_json().encode()).hexdigest()
    cached = _timeline_cache.get(key)
    if cached is not None:
        _timeline_cache.move_to_end(key)
        return cached

    if request.custom_planet is not None:
        body = body_from_custom(request.custom_planet)
    else:
        assert request.planet_id is not None
        body = _load_body(session, request.planet_id)
    crop = _load_crop(session, request.crop_id)
    morph = load_morphology().get(crop.id)
    if morph is None:
        raise HTTPException(422, f"Нет морфологии для культуры: {crop.id}")
    overrides = Overrides(**request.overrides.model_dump()) if request.overrides else None

    try:
        result = simulate_timeline(
            body,
            crop_params(crop),
            morph,
            request.scenario,
            request.atmosphere_preset,
            overrides=overrides,
            seed=request.seed,
            events_enabled=request.events,
            crop_is_estimate=crop.estimate,
            yield_kg_m2_cycle=crop.yield_kg_m2_cycle,
        )
    except InsufficientDataError as exc:
        raise HTTPException(422, str(exc)) from exc

    sim = result.simulation
    limiting = (
        result.days[-1].limiting_factor if not result.survival else sim.growth.limiting_factor
    )
    out = TimelineOut(
        planet_name=body.name,
        crop_id=crop.id,
        crop_name=crop.name_ru,
        scenario=request.scenario,
        step_hours=result.step_hours,
        day_unit=_day_unit(  # type: ignore[arg-type]
            request.planet_id, result.step_hours, sim.environment.day_hours
        ),
        environment=environment_out(sim.environment),
        conditions={**asdict(result.conditions), **sim.outcome.engineering},
        morphology=MorphologyOut(
            harvest_organ=morph.harvest_organ,
            growth_form=morph.growth_form,
            height_max_m=morph.height_max_m,
            biomass_max_g=morph.biomass_max_g,
            harvest_index=morph.harvest_index,
            organ_count_max=morph.organ_count_max,
        ),
        days=[
            PlantStateOut(
                day=d.day,
                earth_day=d.earth_day,
                stage=d.stage,
                progress=d.progress,
                heightM=d.height_m,
                leafCount=d.leaf_count,
                leafAreaIndex=d.leaf_area_index,
                biomassG=d.biomass_g,
                yieldG=d.yield_g,
                organCount=d.organ_count,
                stress=StressOut(**d.stress),
                factors=d.factors,
                health=d.health,
                growth_rate=d.growth_rate,
                limiting_factor=d.limiting_factor,
                limiting_f=d.limiting_f,
                t_mean_c=d.t_mean_c,
                ppfd_umol_m2_s=d.ppfd_umol_m2_s,
                storm=d.storm,
                flare=d.flare,
            )
            for d in result.days
        ],
        events=[
            TimelineEventOut(day=e.day, type=e.type, message=e.message)  # type: ignore[arg-type]
            for e in result.events
        ],
        summary=TimelineSummaryOut(
            yield_rel=result.yield_rel,
            static_yield_rel=result.static_yield_rel,
            survival=result.survival,
            days_to_harvest=result.harvest_earth_days,
            harvest_day=result.harvest_day,
            limiting_factor=limiting,
            limiting_factor_label=FACTOR_LABELS_RU[limiting],
            confidence=sim.confidence,  # type: ignore[arg-type]
            assumptions=[assumption_out(a) for a in result.assumptions],
            recommendations=list(sim.recommendations),
        ),
    )
    _timeline_cache[key] = out
    if len(_timeline_cache) > TIMELINE_CACHE_SIZE:
        _timeline_cache.popitem(last=False)
    return out


@router.post("/compare", response_model=CompareOut, tags=["simulate"])
def compare(request: CompareRequest, session: SessionDep) -> CompareOut:
    planets: list[dict[str, str]] = []
    bodies: dict[str, BodyInputs] = {}
    for planet_id in request.planet_ids:
        bodies[planet_id] = _load_body(session, planet_id)
        planets.append({"id": planet_id, "name": bodies[planet_id].name})
    crops = [_load_crop(session, crop_id) for crop_id in request.crop_ids]

    cells: list[CompareCell] = []
    for planet_id, body in bodies.items():
        for crop in crops:
            try:
                result = simulate(
                    body,
                    crop_params(crop),
                    request.scenario,
                    request.atmosphere_preset,
                    crop_is_estimate=crop.estimate,
                    yield_kg_m2_cycle=crop.yield_kg_m2_cycle,
                )
            except InsufficientDataError as exc:
                cells.append(
                    CompareCell(
                        planet_id=planet_id,
                        crop_id=crop.id,
                        yield_rel=None,
                        survival=None,
                        limiting_factor=None,
                        limiting_factor_label=None,
                        confidence=None,
                        error=str(exc),
                    )
                )
                continue
            cells.append(
                CompareCell(
                    planet_id=planet_id,
                    crop_id=crop.id,
                    yield_rel=result.growth.yield_rel,
                    survival=result.growth.survival,
                    limiting_factor=result.growth.limiting_factor,
                    limiting_factor_label=FACTOR_LABELS_RU[result.growth.limiting_factor],
                    confidence=result.confidence,  # type: ignore[arg-type]
                )
            )
    return CompareOut(
        planets=planets,
        crops=[{"id": c.id, "name": c.name_ru} for c in crops],
        scenario=request.scenario,
        cells=cells,
    )


@router.post("/ingest/{source}", response_model=IngestOut, tags=["admin"])
def ingest_source(
    source: str,
    session: SessionDep,
    x_admin_token: Annotated[str | None, Header()] = None,
) -> IngestOut:
    expected = config.admin_token()
    if expected is None:
        raise HTTPException(403, "Загрузка через API отключена: не задан ASTROCROP_ADMIN_TOKEN")
    if x_admin_token is None or not hmac.compare_digest(x_admin_token, expected):
        raise HTTPException(401, "Неверный токен администратора")
    if source not in LOADERS:
        raise HTTPException(404, f"Неизвестный источник. Доступны: {sorted(LOADERS)}")
    status, rows, message = LOADERS[source](session)
    clear_timeline_cache()
    scene.clear_caches()
    return IngestOut(source=source, status=status, rows=rows, message=message)
