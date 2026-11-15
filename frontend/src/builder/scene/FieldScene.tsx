import { useDroppable } from "@dnd-kit/core";
import type { CSSProperties, ReactNode } from "react";
import { cropColor } from "@/ui/crops";
import { PAT } from "@/ui/patterns";
import { soilColor } from "@/ui/soilColor";
import type { Card, Irrigation, Quick, Slot, Week } from "../api";
import { Mountains, Trees, type Terrain } from "./Backdrop";
import { Plant, stageOf, type Stage } from "./plants";

/**
 * Screen 2 as a living field (docs/DESIGN_V3.md §2.2): a flat poster landscape whose every part
 * is read from the model — sky by season and the week's weather, the plan's years as strips of
 * the field in perspective (year 1 nearest), plants at the stage the model gives for that year in
 * the month on the time slider, drought, pale nitrogen, erosion rills, salt, irrigation. The strips
 * take the seed packets (drop targets). Quiet life — swaying plants, drifting clouds, a bird —
 * stops with «Пауза мира» and prefers-reduced-motion.
 */
const W = 1000;
const H = 440;
const HORIZON = 232;
const NEAR = 432;
const TOP_L = 236;
const TOP_R = 764;

export type Season = "winter" | "spring" | "summer" | "autumn" | "heat" | "storm";

export function seasonOf(week: Week | null): Season {
  if (!week) return "summer";
  if (week.storm) return "storm";
  if (week.heat) return "heat";
  const m = week.month;
  return m === 11 || m <= 1 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn";
}

/** Depth 0 (horizon) … 1 (near edge) → y, with the far part compressed like a real field. */
const yAt = (d: number) => HORIZON + 4 + (NEAR - HORIZON - 4) * d ** 1.35;
const xAt = (d: number, u: number) => {
  const k = d ** 1.35;
  const l = TOP_L + (-60 - TOP_L) * k;
  const r = TOP_R + (W + 60 - TOP_R) * k;
  return l + (r - l) * u;
};
const quad = (d0: number, d1: number, u0: number, u1: number) =>
  `${xAt(d0, u0)},${yAt(d0)} ${xAt(d0, u1)},${yAt(d0)} ${xAt(d1, u1)},${yAt(d1)} ${xAt(d1, u0)},${yAt(d1)}`;

const rand = (i: number) => {
  const x = Math.sin(i * 91.17 + 7.3) * 43758.5453;
  return x - Math.floor(x);
};

export interface Sow {
  year: number;
  crop: string;
  key: number;
}

