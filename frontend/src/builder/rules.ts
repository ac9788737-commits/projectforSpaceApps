import i18n, { num } from "@/i18n";
import type { Card, Slot } from "./api";

export interface Clash {
  year: number;
  slot: 0 | 1;
  text: string;
  warn?: boolean; // yellow: money or labour, not agronomy
}

/** Seasons that need more money or hands than the farmer has (docs/IMPROVEMENTS.md B6). */
export function overBudget(costs: { start_usd: number; labour_days: number }[], budget: number | null, labour: number | null): Clash[] {
  const out: Clash[] = [];
  costs.forEach((c, y) => {
    if (budget !== null && c.start_usd > budget) out.push({ year: y, slot: 0, warn: true, text: i18n.t("rules.over_budget", { v: num(Math.round(c.start_usd / 10) * 10) }) });
    else if (labour !== null && c.labour_days > labour) out.push({ year: y, slot: 0, warn: true, text: i18n.t("rules.over_labour", { v: Math.round(c.labour_days) }) });
  });
  return out;
}

/** Instant agronomic checks on the client (same rules as the server, docs/ROTATION.md §1.4),
 * so a bad combination lights up on the card before any calculation. Pure. */
export function clashes(plan: Slot[], deck: Card[]): Clash[] {
  const byId = new Map(deck.map((c) => [c.id, c]));
  const out: Clash[] = [];
  const lastFamily = new Map<string, number>();
  let prev: Card | undefined;
  plan.forEach(([m, c], y) => {
    const main = m ? byId.get(m) : undefined;
    const cover = c ? byId.get(c) : undefined;
    if (main) {
      const seen = lastFamily.get(main.family);
      const consecutiveOk = main.allow_consecutive && prev?.id === main.id;
      if (seen !== undefined && y - seen <= main.min_break_years && !consecutiveOk) {
        out.push({ year: y, slot: 0, text: i18n.t("rules.again", { family: main.family_ru, n: main.min_break_years }) });
      } else if (main.is_legume && prev?.is_legume && !consecutiveOk) {
        out.push({ year: y, slot: 0, text: i18n.t("rules.legumes") });
      }
      lastFamily.set(main.family, y);
    }
    if (cover && main && cover.family === main.family) {
      out.push({ year: y, slot: 1, text: i18n.t("rules.cover_family", { family: main.family_ru }) });
    }
    if (m && !main) out.push({ year: y, slot: 0, text: i18n.t("rules.unknown") });
    prev = main;
  });
  return out;
}

/** Human rounding (docs/UX.md §5). */
export function human(value: number, unit: string): string {
  const abs = Math.abs(value);
  const step = abs >= 1000 ? 100 : abs >= 100 ? 10 : 1;
  const v = Math.round(value / step) * step;
  return `${v < 0 ? "−" : ""}${num(Math.abs(v))}${unit ? ` ${unit}` : ""}`;
}
