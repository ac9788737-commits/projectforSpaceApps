"""Fields on the map, their data layers and rotation runs (docs/ROTATION.md, stage 7)."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.geo import fields as geo
from app.i18n import field_text
from app.i18n import translate as tr
from app.rotation.crops import rotation_crops
from app.rotation.model import rotation_from_plan
from app.rotation.rules import check_rotation
from app.rotation.simulate import run_rotation

router = APIRouter(tags=["fields"])


class FieldIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    geometry: dict[str, Any]


class RotationIn(BaseModel):
    plan: list[tuple[str | None, str | None]] = Field(min_length=1, max_length=6)
    fert: dict[str, float] = Field(default_factory=dict)
    irrigated: bool = False
    irrigation_limit_mm: float = Field(default=0.0, ge=0, le=3000)
    start_year: int | None = None


def _field(fid: str) -> dict[str, Any]:
    try:
        return geo.get_field(fid)
    except KeyError as exc:
        raise HTTPException(404, "поле не найдено") from exc


@router.get("/fields")
def list_fields(lang: str = "ru") -> list[dict[str, Any]]:
    return [field_text(f, lang) for f in geo.list_fields()]


@router.post("/fields", status_code=201)
def create_field(body: FieldIn) -> dict[str, Any]:
    try:
        return geo.save_field(body.name, body.geometry)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except OSError as exc:
        detail = f"не удалось сохранить поле: {exc.strerror} ({exc.filename})"
        raise HTTPException(503, detail) from exc


@router.get("/fields/{fid}")
def get_field(fid: str, lang: str = "ru") -> dict[str, Any]:
    return field_text(_field(fid), lang)


@router.post("/fields/{fid}/load")
def load_field(fid: str, offline: bool = False) -> dict[str, Any]:
    """Download (or reuse cached) NASA POWER, SoilGrids and terrain for the field."""
    _field(fid)
    layers = geo.load_layers(fid, offline)
    return {
        k: {"status": v["status"], "retrieved_at": v["retrieved_at"]}
        for k, v in layers.items()
        if k != "field"
    }


@router.get("/fields/{fid}/data-card")
def data_card(fid: str, offline: bool = False) -> dict[str, Any]:
    _field(fid)
    return geo.data_card(fid, offline)


@router.get("/fields/{fid}/history")
def history(fid: str) -> dict[str, Any]:
    """10–20 years of the field: bare soil, heat, drought, frost, vulnerable windows (§3.1)."""
    _field(fid)
    return _history(fid)


def _history(fid: str) -> dict[str, Any]:
    from app.analysis.history import analyse

    layers = geo.load_layers(fid, offline=False)
    weather = geo.field_weather(layers)
    if weather is None:
        raise HTTPException(503, "нет погоды NASA POWER для поля")
    ndvi, _ = geo.field_ndvi(fid)
    key = (fid, len(weather.years), ndvi is not None)
    if key not in _HISTORY:
        _HISTORY[key] = analyse(weather, ndvi)
    return _HISTORY[key]


_HISTORY: dict[tuple[str, int, bool], dict[str, Any]] = {}


class ProfileIn(BaseModel):
    weights: dict[str, float] = Field(
        default_factory=lambda: {"yield": 3.0, "income": 3.0, "risk": 3.0}
    )
    years: int = Field(default=4, ge=3, le=5)
    horizon: int | None = Field(default=None, ge=3, le=10)
    allowed: list[str] | None = None
    required: list[str] = Field(default_factory=list)
    forbidden: list[str] = Field(default_factory=list)
    sellable: list[str] | None = None
    machinery: list[str] = Field(default_factory=lambda: ["small_seed_drill"])
    irrigated: bool = False
    water_limit_m3_ha: float = Field(default=0.0, ge=0, le=30000)
    budget_usd_ha: float | None = Field(default=None, ge=0)
    covers: list[str] = Field(
        default_factory=lambda: ["vetch", "rye_cover", "mustard", "clover", "phacelia"]
    )
    prices: dict[str, float] = Field(default_factory=dict)
    fert: dict[str, float] | None = None
    scenario: str = "history"
    d_temp_c: float | None = Field(default=None, ge=-3, le=6)
    d_precip: float | None = Field(default=None, ge=-0.6, le=0.6)
    d_heat_c: float | None = Field(default=None, ge=0, le=6)
    seed: int = 7


_PLANS: dict[str, dict[str, Any]] = {}


@router.post("/fields/{fid}/plan")
def plan(fid: str, body: ProfileIn) -> dict[str, Any]:
    """Generate and rank rotations for the farmer's priorities on this field (§3.2, §4)."""
    import hashlib
    import json as _json

    from app.climate.stress_scenarios import PRESETS as STRESS
    from app.climate.stress_scenarios import apply, custom
    from app.rotation.optimizer import DEFAULT_N, Profile, optimise

    _field(fid)
    key = hashlib.sha1((fid + _json.dumps(body.model_dump(), sort_keys=True)).encode()).hexdigest()
    if key in _PLANS:
        return _PLANS[key]
    layers = geo.load_layers(fid, offline=False)
    weather = geo.field_weather(layers)
    if weather is None:
        raise HTTPException(503, "нет погоды NASA POWER для поля")
    if body.d_temp_c is not None or body.d_precip is not None or body.d_heat_c is not None:
        scen = custom(body.d_temp_c or 0.0, body.d_precip or 0.0, body.d_heat_c or 0.0)
    else:
        scen = STRESS.get(body.scenario, STRESS["history"])
    weather = apply(weather, scen)
    site = geo.field_site(layers, body.irrigated, body.water_limit_m3_ha / 10)
    prof = Profile(
        weights=body.weights,
        years=body.years,
        horizon=body.horizon,
        allowed=body.allowed,
        required=body.required,
        forbidden=body.forbidden,
        sellable=body.sellable,
        machinery=body.machinery,
        irrigated=body.irrigated,
        water_limit_m3_ha=body.water_limit_m3_ha,
        budget_usd_ha=body.budget_usd_ha,
        covers=body.covers,
        prices=body.prices,
        fert=body.fert if body.fert is not None else dict(DEFAULT_N),
        seed=body.seed,
    )
    result = optimise(site, weather, prof)
    result["scenario"] = {
        "id": scen.id,
        "name_ru": scen.name_ru,
        "d_temp_c": scen.d_temp_c,
        "d_precip": scen.d_precip,
        "d_heat_c": scen.d_heat_c,
    }
    result["weather_notes"] = list(weather.notes)
    from app.explain.explain import explain, facts, template

    schemes = result["schemes"]
    for i, sc in enumerate(schemes):
        base = schemes[1] if i == 0 and len(schemes) > 1 else schemes[0]
        sc["explanation"] = template(facts(sc, base))
    _PLANS[key] = result
    _ = explain
    return result