function Strip({
  year,
  d0,
  d1,
  week,
  plan,
  card,
  coverCard,
  current,
  dragging,
  sow,
  salinity,
  irrigation,
  names,
  label,
  interactive,
  signs,
}: {
  year: number;
  d0: number;
  d1: number;
  week: Week | null;
  plan: Slot;
  card?: Card;
  coverCard?: Card;
  current: boolean;
  dragging: boolean;
  sow: Sow | null;
  salinity: boolean;
  irrigation: Irrigation;
  names: Record<string, string>;
  label: string;
  interactive: boolean;
  signs: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `scene-${year}`, data: { year, slot: 0 }, disabled: !interactive });
  // what stands on the strip now: the model's week for this year and month, or the plan before the first answer
  const crop = week ? week.crop : plan[0];
  const stage: Stage | null = week ? stageOf(week.stage, week.crop, week.soil_cover) : plan[0] ? "flower" : null;
  const health = { water: week?.water ?? 0.6, nitrogen: week?.n_mineral ?? 60 };
  const soc = week?.soc_pct ?? 1.4;
  const dMid = (d0 + d1) / 2;
  const rows = Math.max(2, Math.round(1 + 3 * dMid));
  const perRow = Math.max(8, Math.round(10 + 14 * dMid));
  const bare = !crop;
  const dry = health.water < 0.3;
  const pests = (week?.pest ?? 0) > 0.6;
  const rills = (week?.erosion_cum ?? 0) > 1.5 ? Math.min(6, Math.round((week?.erosion_cum ?? 0) / 1.5)) : 0;
  const sowing = sow && sow.year === year;
  const plants: ReactNode[] = [];
  if (stage && crop && !sowing) {
    for (let r = 0; r < rows; r++) {
      const d = d0 + ((r + 0.7) / (rows + 0.2)) * (d1 - d0);
      const s = 10 + 40 * d ** 1.35;
      for (let i = 0; i < perRow; i++) {
        const k = year * 997 + r * 61 + i;
        if (pests && rand(k) < 0.22) continue;
        const u = 0.05 + ((i + 0.5 + (rand(k * 3) - 0.5) * 0.3) / perRow) * 0.9;
        plants.push(
          <g key={k} transform={`translate(${xAt(d, u)} ${yAt(d)})`}>
            <g className="scene-plant scene-sway" style={{ animationDelay: `${-rand(k * 7) * 4}s` }}>
              <Plant crop={crop} stage={stage} size={s} health={health} flower={cropColor(crop)} />
            </g>
          </g>,
        );
      }
    }
  }
  const sprouts: ReactNode[] = [];
  if (sowing) {
    for (let r = 0; r < rows; r++) {
      const d = d0 + ((r + 0.7) / (rows + 0.2)) * (d1 - d0);
      const s = 10 + 40 * d ** 1.35;
      for (let i = 0; i < perRow; i++) {
        const u = 0.05 + ((i + 0.5) / perRow) * 0.9;
        const k = year * 131 + r * 17 + i;
        sprouts.push(
          <g key={`s${k}`} transform={`translate(${xAt(d, u)} ${yAt(d)})`}>
            <circle r={Math.max(1.2, s * 0.05)} fill="var(--seed)" className="scene-seed" style={{ ["--sx" as string]: `${(rand(k) - 0.5) * 60}px`, ["--sy" as string]: `${-120 - rand(k * 5) * 60}px`, animationDelay: `${rand(k * 9) * 120}ms` } as CSSProperties} />
            <g className="scene-sprout" style={{ animationDelay: `${380 + rand(k * 2) * 160}ms` }}>
              <Plant crop={sow.crop} stage="sprout" size={s} health={{ water: 0.8, nitrogen: 60 }} flower={cropColor(sow.crop)} />
            </g>
          </g>,
        );
      }
    }
  }
  const signY = yAt(dMid);
  const signX = xAt(dMid, 0) + 6;
  const signS = 0.75 + dMid * 0.45;
  const signText = `${label}${card ? `: ${names[card.id] ?? card.id}` : ""}`;
  const signW = Math.max(signText.length, coverCard ? (names[coverCard.id] ?? "").length + 2 : 0) * 7.6 + 14;
  return (
    <g>
      <polygon
        ref={(el) => setNodeRef(el as unknown as HTMLElement)}
        points={quad(d0, d1, 0, 1)}
        fill={soilColor(soc)}
        className="soil-horizon"
        role="group"
        aria-label={label}
      />
      {(bare || dry) && <polygon points={quad(d0, d1, 0, 1)} fill={PAT.bare} pointerEvents="none" />}
      {salinity && <polygon points={quad(d0 + (d1 - d0) * 0.15, d1, 0.55, 0.95)} fill={PAT.salt} pointerEvents="none" />}
      {/* furrows towards the vanishing point */}
      {Array.from({ length: 13 }, (_, i) => {
        const u = (i + 1) / 14;
        return <line key={i} x1={xAt(d0, u)} y1={yAt(d0)} x2={xAt(d1, u)} y2={yAt(d1)} stroke="var(--soil-5)" strokeOpacity="0.16" strokeWidth={0.6 + dMid} pointerEvents="none" />;
      })}
      {dry && bare &&
        Array.from({ length: 8 }, (_, i) => {
          const u = 0.1 + rand(year * 13 + i) * 0.8;
          const d = d0 + rand(year * 29 + i) * (d1 - d0);
          const x = xAt(d, u);
          const y = yAt(d);
          const s = 3 + 8 * d;
          return <path key={`c${i}`} d={`M${x} ${y} l${s} ${s * 0.3} l${-s * 0.4} ${s * 0.5} l${s * 0.9} ${s * 0.2}`} stroke="var(--soil-5)" strokeOpacity="0.5" strokeWidth="1" fill="none" pointerEvents="none" />;
        })}
      {Array.from({ length: rills }, (_, i) => {
        const u = 0.15 + rand(year * 7 + i) * 0.7;
        return <path key={`r${i}`} d={`M${xAt(d0, u)} ${yAt(d0)} Q${xAt((d0 + d1) / 2, u + 0.03)} ${yAt((d0 + d1) / 2)} ${xAt(d1, u - 0.02)} ${yAt(d1)}`} stroke="var(--soil-1)" strokeOpacity="0.7" strokeWidth={0.8 + dMid * 1.6} fill="none" strokeLinecap="round" pointerEvents="none" />;
      })}
      {irrigation === "drip" &&
        Array.from({ length: rows }, (_, r) => {
          const d = d0 + ((r + 0.7) / (rows + 0.2)) * (d1 - d0);
          return (
            <g key={`dl${r}`} pointerEvents="none">
              <line x1={xAt(d, 0.04)} y1={yAt(d) + 1} x2={xAt(d, 0.96)} y2={yAt(d) + 1} stroke="var(--grayscale-700)" strokeWidth={0.6 + d * 1.2} />
              {Array.from({ length: 6 }, (_, i) => (
                <circle key={i} cx={xAt(d, 0.1 + i * 0.16)} cy={yAt(d) + 2.5} r={0.8 + d * 1.2} fill="var(--aryk)" />
              ))}
            </g>
          );
        })}
      <g pointerEvents="none">{plants}</g>
      <g pointerEvents="none">{sprouts}</g>
      {(isOver || current) && (
        <polygon points={quad(d0, d1, 0, 1)} fill="none" stroke="var(--ink)" strokeWidth={isOver ? 3 : 1.5} strokeDasharray={isOver ? "8 5" : undefined} pointerEvents="none" />
      )}
      {dragging && !isOver && <polygon points={quad(d0, d1, 0, 1)} fill="none" stroke="var(--paper-sheet)" strokeOpacity="0.8" strokeWidth="1.5" strokeDasharray="4 4" pointerEvents="none" />}
      {/* the field sign: year and what the plan puts there */}
      {signs && <g transform={`translate(${signX} ${signY}) scale(${signS})`} pointerEvents="none">
        <rect x={0} y={-15} width={signW} height={coverCard ? 34 : 22} rx="3" fill="var(--paper-sheet)" style={{ filter: "drop-shadow(var(--shadow-packet))" }} />
        <text x={6} y={0} fontSize="12" fontWeight="600" fill="var(--ink)">
          {signText}
        </text>
        {coverCard && (
          <text x={6} y={14} fontSize="11" fill="var(--ink-soft)">
            + {names[coverCard.id] ?? coverCard.id}
          </text>
        )}
      </g>}
    </g>
  );
}

