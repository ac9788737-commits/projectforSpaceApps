/**
 * Organic carbon → Munsell 10YR soil colour (docs/DESIGN.md §2.2). The one place where the
 * mapping lives: darker soil = more organic carbon. Anchors follow the usual reading of a
 * Munsell chart (value 7 → 3 as organic C rises from ~0.4 to ~3 %); between two anchors the
 * colour is mixed linearly, so a small change in carbon still moves the colour a little.
 */
export const SOIL_STEPS = [
  { step: 1, soc: 0.4, token: "var(--soil-1)", munsell: "10YR 7/3" },
  { step: 2, soc: 0.8, token: "var(--soil-2)", munsell: "10YR 6/4" },
  { step: 3, soc: 1.3, token: "var(--soil-3)", munsell: "10YR 5/4" },
  { step: 4, soc: 2.0, token: "var(--soil-4)", munsell: "10YR 4/3" },
  { step: 5, soc: 3.0, token: "var(--soil-5)", munsell: "10YR 3/2" },
] as const;

/** Nearest Munsell step 1–5 for an organic-carbon percentage. */
export function soilStep(socPct: number): 1 | 2 | 3 | 4 | 5 {
  let best: (typeof SOIL_STEPS)[number] = SOIL_STEPS[0];
  for (const s of SOIL_STEPS) if (Math.abs(s.soc - socPct) < Math.abs(best.soc - socPct)) best = s;
  return best.step;
}

/** Position on the chart, 0 (step 1) … 4 (step 5), continuous. */
export function soilPosition(socPct: number): number {
  const s = SOIL_STEPS;
  if (socPct <= s[0].soc) return 0;
  for (let i = 1; i < s.length; i++) {
    if (socPct <= s[i].soc) return i - 1 + (socPct - s[i - 1].soc) / (s[i].soc - s[i - 1].soc);
  }
  return s.length - 1;
}

/** CSS colour for the topsoil: the two neighbouring Munsell chips mixed by position. */
export function soilColor(socPct: number): string {
  const pos = soilPosition(socPct);
  const i = Math.min(SOIL_STEPS.length - 2, Math.floor(pos));
  const t = Math.round((pos - i) * 100);
  if (t <= 0) return SOIL_STEPS[i].token;
  if (t >= 100) return SOIL_STEPS[i + 1].token;
  return `color-mix(in oklab, ${SOIL_STEPS[i + 1].token} ${t}%, ${SOIL_STEPS[i].token})`;
}