class ExplainIn(BaseModel):
    scheme: dict[str, Any]
    baseline: dict[str, Any]


@router.post("/explain")
def explain_scheme(body: ExplainIn) -> dict[str, Any]:
    """«Почему это место?»: text from computed numbers only (Claude if a key is set)."""
    from app.explain.explain import explain

    try:
        return explain(body.scheme, body.baseline)
    except (KeyError, TypeError, ZeroDivisionError) as exc:
        raise HTTPException(422, f"неполные данные схемы: {exc}") from exc


@router.get("/fields/{fid}/gaps")
def gaps(fid: str, lang: str = "ru") -> dict[str, Any]:
    """«Пробелы в данных и риски: что проверить агроному на месте» (§5.2)."""
    from app.explain.gaps import gaps as build

    _field(fid)
    card = geo.data_card(fid)
    est = [c.name_ru for c in rotation_crops().values() if c.estimate]
    try:
        hist: dict[str, Any] | None = _history(fid)
    except HTTPException:
        hist = None
    out: dict[str, Any] = tr(build(card, est, hist), lang)
    return out


class QuickIn(BaseModel):
    lang: str = Field(default="ru", pattern="^(ru|en|tg)$")
    field_id: str
    prices: dict[str, float] = Field(default_factory=dict)
    plan: list[tuple[str | None, str | None]] = Field(min_length=1, max_length=6)
    irrigation: str | None = Field(default=None, pattern="^(none|furrow|drip)$")
    irrigated: bool = False
    water_limit_m3_ha: float = Field(default=0.0, ge=0, le=30000)
    scenario: str = "history"
    start_year: int | None = None


@router.post("/rotation/quick")
def rotation_quick(body: QuickIn) -> dict[str, Any]:
    """Instant evaluation of one plan for the builder: 4 indicators, 20 years, links, playback."""
    from app.rotation.quick import quick

    _field(body.field_id)
    known = rotation_crops()
    for main, cover in body.plan:
        for c in (main, cover):
            if c is not None and c not in known:
                raise HTTPException(422, f"неизвестная культура: {c}")
    try:
        irrigated, method, limit = body.irrigated, None, body.water_limit_m3_ha
        if body.irrigation is not None:
            irrigated = body.irrigation != "none"
            method = body.irrigation if irrigated else None
            limit = (limit or 9000.0) if irrigated else 0.0
        return tr(
            quick(
                body.field_id,
                list(body.plan),
                irrigated,
                limit / 10,
                body.scenario,
                body.start_year,
                method,
                body.prices or None,
            ),
            body.lang,
        )
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/rotation/deck")
def rotation_deck(field_id: str | None = None, lang: str = "ru") -> list[dict[str, Any]]:
    """Crop cards; with a field, each card says whether it needs irrigation there."""
    from app.rotation.quick import deck, needs_water

    cards = deck()
    if field_id:
        _field(field_id)
        flags = needs_water(field_id)
        cards = [{**c, "needs_water": flags.get(c["id"], False)} for c in cards]
    out: list[dict[str, Any]] = tr(cards, lang)
    return out