function Fence() {
  const posts = Array.from({ length: 9 }, (_, i) => 0.12 + i * 0.11);
  const at = (d: number) => ({ x: xAt(d, 0) - 10 - 30 * d, y: yAt(d) + 2, h: 6 + 22 * d });
  return (
    <g stroke="var(--fence)" strokeLinecap="round" pointerEvents="none">
      {posts.slice(1).map((d, i) => {
        const a = at(posts[i]);
        const b = at(d);
        return (
          <g key={d}>
            <line x1={a.x} y1={a.y - a.h * 0.8} x2={b.x} y2={b.y - b.h * 0.8} strokeWidth={1 + d * 2} />
            <line x1={a.x} y1={a.y - a.h * 0.4} x2={b.x} y2={b.y - b.h * 0.4} strokeWidth={1 + d * 2} />
          </g>
        );
      })}
      {posts.map((d) => {
        const p = at(d);
        return <line key={`p${d}`} x1={p.x} y1={p.y} x2={p.x} y2={p.y - p.h} strokeWidth={1.5 + d * 3} />;
      })}
    </g>
  );
}

function Cloud({ x, y, s, dark, duration, delay }: { x: number; y: number; s: number; dark: boolean; duration: number; delay: number }) {
  return (
    <g className="scene-cloud" style={{ animationDuration: `${duration}s`, animationDelay: `${-delay}s` }}>
      <g transform={`translate(${x} ${y}) scale(${s})`} fill={dark ? "var(--cloud-storm)" : "var(--cloud)"}>
        <ellipse cx="0" cy="0" rx="46" ry="16" />
        <ellipse cx="-18" cy="-12" rx="22" ry="16" />
        <ellipse cx="16" cy="-16" rx="26" ry="20" />
      </g>
    </g>
  );
}

