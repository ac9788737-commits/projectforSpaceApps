"""Runtime configuration from environment variables."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("ASTROCROP_DATA_DIR", REPO_ROOT / "data"))
SEED_DIR = DATA_DIR / "seed"
RAW_DIR = DATA_DIR / "raw"
DATABASE_URL = os.environ.get("ASTROCROP_DATABASE_URL", f"sqlite:///{DATA_DIR / 'astrocrop.db'}")
CORS_ORIGINS = os.environ.get(
    "ASTROCROP_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")


def admin_token() -> str | None:
    """Token protecting POST /ingest; ingestion over HTTP is disabled when unset."""
    return os.environ.get("ASTROCROP_ADMIN_TOKEN") or None
