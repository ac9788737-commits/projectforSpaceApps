import { useTranslation } from "react-i18next";
import { num } from "@/i18n";
import { soilColor } from "@/ui/soilColor";
import type { Card, Quick, Slot, Week } from "./api";

/**
 * The soil profile under the plan (docs/DESIGN.md §6): one continuous section through all years.
 * Topsoil colour = organic carbon on the Munsell chart (ui/soilColor.ts), its thickness = the soil
 * reserve, a cut edge = soil washed away, roots at the crop's real depth, a blue line = moisture,
 * ink ticks = available nitrogen. Drawn in a 1000-wide box; the year columns line up with the
 * strips above (summer : winter = 1.6 : 1).
 */
export const SUMMER_SHARE = 1.6 / 2.6;
const W = 1000;
const H = 190;
const DEPTH_M = 2; // the section shows the top 2 m
const SURFACE = 4;

export interface YearSoil {
  soc: number;
  reserve: number;
  erosion: number;
  water: number;
  nitrogen: number;
}

/** Year-end state of the soil for each year of the plan (median of 20 weathers for soil, the
 * played weather for moisture, nitrogen and erosion). */
export function yearSoil(q: Quick | undefined, years: number): YearSoil[] {
  const weeks = q?.playback.weeks ?? [];
  const start = q?.soil_reserve[0];
  return Array.from({ length: years }, (_, k) => {
    const r = q?.soil_reserve[k + 1] ?? start;
    const ws: Week[] = weeks.filter((w) => w.year === k);
    const mean = (f: (w: Week) => number) => (ws.length ? ws.reduce((a, w) => a + f(w), 0) / ws.length : 0);
    return {
      soc: r?.soc_pct ?? 1.3,
      reserve: r?.value ?? 50,
      erosion: ws.length ? ws[ws.length - 1].erosion_cum : 0,
      water: ws.length ? mean((w) => w.water) : 0.5,
      nitrogen: ws.length ? mean((w) => w.n_mineral) : 0,
    };
  });
}

