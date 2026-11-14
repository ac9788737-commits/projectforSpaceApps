"""PHL Habitable Worlds Catalog: marks exoplanets as potentially habitable."""

from __future__ import annotations

from pathlib import Path

import duckdb
import polars as pl
from sqlmodel import Session, select

from app import config
from app.ingest.common import fetch_with_cache, log_ingest
from app.models.db import Planet, Star

SOURCE = "phl_hwc"
SOURCE_LABEL = "PHL Habitable Worlds Catalog"
SOURCE_URL = "https://phl.upr.edu/hwc"
DATA_URL = "https://www.hpcf.upr.edu/~abel/phl/hwc/data/hwc.csv"
SNAPSHOT_FILE = "phl_habitable_snapshot.csv"
COORDS_SNAPSHOT_FILE = "phl_star_coordinates.csv"
_FILENAME = "hwc.csv"


def habitable_names(path: Path) -> pl.DataFrame:
    """Names flagged as potentially habitable in the catalog (P_HABITABLE of 1 or 2)."""
    frame = pl.read_csv(path, infer_schema_length=0, truncate_ragged_lines=True)
    return frame.filter(pl.col("P_HABITABLE").is_in(["1", "2"])).select(
        pl.col("P_NAME").alias("name")
    )


def match(habitable: pl.DataFrame, planets: pl.DataFrame) -> set[str]:
    """Case- and whitespace-insensitive join between catalog names and stored planets."""
    connection = duckdb.connect()
    connection.register("habitable", habitable.to_arrow())
    connection.register("planets", planets.to_arrow())
    rows = connection.execute(
        """
        select distinct p.id
        from planets p join habitable h
          on regexp_replace(lower(p.name), '\\s+', '', 'g')
           = regexp_replace(lower(h.name), '\\s+', '', 'g')
        """
    ).fetchall()
    return {row[0] for row in rows}


def _key(name: str) -> str:
    return "".join(name.lower().split())


def star_coordinates(path: Path) -> dict[str, tuple[float, float]]:
    """Host star RA/Dec in degrees keyed by normalised star name; absent in the snapshot."""
    frame = pl.read_csv(path, infer_schema_length=0, truncate_ragged_lines=True)
    if not {"S_NAME", "S_RA", "S_DEC"} <= set(frame.columns):
        return {}
    frame = frame.select(
        pl.col("S_NAME"),
        pl.col("S_RA").cast(pl.Float64, strict=False),
        pl.col("S_DEC").cast(pl.Float64, strict=False),
    ).drop_nulls()
    return {_key(r["S_NAME"]): (r["S_RA"], r["S_DEC"]) for r in frame.to_dicts()}


def fill_star_coordinates(session: Session, path: Path) -> int:
    """Fill missing star coordinates; values from NASA are never overwritten."""
    coords = star_coordinates(path)
    seed = config.SEED_DIR / COORDS_SNAPSHOT_FILE
    if not coords and seed.exists():
        coords = star_coordinates(seed)
    filled = 0
    for star in session.exec(select(Star).where(Star.ra_deg == None)).all():  # noqa: E711
        found = coords.get(_key(star.name))
        if found is None:
            continue
        star.ra_deg, star.dec_deg = found
        star.coords_source = SOURCE_LABEL
        session.add(star)
        filled += 1
    session.commit()
    return filled


def apply(session: Session, path: Path, retrieved_at: str) -> int:
    rows = session.exec(select(Planet.id, Planet.name).where(Planet.kind == "exoplanet")).all()
    if not rows:
        return 0
    planets = pl.DataFrame({"id": [r[0] for r in rows], "name": [r[1] for r in rows]})
    matched = match(habitable_names(path), planets)
    for planet in session.exec(select(Planet).where(Planet.kind == "exoplanet")).all():
        flag = planet.id in matched
        if planet.potentially_habitable != flag:
            planet.potentially_habitable = flag
            session.add(planet)
        if flag:
            planet.provenance = {
                **planet.provenance,
                "potentially_habitable": {
                    "source": SOURCE_LABEL,
                    "source_url": SOURCE_URL,
                    "retrieved_at": retrieved_at,
                    "estimate": False,
                },
            }
            session.add(planet)
    session.commit()
    return len(matched)


def ingest(session: Session, allow_network: bool = True) -> tuple[str, int, str | None]:
    if allow_network:
        fetched = fetch_with_cache(SOURCE, DATA_URL, _FILENAME)
        path, status, retrieved_at, message = (
            fetched.path,
            fetched.status,
            fetched.retrieved_at,
            fetched.message,
        )
    else:
        cached = sorted((config.RAW_DIR / SOURCE).glob(f"*/{_FILENAME}"))
        path = cached[-1] if cached else None
        status, retrieved_at, message = "cached", path.parent.name if path else None, None

    if path is None:
        path = config.SEED_DIR / SNAPSHOT_FILE
        if not path.exists():
            log_ingest(session, SOURCE, "failed", 0, message)
            return "failed", 0, message
        status = "seed"
        retrieved_at = (config.SEED_DIR / "exoplanets_snapshot.date").read_text().strip()

    assert retrieved_at is not None
    try:
        count = apply(session, path, retrieved_at)
        fill_star_coordinates(session, path)
    except (pl.exceptions.PolarsError, duckdb.Error, KeyError, OSError) as exc:
        session.rollback()
        text = f"ошибка разбора: {type(exc).__name__}"
        log_ingest(session, SOURCE, "failed", 0, text)
        return "failed", 0, text
    log_ingest(session, SOURCE, status, count, message)
    return status, count, message
