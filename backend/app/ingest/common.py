"""Shared ingestion helpers: cached downloads, logging, provenance."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import httpx
from sqlmodel import Session

from app import config
from app.models.db import IngestLog

USER_AGENT = "WhatCropNext/0.1 (research prototype)"
TIMEOUT_S = 120.0


@dataclass(frozen=True, slots=True)
class FetchResult:
    path: Path | None
    status: str  # ok | cached | failed
    retrieved_at: str | None
    message: str | None = None


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _latest_cached(source: str, filename: str) -> Path | None:
    root = config.RAW_DIR / source
    if not root.exists():
        return None
    candidates = sorted(p for p in root.glob(f"*/{filename}") if p.stat().st_size > 0)
    return candidates[-1] if candidates else None


def fetch_with_cache(source: str, url: str, filename: str) -> FetchResult:
    """Download into data/raw/<source>/<date>/; on failure fall back to the newest cached copy."""
    today = date.today().isoformat()
    target = config.RAW_DIR / source / today / filename
    try:
        with httpx.Client(
            timeout=TIMEOUT_S, follow_redirects=True, headers={"User-Agent": USER_AGENT}
        ) as client:
            response = client.get(url)
            response.raise_for_status()
        if not response.content.strip():
            raise ValueError("пустой ответ источника")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(response.content)
        return FetchResult(target, "ok", today)
    except (httpx.HTTPError, OSError, ValueError) as exc:
        cached = _latest_cached(source, filename)
        message = f"источник недоступен: {type(exc).__name__}"
        if cached is not None:
            return FetchResult(cached, "cached", cached.parent.name, message)
        return FetchResult(None, "failed", None, message)


def log_ingest(
    session: Session, source: str, status: str, rows: int, message: str | None = None
) -> None:
    session.add(IngestLog(source=source, status=status, rows=rows, message=message))
    session.commit()


def provenance_for(
    fields: list[str],
    values: dict[str, Any],
    source: str,
    source_url: str,
    retrieved_at: str,
    estimate_fields: set[str] | None = None,
) -> dict[str, dict[str, Any]]:
    """Per-value origin record; missing values are recorded as absent, not invented."""
    estimates = estimate_fields or set()
    result: dict[str, dict[str, Any]] = {}
    for name in fields:
        if values.get(name) is None:
            continue
        result[name] = {
            "source": source,
            "source_url": source_url,
            "retrieved_at": retrieved_at,
            "estimate": name in estimates,
        }
    return result
