"""Fields: polygons on the map, their cached data layers and the data card (ROTATION.md §2)."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from app import config
from app.geo.harmonize import area_ha, point_layer, polygon_of
from app.geo.terrain import field_terrain
from app.ingest.common import TIMEOUT_S, USER_AGENT
from app.rotation.model import FieldSite
from app.rotation.weather import POWER_PARAMS, Weather, weather_from_power

FIELDS_DIR = config.DATA_DIR / "fields"
CACHE_DIR = config.DATA_DIR / "cache"
DEMO_FILE = config.SEED_DIR / "demo_fields.geojson"
POWER_YEARS = (2005, 2024)
POWER_API = "https://power.larc.nasa.gov/api/temporal/daily/point"
SOILGRIDS_API = "https://rest.isric.org/soilgrids/v2.0/properties/query"
SOIL_PROPS = ("sand", "clay", "soc", "bdod", "phh2o")
SOIL_DEPTHS = (("0-5cm", 5), ("5-15cm", 10), ("15-30cm", 15))
EARTHDATA_LAYERS = (
    ("gpm", "GPM IMERG", "осадки", "~0,1°, до 30 мин", "2000–н. в."),
    ("smap", "SMAP L3/L4", "влажность почвы", "9–36 км, сутки", "2015–н. в."),
    ("ecostress", "ECOSTRESS", "температура поверхности, ЭТ", "~70 м, нерегулярно", "2018–н. в."),
    ("grace", "GRACE / GRACE-FO", "тренд запасов воды", "сотни км, месяц", "2002–н. в."),
)


def _now() -> str:
    return datetime.now(UTC).date().isoformat()


def demo_fields() -> list[dict[str, Any]]:
    data = json.loads(DEMO_FILE.read_text(encoding="utf-8"))
    return [dict(f, demo=True) for f in data["features"]]


def _record(feature: dict[str, Any]) -> dict[str, Any]:
    poly = polygon_of(feature)
    props = feature.get("properties", {})
    return {
        "id": props["id"],
        "name": props.get("name", props["id"]),
        "region": props.get("region"),
        "demo": bool(feature.get("demo")),
        "note": props.get("note"),
        "card_ru": props.get("card_ru"),
        "irrigated": bool(props.get("irrigated", False)),
        "irrigation_method": props.get(
            "irrigation_method", "furrow" if props.get("irrigated") else "none"
        ),
        "water_limit_m3_ha": float(props.get("water_limit_m3_ha", 0)),
        "current_plan": props.get("current_plan"),
        "farmer": props.get("farmer"),
        "story_ru": props.get("story_ru"),
        "i18n": props.get("i18n", {}),
        "geometry": feature["geometry"],
        "area_ha": round(area_ha(poly), 2),
        "centroid": [round(poly.centroid.x, 5), round(poly.centroid.y, 5)],
    }


def list_fields() -> list[dict[str, Any]]:
    out = [_record(f) for f in demo_fields()]
    if FIELDS_DIR.exists():
        for p in sorted(FIELDS_DIR.glob("*.json")):
            out.append(_record(json.loads(p.read_text(encoding="utf-8"))))
    return out


def get_field(fid: str) -> dict[str, Any]:
    for f in list_fields():
        if f["id"] == fid:
            return f
    raise KeyError(fid)


def save_field(name: str, geometry: dict[str, Any]) -> dict[str, Any]:
    poly = polygon_of(geometry)
    ha = area_ha(poly)
    if not 0.01 <= ha <= 5000:
        raise ValueError(f"площадь поля {ha:.2f} га вне диапазона 0,01–5000 га")
    fid = "f" + hashlib.sha1(json.dumps(geometry, sort_keys=True).encode()).hexdigest()[:10]
    feature = {"type": "Feature", "geometry": geometry, "properties": {"id": fid, "name": name}}
    FIELDS_DIR.mkdir(parents=True, exist_ok=True)
    (FIELDS_DIR / f"{fid}.json").write_text(
        json.dumps(feature, ensure_ascii=False), encoding="utf-8"
    )
    return _record(feature)


# ---------- layers (idempotent: cached files are reused) ----------


def _cache(fid: str) -> Path:
    return CACHE_DIR / fid


def _cached_json(path: Path, fetch: Any, offline: bool) -> tuple[Any, str, str | None]:
    if path.exists():
        when = datetime.fromtimestamp(path.stat().st_mtime, UTC).date().isoformat()
        return json.loads(path.read_text(encoding="utf-8")), "cached", when
    if offline:
        return None, "missing", None
    try:
        data = fetch()
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        return {"error": str(exc)[:200]}, "failed", None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data, "ok", _now()


def _fetch_power(lon: float, lat: float) -> Any:
    params = {
        "parameters": ",".join(POWER_PARAMS),
        "community": "AG",
        "longitude": f"{lon:.4f}",
        "latitude": f"{lat:.4f}",
        "start": f"{POWER_YEARS[0]}0101",
        "end": f"{POWER_YEARS[1]}1231",
        "format": "JSON",
    }
    r = httpx.get(POWER_API, params=params, timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT})
    r.raise_for_status()
    return r.json()


def _fetch_soilgrids(lon: float, lat: float) -> Any:
    params: list[tuple[str, str | int | float | bool | None]] = [
        ("lon", lon),
        ("lat", lat),
        ("value", "mean"),
    ]
    params += [("property", p) for p in SOIL_PROPS]
    params += [("depth", d) for d, _ in SOIL_DEPTHS]
    r = httpx.get(
        SOILGRIDS_API, params=params, timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT}
    )
    r.raise_for_status()
    return r.json()


def soil_topsoil(payload: dict[str, Any]) -> dict[str, float | None]:
    """0–30 cm thickness-weighted means in target units (%, %, % C, g/cm3, pH)."""
    out: dict[str, float | None] = {}
    for layer in payload["properties"]["layers"]:
        d = layer["unit_measure"]["d_factor"]
        vals = {x["label"]: x["values"]["mean"] for x in layer["depths"]}
        num = sum(vals[lab] / d * th for lab, th in SOIL_DEPTHS if vals.get(lab) is not None)
        den = sum(th for lab, th in SOIL_DEPTHS if vals.get(lab) is not None)
        v = num / den if den else None
        if v is not None and layer["name"] == "soc":
            v = v / 10  # g/kg → %
        out[layer["name"]] = round(v, 3) if v is not None else None
    return out


def load_layers(fid: str, offline: bool = False) -> dict[str, Any]:
    f = get_field(fid)
    poly = polygon_of(f["geometry"])
    lon, lat = poly.centroid.x, poly.centroid.y
    root = _cache(fid)
    power, p_status, p_when = _cached_json(
        root / "power.json", lambda: _fetch_power(lon, lat), offline
    )
    soil, s_status, s_when = _cached_json(
        root / "soilgrids.json", lambda: _fetch_soilgrids(lon, lat), offline
    )
    terrain, t_status, t_when = _cached_json(
        root / "terrain.json", lambda: field_terrain(poly), offline
    )
    return {
        "field": f,
        "power": {"status": p_status, "retrieved_at": p_when, "data": power},
        "soilgrids": {"status": s_status, "retrieved_at": s_when, "data": soil},
        "terrain": {"status": t_status, "retrieved_at": t_when, "data": terrain},
    }


def field_ndvi(fid: str) -> tuple[dict[int, list[float | None]] | None, dict[str, Any] | None]:
    """Daily NDVI per year from the cached MOD13Q1 composites (None if not downloaded yet)."""
    from app.analysis.indices import daily_from_composites
    from app.rotation.weather import doy_of

    path = _cache(fid) / "ndvi.json"
    if not path.exists():
        return None, None
    raw = json.loads(path.read_text(encoding="utf-8"))
    pts = []
    years: set[int] = set()
    for r in raw["rows"]:
        y, mmdd = int(r["date"][:4]), r["date"][5:]
        if mmdd == "02-29":
            continue
        years.add(y)
        pts.append((y, doy_of(mmdd), r["ndvi"]))
    daily = daily_from_composites(pts, sorted(years))
    good = sum(r["ndvi"] is not None for r in raw["rows"])
    meta = {
        "n": len(raw["rows"]),
        "good": good,
        "years": f"{min(years)}–{max(years)}" if years else None,
        "pixel_m": raw.get("pixel_m"),
        "retrieved_at": datetime.fromtimestamp(path.stat().st_mtime, UTC).date().isoformat(),
    }
    return daily, meta


def field_weather(layers: dict[str, Any]) -> Weather | None:
    p = layers["power"]
    if p["status"] in ("ok", "cached") and p["data"] and "properties" in p["data"]:
        t = layers["terrain"]
        elev = (
            t["data"].get("elevation_m") if t["status"] in ("ok", "cached") and t["data"] else None
        )
        return weather_from_power(p["data"], site_elevation_m=elev)
    return None


def field_site(
    layers: dict[str, Any],
    irrigated: bool = False,
    irrigation_limit_mm: float = 0.0,
    irrigation_method: str | None = None,
) -> FieldSite:
    f = layers["field"]
    soil = (
        soil_topsoil(layers["soilgrids"]["data"])
        if layers["soilgrids"]["status"] in ("ok", "cached")
        else {}
    )
    terr = layers["terrain"]["data"] if layers["terrain"]["status"] in ("ok", "cached") else {}
    lon, lat = f["centroid"]
    return FieldSite(
        f["id"],
        f["name"],
        lat,
        lon,
        f["area_ha"],
        sand_pct=soil.get("sand") or 40.0,
        clay_pct=soil.get("clay") or 20.0,
        soc_pct=soil.get("soc") or 1.0,
        bulk_density=soil.get("bdod") or 1.35,
        ph=soil.get("phh2o") or 7.0,
        slope_pct=(terr or {}).get("slope_pct") or 2.0,
        irrigated=irrigated,
        irrigation_limit_mm=irrigation_limit_mm,
        irrigation_method=irrigation_method,
    )


def data_card(fid: str, offline: bool = False) -> dict[str, Any]:
    """Every layer: source, resolution, coverage, gaps, coarse flag, date (ROTATION.md §2.3)."""
    layers = load_layers(fid, offline)
    f = layers["field"]
    poly = polygon_of(f["geometry"])
    rows: list[dict[str, Any]] = []
    weather = field_weather(layers)
    p = layers["power"]
    pz = point_layer(1.0, 0.5, poly)
    rows.append(
        {
            "id": "power",
            "source": "NASA POWER (MERRA-2, CERES)",
            "what": "T min/max, осадки, радиация, влажность, ветер — сутки",
            "space": "0,5° × 0,625° (≈ 50 км)",
            "time": "сутки",
            "coverage": (
                f"{weather.years[0].year}–{weather.years[-1].year}, {len(weather.years)} лет"
                if weather
                else None
            ),
            "missing_share": round(
                sum(y.gaps for y in weather.years) / (365 * len(weather.years)), 4
            )
            if weather and weather.years
            else 1.0,
            "coarse": True,
            "pixel_to_field": pz.pixel_to_field,
            "status": p["status"],
            "retrieved_at": p["retrieved_at"],
            "notes": list(weather.notes) if weather else [],
            "elevation_m": weather.elevation_m if weather else None,
        }
    )
    s = layers["soilgrids"]
    soil = soil_topsoil(s["data"]) if s["status"] in ("ok", "cached") else None
    sz = point_layer(1.0, 250 / 111_320, poly)
    rows.append(
        {
            "id": "soilgrids",
            "source": "ISRIC SoilGrids 2.0",
            "what": "песок, глина, органический углерод, плотность, pH (0–30 см)",
            "space": "250 м",
            "time": "статический (модель по данным 1950–2017)",
            "coverage": "значение в центре поля",
            "missing_share": 0.0 if soil and None not in soil.values() else 1.0,
            "coarse": sz.coarse,
            "pixel_to_field": sz.pixel_to_field,
            "status": s["status"],
            "retrieved_at": s["retrieved_at"],
            "values": soil,
            "notes": ["Модельная оценка ISRIC, не замер на поле"],
        }
    )
    t = layers["terrain"]
    terr = t["data"] if t["status"] in ("ok", "cached") else None
    rows.append(
        {
            "id": "terrain",
            "source": "Terrain Tiles (AWS Open Data): SRTM и др. DEM",
            "what": "высота и уклон → LS-фактор эрозии",
            "space": f"≈ {terr['pixel_m']:.0f} м" if terr and "pixel_m" in terr else "≈ 30 м",
            "time": "статический (SRTM 2000)",
            "coverage": f"{terr['pixels']} пикселей на поле" if terr and "pixels" in terr else None,
            "missing_share": terr.get("missing_share", 1.0) if terr else 1.0,
            "coarse": False,
            "pixel_to_field": None,
            "status": t["status"],
            "retrieved_at": t["retrieved_at"],
            "values": terr,
            "notes": [],
        }
    )
    _, nd = field_ndvi(fid)
    pixel_ha = (float(nd["pixel_m"]) ** 2 / 1e4) if nd and nd.get("pixel_m") else 6.25
    rows.append(
        {
            "id": "ndvi",
            "source": "MODIS MOD13Q1 (ORNL DAAC)",
            "what": "NDVI → периоды голой почвы",
            "space": "250 м, один пиксель в центре поля",
            "time": "композит 16 сут → интерполяция по дням (флаг)",
            "coverage": f"{nd['years']}, {nd['n']} композитов" if nd else None,
            "missing_share": round(1 - nd["good"] / nd["n"], 4) if nd and nd["n"] else 1.0,
            "coarse": pixel_ha > f["area_ha"],
            "pixel_to_field": round(pixel_ha / f["area_ha"], 2),
            "status": "cached" if nd else "missing",
            "retrieved_at": nd["retrieved_at"] if nd else None,
            "notes": [
                "Облака, снег и брак (pixel_reliability ≥ 2) — пропуск, а не ноль",
                "HLS 30 м не подключён: нужен вход Earthdata",
            ]
            if nd
            else ["Ряд ещё не загружен (сервис ORNL медленный, загрузка идёт в фоне)"],
        }
    )
    has_token = bool(os.environ.get("EARTHDATA_TOKEN"))
    for lid, src, what, space, cover in EARTHDATA_LAYERS:
        rows.append(
            {
                "id": lid,
                "source": src,
                "what": what,
                "space": space,
                "time": cover,
                "coverage": None,
                "missing_share": 1.0,
                "coarse": lid in ("smap", "grace"),
                "pixel_to_field": None,
                "status": "not_loaded" if has_token else "no_access",
                "retrieved_at": None,
                "notes": [
                    "Нужен вход NASA Earthdata: задайте EARTHDATA_TOKEN в .env"
                    if not has_token
                    else "Загрузка через AppEEARS ещё не выполнена"
                ],
            }
        )
    return {"field": f, "layers": rows}
