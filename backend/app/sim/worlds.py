"""Resolve a world id of a scenario into its starting climate (uses the catalogue database)."""

from __future__ import annotations

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.convert import body_from_rows, crop_params
from app.ingest.common import slugify
from app.ingest.morphology import load_morphology
from app.models.db import Crop, Planet, Star
from app.physics.environment import InsufficientDataError, compute_environment
from app.sim.data import world_preset_rows
from app.sim.engine import CropBook
from app.sim.environment.base_climate import WorldClimate, world_from_environment, world_from_preset
from app.sim.scenario import ScenarioError

ALIASES = {
    "earth": "planet:earth",
    "mars": "planet:mars",
    "moon": "planet:moon",
    "titan": "planet:titan",
}


def resolve_world(session: Session, world_id: str) -> WorldClimate:
    world_id = ALIASES.get(world_id, world_id)
    if world_id in world_preset_rows():
        return world_from_preset(world_id)
    if world_id.startswith(("planet:", "exo:")):
        key = world_id.split(":", 1)[1]
        planet = session.get(Planet, key) or session.get(Planet, slugify(key))
        if planet is None:
            planet = session.exec(
                select(Planet).where(func.lower(col(Planet.name)) == key.lower())
            ).first()
        if planet is None:
            raise ScenarioError(f"планета не найдена: {key}")
        star = session.get(Star, planet.star_id)
        assert star is not None
        try:
            env = compute_environment(body_from_rows(planet, star))
        except InsufficientDataError as exc:
            raise ScenarioError(str(exc)) from exc
        return world_from_environment(f"planet:{planet.id}", planet.name_ru or planet.name, env)
    raise ScenarioError(f"неизвестный мир: {world_id}")


def crop_book(session: Session) -> CropBook:
    morph = load_morphology()
    crops = session.exec(select(Crop)).all()
    return CropBook(
        {c.id: crop_params(c) for c in crops}, {c.id: morph[c.id] for c in crops if c.id in morph}
    )
