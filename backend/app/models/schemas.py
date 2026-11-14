"""Request and response schemas of the HTTP API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ScenarioName = Literal["open_surface", "greenhouse", "closed_farm"]
PresetName = Literal["earth_like", "mars_like", "venus_like", "dense_co2", "none"]


class StarOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    teff_k: float | None
    radius_rsun: float | None
    mass_msun: float | None
    luminosity_lsun: float | None
    spectral_type: str | None
    distance_pc: float | None
    ra_deg: float | None = None
    dec_deg: float | None = None
    source: str
    source_url: str
    retrieved_at: str


class PlanetSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    name_ru: str | None
    kind: str
    hypothetical: bool
    galaxy_preset: str | None
    mass_earth: float | None
    radius_earth: float | None
    semi_major_axis_au: float | None
    insolation_earth: float | None
    potentially_habitable: bool
    in_habitable_zone: bool | None
    star_teff_k: float | None = None
    star_type: str | None = None
    source: str


class PlanetPage(BaseModel):
    total: int
    items: list[PlanetSummary]


class EnvironmentOut(BaseModel):
    teff_k: float
    gravity_g: float
    insolation_earth: float
    toa_irradiance_w_m2: float
    par_fraction: float
    far_red_fraction: float
    far_red_to_par_ratio: float
    daytime_ppfd_umol_m2_s: float
    dli_mol_m2_d: float
    day_hours: float | None
    light_hours: float
    dark_hours: float
    tidally_locked: bool
    day_length_uncertain: bool
    equilibrium_temp_k: float
    surface_temp_k: float
    site_spread_k: float
    diurnal_amplitude_k: float
    pressure_pa: float
    pco2_pa: float
    po2_pa: float
    uv_relative: float
    ionising_msv_yr: float
    has_solid_surface: bool
    water: str
    substrate: str
    soil_ph: float | None
    perchlorate_wt_pct: float | None
    vis_transmission: float


class AssumptionOut(BaseModel):
    code: str
    text: str
    penalty: float


class SpectrumPoint(BaseModel):
    wavelength_nm: float
    star: float
    sun: float


class PlanetDetail(BaseModel):
    planet: dict[str, Any]
    star: StarOut
    environment: EnvironmentOut | None
    environment_error: str | None = None
    assumptions: list[AssumptionOut]
    spectrum: list[SpectrumPoint]
    habitable_zone_au: tuple[float, float] | None = None


class CropOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name_ru: str
    name_en: str
    group: str
    photosynthesis: str
    t_kill_c: float
    t_min_c: float
    t_opt_min_c: float
    t_opt_max_c: float
    t_max_c: float
    ph_min: float
    ph_max: float
    cycle_days: float
    ppfd_comp: float
    ppfd_sat: float
    dli_min: float
    dli_opt: float
    o2_min_kpa: float
    uv_tolerance_rel: float
    p_min_kpa: float
    max_dark_hours: float
    continuous_light_ok: bool
    aquatic: bool
    yield_kg_m2_cycle: float | None
    estimate: bool
    reference: str | None
    notes: str | None
    source: str
    source_url: str
    retrieved_at: str


class CustomPlanet(BaseModel):
    """A user-defined world. Unknown parameters stay null and become assumptions."""

    name: str = "Пользовательская планета"
    teff_k: float | None = Field(default=None, gt=0, le=60_000)
    luminosity_lsun: float | None = Field(default=None, gt=0)
    star_mass_msun: float | None = Field(default=None, gt=0)
    mass_earth: float | None = Field(default=None, gt=0)
    radius_earth: float | None = Field(default=None, gt=0)
    semi_major_axis_au: float | None = Field(default=None, gt=0)
    orbital_period_days: float | None = Field(default=None, gt=0)
    eccentricity: float | None = Field(default=None, ge=0, lt=1)
    albedo: float | None = Field(default=None, ge=0, le=1)
    insolation_earth: float | None = Field(default=None, ge=0)
    day_hours: float | None = Field(default=None, gt=0)
    surface_temp_k: float | None = Field(default=None, gt=0)
    surface_pressure_pa: float | None = Field(default=None, ge=0)
    pco2_pa: float | None = Field(default=None, ge=0)
    po2_pa: float | None = Field(default=None, ge=0)
    has_magnetosphere: bool | None = None
    has_solid_surface: bool | None = None
    water: Literal["abundant", "ice", "trace", "none", "unknown"] = "unknown"
    substrate: Literal["soil", "regolith", "ice", "none", "unknown"] = "unknown"


class SimulateRequest(BaseModel):
    planet_id: str | None = None
    custom_planet: CustomPlanet | None = None
    crop_id: str
    scenario: ScenarioName
    atmosphere_preset: PresetName | None = None
    ranges: dict[str, tuple[float, float]] | None = Field(
        default=None,
        description="Диапазоны входных параметров для Монте-Карло: имя поля → [мин, макс].",
    )
    monte_carlo_n: int = Field(default=1000, ge=10, le=5000)

    @model_validator(mode="after")
    def exactly_one_planet(self) -> SimulateRequest:
        if (self.planet_id is None) == (self.custom_planet is None):
            raise ValueError("укажите ровно одно из полей: planet_id или custom_planet")
        return self


class FactorOut(BaseModel):
    key: str
    label: str
    value: float
    unit: str
    f: float
    status: Literal["ok", "stress", "lethal"]


class MonteCarloOut(BaseModel):
    n: int
    p10: float
    p50: float
    p90: float
    survival_probability: float


class SimulationOut(BaseModel):
    planet_name: str
    crop_id: str
    crop_name: str
    scenario: ScenarioName
    atmosphere_preset: PresetName | None
    yield_rel: float
    survival: bool
    days_to_harvest: float | None
    limiting_factor: str
    limiting_factor_label: str
    factors: list[FactorOut]
    confidence: Literal["high", "medium", "low"]
    confidence_score: float
    assumptions: list[AssumptionOut]
    recommendations: list[str]
    engineering: dict[str, float | bool | str | None]
    environment: EnvironmentOut
    monte_carlo: MonteCarloOut | None = None


class TimelineOverridesIn(BaseModel):
    """«Что если…»: изменения поверх сценария."""

    supplemental_ppfd_umol_m2_s: float = Field(default=0.0, ge=0, le=2000)
    heating_k: float = Field(default=0.0, ge=-100, le=200)


class TimelineRequest(SimulateRequest):
    overrides: TimelineOverridesIn | None = None
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    events: bool = True


class StressOut(BaseModel):
    temp: float
    light: float
    water: float
    gravity: float
    radiation: float


PlantStage = Literal["seed", "germination", "vegetative", "flowering", "fruiting", "mature", "dead"]


class PlantStateOut(BaseModel):
    day: int
    earth_day: float
    stage: PlantStage
    progress: float
    heightM: float
    leafCount: int
    leafAreaIndex: float
    biomassG: float
    yieldG: float
    organCount: int
    stress: StressOut
    factors: dict[str, float] = Field(description="Отклик f_i ∈ [0, 1] по каждому фактору")
    health: float
    growth_rate: float
    limiting_factor: str
    limiting_f: float
    t_mean_c: float
    ppfd_umol_m2_s: float
    storm: bool
    flare: bool


class TimelineEventOut(BaseModel):
    day: int
    type: Literal[
        "germination",
        "flowering",
        "organ_init",
        "harvest",
        "death",
        "dust_storm",
        "flare",
        "frost",
    ]
    message: str


class TimelineSummaryOut(BaseModel):
    yield_rel: float
    static_yield_rel: float
    survival: bool
    days_to_harvest: float | None
    harvest_day: int | None
    limiting_factor: str
    limiting_factor_label: str
    confidence: Literal["high", "medium", "low"]
    assumptions: list[AssumptionOut]
    recommendations: list[str]


class MorphologyOut(BaseModel):
    harvest_organ: str
    growth_form: str
    height_max_m: float
    biomass_max_g: float
    harvest_index: float
    organ_count_max: int
    estimate: bool = True


class TimelineOut(BaseModel):
    planet_name: str
    crop_id: str
    crop_name: str
    scenario: ScenarioName
    step_hours: float
    day_unit: Literal["sol", "local_day", "earth_day"]
    environment: EnvironmentOut
    conditions: dict[str, float | str | bool | None]
    morphology: MorphologyOut
    days: list[PlantStateOut]
    events: list[TimelineEventOut]
    summary: TimelineSummaryOut


class CompareRequest(BaseModel):
    planet_ids: list[str] = Field(min_length=1, max_length=30)
    crop_ids: list[str] = Field(min_length=1, max_length=30)
    scenario: ScenarioName
    atmosphere_preset: PresetName | None = None


class CompareCell(BaseModel):
    planet_id: str
    crop_id: str
    yield_rel: float | None
    survival: bool | None
    limiting_factor: str | None
    limiting_factor_label: str | None
    confidence: Literal["high", "medium", "low"] | None
    error: str | None = None


class CompareOut(BaseModel):
    planets: list[dict[str, str]]
    crops: list[dict[str, str]]
    scenario: ScenarioName
    cells: list[CompareCell]


class IngestOut(BaseModel):
    source: str
    status: str
    rows: int
    message: str | None


class AtmospherePresetOut(BaseModel):
    id: str
    label: str
    pressure_pa: float
    pco2_pa: float
    po2_pa: float
    tau_ir: float
    vis_transmission: float


class GalaxyPresetOut(BaseModel):
    id: str
    name_ru: str
    description_ru: str
    metallicity_feh: float
    cosmic_ray_factor: float
    supernova_rate_factor: float
    spectral_mix: dict[str, float]
    estimate: bool


class GenerateRequest(BaseModel):
    galaxy_preset: str
    count: int = Field(default=10, ge=1, le=200)
    seed: int = 42
