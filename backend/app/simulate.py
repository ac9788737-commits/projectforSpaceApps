"""Orchestrator: planet + crop + scenario -> result. Pure, no I/O."""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

from app.biology.growth import CropParams, GrowthResult, evaluate_growth
from app.physics.environment import Assumption, BodyInputs, Environment, compute_environment
from app.scenarios import (
    ClosedFarmOptions,
    GreenhouseOptions,
    ScenarioId,
    ScenarioOutcome,
    apply_scenario,
)

GRAVITY_EXTRAPOLATION_ABOVE_G = 1.05
GRAVITY_REDUCED_BELOW_G = 0.95

FACTOR_LABELS_RU: dict[str, str] = {
    "temperature": "Температура",
    "light": "Свет (PPFD)",
    "photoperiod": "Фотопериод и DLI",
    "spectrum": "Спектр звезды",
    "co2": "CO₂",
    "o2": "O₂",
    "pressure": "Давление",
    "gravity": "Гравитация",
    "uv": "Ультрафиолет",
    "ionising": "Ионизирующее излучение",
    "water": "Вода",
    "soil": "Субстрат",
}

_ADVICE_RU: dict[str, str] = {
    "temperature": "Поддерживайте температуру около оптимума культуры: обогрев или охлаждение.",
    "light": "Добавьте досветку: естественного света не хватает.",
    "photoperiod": "Задайте искусственный фотопериод с LED, чтобы убрать длинные тёмные периоды.",
    "spectrum": "Скорректируйте спектр: добавьте сине-красные LED, отфильтруйте дальний красный.",
    "co2": "Подавайте CO₂ или удаляйте его избыток, поддерживая около 100 Па.",
    "o2": "Обеспечьте кислород для корней и тёмного дыхания (не менее 16 кПа).",
    "pressure": "Используйте герметичный объём с давлением не ниже 50 кПа.",
    "gravity": "Гравитацию сценарий не меняет: нужны центрифуга или адаптированные сорта.",
    "uv": "Экранируйте ультрафиолет стеклом, поликарбонатом или слоем воды.",
    "ionising": "Разместите посадки под грунтом или за толстым слоем защиты.",
    "water": "Нужен источник воды: добыча льда и замкнутый водооборот.",
    "soil": "Перейдите на гидропонику или очистите реголит от перхлоратов.",
}

_NEXT_SCENARIO_RU: dict[str, str] = {
    "open_surface": "Попробуйте сценарий «Теплица» или «Закрытая ферма».",
    "greenhouse": "Попробуйте сценарий «Закрытая ферма».",
}


@dataclass(frozen=True, slots=True)
class SimulationResult:
    environment: Environment
    outcome: ScenarioOutcome
    growth: GrowthResult
    confidence: str
    confidence_score: float
    assumptions: tuple[Assumption, ...]
    recommendations: tuple[str, ...]


def _recommendations(scenario: ScenarioId, growth: GrowthResult) -> list[str]:
    weak = sorted((f for f in growth.factors if f.status != "ok"), key=lambda f: f.f)
    advice = [_ADVICE_RU[f.key] for f in weak]
    if (
        any(f.status == "lethal" for f in growth.factors) or growth.yield_rel < 0.5
    ) and scenario in _NEXT_SCENARIO_RU:
        advice.append(_NEXT_SCENARIO_RU[scenario])
    return advice


def _confidence(notes: tuple[Assumption, ...]) -> tuple[str, float]:
    score = max(0.0, 1.0 - sum(n.penalty for n in notes))
    if score >= 0.8:
        return "high", score
    return ("medium", score) if score >= 0.45 else ("low", score)


def simulate(
    body: BodyInputs,
    crop: CropParams,
    scenario: ScenarioId,
    preset_id: str | None = None,
    crop_is_estimate: bool = True,
    yield_kg_m2_cycle: float | None = None,
    greenhouse_options: GreenhouseOptions | None = None,
    closed_farm_options: ClosedFarmOptions | None = None,
) -> SimulationResult:
    env = compute_environment(body, preset_id)
    outcome = apply_scenario(
        scenario, env, crop, yield_kg_m2_cycle, greenhouse_options, closed_farm_options
    )
    growth = evaluate_growth(outcome.conditions, crop)

    notes = list(env.assumptions) + list(outcome.assumptions)
    if crop_is_estimate:
        notes.append(
            Assumption(
                "crop_params_estimate",
                "Физиологические параметры культуры заданы экспертной оценкой (estimate=true).",
                0.1,
            )
        )
    if env.gravity_g > GRAVITY_EXTRAPOLATION_ABOVE_G:
        notes.append(
            Assumption(
                "gravity_extrapolation",
                "Гравитация выше земной: отклик экстраполирован, данных почти нет.",
                0.25,
            )
        )
    elif env.gravity_g < GRAVITY_REDUCED_BELOW_G:
        notes.append(
            Assumption(
                "gravity_reduced",
                "Пониженная гравитация: длительных опытов полного цикла почти нет.",
                0.15,
            )
        )
    frozen_notes = tuple(notes)
    confidence, score = _confidence(frozen_notes)
    return SimulationResult(
        environment=env,
        outcome=outcome,
        growth=growth,
        confidence=confidence,
        confidence_score=score,
        assumptions=frozen_notes,
        recommendations=tuple(_recommendations(scenario, growth)),
    )


# Inputs that may be given as a [low, high] range.
RANGE_FIELDS = frozenset(
    {
        "albedo",
        "insolation_earth",
        "surface_temp_k",
        "surface_pressure_pa",
        "pco2_pa",
        "po2_pa",
        "mass_earth",
        "radius_earth",
    }
)


@dataclass(frozen=True, slots=True)
class MonteCarloResult:
    n: int
    p10: float
    p50: float
    p90: float
    survival_probability: float


def monte_carlo(
    body: BodyInputs,
    crop: CropParams,
    scenario: ScenarioId,
    ranges: dict[str, tuple[float, float]],
    preset_id: str | None = None,
    n: int = 1000,
    seed: int = 42,
    yield_kg_m2_cycle: float | None = None,
) -> MonteCarloResult:
    """Sample uniform input ranges and return yield percentiles."""
    unknown = set(ranges) - RANGE_FIELDS
    if unknown:
        raise ValueError(f"unsupported range fields: {sorted(unknown)}")
    if n < 1:
        raise ValueError("n must be positive")
    rng = np.random.default_rng(seed)
    samples = {k: rng.uniform(lo, hi, n) for k, (lo, hi) in ranges.items()}
    yields = np.zeros(n)
    survived = 0
    for i in range(n):
        drawn = replace(body, **{k: float(v[i]) for k, v in samples.items()})  # type: ignore[arg-type]
        env = compute_environment(drawn, preset_id)
        outcome = apply_scenario(scenario, env, crop, yield_kg_m2_cycle)
        growth = evaluate_growth(outcome.conditions, crop)
        yields[i] = growth.yield_rel
        survived += int(growth.survival)
    p10, p50, p90 = np.percentile(yields, [10, 50, 90])
    return MonteCarloResult(n, float(p10), float(p50), float(p90), survived / n)
