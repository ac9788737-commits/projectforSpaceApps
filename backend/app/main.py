"""FastAPI application."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlmodel import Session

from app import config
from app.api import planets, scene, sim, simulation
from app.database import create_tables, get_engine
from app.ingest import bootstrap


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    create_tables()
    with Session(get_engine()) as session:
        bootstrap(session)
    yield


app = FastAPI(
    title="AstroCrop API",
    version="0.1.0",
    description="Как будет расти культура X на планете Y при сценарии Z?",
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Admin-Token"],
)
app.include_router(planets.router)
app.include_router(simulation.router)
app.include_router(scene.router)
app.include_router(sim.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
