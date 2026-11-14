from __future__ import annotations

from pathlib import Path

import httpx
import polars as pl
import pytest
from sqlmodel import Session, select

from app import config
from app.ingest import common, galaxies, nasa_exoplanet_archive, phl_hwc, solar_system
from app.models.db import Planet

SAMPLE = (
    "pl_name,hostname,pl_rade,pl_bmasse,pl_orbsmax,pl_orbper,pl_orbeccen,pl_eqt,pl_insol,"
    "st_teff,st_rad,st_mass,st_lum,st_spectype,sy_dist\n"
    '"Test-1 b","Test-1",1.0,1.0,0.03,6.1,0.0,250.0,0.66,2566.0,0.12,0.09,-3.28,M8,12.5\n'
    '"Test-1 c","Test-1",1.1,,0.05,12.0,,,,2566.0,0.12,0.09,-3.28,M8,12.5\n'
)
PHL = "P_NAME,P_HABITABLE\nTest-1 b,1\nOther b,0\n"


def _boom(*_args, **_kwargs):
    raise httpx.ConnectError("offline")


def test_solar_system_table_is_complete():
    table = solar_system.read_table()
    assert set(table["id"]) >= {"earth", "mars", "titan", "europa", "enceladus", "moon"}
    assert table["source_url"].null_count() == 0


def test_ingest_is_idempotent(session):
    before = len(session.exec(select(Planet)).all())
    solar_system.ingest(session)
    assert len(session.exec(select(Planet)).all()) == before


def test_fetch_uses_cache_when_source_fails(raw_dir: Path, monkeypatch):
    cached = raw_dir / "src" / "2024-01-01" / "x.csv"
    cached.parent.mkdir(parents=True)
    cached.write_text("a,b\n1,2\n")
    monkeypatch.setattr(httpx.Client, "get", _boom)
    result = common.fetch_with_cache("src", "http://example.invalid", "x.csv")
    assert result.status == "cached" and result.path == cached
    assert result.retrieved_at == "2024-01-01"


def test_fetch_failure_without_cache_does_not_raise(raw_dir: Path, monkeypatch):
    monkeypatch.setattr(httpx.Client, "get", _boom)
    result = common.fetch_with_cache("src", "http://example.invalid", "x.csv")
    assert result.status == "failed" and result.path is None


def test_nasa_normalise_converts_log_luminosity(tmp_path: Path):
    raw = tmp_path / "p.csv"
    raw.write_text(SAMPLE)
    frame = nasa_exoplanet_archive.normalise(raw)
    assert frame["luminosity_lsun"][0] == pytest.approx(10**-3.28)
    assert frame["pl_bmasse"][1] is None


def test_nasa_and_phl_pipeline(engine, tmp_path: Path):
    raw = tmp_path / "p.csv"
    raw.write_text(SAMPLE)
    phl_csv = tmp_path / "hwc.csv"
    phl_csv.write_text(PHL)
    with Session(engine) as session:
        nasa_exoplanet_archive.load_frame(
            session, nasa_exoplanet_archive.normalise(raw), "2026-01-01"
        )
        assert phl_hwc.apply(session, phl_csv, "2026-01-01") == 1
        planet = session.get(Planet, "test-1-b")
        assert planet.potentially_habitable is True
        assert planet.provenance["potentially_habitable"]["source"]
        # A repeated NASA load keeps the PHL flag and creates no duplicates.
        nasa_exoplanet_archive.load_frame(
            session, nasa_exoplanet_archive.normalise(raw), "2026-01-02"
        )
        assert session.get(Planet, "test-1-b").potentially_habitable is True
        other = session.get(Planet, "test-1-c")
        assert other.mass_earth is None  # missing values stay null
        assert "mass_earth" not in other.provenance


def test_nasa_offline_without_data_reports_failure(session, raw_dir, monkeypatch):
    monkeypatch.setattr(httpx.Client, "get", _boom)
    monkeypatch.setattr(config, "SEED_DIR", raw_dir)
    status, rows, message = nasa_exoplanet_archive.ingest(session)
    assert status == "failed" and rows == 0 and message


def test_phl_names_keep_only_habitable(tmp_path: Path):
    raw = tmp_path / "hwc.csv"
    raw.write_text(PHL)
    names = phl_hwc.habitable_names(raw)
    assert isinstance(names, pl.DataFrame)
    assert names["name"].to_list() == ["Test-1 b"]


def test_generator_is_deterministic_and_hypothetical():
    first = galaxies.generate("starburst", 5, 1)
    second = galaxies.generate("starburst", 5, 1)
    assert [p.mass_earth for _, p in first] == [p.mass_earth for _, p in second]
    assert all(p.hypothetical and p.kind == "hypothetical" for _, p in first)
    assert all(p.provenance["mass_earth"]["estimate"] for _, p in first)
    assert first[0][1].extra_radiation_msv_yr > 1000.0


def test_star_coordinates_fall_back_to_seed(session) -> None:
    from app.ingest import phl_hwc
    from app.models.db import Star

    star = Star(
        id="star-test-coords",
        name="TRAPPIST-1",
        source="test",
        source_url="",
        retrieved_at="2026-11-10",
    )
    session.merge(star)
    session.commit()
    seed_only = phl_hwc.config.SEED_DIR / phl_hwc.SNAPSHOT_FILE  # has no coordinate columns
    assert phl_hwc.fill_star_coordinates(session, seed_only) >= 1
    stored = session.get(Star, "star-test-coords")
    assert stored is not None and stored.ra_deg is not None
    assert stored.coords_source == phl_hwc.SOURCE_LABEL