@router.get("/irrigation/methods")
def irrigation_list() -> dict[str, Any]:
    from app.rotation.model import irrigation_methods

    return irrigation_methods()


class AdviceIn(BaseModel):
    lang: str = Field(default="ru", pattern="^(ru|en|tg)$")
    field_id: str
    irrigation: str | None = Field(default=None, pattern="^(none|furrow|drip)$")
    budget_usd_ha: float | None = Field(default=None, ge=0)
    labour_days_max: float | None = Field(default=None, ge=0)
    priorities: list[str] = Field(default_factory=lambda: ["income"], max_length=4)
    years: int = Field(default=4, ge=3, le=5)
    irrigated: bool = False
    water_limit_m3_ha: float = Field(default=0.0, ge=0, le=30000)
    scenario: str = "history"
    allowed: list[str] | None = None


@router.post("/rotation/advice")
def rotation_advice(body: AdviceIn) -> dict[str, Any]:
    """«Подобрать лучший план»: a fast optimiser pass for the chosen priorities."""
    from app.rotation.advice import advice

    _field(body.field_id)
    irrigated, method, limit = body.irrigated, None, body.water_limit_m3_ha
    if body.irrigation is not None:
        irrigated = body.irrigation != "none"
        method = body.irrigation if irrigated else None
        limit = (limit or 9000.0) if irrigated else 0.0
    return tr(
        advice(
            body.field_id,
            body.priorities,
            body.years,
            irrigated,
            limit,
            body.scenario,
            body.allowed,
            method,
            body.budget_usd_ha,
            body.labour_days_max,
        ),
        body.lang,
    )


class FixIn(BaseModel):
    lang: str = Field(default="ru", pattern="^(ru|en|tg)$")
    field_id: str
    plan: list[tuple[str | None, str | None]] = Field(min_length=1, max_length=6)
    year: int = Field(ge=0, le=5)
    slot: int = Field(ge=0, le=1)
    priorities: list[str] = Field(default_factory=list, max_length=4)
    irrigation: str | None = Field(default=None, pattern="^(none|furrow|drip)$")
    water_limit_m3_ha: float = Field(default=0.0, ge=0, le=30000)
    budget_usd_ha: float | None = Field(default=None, ge=0)


@router.post("/rotation/fix")
def rotation_fix(body: FixIn) -> list[dict[str, Any]]:
    """«Чем заменить?» for one cell of the plan (docs/IMPROVEMENTS.md B7)."""
    from app.rotation.quick import alternatives

    _field(body.field_id)
    irrigated = body.irrigation not in (None, "none")
    method = body.irrigation if irrigated else None
    limit = (body.water_limit_m3_ha or 9000.0) / 10 if irrigated else 0.0
    out: list[dict[str, Any]] = tr(
        alternatives(
            body.field_id,
            list(body.plan),
            body.year,
            body.slot,
            body.priorities,
            irrigated,
            limit,
            method,
            body.budget_usd_ha,
        ),
        body.lang,
    )
    return out


@router.get("/economics")
def economics() -> dict[str, Any]:
    from app.rotation.economics import default_economics

    e = default_economics()
    return {
        "crops": {
            k: {
                "price_usd_t": v.price_usd_t,
                "seed_usd_ha": v.seed_usd_ha,
                "ops_usd_ha": v.ops_usd_ha,
                "labour_h_ha": v.labour_h_ha,
                "machinery": v.machinery,
                "estimate": v.estimate,
                "reference": v.reference,
            }
            for k, v in e.crops.items()
        },
        "n_usd_kg": e.n_usd_kg,
        "water_usd_m3": e.water_usd_m3,
        "references": list(e.references),
    }


@router.get("/climate/scenarios")
def scenarios() -> list[dict[str, Any]]:
    from app.climate.stress_scenarios import PRESETS as STRESS

    return [
        {
            "id": s.id,
            "name_ru": s.name_ru,
            "d_temp_c": s.d_temp_c,
            "d_precip": s.d_precip,
            "d_heat_c": s.d_heat_c,
            "spring_precip": s.spring_precip,
        }
        for s in STRESS.values()
    ]


