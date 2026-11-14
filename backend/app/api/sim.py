"""Farmer simulator API: live sessions, scenarios, reports and experiments (SIMULATOR.md §4.3)."""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlmodel import Session

from app import config
from app.database import get_session
from app.models.sim_schemas import (
    ActionIn,
    BatchIn,
    BatchOut,
    BatchRow,
    ConditionsIn,
    ControlIn,
    EventIn,
    EventPatchIn,
    SavedScenarioOut,
    ScenarioIn,
    SessionOut,
    TrajectoryOut,
)
from app.sim.actions import ACTION_TYPES
from app.sim.engine import ENV_FIELDS, CropBook, SimScenario, run
from app.sim.environment.base_climate import OVERRIDABLE
from app.sim.environment.events import EVENT_TYPES, LEVELS
from app.sim.report import build_report
from app.sim.scenario import ScenarioError, canonical_json, parse_scenario
from app.sim.session import LiveSession, store
from app.sim.worlds import crop_book, resolve_world

router = APIRouter(prefix="/sim", tags=["farmer"])
SessionDep = Annotated[Session, Depends(get_session)]

PARAMETERS: list[dict[str, Any]] = [
    {
        "key": "temp_day_c",
        "label": "Температура днём",
        "group": "temperature",
        "unit": "°C",
        "min": -60,
        "max": 60,
        "step": 0.5,
    },
    {
        "key": "temp_night_c",
        "label": "Температура ночью",
        "group": "temperature",
        "unit": "°C",
        "min": -80,
        "max": 50,
        "step": 0.5,
    },
    {
        "key": "temp_soil_c",
        "label": "Температура почвы",
        "group": "temperature",
        "unit": "°C",
        "min": -40,
        "max": 45,
        "step": 0.5,
    },
    {
        "key": "precip_mm_day",
        "label": "Осадки",
        "group": "water",
        "unit": "мм/сут",
        "min": 0,
        "max": 20,
        "step": 0.1,
    },
    {
        "key": "rain_prob",
        "label": "Частота дождей",
        "group": "water",
        "unit": "доля дней",
        "min": 0,
        "max": 1,
        "step": 0.05,
    },
    {
        "key": "rh",
        "label": "Влажность воздуха",
        "group": "water",
        "unit": "доля",
        "min": 0.02,
        "max": 1,
        "step": 0.01,
    },
    {
        "key": "groundwater_m",
        "label": "Грунтовые воды",
        "group": "water",
        "unit": "м",
        "min": 0.3,
        "max": 99,
        "step": 0.1,
    },
    {
        "key": "ppfd_max",
        "label": "Свет в полдень (PPFD)",
        "group": "light",
        "unit": "мкмоль/м²/с",
        "min": 0,
        "max": 2500,
        "step": 10,
    },
    {
        "key": "light_hours",
        "label": "Длина дня",
        "group": "light",
        "unit": "ч",
        "min": 0,
        "max": 24,
        "step": 0.5,
    },
    {
        "key": "clouds",
        "label": "Облачность",
        "group": "light",
        "unit": "доля",
        "min": 0,
        "max": 1,
        "step": 0.05,
    },
    {
        "key": "spectrum",
        "label": "Спектр",
        "group": "light",
        "unit": "",
        "options": [
            ["solar", "солнечный"],
            ["warm", "тёплый"],
            ["red_dwarf", "красный карлик"],
            ["led", "LED"],
        ],
    },
    {
        "key": "co2_ppm",
        "label": "CO₂",
        "group": "air",
        "unit": "ppm",
        "min": 0,
        "max": 5000,
        "step": 10,
    },
    {
        "key": "o2_kpa",
        "label": "O₂",
        "group": "air",
        "unit": "кПа",
        "min": 0,
        "max": 60,
        "step": 0.5,
    },
    {
        "key": "pressure_kpa",
        "label": "Давление",
        "group": "air",
        "unit": "кПа",
        "min": 0,
        "max": 300,
        "step": 0.5,
    },
    {
        "key": "wind_ms",
        "label": "Ветер",
        "group": "air",
        "unit": "м/с",
        "min": 0,
        "max": 40,
        "step": 0.5,
    },
    {
        "key": "soil",
        "label": "Тип почвы",
        "group": "soil",
        "unit": "",
        "options": [
            ["sand", "песок"],
            ["loam", "суглинок"],
            ["clay", "глина"],
            ["regolith", "реголит"],
        ],
    },
    {"key": "ph", "label": "pH", "group": "soil", "unit": "", "min": 3, "max": 11, "step": 0.1},
    {
        "key": "nutrients",
        "label": "Питательные вещества",
        "group": "soil",
        "unit": "",
        "options": [["low", "низко"], ["norm", "норма"], ["high", "высоко"]],
    },
    {
        "key": "salinity_ds_m",
        "label": "Солёность",
        "group": "soil",
        "unit": "дСм/м",
        "min": 0,
        "max": 20,
        "step": 0.1,
    },
    {
        "key": "gravity_g",
        "label": "Гравитация",
        "group": "space",
        "unit": "g",
        "min": 0,
        "max": 5,
        "step": 0.01,
    },
    {
        "key": "uv_rel",
        "label": "Ультрафиолет",
        "group": "space",
        "unit": "× Земля",
        "min": 0,
        "max": 50,
        "step": 0.1,
    },
    {
        "key": "radiation_msv_yr",
        "label": "Радиационный фон",
        "group": "space",
        "unit": "мЗв/год",
        "min": 0,
        "max": 100000,
        "step": 1,
    },
]
assert {p["key"] for p in PARAMETERS} <= OVERRIDABLE

