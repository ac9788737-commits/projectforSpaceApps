from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import config, database
from app.convert import body_from_rows, crop_params
from app.ingest import ecocrop, galaxies, solar_system
from app.main import app
from app.models.db import Crop, Planet, Star
from app.physics.environment import BodyInputs


@pytest.fixture(scope="session")
def engine():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    database.set_engine(engine)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        solar_system.ingest(session)
        ecocrop.ingest(session)
        galaxies.ingest(session)
    return engine


@pytest.fixture()
def session(engine) -> Iterator[Session]:
    with Session(engine) as db:
        yield db


@pytest.fixture()
def client(engine) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def bodies(engine) -> dict[str, BodyInputs]:
    with Session(engine) as db:
        sun = db.get(Star, "sun")
        assert sun is not None
        planets = db.exec(select(Planet).where(Planet.kind == "solar_system")).all()
        return {p.id: body_from_rows(p, sun) for p in planets}


@pytest.fixture(scope="session")
def crops(engine):
    with Session(engine) as db:
        return {c.id: crop_params(c) for c in db.exec(select(Crop)).all()}


@pytest.fixture(scope="session")
def crop_rows(engine):
    with Session(engine) as db:
        rows = db.exec(select(Crop)).all()
        for row in rows:
            db.expunge(row)
        return {row.id: row for row in rows}


@pytest.fixture()
def raw_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(config, "RAW_DIR", tmp_path)
    return tmp_path
