"""User overrides of the world climate, each valid from a given hour (live changes). Pure."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.sim.environment.base_climate import WorldClimate, apply_overrides


@dataclass(frozen=True, slots=True)
class OverrideChange:
    from_hour: float
    values: dict[str, float | str] = field(default_factory=dict)


class WorldTimeline:
    """World parameters as they change over time; lookups are cached per change segment."""

    def __init__(self, base: WorldClimate, changes: list[OverrideChange]):
        self.base = base
        ordered = sorted(changes, key=lambda c: c.from_hour)
        self._starts: list[float] = []
        self._worlds: list[WorldClimate] = []
        world = base
        acc: dict[str, float | str] = {}
        for change in ordered:
            acc.update(change.values)
            world = apply_overrides(base, acc)
            self._starts.append(change.from_hour)
            self._worlds.append(world)

    def at(self, hour: float) -> WorldClimate:
        world = self.base
        for start, w in zip(self._starts, self._worlds, strict=True):
            if start <= hour + 0.5:
                world = w
            else:
                break
        return world
