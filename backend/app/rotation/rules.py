"""Agronomic rules for a rotation (ROTATION.md §1.4). Violations are shown, never hidden."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.rotation.crops import rotation_crops
from app.rotation.model import Rotation
from app.rotation.weather import DAYS, doy_of

Level = Literal["warning", "error"]


@dataclass(frozen=True, slots=True)
class RuleViolation:
    code: str
    level: Level
    year: int
    message_ru: str


def check_rotation(rotation: Rotation, erosive_months: tuple[int, ...] = ()) -> list[RuleViolation]:
    """Family breaks, legume after legume, bare soil in the erosive season, cover-crop windows."""
    crops = rotation_crops()
    out: list[RuleViolation] = []
    last_family_year: dict[str, int] = {}
    prev_main = None
    for y in range(rotation.years):
        main = rotation.main(y)
        cover = rotation.cover(y)
        c = crops[main.crop] if main and main.crop else None
        if c:
            seen = last_family_year.get(c.family)
            consecutive_ok = c.allow_consecutive and prev_main == c.id
            if seen is not None and y - seen <= c.min_break_years and not consecutive_ok:
                out.append(
                    RuleViolation(
                        "family_break",
                        "warning",
                        y,
                        f"Год {y + 1}: {c.name_ru} — перерыв для семейства «{c.family_ru}» "
                        f"{y - seen - 1} г., нужно не меньше {c.min_break_years} г.",
                    )
                )
            if c.is_legume and prev_main and crops[prev_main].is_legume and not consecutive_ok:
                out.append(
                    RuleViolation(
                        "legume_after_legume",
                        "warning",
                        y,
                        f"Год {y + 1}: бобовые после бобовых "
                        f"({crops[prev_main].name_ru} → {c.name_ru})",
                    )
                )
            last_family_year[c.family] = y
        if cover and cover.crop:
            cc = crops[cover.crop]
            if c and cc.family == c.family:
                out.append(
                    RuleViolation(
                        "cover_same_family",
                        "warning",
                        y,
                        f"Год {y + 1}: покровная {cc.name_ru} из того же семейства, "
                        f"что {c.name_ru}",
                    )
                )
            start = (
                doy_of(c.sow_mmdd or "04-15") + c.season_days + 10
                if c and not (main and main.sow_mmdd)
                else (
                    doy_of(main.sow_mmdd) + c.season_days + 10
                    if c and main and main.sow_mmdd
                    else doy_of("08-20")
                )
            )
            nxt = rotation.main(y + 1)
            nxt_crop = crops[nxt.crop] if nxt and nxt.crop else None
            end = (
                DAYS
                + doy_of(
                    (nxt.sow_mmdd if nxt else None)
                    or (nxt_crop.sow_mmdd if nxt_crop else None)
                    or "04-15"
                )
                - 14
            )
            if nxt_crop and end - start < 45:
                out.append(
                    RuleViolation(
                        "cover_window",
                        "warning",
                        y,
                        f"Год {y + 1}: покровной {cc.name_ru} остаётся меньше 45 дней "
                        "до сева следующей культуры",
                    )
                )
        if c and erosive_months and not (cover and cover.crop):
            harvest = doy_of(main.sow_mmdd or c.sow_mmdd or "04-15") + c.season_days  # type: ignore[union-attr]
            months_bare = {m for m in erosive_months if _month_after(harvest, m)}
            if months_bare:
                out.append(
                    RuleViolation(
                        "bare_erosive",
                        "warning",
                        y,
                        f"Год {y + 1}: после уборки {c.name_ru} поле голое в месяцы эрозионных "
                        f"ливней ({', '.join(str(m) for m in sorted(months_bare))}) — "
                        "подумайте о покровной культуре",
                    )
                )
        if not c and not (cover and cover.crop):
            out.append(
                RuleViolation("bare_year", "warning", y, f"Год {y + 1}: поле весь год без растений")
            )
        prev_main = c.id if c else None
    return out


def _month_after(doy: int, month: int) -> bool:
    month_start = doy_of(f"{month:02d}-01")
    return month_start >= doy % DAYS
