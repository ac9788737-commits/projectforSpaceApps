"""Data loaders. One module per source; running them twice leaves the database unchanged."""

from __future__ import annotations

from collections.abc import Callable

from sqlmodel import Session, select

from app.ingest import ecocrop, galaxies, nasa_exoplanet_archive, phl_hwc, solar_system
from app.models.db import Planet

Loader = Callable[[Session], tuple[str, int, str | None]]

LOADERS: dict[str, Loader] = {
    "solar_system": solar_system.ingest,
    "ecocrop": ecocrop.ingest,
    "nasa_exoplanet_archive": nasa_exoplanet_archive.ingest,
    "phl_hwc": phl_hwc.ingest,
    "galaxies": galaxies.ingest,
}


def bootstrap(session: Session) -> None:
    """Fill an empty database from local files only, so startup never needs the network."""
    if session.exec(select(Planet.id).limit(1)).first() is not None:
        return
    solar_system.ingest(session)
    ecocrop.ingest(session)
    galaxies.ingest(session)
    nasa_exoplanet_archive.ingest(session, allow_network=False)
    phl_hwc.ingest(session, allow_network=False)
