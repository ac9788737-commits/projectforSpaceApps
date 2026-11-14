"""Scenarios transform the outdoor environment into the conditions a plant experiences."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from app.biology.growth import KELVIN, CropParams, GrowthConditions
from app.physics.environment import Assumption, Environment

ScenarioId = Literal["open_surface", "greenhouse", "closed_farm"]

WATER_TRIPLE_POINT_PA = 611.7
BOILING_POINT_K = 373.15
PHOTOPERIOD_LED_H = 16.0
LED_EFFICACY_UMOL_J = 2.8  # high-end horticultural LED fixtures
HVAC_OVERHEAD = 1.4
MJ_PER_KWH = 3.6
_SOLAR_LIKE_FAR_RED_RATIO = 0.33
_HULL_LIMIT_PRESSURE_PA = 300_000.0
_HULL_LIMIT_TEMP_K = 400.0


@dataclass(frozen=True, slots=True)
class GreenhouseOptions:
    min_pressure_kpa: float = 50.0
    glass_transmission: float = 0.8
    uv_transmission: float = 0.1
    max_heating_k: float = 120.0
    max_cooling_k: float = 50.0
    heat_transfer_w_m2_k: float = 2.0
    max_external_pressure_kpa: float = 300.0


@dataclass(frozen=True, slots=True)
class ClosedFarmOptions:
    pressure_kpa: float = 101.3
    pco2_pa: float = 100.0
    po2_kpa: float = 21.0
    radiation_shielding: float = 0.01


@dataclass(frozen=True, slots=True)
class ScenarioOutcome:
    conditions: GrowthConditions
    engineering: dict[str, float | bool | str | None]
    assumptions: tuple[Assumption, ...] = field(default_factory=tuple)


def best_site_temp_k(mean_k: float, spread_k: float, target_k: float) -> float:
    """Temperature of the site closest to the crop's optimum within the planet's spread."""
    return max(mean_k - spread_k, min(mean_k + spread_k, target_k))


def open_surface(env: Environment, crop: CropParams) -> ScenarioOutcome:
    """Scenario A: the environment as it is, at the most suitable site."""
    target_k = crop.t_opt_c + KELVIN
    site_k = best_site_temp_k(env.surface_temp_k, env.site_spread_k, target_k)
    liquid = env.pressure_pa >= WATER_TRIPLE_POINT_PA and KELVIN <= site_k <= BOILING_POINT_K
    conditions = GrowthConditions(
        t_mean_c=site_k - KELVIN,
        diurnal_amplitude_k=env.diurnal_amplitude_k,
        ppfd_umol_m2_s=env.daytime_ppfd_umol_m2_s,
        light_hours=env.light_hours,
        dark_hours=env.dark_hours,
        dli_mol_m2_d=env.dli_mol_m2_d,
        far_red_ratio=env.far_red_to_par_ratio,
        pco2_pa=env.pco2_pa,
        po2_pa=env.po2_pa,
        pressure_pa=env.pressure_pa,
        gravity_g=env.gravity_g,
        uv_relative=env.uv_relative,
        ionising_msv_yr=env.ionising_msv_yr,
        water=env.water,
        liquid_water_stable=liquid,
        engineered_water=False,
        substrate=env.substrate,
        soil_ph=env.soil_ph,
        perchlorate_wt_pct=env.perchlorate_wt_pct,
    )
    notes = [
        Assumption(
            "site_selection",
            "Выбран лучший участок планеты по температуре (широта и сезон).",
            0.05,
        )
    ]
    return ScenarioOutcome(conditions, {"site_temp_k": site_k}, tuple(notes))


def greenhouse(
    env: Environment, crop: CropParams, options: GreenhouseOptions | None = None
) -> ScenarioOutcome:
    """Scenario B: pressurised dome using natural light."""
    opt = options or GreenhouseOptions()
    target_k = crop.t_opt_c + KELVIN
    external_k = best_site_temp_k(env.surface_temp_k, env.site_spread_k, target_k)
    inside_k = max(external_k - opt.max_cooling_k, min(external_k + opt.max_heating_k, target_k))

    notes: list[Assumption] = []
    external_kpa = env.pressure_pa / 1000.0
    feasible = external_kpa <= opt.max_external_pressure_kpa and env.has_solid_surface
    # A dome cannot hold out a very dense atmosphere: the inside follows the outside pressure.
    if external_kpa > opt.max_external_pressure_kpa:
        inside_kpa = external_kpa
        po2_pa, pco2_pa = env.po2_pa, env.pco2_pa
        notes.append(
            Assumption(
                "dome_crushed",
                "Внешнее давление превышает прочность купола: внутри то же давление и газы.",
                0.1,
            )
        )
    else:
        inside_kpa = max(min(external_kpa, 101.3), opt.min_pressure_kpa)
        po2_pa = min(21_000.0, inside_kpa * 1000.0 * 0.4)
        pco2_pa = 100.0
    if not env.has_solid_surface:
        notes.append(
            Assumption(
                "floating_platform",
                "Нет твёрдой поверхности: предполагается плавающая платформа в атмосфере.",
                0.3,
            )
        )

    substrate = "hydroponic" if env.substrate in ("none", "ice") else "treated_regolith"
    if env.substrate == "soil":
        substrate = "soil"
    perchlorate = (env.perchlorate_wt_pct or 0.0) * 0.01
    if perchlorate > 0:
        notes.append(
            Assumption("regolith_washing", "Грунт отмыт от перхлоратов (остаток около 1%).", 0.1)
        )
    if env.water in ("unknown", "trace"):
        notes.append(Assumption("water_supply", "Источник воды не подтверждён.", 0.15))

    ppfd = env.daytime_ppfd_umol_m2_s * opt.glass_transmission
    delta_t = abs(inside_k - external_k)
    conditions = GrowthConditions(
        t_mean_c=inside_k - KELVIN,
        diurnal_amplitude_k=min(env.diurnal_amplitude_k * 0.1, 10.0),
        ppfd_umol_m2_s=ppfd,
        light_hours=env.light_hours,
        dark_hours=env.dark_hours,
        dli_mol_m2_d=env.dli_mol_m2_d * opt.glass_transmission,
        far_red_ratio=env.far_red_to_par_ratio,
        pco2_pa=pco2_pa,
        po2_pa=po2_pa,
        pressure_pa=inside_kpa * 1000.0,
        gravity_g=env.gravity_g,
        uv_relative=env.uv_relative * opt.uv_transmission,
        ionising_msv_yr=env.ionising_msv_yr,
        water=env.water,
        liquid_water_stable=True,
        engineered_water=True,
        substrate=substrate,
        soil_ph=env.soil_ph if substrate != "hydroponic" else None,
        perchlorate_wt_pct=perchlorate,
    )
    engineering: dict[str, float | bool | str | None] = {
        "feasible": feasible,
        "pressure_delta_kpa": round(inside_kpa - external_kpa, 2),
        "inside_temp_k": round(inside_k, 1),
        "external_temp_k": round(external_k, 1),
        "heat_loss_w_m2": round(opt.heat_transfer_w_m2_k * delta_t, 1),
    }
    return ScenarioOutcome(conditions, engineering, tuple(notes))


def closed_farm(
    env: Environment,
    crop: CropParams,
    yield_kg_m2_cycle: float | None,
    options: ClosedFarmOptions | None = None,
) -> ScenarioOutcome:
    """Scenario C: full environmental control, limited only by gravity and energy."""
    opt = options or ClosedFarmOptions()
    target_ppfd = min(crop.ppfd_sat, 750.0)
    dli = target_ppfd * PHOTOPERIOD_LED_H * 3600.0 / 1e6
    conditions = GrowthConditions(
        t_mean_c=crop.t_opt_c,
        diurnal_amplitude_k=2.0,
        ppfd_umol_m2_s=target_ppfd,
        light_hours=PHOTOPERIOD_LED_H,
        dark_hours=24.0 - PHOTOPERIOD_LED_H,
        dli_mol_m2_d=dli,
        far_red_ratio=_SOLAR_LIKE_FAR_RED_RATIO,
        pco2_pa=opt.pco2_pa,
        po2_pa=opt.po2_kpa * 1000.0,
        pressure_pa=opt.pressure_kpa * 1000.0,
        gravity_g=env.gravity_g,
        uv_relative=0.0,
        ionising_msv_yr=env.ionising_msv_yr * opt.radiation_shielding,
        water="abundant",
        liquid_water_stable=True,
        engineered_water=True,
        substrate="hydroponic",
        soil_ph=None,
        perchlorate_wt_pct=0.0,
    )
    daily_kwh_m2 = dli * 1e6 / LED_EFFICACY_UMOL_J / 1e6 / MJ_PER_KWH * HVAC_OVERHEAD
    cycle_kwh_m2 = daily_kwh_m2 * crop.cycle_days
    hull_ok = (
        env.pressure_pa <= _HULL_LIMIT_PRESSURE_PA and env.surface_temp_k <= _HULL_LIMIT_TEMP_K
    )
    engineering: dict[str, float | bool | str | None] = {
        "feasible": env.has_solid_surface and hull_ok,
        "led_ppfd_umol_m2_s": round(target_ppfd, 0),
        "energy_kwh_m2_day": round(daily_kwh_m2, 2),
        "energy_kwh_per_kg": (
            round(cycle_kwh_m2 / yield_kg_m2_cycle, 1) if yield_kg_m2_cycle else None
        ),
    }
    notes: list[Assumption] = []
    if not env.has_solid_surface:
        notes.append(
            Assumption(
                "floating_platform",
                "Нет твёрдой поверхности: предполагается плавающая платформа в атмосфере.",
                0.3,
            )
        )
    if not hull_ok:
        notes.append(
            Assumption(
                "extreme_hull",
                "Экстремальная среда: расчёт предполагает ещё не существующий корпус.",
                0.3,
            )
        )
    return ScenarioOutcome(conditions, engineering, tuple(notes))


def apply_scenario(
    scenario: ScenarioId,
    env: Environment,
    crop: CropParams,
    yield_kg_m2_cycle: float | None = None,
    greenhouse_options: GreenhouseOptions | None = None,
    closed_farm_options: ClosedFarmOptions | None = None,
) -> ScenarioOutcome:
    if scenario == "open_surface":
        return open_surface(env, crop)
    if scenario == "greenhouse":
        return greenhouse(env, crop, greenhouse_options)
    return closed_farm(env, crop, yield_kg_m2_cycle, closed_farm_options)
