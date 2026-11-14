"""Database engine and session helpers."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import Engine, inspect, text
from sqlmodel import Session, SQLModel, create_engine

from app import config
from app.models import db as _tables  # noqa: F401  (registers tables on the metadata)

_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(config.DATABASE_URL, connect_args={"check_same_thread": False})
    return _engine


def set_engine(engine: Engine) -> None:
    """Replace the engine (used by tests)."""
    global _engine
    _engine = engine


def create_tables() -> None:
    engine = get_engine()
    SQLModel.metadata.create_all(engine)
    add_missing_columns(engine)


def add_missing_columns(engine: Engine) -> list[str]:
    """Minimal forward migration: add nullable columns that newer models define."""
    inspector = inspect(engine)
    added: list[str] = []
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing or not column.nullable:
                    continue
                kind = column.type.compile(dialect=engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {kind}'))
                added.append(f"{table.name}.{column.name}")
    return added


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
