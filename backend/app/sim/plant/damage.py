"""Hourly injuries and their daily recovery. Pure functions on a plot's state.

Thresholds come from data/seed/crop_stage_sensitivity.csv (estimate flags there); kill
temperatures default to EcoCrop KTMP. Rates are a model (estimates, docs/ASSUMPTIONS.md).
"""

from __future__ import annotations

from app.biology import responses as r
from app.biology.growth import CropParams
from app.biology.morphology import Morphology
from app.sim.data import StageSensitivity
from app.sim.environment.base_climate import HourEnv
from app.sim.plant.state import PlotState
from app.sim.plant.water import Bucket, ks

FROST_RATE_H = 0.06
HEAT_RATE_H = 0.02
HEAT_KILL_MARGIN_C = 10.0
HEAT_KILL_HOURS = 2.0
WATERLOG_ROOT_RATE_H = 0.008
WILT_DAMAGE_RATE_H = 0.004
WILT_DAMAGE_AFTER_H = 24.0
WILT_DEATH_H = 96.0
HAIL_LEAF_RATE = 0.25
HAIL_FRUIT_RATE = 0.15
WIND_STEM_RATE = 0.02
STAKE_FACTOR = 1.5


def frost_kill_c(sens: StageSensitivity, crop: CropParams) -> float:
    kill = sens.frost_kill_c if sens.frost_kill_c is not None else crop.t_kill_c
    return min(kill, sens.frost_onset_c - 1.0)


def hourly_damage(
    st: PlotState,
    env: HourEnv,
    crop: CropParams,
    morph: Morphology,
    sens: StageSensitivity,
    bucket: Bucket,
    staked: bool,
) -> str | None:
    """Apply one hour of injuries. Returns a death cause, or None."""
    d, c, acc = st.damage, st.counters, st.day
    t = env.temp_c

    # Frost: injury grows with depth below the onset; hours at the kill temperature are fatal.
    onset, kill = sens.frost_onset_c, frost_kill_c(sens, crop)
    if t < onset:
        depth = min(1.5, (onset - t) / (onset - kill))
        hit = FROST_RATE_H * depth
        d.leaf_rev += 0.4 * hit
        d.leaf_irrev += 0.6 * hit
        c.injured_today = True
        acc.note("frost", onset - t)
    if t <= kill:
        c.frost_kill_hours += 1.0
        if c.frost_kill_hours >= sens.frost_kill_hours:
            return "frost"
    else:
        c.frost_kill_hours = 0.0

    # Heat: scorch above the onset; far above the crop's maximum the plant dies.
    if t > sens.heat_onset_c:
        d.leaf_rev += HEAT_RATE_H * (t - sens.heat_onset_c) / 5.0
        c.injured_today = True
        acc.note("heat", t - sens.heat_onset_c)
    if t > crop.t_max_c + HEAT_KILL_MARGIN_C:
        c.heat_kill_hours += 1.0
        if c.heat_kill_hours >= HEAT_KILL_HOURS:
            return "heat"
    else:
        c.heat_kill_hours = 0.0
    # Heat during flowering sterilises flowers: irreversible.
    if sens.sterility_onset_c is not None and t > sens.sterility_onset_c:
        d.sterility = min(
            0.95, d.sterility + sens.sterility_per_degree_hour * (t - sens.sterility_onset_c)
        )
        acc.note("heat_flowering", t - sens.sterility_onset_c)

    # Water: wilting when the root zone dries out, hypoxia when it stays saturated.
    k = ks(st.water_mm, bucket)
    acc.ks_sum += k
    if k < 0.05:
        c.wilt_hours += 1.0
        acc.note("drought", 1.0 - k)
        if c.wilt_hours > WILT_DAMAGE_AFTER_H:
            d.leaf_rev += WILT_DAMAGE_RATE_H
            c.injured_today = True
        if c.wilt_hours > WILT_DEATH_H:
            return "drought"
    else:
        c.wilt_hours = max(0.0, c.wilt_hours - 2.0)
        if k < 0.5:
            acc.note("drought", 1.0 - k)
    if sens.waterlog_onset_h is not None and (st.water_mm >= bucket.waterlog_level or env.flood):
        c.waterlog_hours += 1.0
        acc.note("waterlog", c.waterlog_hours)
        if c.waterlog_hours > sens.waterlog_onset_h:
            d.root = min(1.0, d.root + WATERLOG_ROOT_RATE_H)
            c.injured_today = True
    else:
        c.waterlog_hours = max(0.0, c.waterlog_hours - 2.0)

    # Wind and hail: mechanical damage.
    limit = sens.lodging_wind_ms * (STAKE_FACTOR if staked else 1.0)
    if env.wind_ms > limit:
        d.stem = min(1.0, d.stem + WIND_STEM_RATE * (env.wind_ms / limit - 0.8))
        d.leaf_irrev += 0.004
        c.injured_today = True
        acc.note("wind", env.wind_ms)
    if env.hail > 0:
        d.leaf_irrev += HAIL_LEAF_RATE * env.hail
        if morph.harvest_organ in ("fruit", "pod", "grain") and st.progress > morph.organ_init_frac:
            d.fruit_loss = min(0.9, d.fruit_loss + HAIL_FRUIT_RATE * env.hail)
        c.injured_today = True
        acc.note("hail", env.hail)

    # UV and ionising radiation (flares).
    f_uv = r.uv_response(env.uv_rel, crop.uv_tolerance_rel)
    if f_uv < 0.6:
        d.leaf_rev += (0.6 - f_uv) * 0.03
        c.injured_today = True
        acc.note("uv", 1.0 - f_uv)
    if r.ionising_response(env.radiation_msv_yr) < 0.6:
        d.leaf_irrev += 0.01
        c.injured_today = True
        acc.note("radiation", env.radiation_msv_yr)

    d.leaf_rev = min(1.0, d.leaf_rev)
    d.leaf_irrev = min(1.0, d.leaf_irrev)
    if d.health() <= 0.03:
        return max(
            ("frost", d.leaf_irrev), ("injury", d.leaf_rev), ("roots", d.root), key=lambda x: x[1]
        )[0]
    return None


def daily_recovery(st: PlotState) -> None:
    """Reversible injuries heal when the day passed without new harm."""
    d = st.damage
    if not st.counters.injured_today:
        d.leaf_rev *= 0.85
        d.root *= 0.97
    st.counters.injured_today = False
