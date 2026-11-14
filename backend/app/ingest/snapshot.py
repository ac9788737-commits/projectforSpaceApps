"""Write a small offline snapshot of real catalogue rows into data/seed.

Run after a successful `python -m app.ingest`; the snapshot lets a fresh checkout show real
exoplanets without network access. Only rows flagged as potentially habitable by PHL are kept.
"""

from __future__ import annotations

import sys

import polars as pl

from app import config
from app.ingest import nasa_exoplanet_archive as nasa
from app.ingest import phl_hwc as phl


def main() -> int:
    nasa_files = sorted((config.RAW_DIR / nasa.SOURCE).glob("*/pscomppars.csv"))
    phl_files = sorted((config.RAW_DIR / phl.SOURCE).glob("*/hwc.csv"))
    if not nasa_files or not phl_files:
        print("no raw data: run `python -m app.ingest` first", file=sys.stderr)
        return 1
    names = phl.habitable_names(phl_files[-1])
    frame = pl.read_csv(nasa_files[-1], infer_schema_length=0)
    selected = frame.filter(pl.col("pl_name").is_in(names["name"].to_list()))
    selected.write_csv(config.SEED_DIR / nasa.SNAPSHOT_FILE)
    pl.DataFrame({"P_NAME": names["name"], "P_HABITABLE": ["1"] * names.height}).write_csv(
        config.SEED_DIR / phl.SNAPSHOT_FILE
    )
    full = pl.read_csv(phl_files[-1], infer_schema_length=0, truncate_ragged_lines=True)
    full.select("S_NAME", "S_RA", "S_DEC").unique(subset="S_NAME").sort("S_NAME").write_csv(
        config.SEED_DIR / phl.COORDS_SNAPSHOT_FILE
    )
    (config.SEED_DIR / "exoplanets_snapshot.date").write_text(nasa_files[-1].parent.name + "\n")
    print(f"snapshot: {selected.height} planets, {names.height} catalogue names")
    return 0


if __name__ == "__main__":
    sys.exit(main())
