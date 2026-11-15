"""Delta-method climate stress test: changes applied on top of the field's real history.

Not a forecast: a check of how robust a rotation is to plausible changes. Temperatures get
+ΔT, precipitation ×(1 + ΔP), hot days (above the field's 90th percentile for the season)
get an extra +ΔHeat, and spring rain can be cut separately ("dry springs"). ET0 is recomputed
with FAO-56 from the changed temperatures. Pure.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from app.analysis.indices import window_percentile
from app.rotation.weather import DAYS, Weather, WeatherYear, et0_penman_monteith


@dataclass(frozen=True, slots=True)
class StressScenario:
    id: str
    name_ru: str
    d_temp_c: float = 0.0
    d_precip: float = 0.0  # fraction, −0.15 = 15 % less
    d_heat_c: float = 0.0  # extra on days above the 90th percentile
    spring_precip: float = 0.0  # extra fraction in March–May (or Sept–Nov south)


PRESETS: dict[str, StressScenario] = {
    s.id: s
    for s in (
        StressScenario("history", "Как в истории"),
        StressScenario("plus1", "+1 °C", d_temp_c=1.0),
        StressScenario("plus15_dry", "+1,5 °C и −15 % осадков", d_temp_c=1.5, d_precip=-0.15),
        StressScenario("dry_springs", "Сухие вёсны", spring_precip=-0.4),
        StressScenario("hot_days", "Больше дней > 35 °C", d_heat_c=3.0),
    )
}


def apply(weather: Weather, s: StressScenario) -> Weather:
    if s.d_temp_c == 0 and s.d_precip == 0 and s.d_heat_c == 0 and s.spring_precip == 0:
        return weather
    years = list(weather.years)
    p90 = window_percentile(years, "tmax", 90) if s.d_heat_c else [1e9] * DAYS
    spring = range(59, 151) if weather.lat >= 0 else range(243, 334)
    out: list[WeatherYear] = []
    for wy in years:
        tmax = [t + s.d_temp_c + (s.d_heat_c if t > p90[d] else 0.0) for d, t in enumerate(wy.tmax)]
        tmin = [t + s.d_temp_c for t in wy.tmin]
        precip = [
            max(0.0, p * (1 + s.d_precip) * (1 + (s.spring_precip if d in spring else 0.0)))
            for d, p in enumerate(wy.precip)
        ]
        et0 = tuple(
            round(
                et0_penman_monteith(
                    tmax[d],
                    tmin[d],
                    wy.rh[d],
                    wy.wind[d],
                    wy.rs[d],
                    weather.lat,
                    weather.elevation_m,
                    d + 1,
                ),
                3,
            )
            for d in range(DAYS)
        )
        out.append(replace(wy, tmax=tuple(tmax), tmin=tuple(tmin), precip=tuple(precip), et0=et0))
    note = (
        f"Стресс-тест «{s.name_ru}»: ΔT {s.d_temp_c:+.1f} °C, осадки {s.d_precip * 100:+.0f} %"
        + (f", жаркие дни {s.d_heat_c:+.1f} °C" if s.d_heat_c else "")
        + (f", весной {s.spring_precip * 100:+.0f} %" if s.spring_precip else "")
    )
    return replace(weather, years=tuple(out), notes=(*weather.notes, note))


def custom(
    d_temp_c: float, d_precip: float, d_heat_c: float = 0.0, spring_precip: float = 0.0
) -> StressScenario:
    return StressScenario("custom", "Свой сценарий", d_temp_c, d_precip, d_heat_c, spring_precip)
