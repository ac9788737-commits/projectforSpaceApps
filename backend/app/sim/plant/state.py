"""Mutable state of the plants on one plot, carried hour to hour."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class Damage:
    leaf_rev: float = 0.0  # reversible leaf injury (wilting, mild frost, heat scorch)
    leaf_irrev: float = 0.0  # lost leaf tissue (hard frost, hail, radiation)
    root: float = 0.0  # root injury (waterlogging/hypoxia)
    stem: float = 0.0  # lodging / broken stems (wind)
    sterility: float = 0.0  # irreversible loss of flowers / grains set
    fruit_loss: float = 0.0  # fruits/pods knocked off (hail)

    @property
    def leaf(self) -> float:
        return min(1.0, self.leaf_rev + self.leaf_irrev)

    def health(self) -> float:
        return max(0.0, (1.0 - self.leaf) * (1.0 - self.root) * (1.0 - 0.5 * self.stem))


@dataclass(slots=True)
class Counters:
    frost_kill_hours: float = 0.0
    heat_kill_hours: float = 0.0
    waterlog_hours: float = 0.0
    wilt_hours: float = 0.0
    starvation_days: float = 0.0
    injured_today: bool = False


@dataclass(slots=True)
class DayAccumulator:
    temps: list[float] = field(default_factory=list)
    night_temps: list[float] = field(default_factory=list)
    ppfd_sum: float = 0.0
    lit_hours: float = 0.0
    hours: int = 0
    far_red_sum: float = 0.0
    co2_sum: float = 0.0
    o2_sum: float = 0.0
    pressure_sum: float = 0.0
    radiation_sum: float = 0.0
    uv_max: float = 0.0
    gravity: float = 1.0
    ks_sum: float = 0.0
    precip: float = 0.0
    wind_max: float = 0.0
    stresses: dict[str, float] = field(default_factory=dict)  # cause → worst value today

    def note(self, cause: str, value: float) -> None:
        self.stresses[cause] = max(self.stresses.get(cause, 0.0), value)


@dataclass(slots=True)
class PlotState:
    plot_id: str
    crop_id: str
    protection: str
    irrigation: str
    progress: float = 0.0
    biomass: float = 0.0
    alive: bool = True
    harvested: bool = False
    death_cause: str | None = None
    death_day: int | None = None
    harvest_day: int | None = None
    water_mm: float = 0.0
    water_used_mm: float = 0.0
    # Storage organs already in the soil when the tops die (tubers, roots) can still be dug up.
    salvage_g: float = 0.0
    damage: Damage = field(default_factory=Damage)
    counters: Counters = field(default_factory=Counters)
    day: DayAccumulator = field(default_factory=DayAccumulator)
    tuber_eff_sum: float = 0.0
    tuber_days: float = 0.0
    organ_vigour: float = 1.0
    health_ema: float | None = None
    last_stage: str = "seed"
    planted_day: int = 0
