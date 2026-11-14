"""Command line entry point: python -m app.ingest [source ...]."""

from __future__ import annotations

import sys

from sqlmodel import Session

from app.database import create_tables, get_engine
from app.ingest import LOADERS


def main(sources: list[str]) -> int:
    create_tables()
    selected = sources or list(LOADERS)
    unknown = [s for s in selected if s not in LOADERS]
    if unknown:
        print(f"unknown sources: {unknown}; available: {list(LOADERS)}", file=sys.stderr)
        return 2
    with Session(get_engine()) as session:
        for source in selected:
            status, rows, message = LOADERS[source](session)
            print(f"{source}: {status}, rows={rows}" + (f" ({message})" if message else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