export function FieldScene({
  plan,
  deck,
  q,
  week,
  irrigation,
  sow,
  paused,
  dragging,
  names,
  yearLabel,
  overlay,
  interactive = true,
  compact = false,
  terrain = "hills",
  signs,
}: {
  plan: Slot[];
  deck: Card[];
  q: Quick | undefined;
  week: Week | null;
  irrigation: Irrigation;
  sow: Sow | null;
  paused: boolean;
  dragging: boolean;
  names: Record<string, string>;
  yearLabel: (y: number) => string;
  overlay?: ReactNode;
  interactive?: boolean;
  compact?: boolean;
  terrain?: Terrain;
  signs?: boolean;
}) {
  const season = seasonOf(week);
  const weeks = q?.playback.weeks ?? [];
  const month = week?.month ?? 6;
  const byId = new Map(deck.map((c) => [c.id, c]));
  const n = plan.length;
  const salinity = !!q?.salinity.risk;
  const hills = season === "winter" ? "winter" : season === "heat" || season === "autumn" ? "dry" : "green";
  const hillFar = hills === "winter" ? "var(--hill-far-winter)" : hills === "dry" ? "var(--hill-far-dry)" : "var(--hill-far)";
  const hillNear = hills === "winter" ? "var(--hill-near-winter)" : hills === "dry" ? "var(--hill-near-dry)" : "var(--hill-near)";
  const rainy = !!week && (week.storm || week.rain > 6) && season !== "winter";
  const snowy = !!week && season === "winter" && (week.rain > 3 || week.frost);
  const cloudy = season === "storm" || rainy;
  return (
    <div className={`relative overflow-hidden ${paused ? "world-paused" : ""}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className={compact ? "block h-auto w-full" : "block h-80 w-full sm:h-auto"} role="img" aria-label={yearLabel(-1)}>
        {/* sky: three flat bands of the season */}
        <rect width={W} height={86} fill={`var(--sky-${season}-1)`} />
        <rect y={86} width={W} height={78} fill={`var(--sky-${season}-2)`} />
        <rect y={164} width={W} height={HORIZON - 164 + 8} fill={`var(--sky-${season}-3)`} />
        {season !== "storm" && <circle cx={season === "winter" ? 820 : 860} cy={season === "winter" ? 120 : 70} r={season === "heat" ? 44 : 34} fill="var(--sun)" />}
        {!compact && (
          <>
            <Cloud x={0} y={60} s={1} dark={cloudy} duration={90} delay={20} />
            <Cloud x={0} y={110} s={0.7} dark={cloudy} duration={120} delay={70} />
            {cloudy && <Cloud x={0} y={40} s={1.3} dark duration={70} delay={45} />}
            {!cloudy && season !== "winter" && (
              <g className="scene-bird" style={{ animationDelay: "-3s" }}>
                <g transform="translate(0 70)">
                  <path d="M0 0 q6 -6 12 0 q6 -6 12 0" stroke="var(--bird)" strokeWidth="2" fill="none" strokeLinecap="round" />
                </g>
              </g>
            )}
          </>
        )}
        {terrain === "mountains" && <Mountains horizon={HORIZON} season={season} />}
        {/* hills: two flat silhouettes */}
        <path d={`M0 ${HORIZON - 40} C 160 ${HORIZON - 80}, 300 ${HORIZON - 30}, 450 ${HORIZON - 56} S 760 ${HORIZON - 88}, ${W} ${HORIZON - 44} V ${HORIZON + 10} H 0 Z`} fill={hillFar} />
        <path d={`M0 ${HORIZON - 12} C 200 ${HORIZON - 44}, 380 ${HORIZON - 4}, 560 ${HORIZON - 26} S 860 ${HORIZON - 40}, ${W} ${HORIZON - 14} V ${HORIZON + 12} H 0 Z`} fill={hillNear} />
        <Trees horizon={HORIZON + 4} season={season} terrain={terrain} />
        {/* ground around the field */}
        <polygon points={`0,${HORIZON + 2} ${W},${HORIZON + 2} ${W},${H} 0,${H}`} fill={hillNear} />
        {/* a fence along the near-left edge of the field */}
        <Fence />
        {/* the aryk along the field for furrow irrigation */}
        {irrigation === "furrow" && <polygon points={`${xAt(0, 1) + 6},${yAt(0)} ${xAt(0, 1) + 12},${yAt(0)} ${xAt(1, 1) + 34},${H} ${xAt(1, 1) + 4},${H}`} fill="var(--aryk)" />}
        {/* strips: year 1 nearest */}
        {plan.map((p, y) => {
          const d0 = 1 - (y + 1) / n;
          const d1 = 1 - y / n;
          const wk = weeks.find((w) => w.year === y && w.month === month) ?? null;
          return (
            <Strip
              key={y}
              year={y}
              d0={d0 + 0.004}
              d1={d1 - 0.004}
              week={wk}
              plan={p}
              card={p[0] ? byId.get(p[0]) : undefined}
              coverCard={p[1] ? byId.get(p[1]) : undefined}
              current={!!week && week.year === y}
              dragging={dragging}
              sow={sow}
              salinity={salinity}
              irrigation={irrigation}
              names={names}
              label={yearLabel(y)}
              interactive={interactive}
              signs={signs ?? !compact}
            />
          );
        }).reverse()}
        {/* weather of the week, in flat shapes */}
        {!compact && rainy && (
          <g pointerEvents="none">
            {Array.from({ length: 60 }, (_, i) => (
              <line key={i} className="scene-rain" style={{ animationDelay: `${-rand(i) * 0.7}s` }} x1={rand(i * 3) * (W + 60)} y1={rand(i * 5) * H * 0.9} x2={rand(i * 3) * (W + 60) - 8} y2={rand(i * 5) * H * 0.9 + 22} stroke="var(--aryk)" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
            ))}
          </g>
        )}
        {!compact && week?.storm && <path className="scene-bolt" d="M720 40 l-26 58 h20 l-22 56 l52 -74 h-22 l20 -40 z" fill="var(--sun)" pointerEvents="none" />}
        {!compact && snowy && (
          <g pointerEvents="none">
            {Array.from({ length: 50 }, (_, i) => (
              <circle key={i} className="scene-snow" style={{ animationDelay: `${-rand(i) * 2.6}s` }} cx={rand(i * 7) * W} cy={rand(i * 11) * H * 0.85} r={1.6 + rand(i) * 1.6} fill="var(--cloud)" />
            ))}
          </g>
        )}
        {!compact && week?.heat && (
          <g pointerEvents="none" stroke="var(--paper-sheet)" strokeOpacity="0.55" strokeWidth="1.3" fill="none" strokeLinecap="round">
            {[0, 1, 2].map((i) => (
              <path key={i} className="scene-heat" style={{ animationDelay: `${-i * 0.5}s` }} d={`M${300 + i * 150} ${HORIZON - 8 + i * 6} q10 -4 20 0 t20 0 t20 0`} />
            ))}
          </g>
        )}
      </svg>
      {overlay}
    </div>
  );
}
