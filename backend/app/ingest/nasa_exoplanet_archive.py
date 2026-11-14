"""NASA Exoplanet Archive loader (TAP service, table pscomppars)."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import polars as pl
from sqlmodel import Session, select

from app import config
from app.ingest.common import fetch_with_cache, log_ingest, provenance_for, slugify
from app.models.db import Planet, Star
from app.physics.climate import habitable_zone_au

SOURCE = "nasa_exoplanet_archive"
SOURCE_LABEL = "NASA Exoplanet Archive, pscomppars"
SOURCE_URL = "https://exoplanetarchive.ipac.caltech.edu/"
SNAPSHOT_FILE = "exoplanets_snapshot.csv"
COLUMNS = (
    "pl_name,hostname,pl_rade,pl_bmasse,pl_orbsmax,pl_orbper,pl_orbeccen,pl_eqt,pl_insol,"
    "st_teff,st_rad,st_mass,st_lum,st_spectype,sy_dist,ra,dec"
)
_FLOATS = [
    "pl_rade",
    "pl_bmasse",
    "pl_orbsmax",
    "pl_orbper",
    "pl_orbeccen",
    "pl_eqt",
    "pl_insol",
    "st_teff",
    "st_rad",
    "st_mass",
    "st_lum",
    "sy_dist",
    "ra",
    "dec",
]
_PLANET_FIELDS = [
    "mass_earth",
    "radius_earth",
    "semi_major_axis_au",
    "orbital_period_days",
    "eccentricity",
    "insolation_earth",
    "eq_temp_k",
]


def tap_url() -> str:
    query = quote_plus(f"select {COLUMNS} from pscomppars")
    return f"https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query={query}&format=csv"


def normalise(path: Path) -> pl.DataFrame:
    """Read a raw export into typed columns; st_lum is converted from log10 to solar units."""
    frame = pl.read_csv(path, infer_schema_length=0)
    # Older caches and the seed snapshot may predate the ra/dec columns.
    missing = [c for c in _FLOATS if c not in frame.columns]
    frame = frame.with_columns([pl.lit(None, dtype=pl.Utf8).alias(c) for c in missing])
    frame = frame.with_columns(pl.col(_FLOATS).cast(pl.Float64, strict=False))
    return frame.with_columns((10.0 ** pl.col("st_lum")).alias("luminosity_lsun"))


def _star(row: dict[str, Any], retrieved_at: str) -> Star:
    return Star(
        id=f"star-{slugify(row['hostname'])}",
        name=row["hostname"],
        teff_k=row["st_teff"],
        radius_rsun=row["st_rad"],
        mass_msun=row["st_mass"],
        luminosity_lsun=row["luminosity_lsun"],
        spectral_type=row["st_spectype"] or None,
        distance_pc=row["sy_dist"],
        ra_deg=row["ra"],
        dec_deg=row["dec"],
        coords_source=SOURCE_LABEL if row["ra"] is not None else None,
        source=SOURCE_LABEL,
        source_url=SOURCE_URL,
        retrieved_at=retrieved_at,
    )


def _in_habitable_zone(row: dict[str, Any]) -> bool | None:
    a_au, luminosity, teff = row["pl_orbsmax"], row["luminosity_lsun"], row["st_teff"]
    if a_au is None or luminosity is None or teff is None:
        return None
    inner, outer = habitable_zone_au(luminosity, teff)
    return inner <= a_au <= outer


def _planet(row: dict[str, Any], star_id: str, retrieved_at: str, habitable: bool) -> Planet:
    values = {
        "mass_earth": row["pl_bmasse"],
        "radius_earth": row["pl_rade"],
        "semi_major_axis_au": row["pl_orbsmax"],
        "orbital_period_days": row["pl_orbper"],
        "eccentricity": row["pl_orbeccen"],
        "insolation_earth": row["pl_insol"],
        "eq_temp_k": row["pl_eqt"],
    }
    return Planet(
        id=slugify(row["pl_name"]),
        name=row["pl_name"],
        kind="exoplanet",
        star_id=star_id,
        potentially_habitable=habitable,
        in_habitable_zone=_in_habitable_zone(row),
        source=SOURCE_LABEL,
        source_url=SOURCE_URL,
        retrieved_at=retrieved_at,
        provenance=provenance_for(_PLANET_FIELDS, values, SOURCE_LABEL, SOURCE_URL, retrieved_at),
        **values,
    )


def load_frame(session: Session, frame: pl.DataFrame, retrieved_at: str) -> int:
    """Idempotent upsert. PHL habitability flags already stored are preserved."""
    habitable_ids = set(
        session.exec(
            select(Planet.id).where(
                Planet.kind == "exoplanet",
                Planet.potentially_habitable == True,  # noqa: E712
            )
        ).all()
    )
    rows = frame.to_dicts()
    for host in frame.unique(subset="hostname").to_dicts():
        star = _star(host, retrieved_at)
        if star.ra_deg is None:
            existing = session.get(Star, star.id)
            if existing is not None and existing.ra_deg is not None:
                star.ra_deg, star.dec_deg = existing.ra_deg, existing.dec_deg
                star.coords_source = existing.coords_source
        session.merge(star)
    session.commit()
    for row in rows:
        planet_id = slugify(row["pl_name"])
        star_id = f"star-{slugify(row['hostname'])}"
        session.merge(_planet(row, star_id, retrieved_at, planet_id in habitable_ids))
    session.commit()
    return len(rows)


def ingest(session: Session, allow_network: bool = True) -> tuple[str, int, str | None]:
    """Download, or use the cache, or use the seed snapshot. Never raises on source failure."""
    filename = "pscomppars.csv"
    if allow_network:
        fetched = fetch_with_cache(SOURCE, tap_url(), filename)
    else:
        cached = sorted((config.RAW_DIR / SOURCE).glob(f"*/{filename}"))
        path = cached[-1] if cached else None
        fetched_status = "cached" if path else "failed"
        fetched = _offline_result(path, fetched_status)

    path, status, retrieved_at, message = (
        fetched.path,
        fetched.status,
        fetched.retrieved_at,
        fetched.message,
    )
    if path is None:
        path = config.SEED_DIR / SNAPSHOT_FILE
        if not path.exists():
            log_ingest(session, SOURCE, "failed", 0, message)
            return "failed", 0, message
        status = "seed"
        retrieved_at = (config.SEED_DIR / "exoplanets_snapshot.date").read_text().strip()

    assert retrieved_at is not None
    try:
        rows = load_frame(session, normalise(path), retrieved_at)
    except (pl.exceptions.PolarsError, KeyError, OSError) as exc:
        session.rollback()
        text = f"ошибка разбора: {type(exc).__name__}"
        log_ingest(session, SOURCE, "failed", 0, text)
        return "failed", 0, text
    log_ingest(session, SOURCE, status, rows, message)
    return status, rows, message


def _offline_result(path: Path | None, status: str) -> Any:
    from app.ingest.common import FetchResult

    return FetchResult(path, status, path.parent.name if path else None)