@router.get("/fields/{fid}/passport")
def field_passport(fid: str, lang: str = "ru") -> dict[str, Any]:
    """«Паспорт поля»: four plain-language cards, the 20-year calendar and data sources."""
    from app.analysis.passport import passport

    _field(fid)
    layers = geo.load_layers(fid, offline=False)
    weather = geo.field_weather(layers)
    if weather is None:
        raise HTTPException(503, "нет погоды NASA POWER для поля")
    layers["ndvi_ok"] = geo.field_ndvi(fid)[0] is not None
    return tr(passport(_history(fid), weather, layers), lang)


@router.get("/fields/{fid}/imagery")
def field_imagery(
    fid: str, kind: str = "truecolor", offline: bool = False, lang: str = "ru"
) -> dict[str, Any]:
    """Field picture from the cascade (fresh Sentinel-2 → mosaic → local); always answers."""
    from app.geo.harmonize import polygon_of
    from app.geo.imagery import padded_bounds, picture

    if kind not in ("truecolor", "ndvi"):
        raise HTTPException(422, "kind: truecolor | ndvi")
    f = _field(fid)
    poly = polygon_of(f["geometry"])
    pic, pending = picture(fid, poly, kind, offline=offline)
    return {
        "bounds": [round(v, 6) for v in padded_bounds(poly)],
        "url": f"/imagery/{pic.file}",
        "kind": pic.kind,
        "date": pic.date,
        "level": pic.level,
        "cloud_pct": pic.cloud_pct,
        "source": tr(pic.source, lang, "note"),
        "attribution": pic.attribution,
        "note": tr(pic.note, lang, "note"),
        "pending": pending,
    }


@router.get("/imagery/{name}")
def imagery_file(name: str) -> Any:
    from fastapi.responses import FileResponse

    from app.geo.imagery import file_path

    path = file_path(name)
    if path is None:
        raise HTTPException(404, "нет такого снимка")
    return FileResponse(
        path, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"}
    )


@router.get("/reference/crops")
def reference_crops(lang: str = "ru") -> list[dict[str, Any]]:
    """«Откуда цифры»: crop parameters with a source each, or None for an estimate (B13)."""
    from app.rotation.reference import crop_reference

    out: list[dict[str, Any]] = tr(crop_reference(), lang)
    return out


@router.get("/rotation/crops")
def crops(lang: str = "ru") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = tr(
        [
            {
                "id": c.id,
                "name_ru": c.name_ru,
                "family": c.family,
                "family_ru": c.family_ru,
                "is_cover": c.is_cover,
                "is_legume": c.is_legume,
                "season_days": c.season_days,
                "sow_mmdd": c.sow_mmdd,
                "root_depth_m": c.root_depth_m,
                "min_break_years": c.min_break_years,
                "ymax_t_ha": c.ymax_t_ha,
                "estimate": c.estimate,
                "references": list(c.references),
            }
            for c in rotation_crops().values()
        ],
        lang,
    )
    return out


@router.post("/fields/{fid}/rotation/run")
def run(fid: str, body: RotationIn) -> dict[str, Any]:
    """One rotation on consecutive historical years of the field's weather."""
    _field(fid)
    known = rotation_crops()
    for main, cover in body.plan:
        for c in (main, cover):
            if c is not None and c not in known:
                raise HTTPException(422, f"неизвестная культура: {c}")
    layers = geo.load_layers(fid, offline=False)
    weather = geo.field_weather(layers)
    if weather is None:
        raise HTTPException(503, "нет погоды NASA POWER для поля")
    site = geo.field_site(layers, body.irrigated, body.irrigation_limit_mm)
    rot = rotation_from_plan("plan", "Схема", list(body.plan), body.fert)
    years = list(weather.years)
    start = 0
    if body.start_year is not None:
        start = next((i for i, w in enumerate(years) if w.year == body.start_year), 0)
    seq = (years[start:] + years[:start])[: rot.years]
    result = run_rotation(site, rot, seq)
    return {
        "site": {
            "texture": site.texture.name_ru,
            "soc_pct": site.soc_pct,
            "slope_pct": site.slope_pct,
            "k_factor": round(site.k_factor, 4),
            "ls": round(site.ls, 3),
        },
        "years": [asdict(y) for y in result.years],
        "soil_cover_weekly": result.soil_cover,
        "rules": [asdict(v) for v in check_rotation(rot)],
    }
