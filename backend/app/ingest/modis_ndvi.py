"""MODIS MOD13Q1 NDVI (250 m, 16-day) at a field from the ORNL DAAC MODIS web service.

https://modis.ornl.gov/data/modis_webservice.html — open, no login; slow (~40 s per request
of 10 composites), so results are cached per chunk and the download can resume.
Quality: pixel_reliability 0 = good, 1 = marginal; 2 = snow/ice, 3 = cloudy, -1 = fill →
treated as missing (never as zero).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

import httpx

from app import config
from app.ingest.common import USER_AGENT

API = "https://modis.ornl.gov/rst/api/v1/MOD13Q1"
BANDS = ("250m_16_days_NDVI", "250m_16_days_pixel_reliability")
CHUNK = 10  # service limit: composites per request


def _get(url: str, params: dict[str, Any], attempts: int = 12) -> Any:
    """GET with retries: the service answers 502/timeouts under load."""
    for k in range(attempts):
        try:
            r = httpx.get(
                url,
                params=params,
                timeout=180,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, ValueError):
            if k == attempts - 1:
                raise
            time.sleep(min(300, 30 * (k + 1)))
    raise RuntimeError("unreachable")


def download(fid: str, lat: float, lon: float, start_year: int, end_year: int) -> Path:
    root = config.DATA_DIR / "cache" / fid / "ndvi_parts"
    root.mkdir(parents=True, exist_ok=True)
    dates_file = root / "dates.json"
    if not dates_file.exists():
        dates_file.write_text(json.dumps(_get(f"{API}/dates", {"latitude": lat, "longitude": lon})))
    dates = [
        d["modis_date"]
        for d in json.loads(dates_file.read_text())["dates"]
        if start_year <= int(d["calendar_date"][:4]) <= end_year
    ]
    for band in BANDS:
        for i in range(0, len(dates), CHUNK):
            part = root / f"{band}_{dates[i]}.json"
            if part.exists():
                continue
            chunk = dates[i : i + CHUNK]
            data = _get(
                f"{API}/subset",
                {
                    "latitude": lat,
                    "longitude": lon,
                    "band": band,
                    "startDate": chunk[0],
                    "endDate": chunk[-1],
                    "kmAboveBelow": 0,
                    "kmLeftRight": 0,
                },
            )
            part.write_text(json.dumps(data))
            print(fid, band, chunk[0], flush=True)
    return assemble(fid)


def assemble(fid: str) -> Path:
    """Merge chunks into cache/<fid>/ndvi.json: [{date, ndvi|null, reliability}]."""
    root = config.DATA_DIR / "cache" / fid
    parts = root / "ndvi_parts"
    values: dict[str, dict[str, Any]] = {}
    meta: dict[str, Any] = {}
    for band in BANDS:
        for p in sorted(parts.glob(f"{band}_*.json")):
            d = json.loads(p.read_text())
            meta.setdefault("scale", d.get("scale")) if band == BANDS[0] else None
            meta["pixel_m"] = d.get("cellsize")
            for s in d["subset"]:
                values.setdefault(s["calendar_date"], {})[band] = s["data"][0]
    scale = float(meta.get("scale") or 0.0001)
    rows = []
    for date in sorted(values):
        v = values[date]
        rel = v.get(BANDS[1])
        raw = v.get(BANDS[0])
        good = rel in (0, 1) and raw is not None and raw > -2000
        rows.append(
            {
                "date": date,
                "ndvi": round(float(raw) * scale, 4) if good and raw is not None else None,
                "reliability": rel,
            }
        )
    out = root / "ndvi.json"
    out.write_text(
        json.dumps(
            {
                "source": "MODIS MOD13Q1 v6.1 via ORNL DAAC web service",
                "pixel_m": meta.get("pixel_m"),
                "composite_days": 16,
                "rows": rows,
            }
        )
    )
    return out


if __name__ == "__main__":
    # python -m app.ingest.modis_ndvi <start> <end> <fid> <lat> <lon> [<fid> <lat> <lon> ...]
    first, last = int(sys.argv[1]), int(sys.argv[2])
    args = sys.argv[3:]
    for j in range(0, len(args), 3):
        download(args[j], float(args[j + 1]), float(args[j + 2]), first, last)
