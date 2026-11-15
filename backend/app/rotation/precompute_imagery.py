"""Save fresh Sentinel-2 pictures of the demo fields (docs/IMPROVEMENTS.md A.2, level 3).

Run: python -m app.rotation.precompute_imagery
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.geo import fields as geo
from app.geo.harmonize import polygon_of
from app.geo.imagery import save_demo


def main() -> None:
    today = datetime.now(UTC).date()
    for f in geo.demo_fields():
        fid = f["properties"]["id"]
        res = save_demo(fid, polygon_of(f["geometry"]), today)
        print(fid, {k: (v["level"], v["date"], v["note"]) for k, v in res.items()}, flush=True)


if __name__ == "__main__":
    main()
