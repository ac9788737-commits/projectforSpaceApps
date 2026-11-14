"""Weather events: time-limited changes of conditions with smooth onset and end. Pure.

Intensity is "weak" | "medium" | "strong" or an explicit number in the event's own unit.
Magnitudes below are a model of typical events (estimates, see docs/ASSUMPTIONS.md).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.sim.environment.base_climate import HourEnv

LEVELS = ("weak", "medium", "strong")


@dataclass(frozen=True, slots=True)
class EventType:
    id: str
    name_ru: str
    unit: str  # unit of the numeric intensity
    levels: tuple[float, float, float]  # weak, medium, strong
    default_hours: float
    harm_ru: str


EVENT_TYPES: dict[str, EventType] = {
    e.id: e
    for e in (
        EventType(
            "heatwave",
            "Волна жары",
            "+°C",
            (5.0, 8.0, 12.0),
            5 * 24,
            "тепловой стресс, стерильность при цветении",
        ),
        EventType(
            "frost", "Заморозок", "°C минимум", (-1.0, -3.0, -6.0), 8, "повреждение и гибель тканей"
        ),
        EventType(
            "cold_snap", "Долгое похолодание", "−°C", (4.0, 7.0, 10.0), 10 * 24, "замедление роста"
        ),
        EventType(
            "drought", "Засуха", "× испарение", (1.15, 1.3, 1.5), 14 * 24, "водный стресс, увядание"
        ),
        EventType(
            "downpour", "Ливень", "мм/ч", (3.0, 8.0, 20.0), 12, "переувлажнение, гипоксия корней"
        ),
        EventType("hail", "Град", "сила 0–1", (0.3, 0.6, 1.0), 1, "сбитые листья и плоды"),
        EventType("storm", "Буря", "м/с", (12.0, 18.0, 26.0), 12, "полегание, обломанные стебли"),
        EventType(
            "dust_storm", "Пылевая буря", "доля света", (0.6, 0.4, 0.2), 10 * 24, "нехватка света"
        ),
        EventType("flare", "Вспышка звезды", "× УФ", (5.0, 10.0, 30.0), 3, "повреждение листьев"),
        EventType(
            "eclipse",
            "Затмение / долгая ночь",
            "доля света",
            (0.0, 0.0, 0.0),
            24,
            "голодание без света",
        ),
        EventType(
            "greenhouse_failure",
            "Сбой теплицы",
            "",
            (1.0, 1.0, 1.0),
            6,
            "резкий переход к внешним условиям",
        ),
    )
}


@dataclass(frozen=True, slots=True)
class Event:
    type: str
    start_hour: float
    duration_hours: float
    intensity: float
    id: str = ""

    @property
    def end_hour(self) -> float:
        return self.start_hour + self.duration_hours


def resolve_intensity(event_type: str, intensity: str | float | None) -> float:
    spec = EVENT_TYPES[event_type]
    if intensity is None:
        return spec.levels[1]
    if isinstance(intensity, str):
        return spec.levels[LEVELS.index(intensity)]
    return float(intensity)


def envelope(event: Event, hour: float) -> float:
    """Smooth 0→1→0 weight: ramps over min(3 h, 20 % of the duration) at both ends."""
    t = hour + 0.5
    if t <= event.start_hour or t >= event.end_hour:
        return 0.0
    ramp = max(0.5, min(3.0, 0.2 * event.duration_hours))

    def smooth(x: float) -> float:
        x = min(1.0, max(0.0, x))
        return x * x * (3.0 - 2.0 * x)

    return smooth((t - event.start_hour) / ramp) * smooth((event.end_hour - t) / ramp)


def night_weight(env: HourEnv, day_hours: float) -> float:
    """1 in the coldest pre-dawn hours, 0 in the afternoon (frosts happen at night)."""
    import math

    coldest = 0.125 * day_hours
    phase = (env.hod - coldest) / day_hours
    return max(0.0, math.cos(2.0 * math.pi * phase)) ** 0.5


def apply_event(env: HourEnv, event: Event, w: float, day_hours: float, night_min_c: float) -> None:
    """Modify `env` in place for one active event with weight w ∈ (0, 1]."""
    x = event.intensity
    k = event.type
    if k == "heatwave":
        env.temp_c += x * w
        env.soil_temp_c += 0.6 * x * w
        env.rh = max(0.05, env.rh - 0.15 * w)
        env.et_mult *= 1.0 + 0.25 * w
    elif k == "frost":
        # Pull the night down so that the coldest hour reaches the event minimum.
        drop = max(0.0, night_min_c - x) * night_weight(env, day_hours) * w
        env.temp_c -= drop
        env.soil_temp_c -= 0.3 * drop
    elif k == "cold_snap":
        env.temp_c -= x * w
        env.soil_temp_c -= 0.7 * x * w
    elif k == "drought":
        env.precip_mm *= 1.0 - w
        env.rh = max(0.05, env.rh - 0.25 * w)
        env.et_mult *= 1.0 + (x - 1.0) * w
    elif k == "downpour":
        env.precip_mm += x * w
        env.rh = min(1.0, env.rh + 0.3 * w)
        env.ppfd *= 1.0 - 0.7 * w
        env.flood = env.flood or (x >= 8.0 and w > 0.5)
    elif k == "hail":
        env.hail = max(env.hail, x * w)
        env.precip_mm += 4.0 * w
        env.temp_c -= 4.0 * w
        env.ppfd *= 1.0 - 0.6 * w
    elif k == "storm":
        env.wind_ms = max(env.wind_ms, x * w)
        env.precip_mm += 3.0 * w
        env.ppfd *= 1.0 - 0.5 * w
    elif k == "dust_storm":
        env.ppfd *= 1.0 - (1.0 - x) * w
        env.uv_rel *= 1.0 - (1.0 - x) * w
        env.temp_c -= 2.0 * w
    elif k == "flare":
        env.uv_rel *= 1.0 + (x - 1.0) * w
        env.radiation_msv_yr += 500.0 * x * w
    elif k == "eclipse":
        env.ppfd *= 1.0 - (1.0 - x) * w
        env.uv_rel *= 1.0 - w
    # greenhouse_failure is handled when the protection is applied (compose.py).
