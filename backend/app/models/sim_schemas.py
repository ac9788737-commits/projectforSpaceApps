"""Schemas of the farmer-simulator API (/sim)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class CropPlotIn(BaseModel):
    crop: str
    plot: str
    protection: Literal["open", "greenhouse", "closed"] = "open"
    irrigation: Literal["rain", "auto"] = "rain"


class ScenarioIn(BaseModel):
    """Scenario JSON, docs/SIMULATOR.md §4.4."""

    version: int = 1
    world: str = "earth:temperate"
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    duration_days: int = Field(default=120, ge=1, le=400)
    crops: list[CropPlotIn] = Field(min_length=1, max_length=9)
    overrides: dict[str, float | str] = Field(default_factory=dict)
    live_overrides: list[dict[str, Any]] = Field(default_factory=list)
    events: list[dict[str, Any]] = Field(default_factory=list)
    actions: list[dict[str, Any]] = Field(default_factory=list)


class SessionOut(BaseModel):
    session_id: str
    version: int
    hour: float
    playing: bool
    speed: float
    report_day_hours: float
    days: int
    hours: int
    scenario: dict[str, Any]
    journal: list[dict[str, Any]]
    world: dict[str, Any]


class TrajectoryOut(BaseModel):
    version: int
    report_day_hours: float
    days: int
    hours: int
    env_fields: list[str]
    env_hours: list[list[float]]
    env_days: list[dict[str, float]]
    plots: dict[str, list[dict[str, Any]]]
    summary: dict[str, dict[str, Any]]
    morphology: dict[str, dict[str, Any]]
    log: list[dict[str, Any]]
    notes: list[str]


class ControlIn(BaseModel):
    action: Literal["play", "pause", "speed", "seek"]
    value: float | None = None


class ConditionsIn(BaseModel):
    values: dict[str, float | str]
    at_hour: float | None = Field(default=None, description="По умолчанию — текущий момент сессии")


class EventIn(BaseModel):
    type: str
    intensity: Literal["weak", "medium", "strong"] | float | None = None
    start: Literal["now"] | float = Field(default="now", description="«now» или час начала")
    duration_hours: float | None = Field(default=None, gt=0, le=24 * 120)
    params: dict[str, float] = Field(default_factory=dict)


class EventPatchIn(BaseModel):
    start_hour: float | None = None
    duration_hours: float | None = Field(default=None, gt=0)
    intensity: Literal["weak", "medium", "strong"] | float | None = None


class ActionIn(BaseModel):
    type: str
    plot: str | None = None
    at_hour: float | None = None
    params: dict[str, float | str] = Field(default_factory=dict)


class BatchIn(BaseModel):
    scenario: ScenarioIn
    parameter: str | None = Field(
        default=None, description="Перебор: имя условия, например temp_day_c"
    )
    values: list[float | str] = Field(default_factory=list, max_length=40)
    variants: list[dict[str, Any]] = Field(
        default_factory=list, max_length=8, description="Сравнение наборов условий"
    )


class BatchRow(BaseModel):
    label: str
    value: float | str | None
    plots: dict[str, dict[str, Any]]


class BatchOut(BaseModel):
    parameter: str | None
    rows: list[BatchRow]


class SavedScenarioOut(BaseModel):
    id: str
    scenario: dict[str, Any]