WORLDS = [
    {"id": "earth:temperate", "name_ru": "Земля, умеренный климат"},
    {"id": "earth:tropical", "name_ru": "Земля, влажные тропики"},
    {"id": "earth:arid", "name_ru": "Земля, пустыня"},
    {"id": "mars", "name_ru": "Марс"},
    {"id": "moon", "name_ru": "Луна"},
    {"id": "titan", "name_ru": "Титан"},
    {"id": "exo:TRAPPIST-1 e", "name_ru": "TRAPPIST-1 e"},
    {"id": "blank", "name_ru": "Пустой мир"},
]


def _book(session: Session) -> CropBook:
    return crop_book(session)


def _parse(raw: dict[str, Any], session: Session) -> SimScenario:
    try:
        return parse_scenario(raw, lambda w: resolve_world(session, w))
    except (ScenarioError, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc


def _session(sid: str) -> LiveSession:
    live = store.get(sid)
    if live is None:
        raise HTTPException(404, "Сессия не найдена или устарела")
    return live


def _recompute(live: LiveSession, session: Session) -> None:
    try:
        live.recompute(lambda w: resolve_world(session, w), _book(session))
    except (ScenarioError, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc
    live.hour = min(live.hour, live.end_hour)


def _session_out(live: LiveSession) -> SessionOut:
    assert live.result is not None
    return SessionOut(
        session_id=live.id,
        version=live.version,
        hour=live.hour,
        playing=live.playing,
        speed=live.speed,
        report_day_hours=live.result.report_day_hours,
        days=live.result.days,
        hours=live.result.hours,
        scenario=live.effective_raw(),
        journal=live.journal,
        world={k: v for k, v in asdict(live.result.world).items() if k != "notes"}
        | {"notes": list(live.result.world.notes)},
    )


@router.get("/catalog")
def catalog() -> dict[str, Any]:
    """What the control panel can offer: worlds, sliders, event cards and farmer actions."""
    return {
        "worlds": WORLDS,
        "parameters": PARAMETERS,
        "events": [
            {
                "id": e.id,
                "name_ru": e.name_ru,
                "unit": e.unit,
                "levels": dict(zip(LEVELS, e.levels, strict=True)),
                "default_hours": e.default_hours,
                "harm_ru": e.harm_ru,
            }
            for e in EVENT_TYPES.values()
        ],
        "actions": [{"id": k, **v} for k, v in ACTION_TYPES.items()],
    }


@router.get("/worlds/{world_id}")
def world(world_id: str, session: SessionDep) -> dict[str, Any]:
    try:
        w = resolve_world(session, world_id)
    except ScenarioError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {k: v for k, v in asdict(w).items() if k != "notes"} | {"notes": list(w.notes)}


@router.post("/sessions", response_model=SessionOut, status_code=201)
def create_session(body: ScenarioIn, session: SessionDep) -> SessionOut:
    raw = body.model_dump()
    _parse(raw, session)
    live = store.create(raw)
    with live.lock:
        _recompute(live, session)
        return _session_out(live)


@router.get("/sessions/{sid}", response_model=SessionOut)
def get_session_state(sid: str) -> SessionOut:
    live = _session(sid)
    live.tick()
    return _session_out(live)


@router.get("/sessions/{sid}/trajectory", response_model=TrajectoryOut)
def trajectory(sid: str, session: SessionDep) -> TrajectoryOut:
    live = _session(sid)
    r = live.result
    assert r is not None
    morph = _book(session).morph
    return TrajectoryOut(
        version=live.version,
        report_day_hours=r.report_day_hours,
        days=r.days,
        hours=r.hours,
        env_fields=list(ENV_FIELDS),
        env_hours=r.env_hours,
        env_days=r.env_days,
        plots=r.plots,
        summary=r.summary,
        morphology={
            pid: {
                "harvest_organ": morph[str(s["crop_id"])].harvest_organ,
                "growth_form": morph[str(s["crop_id"])].growth_form,
                "biomass_max_g": morph[str(s["crop_id"])].biomass_max_g,
                "harvest_index": morph[str(s["crop_id"])].harvest_index,
            }
            for pid, s in r.summary.items()
        },
        log=r.log,
        notes=r.notes,
    )


@router.post("/sessions/{sid}/control", response_model=SessionOut)
def control(sid: str, body: ControlIn) -> SessionOut:
    live = _session(sid)
    with live.lock:
        try:
            live.control(body.action, body.value)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return _session_out(live)


@router.patch("/sessions/{sid}/conditions", response_model=SessionOut)
def change_conditions(sid: str, body: ConditionsIn, session: SessionDep) -> SessionOut:
    live = _session(sid)
    unknown = set(body.values) - OVERRIDABLE
    if unknown:
        raise HTTPException(422, f"Неизвестные параметры: {sorted(unknown)}")
    with live.lock:
        live.tick()
        hour = live.hour if body.at_hour is None else body.at_hour
        live.journal.append({"kind": "conditions", "hour": round(hour, 3), "values": body.values})
        _recompute(live, session)
        return _session_out(live)


@router.post("/sessions/{sid}/events", response_model=SessionOut, status_code=201)
def add_event(sid: str, body: EventIn, session: SessionDep) -> SessionOut:
    live = _session(sid)
    if body.type not in EVENT_TYPES:
        raise HTTPException(422, f"Неизвестное событие: {body.type}")
    with live.lock:
        live.tick()
        start = live.hour if body.start == "now" else float(body.start)
        event: dict[str, Any] = {
            "id": live.next_id("ev"),
            "type": body.type,
            "start_hour": round(start, 3),
        }
        if body.duration_hours is not None:
            event["duration_hours"] = body.duration_hours
        if body.intensity is not None:
            event["intensity"] = body.intensity
        event.update(body.params)
        live.journal.append({"kind": "event", "hour": round(live.hour, 3), "event": event})
        _recompute(live, session)
        return _session_out(live)


@router.patch("/sessions/{sid}/events/{event_id}", response_model=SessionOut)
def move_event(sid: str, event_id: str, body: EventPatchIn, session: SessionDep) -> SessionOut:
    live = _session(sid)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    with live.lock:
        live.journal.append(
            {
                "kind": "move_event",
                "hour": round(live.hour, 3),
                "event_id": event_id,
                "event": patch,
            }
        )
        _recompute(live, session)
        return _session_out(live)


@router.delete("/sessions/{sid}/events/{event_id}", response_model=SessionOut)
def remove_event(sid: str, event_id: str, session: SessionDep) -> SessionOut:
    live = _session(sid)
    with live.lock:
        live.journal.append(
            {"kind": "remove_event", "hour": round(live.hour, 3), "event_id": event_id}
        )
        _recompute(live, session)
        return _session_out(live)


@router.post("/sessions/{sid}/actions", response_model=SessionOut, status_code=201)
def add_action(sid: str, body: ActionIn, session: SessionDep) -> SessionOut:
    live = _session(sid)
    if body.type not in ACTION_TYPES:
        raise HTTPException(422, f"Неизвестное действие: {body.type}")
    with live.lock:
        live.tick()
        hour = live.hour if body.at_hour is None else body.at_hour
        action: dict[str, Any] = {"type": body.type, "hour": round(hour, 3), **body.params}
        if body.plot:
            action["plot"] = body.plot
        live.journal.append({"kind": "action", "hour": round(hour, 3), "action": action})
        _recompute(live, session)
        return _session_out(live)


@router.get("/sessions/{sid}/report")
def session_report(sid: str, session: SessionDep) -> dict[str, Any]:
    live = _session(sid)
    assert live.scenario is not None and live.result is not None
    report = build_report(live.scenario, live.result, _book(session))
    report["scenario"] = live.effective_raw()
    return report


@router.post("/scenario/report")
def scenario_report(body: ScenarioIn, session: SessionDep) -> dict[str, Any]:
    """Scenario mode without a session: run the season and return the report."""
    sc = _parse(body.model_dump(), session)
    book = _book(session)
    return build_report(sc, run(sc, book), book)


@router.post("/batch", response_model=BatchOut)
def batch(body: BatchIn, session: SessionDep) -> BatchOut:
    """Experiment mode: sweep one condition or compare up to 8 sets of conditions."""
    raw = body.scenario.model_dump()
    sc = _parse(raw, session)
    book = _book(session)
    rows: list[BatchRow] = []
    if body.parameter:
        if body.parameter not in OVERRIDABLE:
            raise HTTPException(422, f"Неизвестный параметр: {body.parameter}")
        for value in body.values:
            variant = dict(raw, overrides={**raw["overrides"], body.parameter: value})
            res = run(_parse(variant, session), book)
            rows.append(BatchRow(label=str(value), value=value, plots=res.summary))
    for i, v in enumerate(body.variants):
        variant = {**raw, **{k: val for k, val in v.items() if k != "label"}}
        if "overrides" in v:
            variant["overrides"] = {**raw["overrides"], **v["overrides"]}
        res = run(_parse(variant, session), book)
        rows.append(
            BatchRow(label=str(v.get("label", f"Вариант {i + 1}")), value=None, plots=res.summary)
        )
    if not rows:
        res = run(sc, book)
        rows.append(BatchRow(label="Базовый", value=None, plots=res.summary))
    return BatchOut(parameter=body.parameter, rows=rows)


def _scenario_dir() -> Path:
    d = config.DATA_DIR / "scenarios"
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.post("/scenarios", response_model=SavedScenarioOut, status_code=201)
def save_scenario(body: ScenarioIn, session: SessionDep) -> SavedScenarioOut:
    raw = body.model_dump()
    _parse(raw, session)
    text = canonical_json(raw)
    sid = hashlib.sha256(text.encode()).hexdigest()[:10]
    (_scenario_dir() / f"{sid}.json").write_text(text, encoding="utf-8")
    return SavedScenarioOut(id=sid, scenario=raw)


@router.get("/scenarios/{scenario_id}", response_model=SavedScenarioOut)
def load_scenario(scenario_id: str) -> SavedScenarioOut:
    if not scenario_id.isalnum() or len(scenario_id) > 32:
        raise HTTPException(404, "Сценарий не найден")
    path = _scenario_dir() / f"{scenario_id}.json"
    if not path.exists():
        raise HTTPException(404, "Сценарий не найден")
    return SavedScenarioOut(id=scenario_id, scenario=json.loads(path.read_text(encoding="utf-8")))


@router.websocket("/sessions/{sid}/stream")
async def stream(ws: WebSocket, sid: str) -> None:
    """Frames {day, hour, env, plants, events_fired} ~10 times per second while playing.

    The client may also send {"action": "play"|"pause"|"speed"|"seek", "value": …}.
    """
    live = store.get(sid)
    await ws.accept()
    if live is None:
        await ws.send_json({"error": "Сессия не найдена"})
        await ws.close()
        return
    last_hour: float | None = None
    last_version = -1
    try:
        while True:
            with live.lock:
                live.tick()
                frame = live.frame(last_hour if last_version == live.version else None)
                frame["trajectory_changed"] = last_version != live.version
            last_version = live.version
            last_hour = live.hour
            await ws.send_json(frame)
            try:
                msg = await asyncio.wait_for(
                    ws.receive_json(), timeout=0.1 if live.playing else 0.4
                )
            except TimeoutError:
                continue
            if isinstance(msg, dict) and "action" in msg:
                with live.lock:
                    try:
                        live.control(str(msg["action"]), msg.get("value"))
                    except ValueError as exc:
                        await ws.send_json({"error": str(exc)})
    except WebSocketDisconnect:
        return
