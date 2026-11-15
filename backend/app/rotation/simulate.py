"""Daily multi-year rotation engine (ROTATION.md §1.3). Pure and deterministic.

One continuous loop over all years of the rotation: what grows on the field each day comes
from the slots, and soil water, residues, organic carbon, mineral nitrogen, structure, pest
pressure and erosion carry over from season to season.

Methods: FAO-56 single crop coefficient water balance (Allen et al. 1998), FAO-33 yield
response to water Ky (Doorenbos & Kassam 1979), SCS curve number runoff (USDA NRCS TR-55),
RUSLE erosion (USDA Handbook 703). Nitrogen, residues and pests are simplified balances whose
rates are estimates (docs/ASSUMPTIONS.md).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from app.rotation.crops import RotCrop, rotation_crops
from app.rotation.erosion import cover_factor, daily_erosivity
from app.rotation.model import PROFILE_M, FieldSite, Rotation, SoilState
from app.rotation.weather import DAYS, WeatherYear, doy_of

# ---- estimates (docs/ASSUMPTIONS.md, stage 7) ----
NHI = 0.75  # share of crop N that ends in the marketed product
RESIDUE_K_DAY = 0.012  # residue decomposition at 20 °C, moist soil
HUMIFICATION = 0.15  # share of decomposed residue C that becomes soil organic carbon
MICROBE_CN = 25.0  # residues above this C:N immobilise mineral N while they decompose
SOC_K_YEAR = 0.02  # mineralisation of soil organic carbon at 20 °C
HUMUS_CN = 10.0
C_IN_DM = 0.45
RESIDUE_COVER_AM = 0.0004  # ha/kg, fraction covered = 1 - exp(-Am·M) (Gregory 1982 form)
TILLAGE_BURIAL = 0.7  # share of surface residue buried at sowing
BARE_COVER = 0.3  # soil counted as bare below this total cover
COVER_GDD_KG = 4.0  # cover-crop dry matter per growing degree-day, kg/ha
COVER_MAX_KG = 6000.0
PEST_LOSS = 0.35  # yield loss at full pest pressure (heuristic)
HEAT_LOSS_PER_DAY = 0.03
HEAT_LOSS_MAX = 0.5
LEGUME_NDFA = 0.6  # share of a legume's nitrogen fixed from the air
CN_IDX_SHIFT = 15.0  # curve number change per unit of infiltration index
EROSION_ENRICHMENT = 1.5  # eroded sediment is richer in carbon than the soil


# SCS curve numbers, hydrologic groups A/B/C/D (USDA NRCS TR-55 Table 2-2b, good condition).
CURVE_NUMBERS = {
    "bare": (77, 86, 91, 94),
    "residue": (74, 83, 88, 90),  # fallow with crop residue cover, good
    "row": (67, 78, 85, 89),  # row crops, straight row, good
    "small_grain": (63, 75, 83, 87),
    "legume": (58, 72, 81, 85),  # close-seeded legumes or rotation meadow, good
}
ROW_CROPS = {"maize", "potato", "tomato", "cotton", "sunflower", "soybean"}


@dataclass(slots=True)
class YearResult:
    year: int
    crop: str | None
    cover: str | None
    yield_t_ha: float = 0.0
    yield_rel: float = 0.0  # of the crop's attainable yield
    factors: dict[str, float] = field(default_factory=dict)  # water, n, heat, pest, temp
    eta_mm: float = 0.0
    etc_mm: float = 0.0
    irrigation_mm: float = 0.0
    precip_mm: float = 0.0
    runoff_mm: float = 0.0
    drainage_mm: float = 0.0
    n_leached_kg_ha: float = 0.0
    n_fixed_kg_ha: float = 0.0
    n_fert_kg_ha: float = 0.0
    n_removed_kg_ha: float = 0.0
    n_mineral_end: float = 0.0
    n_mineral_mean: float = 0.0  # mean over the year's days
    residue_kg_end: float = 0.0
    soc_pct_end: float = 0.0
    erosion_t_ha: float = 0.0
    bare_days: int = 0
    heat_days: int = 0
    frost_kill: bool = False
    cover_biomass_kg_ha: float = 0.0
    infiltration_idx: float = 1.0
    pest_pressure: float = 0.0
    weather_year: int = 0
    events: list[str] = field(default_factory=list)


DAILY_FIELDS = (
    "crop",
    "is_cover",
    "stage",
    "canopy",
    "soil_cover",
    "water",
    "soc_pct",
    "n_mineral",
    "erosion_cum",
    "precip",
    "tmax",
    "tmin",
    "pest",
    "n_factor_hint",
)


@dataclass(slots=True)
class RotationRun:
    rotation_id: str
    years: list[YearResult]
    soil_cover: list[float]  # weekly means of total soil cover over the whole plan
    final: SoilState
    daily: list[tuple] | None = None  # see DAILY_FIELDS; only with record=True


def _kc(crop: RotCrop, age: float) -> float:
    """FAO-56 Kc curve (figure 25): constant, linear rise, plateau, linear decline."""
    a, b, c, d = crop.stages
    if age < a:
        return crop.kc_ini
    if age < a + b:
        return crop.kc_ini + (crop.kc_mid - crop.kc_ini) * (age - a) / b
    if age < a + b + c:
        return crop.kc_mid
    return crop.kc_mid + (crop.kc_end - crop.kc_mid) * min(1.0, (age - a - b - c) / max(1, d))


def _stage(crop: RotCrop, age: float) -> str:
    a, b, c, _ = crop.stages
    if age < a:
        return "ini"
    if age < a + b:
        return "dev"
    if age < a + b + c:
        return "mid"
    return "late"


def _late_progress(crop: RotCrop, age: float) -> float:
    a, b, c, d = crop.stages
    return max(0.0, min(1.0, (age - a - b - c) / max(1, d)))


def _canopy(crop: RotCrop, age: float) -> float:
    """Ground cover by the canopy (estimate following the Kc curve)."""
    a, b, c, d = crop.stages
    if age < a:
        return 0.1
    if age < a + b:
        return 0.1 + 0.8 * (age - a) / b
    if age < a + b + c:
        return 0.9
    return 0.9 - 0.4 * min(1.0, (age - a - b - c) / max(1, d))


def _root_depth(crop: RotCrop, age: float) -> float:
    a, b, _, _ = crop.stages
    frac = min(1.0, age / max(1, a + b))
    return 0.15 + (crop.root_depth_m - 0.15) * frac


def temperature_factor(crop: RotCrop, t_mean: float) -> float:
    """EcoCrop-style suitability of the season mean temperature (1 in the optimum)."""
    lo, olo, ohi, hi = crop.t_min_c, crop.t_opt_min_c, crop.t_opt_max_c, crop.t_max_c
    if lo is None or olo is None or ohi is None or hi is None:
        return 1.0
    if olo <= t_mean <= ohi:
        return 1.0
    if t_mean < olo:
        return max(0.0, (t_mean - lo) / (olo - lo)) if olo > lo else 0.0
    return max(0.0, (hi - t_mean) / (hi - ohi)) if hi > ohi else 0.0


def _curve_number(group: str, state: str, idx: float) -> float:
    cn = CURVE_NUMBERS[state]["ABCD".index(group)]
    return max(30.0, min(98.0, cn - CN_IDX_SHIFT * (idx - 1.0)))


def _runoff(p: float, cn: float) -> float:
    if p <= 0:
        return 0.0
    s = 25400 / cn - 254
    ia = 0.2 * s
    return (p - ia) ** 2 / (p - ia + s) if p > ia else 0.0


@dataclass(slots=True)
class _Window:
    slot_index: int
    crop: RotCrop
    start: int  # absolute day
    end: int  # exclusive
    main: bool
    fert: float
    irrigate: bool
    ages: list[float] = field(default_factory=list)  # phenological age (FAO days) per day


MAX_SEASON_DAYS = 330


def _phenology(
    crop: RotCrop, start: int, tmean: list[float], limit: int
) -> tuple[int, list[float]]:
    """Season end from thermal time: FAO stage days are spread over the crop's GDD requirement,
    so the same crop runs faster in a hot place and pauses through winter."""
    ages: list[float] = []
    gdd = 0.0
    d = start
    while d < min(limit, start + MAX_SEASON_DAYS):
        gdd += max(0.0, tmean[d] - crop.t_base_c)
        ages.append(crop.season_days * min(1.0, gdd / crop.gdd_total))
        d += 1
        if gdd >= crop.gdd_total:
            break
    return d, ages


def _windows(
    rotation: Rotation, total_days: int, tmean: list[float]
) -> tuple[list[_Window], list[str]]:
    crops = rotation_crops()
    out: list[_Window] = []
    notes: list[str] = []
    mains: dict[int, _Window] = {}
    for i, s in enumerate(rotation.slots):
        if s.season != "main" or not s.crop:
            continue
        c = crops[s.crop]
        start = s.year * DAYS + doy_of(s.sow_mmdd or c.sow_mmdd or "04-15")
        prev = mains.get(s.year - 1)
        if prev and start < prev.end + 7:
            notes.append(f"Год {s.year + 1}: сев {c.name_ru} сдвинут — предшественник ещё в поле")
            start = prev.end + 7
        end, ages = _phenology(c, start, tmean, total_days)
        w = _Window(i, c, start, end, True, s.fert_n_kg_ha, s.irrigate, ages)
        mains[s.year] = w
        out.append(w)
    for i, s in enumerate(rotation.slots):
        if s.season != "cover" or not s.crop:
            continue
        c = crops[s.crop]
        main = mains.get(s.year)
        start = (
            s.year * DAYS + doy_of(s.sow_mmdd)
            if s.sow_mmdd
            else (main.end + 10 if main else s.year * DAYS + doy_of("08-20"))
        )
        nxt = mains.get(s.year + 1)
        end = (
            s.year * DAYS
            + doy_of(s.end_mmdd)
            + (DAYS if s.end_mmdd and doy_of(s.end_mmdd) < 180 else 0)
            if s.end_mmdd
            else (nxt.start - 14 if nxt else total_days)
        )
        end = min(end, total_days)
        if end - start < 30:
            notes.append(f"Год {s.year + 1}: покровной культуре {c.name_ru} не хватает времени")
            continue
        _, ages = _phenology(c, start, tmean, end)
        ages += [ages[-1] if ages else 0.0] * (end - start - len(ages))
        out.append(_Window(i, c, start, end, False, s.fert_n_kg_ha, False, ages))
    return sorted(out, key=lambda w: w.start), notes


def run_rotation(
    site: FieldSite,
    rotation: Rotation,
    weather: list[WeatherYear],
    initial: SoilState | None = None,
    record: bool = False,
) -> RotationRun:
    """Simulate the rotation day by day on the given sequence of weather years.

    With `record`, one tuple per day (DAILY_FIELDS) is kept for playback in the interface."""
    if len(weather) < rotation.years:
        raise ValueError("weather years fewer than rotation years")
    total = rotation.years * DAYS
    tmean_all = [
        (w.tmax[d] + w.tmin[d]) / 2 for w in weather[: rotation.years] for d in range(DAYS)
    ]
    windows, notes = _windows(rotation, total, tmean_all)
    by_day: list[_Window | None] = [None] * total
    for win in windows:
        for d in range(win.start, win.end):
            if by_day[d] is None or win.main:
                by_day[d] = win

    tex = site.texture
    fc_mm = 1000 * (tex.theta_fc - tex.theta_wp) * PROFILE_M  # available water at FC
    state = initial or SoilState(
        soc_kg_ha=site.soc_kg_ha(site.soc_pct),
        n_mineral_kg_ha=site.n_mineral_kg_ha,
        water_mm=0.6 * fc_mm,
    )
    years = [
        YearResult(
            y,
            (rotation.main(y).crop if rotation.main(y) else None),  # type: ignore[union-attr]
            (rotation.cover(y).crop if rotation.cover(y) else None),  # type: ignore[union-attr]
            weather_year=weather[y].year,
        )
        for y in range(rotation.years)
    ]
    for n in notes:
        years[0].events.append(n)

    # per-window accumulators
    acc: dict[int, dict[str, float]] = {}
    cover_daily: list[float] = []
    daily: list[tuple] = []
    age: float = 0.0
    de = tex.rew_mm  # top-layer evaporation depletion
    irrig_used = [0.0] * rotation.years
    erosivity = [daily_erosivity(w.precip) for w in weather[: rotation.years]]

    for day in range(total):
        y, doy = divmod(day, DAYS)
        wy = weather[y]
        yr = years[y]
        tmax, tmin, p, et0 = wy.tmax[doy], wy.tmin[doy], wy.precip[doy], wy.et0[doy]
        tmean = (tmax + tmin) / 2
        if doy == 0 and day > 0:
            # yearly decay of pest pressure
            for fam, val in list(state.pest_pressure.items()):
                brk = max(
                    (c.min_break_years for c in rotation_crops().values() if c.family == fam),
                    default=1,
                )
                state.pest_pressure[fam] = val * (1 - 1 / (brk + 1))

        w = by_day[day]
        canopy = 0.0
        kc = 0.0
        zr = 0.15
        crop_active = False
        if w is not None:
            a = acc.setdefault(
                w.slot_index,
                {
                    "eta": 0.0,
                    "etc": 0.0,
                    "heat": 0.0,
                    "tsum": 0.0,
                    "n": 0.0,
                    "bio": 0.0,
                    "kill": 0.0,
                },
            )
            age = w.ages[day - w.start] if day - w.start < len(w.ages) else w.crop.season_days
            if day == w.start:
                if w.main:
                    state.residue_surface *= 1 - TILLAGE_BURIAL
                state.n_mineral_kg_ha += w.fert
                yr.n_fert_kg_ha += w.fert
            if not a["kill"]:
                crop_active = True
                kc = _kc(w.crop, age)
                zr = _root_depth(w.crop, age)
                canopy = _canopy(w.crop, age) if w.main else 1 - math.exp(-0.0008 * a["bio"])
                stage = _stage(w.crop, age)
                young = stage in ("ini", "dev")
                kill_c = w.crop.frost_kill_c - (w.crop.young_frost_margin_c if young else 0.0)
                if tmin < kill_c and day - w.start > 3:
                    a["kill"] = 1.0
                    # frost during ripening keeps the grain already filled (estimate)
                    a["kill_mult"] = (
                        0.5 + 0.5 * _late_progress(w.crop, age) if stage == "late" else 0.0
                    )
                    if w.main:
                        yr.frost_kill = True
                        yr.events.append(
                            f"{w.crop.name_ru}: заморозок {tmin:.1f} °C — гибель посевов"
                        )
                    crop_active = False

        # ---- water balance (FAO-56, single Kc) ----
        res_cover = state.residue_surface * (1 - math.exp(-RESIDUE_COVER_AM * state.residue_kg_ha))
        soil_cover = 1 - (1 - canopy) * (1 - res_cover)
        cover_daily.append(soil_cover)
        if soil_cover < BARE_COVER:
            yr.bare_days += 1
        cn_state = (
            ("legume" if w.crop.is_legume else "row" if w.crop.id in ROW_CROPS else "small_grain")
            if crop_active and w is not None
            else ("residue" if res_cover > 0.3 else "bare")
        )
        runoff = _runoff(p, _curve_number(tex.hydro_group, cn_state, state.infiltration_idx))
        infil = p - runoff
        yr.precip_mm += p
        yr.runoff_mm += runoff

        taw_r = fc_mm * zr / PROFILE_M
        dr = (fc_mm - state.water_mm) * zr / PROFILE_M
        losses = 0.0
        if crop_active and w is not None and w.main and w.irrigate and site.irrigated:
            raw = w.crop.p_depletion * taw_r
            room = (
                site.irrigation_limit_mm - irrig_used[y]
                if site.irrigation_limit_mm > 0
                else math.inf
            )
            if dr > raw and room > 0:
                eff = site.irrigation_efficiency
                net = min(dr, room * eff)  # what reaches the root zone
                gross = net / eff  # what is taken from the canal / well
                infil += net
                irrig_used[y] += gross
                yr.irrigation_mm += gross
                losses += gross - net  # deep percolation and tail water of the method
        state.water_mm += infil
        drainage = max(0.0, state.water_mm - fc_mm) + losses
        state.water_mm -= drainage - losses
        yr.drainage_mm += drainage
        if drainage > 0 and state.n_mineral_kg_ha > 0:
            leach = state.n_mineral_kg_ha * drainage / (drainage + fc_mm)
            state.n_mineral_kg_ha -= leach
            yr.n_leached_kg_ha += leach

        dr = (fc_mm - state.water_mm) * zr / PROFILE_M
        if crop_active and w is not None:
            raw = w.crop.p_depletion * taw_r
            ks = 1.0 if dr <= raw else max(0.0, (taw_r - dr) / max(1e-6, taw_r - raw))
            etc = kc * et0
            eta = ks * etc
            a = acc[w.slot_index]
            a["etc"] += etc
            a["eta"] += eta
            if tmean > w.crop.t_base_c:  # suitability over active-growth days only
                a["tsum"] += tmean
                a["n"] += 1
            if w.main:
                yr.etc_mm += etc
                yr.eta_mm += eta
                if _stage(w.crop, age) == w.crop.sensitive_stage and tmax > w.crop.heat_c:
                    a["heat"] += 1
            else:
                a["bio"] = min(
                    COVER_MAX_KG, a["bio"] + COVER_GDD_KG * max(0.0, tmean - w.crop.t_base_c) * ks
                )
            loss = eta
        else:
            # bare or residue-covered soil: stage-2 evaporation (FAO-56 eq. 74), mulch -5 % per 10 %
            de = 0.0 if p + 0.0 > 2 else de
            kr = (
                1.0 if de <= tex.rew_mm else max(0.0, (tex.tew_mm - de) / (tex.tew_mm - tex.rew_mm))
            )
            loss = kr * 1.05 * et0 * (1 - 0.5 * res_cover)
            de += loss
        state.water_mm = max(0.0, state.water_mm - loss)

        # ---- residues, organic carbon, mineral nitrogen ----
        f_t = min(2.0, max(0.0, 2 ** ((tmean - 20) / 10))) if tmean > 0 else 0.0
        f_w = 0.3 + 0.7 * min(1.0, state.water_mm / fc_mm)
        if state.residue_kg_ha > 0:
            dec = (
                state.residue_kg_ha
                * RESIDUE_K_DAY
                * f_t
                * f_w
                * min(1.0, MICROBE_CN / state.residue_cn) ** 0.5
            )
            state.residue_kg_ha -= dec
            c_dec = dec * C_IN_DM
            state.soc_kg_ha += HUMIFICATION * c_dec
            net_n = c_dec * (1 / state.residue_cn - 1 / MICROBE_CN)
            state.n_mineral_kg_ha = max(0.0, state.n_mineral_kg_ha + net_n)
        c_min = state.soc_kg_ha * SOC_K_YEAR / 365 * f_t * f_w
        state.soc_kg_ha -= c_min
        state.n_mineral_kg_ha += c_min / HUMUS_CN

        # ---- erosion (RUSLE, daily share of R) ----
        a_day = (
            erosivity[y][doy] * site.k_factor * site.ls * cover_factor(soil_cover) * site.practice_p
        )
        if a_day > 0:
            yr.erosion_t_ha += a_day
            state.erosion_loss_t_ha += a_day
            soc_frac = state.soc_kg_ha / (site.bulk_density * 3e6)
            state.soc_kg_ha -= a_day * 1000 * soc_frac * EROSION_ENRICHMENT

        if record:
            active = w if (w is not None and crop_active) else None
            rec_fam = active.crop.family if active else None
            daily.append(
                (
                    active.crop.id if active else None,
                    bool(active and not active.main),
                    _stage(active.crop, age) if active else None,
                    round(canopy, 3),
                    round(soil_cover, 3),
                    round(min(1.0, state.water_mm / fc_mm), 3),
                    round(site.soc_pct_of(state.soc_kg_ha), 4),
                    round(state.n_mineral_kg_ha, 1),
                    round(state.erosion_loss_t_ha, 3),
                    round(p, 1),
                    round(tmax, 1),
                    round(tmin, 1),
                    round(state.pest_pressure.get(rec_fam, 0.0), 3) if rec_fam else 0.0,
                    round(min(1.0, state.n_mineral_kg_ha / 80), 3),
                )
            )

        # ---- window ends: harvest or cover-crop termination ----
        if w is not None and day == w.end - 1:
            _finish(w, acc[w.slot_index], state, years[w.start // DAYS], rotation)

        yr.n_mineral_mean += state.n_mineral_kg_ha / DAYS
        if doy == DAYS - 1:
            yr.n_mineral_end = round(state.n_mineral_kg_ha, 2)
            yr.n_mineral_mean = round(yr.n_mineral_mean, 2)
            yr.residue_kg_end = round(state.residue_kg_ha, 1)
            yr.soc_pct_end = round(site.soc_pct_of(state.soc_kg_ha), 4)
            _structure(yr, rotation, y, state)
            yr.infiltration_idx = round(state.infiltration_idx, 4)

    weekly = [
        round(sum(cover_daily[i : i + 7]) / len(cover_daily[i : i + 7]), 4)
        for i in range(0, len(cover_daily), 7)
    ]
    for yr in years:
        for k in (
            "eta_mm",
            "etc_mm",
            "irrigation_mm",
            "precip_mm",
            "runoff_mm",
            "drainage_mm",
            "n_leached_kg_ha",
            "n_removed_kg_ha",
            "erosion_t_ha",
        ):
            setattr(yr, k, round(getattr(yr, k), 3))
    return RotationRun(rotation.id, years, weekly, state, daily if record else None)


def _finish(
    w: _Window, a: dict[str, float], state: SoilState, yr: YearResult, rotation: Rotation
) -> None:
    crop = w.crop
    if not w.main:
        bio = a["bio"] if not a["kill"] or a["bio"] > 0 else 0.0
        yr.cover_biomass_kg_ha = round(bio, 1)
        fixed = crop.n_fixation_kg_ha * min(1.0, bio / 3000) if crop.is_legume else 0.0
        _add_residue(state, bio, crop.residue_cn)
        state.n_mineral_kg_ha += 0.0  # fixed N arrives through the low C:N residue
        yr.n_fixed_kg_ha += round(fixed, 2)
        state.pest_pressure[crop.family] = min(1.0, state.pest_pressure.get(crop.family, 0.0) + 0.2)
        return
    water = 1 - crop.ky * (1 - a["eta"] / a["etc"]) if a["etc"] > 0 else 0.0
    water = max(0.0, min(1.0, water))
    temp = temperature_factor(crop, a["tsum"] / a["n"]) if a["n"] else 0.0
    heat = 1 - min(HEAT_LOSS_MAX, HEAT_LOSS_PER_DAY * a["heat"])
    pest = 1 - PEST_LOSS * state.pest_pressure.get(crop.family, 0.0)
    potential = crop.ymax_t_ha * water * temp * heat * pest
    demand = potential * 1000 * crop.n_product_pct / 100 / NHI
    fixed = 0.0
    if crop.is_legume:
        # legumes take ~60 % of their N from the air (Peoples et al. 2009 report 50–70 %; estimate)
        fixed = min(crop.n_fixation_kg_ha, LEGUME_NDFA * demand)
    supply = state.n_mineral_kg_ha + fixed
    n_f = 1.0 if demand <= 0 else min(1.0, 0.3 + 0.7 * supply / demand)
    y = potential * n_f * (a.get("kill_mult", 0.0) if a["kill"] else 1.0)
    yr.yield_t_ha = round(y, 3)
    yr.yield_rel = round(y / crop.ymax_t_ha, 4) if crop.ymax_t_ha else 0.0
    yr.factors = {
        "water": round(water, 4),
        "temperature": round(temp, 4),
        "heat": round(heat, 4),
        "pest": round(pest, 4),
        "nitrogen": round(n_f, 4),
    }
    yr.heat_days = int(a["heat"])
    yr.pest_pressure = round(state.pest_pressure.get(crop.family, 0.0), 4)
    uptake_total = y * 1000 * crop.n_product_pct / 100 / NHI
    from_soil = max(0.0, uptake_total - fixed)
    state.n_mineral_kg_ha = max(0.0, state.n_mineral_kg_ha - from_soil)
    removed = y * 1000 * crop.n_product_pct / 100
    yr.n_removed_kg_ha += removed
    yr.n_fixed_kg_ha += round(fixed, 2)
    product_dm = y * 1000 * crop.dm_frac
    if crop.harvest_index > 0 and y > 0:
        residue = product_dm * (1 / crop.harvest_index - 1)
    else:
        residue = crop.ymax_t_ha * 1000 * crop.dm_frac * 0.3  # killed stand stays on the field
    # residue N: whatever the crop took up minus what left with the product
    residue_cn = crop.residue_cn
    _add_residue(state, residue * (1 - crop.residue_removed_frac), residue_cn)
    state.pest_pressure[crop.family] = min(1.0, state.pest_pressure.get(crop.family, 0.0) + 0.5)


def _add_residue(state: SoilState, kg: float, cn: float) -> None:
    if kg <= 0:
        return
    total = state.residue_kg_ha + kg
    # mass-weighted C:N through nitrogen content
    n_old = state.residue_kg_ha / state.residue_cn if state.residue_kg_ha > 0 else 0.0
    state.residue_cn = total / (n_old + kg / cn)
    state.residue_surface = (state.residue_kg_ha * state.residue_surface + kg) / total
    state.residue_kg_ha = total


def _structure(yr: YearResult, rotation: Rotation, y: int, state: SoilState) -> None:
    """Soil structure index: deep roots and cover crops help, bare soil and heavy harvest hurt."""
    crops = rotation_crops()
    idx = state.infiltration_idx
    main = rotation.main(y)
    if main and main.crop and crops[main.crop].deep_roots:
        idx += 0.04
    if yr.cover and yr.cover_biomass_kg_ha > 1000:
        idx += 0.04
    if yr.bare_days > 120:
        idx -= 0.03
    if main and main.crop in ("potato",):
        idx -= 0.02
    state.infiltration_idx = max(0.7, min(1.3, idx))
