"""Live simulation sessions: a scenario plus a timestamped journal of live changes.

The trajectory is always a pure function of (scenario + journal), so pausing, changing
conditions on the fly and rewinding are exact: rewinding recomputes from the start with
the same seed and gives the same result as playing straight through.
"""

from __future__ import annotations

import copy
import itertools
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from app.sim.engine import CropBook, SimResult, SimScenario, run
from app.sim.scenario import WorldResolver, parse_scenario

MAX_SESSIONS = 64
SPEEDS = (0.25, 1.0, 5.0, 20.0)  # simulated days per real second


@dataclass(slots=True)
class LiveSession:
    id: str
    base: dict[str, Any]
    journal: list[dict[str, Any]] = field(default_factory=list)
    hour: float = 0.0
    playing: bool = False
    speed: float = 1.0
    version: int = 0
    result: SimResult | None = None
    scenario: SimScenario | None = None
    _last_tick: float = field(default_factory=time.monotonic)
    lock: threading.RLock = field(default_factory=threading.RLock)
    _ids: itertools.count = field(default_factory=lambda: itertools.count(1))

    def next_id(self, prefix: str) -> str:
        return f"{prefix}{next(self._ids)}"

    # ---- scenario --------------------------------------------------------------------

    def effective_raw(self) -> dict[str, Any]:
        """Base scenario with every live change folded in (what the journal replays)."""
        raw = copy.deepcopy(self.base)
        raw.setdefault("events", [])
        raw.setdefault("actions", [])
        raw.setdefault("live_overrides", [])
        for entry in self.journal:
            kind = entry["kind"]
            if kind == "conditions":
                raw["live_overrides"].append(
                    {"from_hour": entry["hour"], "values": entry["values"]}
                )
            elif kind == "event":
                raw["events"].append(entry["event"])
            elif kind == "action":
                raw["actions"].append(entry["action"])
        removed = {e["event_id"] for e in self.journal if e["kind"] == "remove_event"}
        moved = {e["event_id"]: e["event"] for e in self.journal if e["kind"] == "move_event"}
        events = []
        for ev in raw["events"]:
            eid = ev.get("id")
            if eid in removed:
                continue
            events.append({**ev, **moved[eid]} if eid in moved else ev)
        raw["events"] = events
        return raw

    def recompute(self, resolve_world: WorldResolver, book: CropBook) -> None:
        self.scenario = parse_scenario(self.effective_raw(), resolve_world)
        self.result = run(self.scenario, book)
        self.version += 1

    # ---- clock -------------------------------------------------------------------------

    @property
    def end_hour(self) -> float:
        return float(self.result.hours - 1) if self.result else 0.0

    def tick(self) -> float:
        now = time.monotonic()
        dt = now - self._last_tick
        self._last_tick = now
        if self.playing and self.result:
            self.hour = min(self.end_hour, self.hour + dt * self.speed * 24.0)
            if self.hour >= self.end_hour:
                self.playing = False
        return self.hour

    def control(self, action: str, value: float | None) -> None:
        self.tick()
        if action == "play":
            if self.hour >= self.end_hour:
                self.hour = 0.0
            self.playing = True
        elif action == "pause":
            self.playing = False
        elif action == "speed" and value is not None:
            self.speed = float(value)
        elif action == "seek" and value is not None:
            self.hour = max(0.0, min(self.end_hour, float(value)))
        else:
            raise ValueError(f"неизвестная команда: {action}")
        self._last_tick = time.monotonic()

    # ---- frames ------------------------------------------------------------------------

    def frame(self, since_hour: float | None = None) -> dict[str, Any]:
        assert self.result is not None
        r = self.result
        h = int(min(max(self.hour, 0.0), r.hours - 1))
        day = min(int(self.hour // r.report_day_hours), r.days - 1)
        row = r.env_hours[h]
        env = dict(
            zip(
                ("temp_c", "rh", "precip_mm", "ppfd", "wind_ms", "uv_rel", "hail", "flood"),
                row,
                strict=True,
            )
        )
        plants = {pid: recs[min(day, len(recs) - 1)] for pid, recs in r.plots.items() if recs}
        fired = []
        if since_hour is not None and self.hour > since_hour:
            fired = [e for e in r.log if since_hour < float(e["hour"]) <= self.hour]  # type: ignore[arg-type]
        return {
            "version": self.version,
            "hour": round(self.hour, 3),
            "day": day,
            "playing": self.playing,
            "speed": self.speed,
            "env": env,
            "plants": plants,
            "events_fired": fired,
        }


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, LiveSession] = {}
        self._lock = threading.Lock()
        self._counter = itertools.count(1)

    def create(self, base: dict[str, Any]) -> LiveSession:
        with self._lock:
            sid = f"s{int(time.time() * 1000) % 10_000_000:07d}{next(self._counter)}"
            session = LiveSession(sid, base)
            self._sessions[sid] = session
            while len(self._sessions) > MAX_SESSIONS:
                self._sessions.pop(next(iter(self._sessions)))
            return session

    def get(self, sid: str) -> LiveSession | None:
        return self._sessions.get(sid)

    def clear(self) -> None:
        self._sessions.clear()


store = SessionStore()
