"""Combine stellar, climate, atmosphere and radiation models into a planet environment."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.physics import atmosphere as atm
from app.physics import climate, radiation, stellar

DEFAULT_ALBEDO = 0.3
DEFAULT_SITE_SPREAD_K = 18.0
LOCKED_SITE_SPREAD_K = 30.0
SOLID_SURFACE_MAX_RADIUS_EARTH = 1.8
SECONDS_PER_HOUR = 3600.0


class InsufficientDataError(ValueError):
    """Raised when a body lacks the minimum parameters required for a simulation."""


@dataclass(frozen=True, slots=True)
class Assumption:
    code: str
    text_ru: str
    penalty: float = 0.1


@dataclass(frozen=True, slots=True)
class BodyInputs:
    """Physical description of a body and its star; None means unknown."""

    name: str
    teff_k: float | None = None
    luminosity_lsun: float | None = None
    star_mass_msun: float | None = None
    mass_earth: float | None = None
    radius_earth: float | None = None
    semi_major_axis_au: float | None = None
    orbital_period_days: float | None = None
    eccentricity: float | None = None
    albedo: float | None = None
    insolation_earth: float | None = None
    day_hours: float | None = None
    surface_temp_k: float | None = None
    diurnal_min_k: float | None = None
    diurnal_max_k: float | None = None
    surface_pressure_pa: float | None = None
    pco2_pa: float | None = None
    po2_pa: float | None = None
    tau_ir: float | None = None
    vis_transmission: float | None = None
    has_magnetosphere: bool | None = None
    has_solid_surface: bool | None = None
    water: str = "unknown"
    substrate: str = "unknown"
    soil_ph: float | None = None
    perchlorate_wt_pct: float | None = None
    extra_radiation_msv_yr: float = 0.0


@dataclass(frozen=True, slots=True)
class Environment:
    """Outdoor conditions at the best available site of a body."""

    name: str
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
    assumptions: tuple[Assumption, ...] = field(default_factory=tuple)


def _resolve_size(body: BodyInputs, notes: list[Assumption]) -> tuple[float, float]:
    mass, radius = body.mass_earth, body.radius_earth
    if mass is None and radius is None:
        raise InsufficientDataError(f"{body.name}: неизвестны и масса, и радиус")
    if radius is None:
        assert mass is not None
        radius = mass**0.27
        notes.append(Assumption("radius_from_mass", "Радиус оценён по массе (M^0.27).", 0.1))
    if mass is None:
        mass = radius**3.7 if radius < 1.6 else radius**2.0
        notes.append(Assumption("mass_from_radius", "Масса оценена по радиусу.", 0.1))
    return mass, radius


def _resolve_star(body: BodyInputs, notes: list[Assumption]) -> tuple[float, float | None]:
    teff = body.teff_k
    if teff is None:
        teff = stellar.SUN_TEFF_K
        notes.append(
            Assumption("teff_default", "Температура звезды неизвестна: принята солнечная.", 0.2)
        )
    return teff, body.luminosity_lsun


def _resolve_insolation(body: BodyInputs, luminosity: float | None) -> float:
    if body.insolation_earth is not None:
        return body.insolation_earth
    if luminosity is not None and body.semi_major_axis_au:
        flux = climate.stellar_flux_earth_units(luminosity, body.semi_major_axis_au)
        return flux * climate.orbit_mean_flux_factor(body.eccentricity or 0.0)
    raise InsufficientDataError(f"{body.name}: невозможно определить освещённость")


def _resolve_atmosphere(
    body: BodyInputs, preset_id: str | None, notes: list[Assumption]
) -> tuple[float, float, float, float | None, float, bool]:
    """Return pressure, pCO2, pO2, tau, transmission and whether a preset replaced the data."""
    preset = atm.PRESETS[preset_id] if preset_id else None
    if preset is None and body.surface_pressure_pa is None:
        preset = atm.PRESETS["earth_like"]
        notes.append(
            Assumption(
                "atmosphere_default",
                "Атмосфера неизвестна: принят пресет «Как Земля». Выберите пресет явно.",
                0.3,
            )
        )
    if preset is not None:
        return (
            preset.pressure_pa,
            preset.pco2_pa,
            preset.po2_pa,
            preset.tau_ir,
            preset.vis_transmission,
            True,
        )
    assert body.surface_pressure_pa is not None
    transmission = body.vis_transmission
    if transmission is None:
        transmission = 0.55
        notes.append(Assumption("vis_default", "Прозрачность атмосферы принята земной.", 0.1))
    return (
        body.surface_pressure_pa,
        body.pco2_pa or 0.0,
        body.po2_pa or 0.0,
        body.tau_ir,
        transmission,
        False,
    )


def compute_environment(body: BodyInputs, preset_id: str | None = None) -> Environment:
    """Compute the outdoor environment. Pure function of the inputs."""
    notes: list[Assumption] = []
    mass, radius = _resolve_size(body, notes)
    teff, luminosity = _resolve_star(body, notes)
    insolation = _resolve_insolation(body, luminosity)
    toa = insolation * stellar.SOLAR_CONSTANT_W_M2

    albedo = body.albedo
    if albedo is None:
        albedo = DEFAULT_ALBEDO
        notes.append(Assumption("albedo_default", "Альбедо неизвестно: принято 0,3.", 0.1))
    t_eq = climate.equilibrium_temp_k(insolation, albedo)

    pressure, pco2, po2, tau, transmission, replaced = _resolve_atmosphere(body, preset_id, notes)

    # Rotation.
    day = climate.estimate_day_length(
        body.day_hours,
        body.orbital_period_days,
        mass,
        radius,
        body.semi_major_axis_au,
        body.star_mass_msun,
    )
    if day.uncertain:
        notes.append(
            Assumption(
                "day_length_uncertain",
                "Длина суток не определена надёжно (эвристика приливного захвата).",
                0.15,
            )
        )
    if day.tidally_locked:
        notes.append(
            Assumption(
                "tidally_locked",
                "Вероятен приливный захват: выбран участок дневной стороны с постоянным светом.",
                0.1,
            )
        )
        light_hours, dark_hours = 24.0, 0.0
    else:
        assert day.day_hours is not None
        light_hours = dark_hours = day.day_hours / 2.0

    # Surface temperature.
    if not replaced and body.surface_temp_k is not None:
        surface_temp = body.surface_temp_k
    else:
        if tau is None:
            tau = atm.PRESETS["earth_like"].tau_ir
        surface_temp = climate.grey_greenhouse_temp_k(t_eq, tau)
        if not replaced:
            notes.append(
                Assumption(
                    "temp_greenhouse_default",
                    "Температура поверхности рассчитана с земным парниковым эффектом.",
                    0.15,
                )
            )

    # Diurnal swing: measured if available and the atmosphere was not replaced.
    if day.tidally_locked:
        amplitude = 0.0
    elif not replaced and body.diurnal_min_k is not None and body.diurnal_max_k is not None:
        amplitude = body.diurnal_max_k - body.diurnal_min_k
    else:
        amplitude = climate.diurnal_amplitude_k(pressure)

    # Light at the best-lit site.
    mean_cos = climate.daily_mean_cosine(day.tidally_locked)
    daytime_irradiance = toa * mean_cos * transmission
    ppfd = stellar.ppfd_from_irradiance_umol_m2_s(daytime_irradiance, teff)
    # Daily light integral per 24 h: on bodies with long days the same light is spread over
    # a longer cycle, so only the lit share of each 24 h counts.
    lit_share = light_hours / (light_hours + dark_hours)
    dli = ppfd * lit_share * 24.0 * SECONDS_PER_HOUR / 1e6

    gravity = climate.surface_gravity_g(mass, radius)
    column = atm.column_mass_kg_m2(pressure, gravity)
    uv = radiation.uv_surface_relative(insolation, teff, pressure, po2)
    if teff < 3900.0:
        notes.append(
            Assumption("flare_uv", "УФ вспышек M-карлика задан приближённо, по классу звезды.", 0.1)
        )
    ionising = radiation.ionising_dose_msv_yr(
        column, body.has_magnetosphere, body.extra_radiation_msv_yr
    )

    has_solid = body.has_solid_surface
    if has_solid is None:
        has_solid = radius <= SOLID_SURFACE_MAX_RADIUS_EARTH
        notes.append(
            Assumption(
                "solid_surface_guess",
                "Наличие твёрдой поверхности оценено по радиусу планеты.",
                0.1,
            )
        )

    return Environment(
        name=body.name,
        teff_k=teff,
        gravity_g=gravity,
        insolation_earth=insolation,
        toa_irradiance_w_m2=toa,
        par_fraction=stellar.par_fraction(teff),
        far_red_fraction=stellar.far_red_fraction(teff),
        far_red_to_par_ratio=stellar.far_red_to_par_photon_ratio(teff),
        daytime_ppfd_umol_m2_s=ppfd,
        dli_mol_m2_d=dli,
        day_hours=day.day_hours,
        light_hours=light_hours,
        dark_hours=dark_hours,
        tidally_locked=day.tidally_locked,
        day_length_uncertain=day.uncertain,
        equilibrium_temp_k=t_eq,
        surface_temp_k=surface_temp,
        site_spread_k=LOCKED_SITE_SPREAD_K if day.tidally_locked else DEFAULT_SITE_SPREAD_K,
        diurnal_amplitude_k=amplitude,
        pressure_pa=pressure,
        pco2_pa=pco2,
        po2_pa=po2,
        uv_relative=uv,
        ionising_msv_yr=ionising,
        has_solid_surface=has_solid,
        water=body.water,
        substrate=body.substrate if has_solid else "none",
        soil_ph=body.soil_ph,
        perchlorate_wt_pct=body.perchlorate_wt_pct,
        vis_transmission=transmission,
        assumptions=tuple(notes),
    )
