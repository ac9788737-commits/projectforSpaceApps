"""Farmer actions: irrigation, fertiliser, mulch, frost cover, shade, drainage, stakes,
harvest and re-sowing."""

from __future__ import annotations

from dataclasses import dataclass, field

ACTION_TYPES: dict[str, dict[str, object]] = {
    "irrigate": {"name_ru": "Полив", "param": "mm", "default": 20.0},
    "fertilize": {"name_ru": "Удобрение", "param": "days", "default": 30.0},
    "mulch": {"name_ru": "Мульчирование", "param": None, "default": None},
    "frost_cover": {"name_ru": "Укрытие от заморозка", "param": "hours", "default": 72.0},
    "shade": {"name_ru": "Затенение", "param": "hours", "default": 72.0},
    "drain": {"name_ru": "Дренаж", "param": None, "default": None},
    "stake": {"name_ru": "Подвязка", "param": None, "default": None},
    "harvest": {"name_ru": "Сбор урожая", "param": None, "default": None},
    "replant": {"name_ru": "Пересев", "param": "crop", "default": None},
}


@dataclass(frozen=True, slots=True)
class Action:
    type: str
    hour: float
    plot: str | None = None  # None: every plot
    params: dict[str, float | str] = field(default_factory=dict)

    def applies_to(self, plot_id: str) -> bool:
        return self.plot is None or self.plot == plot_id

    def amount(self) -> float:
        spec = ACTION_TYPES[self.type]
        key = spec["param"]
        if key is None or key == "crop":
            return 0.0
        return float(self.params.get(str(key), spec["default"]))  # type: ignore[arg-type]


@dataclass(frozen=True, slots=True)
class ActiveMeasures:
    frost_cover: bool = False
    shade: bool = False
    mulch: bool = False
    drained: bool = False
    staked: bool = False
    fertilized: bool = False


def measures_at(
    actions: tuple[Action, ...], plot_id: str, hour: int, report_day_hours: float
) -> ActiveMeasures:
    fc = sh = mu = dr = stk = fe = False
    for a in actions:
        if not a.applies_to(plot_id) or a.hour > hour + 0.5:
            continue
        if a.type == "frost_cover" and hour < a.hour + a.amount():
            fc = True
        elif a.type == "shade" and hour < a.hour + a.amount():
            sh = True
        elif a.type == "mulch":
            mu = True
        elif a.type == "drain":
            dr = True
        elif a.type == "stake":
            stk = True
        elif a.type == "fertilize" and hour < a.hour + a.amount() * report_day_hours:
            fe = True
    return ActiveMeasures(fc, sh, mu, dr, stk, fe)