/** Deterministic scatter so the ticks do not jump between renders. */
const rand = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export function SoilProfile({ q, plan, deck, playWeek, compact = false }: { q: Quick | undefined; plan: Slot[]; deck: Card[]; playWeek?: Week | null; compact?: boolean }) {
  const { t } = useTranslation();
  const n = plan.length;
  const yw = W / n;
  const soil = yearSoil(q, n);
  const byId = new Map(deck.map((c) => [c.id, c]));
  const depthPx = (m: number) => (Math.min(m, DEPTH_M) / DEPTH_M) * (H - SURFACE - 6);
  const thick = (v: number) => 20 + Math.max(0, Math.min(100, v)) * 0.55; // reserve 0–100 → 20–75
  const drop = (e: number) => Math.min(18, e * 0.9); // exaggerated: t/ha washed away → px

  const weeks = q?.playback.weeks ?? [];
  let playX: number | null = null;
  if (playWeek) {
    const inYear = weeks.filter((w) => w.year === playWeek.year);
    const i = inYear.indexOf(playWeek);
    playX = playWeek.year * yw + (Math.max(0, i) / Math.max(1, inYear.length)) * yw;
  }

  const moisture = soil
    .map((s, k) => {
      const y = SURFACE + 8 + (1 - s.water) * (H - SURFACE - 24);
      return `${k === 0 ? "M" : "L"}${k * yw},${y} L${(k + 1) * yw},${y}`;
    })
    .join(" ");

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={compact ? "block h-32 w-full" : "block h-40 w-full sm:h-48"}
        role="img"
        aria-label={t("plan.profile_aria", { c: soil.map((s) => `${num(s.soc)} %`).join(", "), v: soil.map((s) => Math.round(s.reserve)).join(", ") })}
      >
        {/* subsoil */}
        <rect x="0" y={SURFACE} width={W} height={H - SURFACE} fill="var(--subsoil)" />
        {soil.map((s, k) => {
          const top = SURFACE + drop(s.erosion);
          return (
            <g key={k}>
              {/* the eaten edge: washed-away soil shows as paper */}
              <rect x={k * yw} y="0" width={yw} height={top} fill="var(--paper)" />
              <rect className="soil-horizon" x={k * yw} y={top} width={yw + 0.5} height={thick(s.reserve)} fill={soilColor(s.soc)} />
              {/* available nitrogen: ink ticks in the topsoil, density = mineral N */}
              {Array.from({ length: Math.max(0, Math.min(16, Math.round(s.nitrogen / 7))) }, (_, i) => {
                const x = k * yw + 8 + rand(k * 31 + i) * (yw - 16);
                const y = top + 5 + rand(k * 17 + i * 3) * Math.max(4, thick(s.reserve) - 12);
                return <line key={i} x1={x} x2={x} y1={y} y2={y + 4} stroke="var(--paper)" strokeOpacity="0.8" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />;
              })}
            </g>
          );
        })}
        {/* roots at the real depth of each crop, summer crop in the wide part, cover in the narrow */}
        {plan.flatMap(([m, c], k) =>
          ([[m, 0], [c, 1]] as const).flatMap(([crop, slot]) => {
            const card = crop ? byId.get(crop) : undefined;
            if (!card) return [];
            const x0 = k * yw + (slot === 0 ? (yw * SUMMER_SHARE) / 2 : yw * SUMMER_SHARE + (yw * (1 - SUMMER_SHARE)) / 2);
            const top = SURFACE + drop(soil[k].erosion);
            const d = depthPx(card.root_depth_m ?? 1);
            const spread = slot === 0 ? yw * 0.16 : yw * 0.07;
            const path = [
              `M${x0},${top} L${x0},${top + d}`,
              `M${x0},${top + d * 0.25} L${x0 - spread},${top + d * 0.7}`,
              `M${x0},${top + d * 0.25} L${x0 + spread},${top + d * 0.7}`,
              `M${x0},${top + d * 0.5} L${x0 - spread * 0.6},${top + d * 0.92}`,
              `M${x0},${top + d * 0.5} L${x0 + spread * 0.6},${top + d * 0.92}`,
            ].join(" ");
            return [<path key={`${k}-${slot}`} d={path} fill="none" stroke="var(--ink)" strokeOpacity="0.7" strokeWidth="1" strokeLinecap="round" vectorEffect="non-scaling-stroke" />];
          }),
        )}
        {/* moisture */}
        <path d={moisture} fill="none" stroke="var(--water)" strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
        {/* year boundaries and the ground line */}
        {soil.map((_, k) => (k ? <line key={k} x1={k * yw} x2={k * yw} y1="0" y2={H} stroke="var(--paper)" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null))}
        <line x1="0" x2={W} y1={SURFACE} y2={SURFACE} stroke="var(--ink)" strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.4" vectorEffect="non-scaling-stroke" />
        {playX !== null && <line x1={playX} x2={playX} y1="0" y2={H} stroke="var(--ink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="grid text-xs text-fg-muted" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {soil.map((s, k) => (
          <p key={k} className="border-l border-subtle px-1.5 pt-1 tabular-nums first:border-l-0">
            <span className="text-fg">{t("plan.reserve", { v: Math.round(s.reserve) })}</span> <span>{t("plan.carbon", { v: num(s.soc) })}</span>
          </p>
        ))}
      </div>
      {!compact && (
        <figcaption className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fg-muted">
          <span>{t("plan.legend_color")}</span>
          <span>{t("plan.legend_depth")}</span>
          <span>{t("plan.legend_roots")}</span>
          <span className="text-water">{t("plan.legend_water")}</span>
          <span>{t("plan.legend_n")}</span>
          <span>{t("plan.legend_erosion")}</span>
        </figcaption>
      )}
    </figure>
  );
}
