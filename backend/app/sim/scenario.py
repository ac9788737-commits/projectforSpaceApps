"""Scenario JSON (docs/SIMULATOR.md §4.4) ↔ SimScenario. Pure apart from the world resolver."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from app.sim.actions import ACTION_TYPES, Action
from app.sim.engine import PROTECTIONS, PlotSpec, SimScenario
from app.sim.environment.base_climate import OVERRIDABLE, WorldClimate
from app.sim.environment.events import EVENT_TYPES, Event, resolve_intensity
from app.sim.environment.overrides import OverrideChange

SCENARIO_VERSION = 1
MAX_DAYS = 400
EVENT_PARAMS = {  # explicit numeric parameter names accepted in place of "intensity"
    "heatwave": "delta_c",
    "frost": "min_temp_c",
    "cold_snap": "delta_c",
    "drought": "et_factor",
    "downpour": "mm_h",
    "hail": "strength",
    "storm": "wind_ms",
    "dust_storm": "light",
    "flare": "uv_x",
    "eclipse": "light",
}

WorldResolver = Callable[[str], WorldClimate]


class ScenarioError(ValueError):
    pass


def _num(value: Any, name: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ScenarioError(f"{name}: ожидалось число") from exc


def parse_event(raw: dict[str, Any], day_hours: float, index: int) -> Event:
    kind = raw.get("type")
    if kind not in EVENT_TYPES:
        raise ScenarioError(f"неизвестное событие: {kind}")
    if "start_hour" in raw:
        start = _num(raw["start_hour"], "start_hour")
    else:
        start = _num(raw.get("start_day", 0), "start_day") * day_hours
    spec = EVENT_TYPES[kind]
    if "duration_hours" in raw:
        duration = _num(raw["duration_hours"], "duration_hours")
    elif "duration_days" in raw:
        duration = _num(raw["duration_days"], "duration_days") * day_hours
    else:
        duration = spec.default_hours
        if kind == "frost":
            # A frost acts at night: started in the daytime it lasts through the coming night,
            # until the morning after the coldest pre-dawn hour.
            to_coldest = (0.125 * day_hours - start % day_hours) % day_hours
            duration = max(duration, to_coldest + 6.0)
    if duration <= 0:
        raise ScenarioError("длительность события должна быть больше нуля")
    param = EVENT_PARAMS.get(kind)
    if param and param in raw:
        intensity = _num(raw[param], param)
    else:
        level = raw.get("intensity")
        if level is not None and not isinstance(level, str):
            intensity = _num(level, "intensity")
        else:
            if level is not None and level not in ("weak", "medium", "strong"):
                raise ScenarioError(f"сила события: {level}")
            intensity = resolve_intensity(kind, level)
    return Event(kind, start, duration, intensity, id=str(raw.get("id") or f"e{index}"))


def parse_action(raw: dict[str, Any], day_hours: float) -> Action:
    kind = raw.get("type")
    if kind not in ACTION_TYPES:
        raise ScenarioError(f"неизвестное действие: {kind}")
    hour = (
        _num(raw["hour"], "hour")
        if "hour" in raw
        else _num(raw.get("day", 0), "day") * day_hours + 8.0
    )
    params = {k: v for k, v in raw.items() if k not in ("type", "day", "hour", "plot")}
    return Action(kind, hour, raw.get("plot"), params)


def parse_scenario(raw: dict[str, Any], resolve_world: WorldResolver) -> SimScenario:
    if raw.get("version", SCENARIO_VERSION) != SCENARIO_VERSION:
        raise ScenarioError("неподдерживаемая версия сценария")
    world = resolve_world(str(raw.get("world", "earth:temperate")))
    day_hours = world.report_day_hours
    duration = int(_num(raw.get("duration_days", 120), "duration_days"))
    if not 1 <= duration <= MAX_DAYS:
        raise ScenarioError(f"длительность сезона: от 1 до {MAX_DAYS} суток")
    crops = raw.get("crops") or []
    if not crops:
        raise ScenarioError("в сценарии нет ни одной культуры")
    plots: list[PlotSpec] = []
    for i, c in enumerate(crops):
        protection = c.get("protection", "open")
        if protection not in PROTECTIONS:
            raise ScenarioError(f"защита грядки: {protection}")
        irrigation = c.get("irrigation", "rain")
        if irrigation not in ("rain", "auto"):
            raise ScenarioError(f"полив: {irrigation}")
        plots.append(
            PlotSpec(str(c.get("plot") or f"P{i + 1}"), str(c["crop"]), protection, irrigation)
        )
    if len({p.id for p in plots}) != len(plots):
        raise ScenarioError("номера грядок повторяются")
    overrides = (
        [OverrideChange(0.0, _overrides(raw.get("overrides") or {}))]
        if raw.get("overrides")
        else []
    )
    for change in raw.get("live_overrides") or []:
        overrides.append(
            OverrideChange(
                _num(change["from_hour"], "from_hour"), _overrides(change.get("values") or {})
            )
        )
    events = tuple(parse_event(e, day_hours, i) for i, e in enumerate(raw.get("events") or []))
    actions = tuple(parse_action(a, day_hours) for a in raw.get("actions") or [])
    return SimScenario(
        world=world,
        plots=tuple(plots),
        seed=int(_num(raw.get("seed", 42), "seed")),
        duration_days=duration,
        overrides=tuple(overrides),
        events=events,
        actions=actions,
    )


def _overrides(values: dict[str, Any]) -> dict[str, float | str]:
    unknown = set(values) - OVERRIDABLE
    if unknown:
        raise ScenarioError(f"неизвестные параметры: {sorted(unknown)}")
    out: dict[str, float | str] = {}
    for k, v in values.items():
        out[k] = v if k in ("soil", "nutrients", "spectrum") else _num(v, k)
    return out


def canonical_json(data: Any) -> str:
    """Stable serialisation: identical input → byte-identical output."""
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
