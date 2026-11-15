import type { Season } from "./FieldScene";

/**
 * What lies behind the field (docs/DESIGN_V3.md §2.2): a mountain range where the field is in the
 * mountains, a row of poplars like along a Central Asian aryk, a farmhouse and a barn. Flat poster
 * shapes; the trees follow the season.
 */
export type Terrain = "mountains" | "hills" | "plains";

export const TERRAIN: Record<string, Terrain> = {
  "tj-hissar": "mountains",
  "ke-nakuru": "mountains",
  "in-punjab": "plains",
  "us-iowa": "hills",
};

const leafOf = (season: Season) =>
  season === "spring" ? "var(--tree-spring)" : season === "autumn" ? "var(--tree-autumn)" : season === "heat" ? "var(--tree-dry)" : "var(--tree)";

export function Mountains({ horizon, season }: { horizon: number; season: Season }) {
  const caps = season === "winter" ? 1.8 : season === "spring" ? 1.2 : 0.8;
  const peaks: [number, number][] = [
    [90, 96],
    [230, 70],
    [380, 104],
    [560, 62],
    [720, 92],
    [880, 74],
  ];
  const range = (dy: number) => `M0 ${horizon - 30} ` + peaks.map(([x, y], i) => `L${x - 70} ${y + 50 + dy + (i % 2) * 10} L${x} ${y + dy}`).join(" ") + ` L1000 ${horizon - 40} V ${horizon} H0 Z`;
  return (
    <g>
      <path d={range(-6)} fill="var(--mountain-far)" />
      {peaks.map(([x, y]) => (
        <path key={x} d={`M${x} ${y - 6} l${-14 * caps} ${16 * caps} l${8 * caps} ${-3 * caps} l${6 * caps} ${5 * caps} l${7 * caps} ${-6 * caps} l${8 * caps} ${4 * caps} Z`} fill="var(--mountain-snow)" />
      ))}
      <path d={range(30)} fill="var(--mountain)" opacity="0.55" />
    </g>
  );
}

function Poplar({ x, y, h, season }: { x: number; y: number; h: number; season: Season }) {
  if (season === "winter")
    return (
      <g stroke="var(--trunk)" strokeLinecap="round">
        <line x1={x} y1={y} x2={x} y2={y - h} strokeWidth="2" />
        <path d={`M${x} ${y - h * 0.4} l-5 -10 M${x} ${y - h * 0.6} l5 -10 M${x} ${y - h * 0.75} l-4 -9`} strokeWidth="1.2" fill="none" />
      </g>
    );
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - h * 0.25} stroke="var(--trunk)" strokeWidth="2" />
      <ellipse cx={x} cy={y - h * 0.6} rx={h * 0.13} ry={h * 0.45} fill={leafOf(season)} />
      <ellipse cx={x + h * 0.03} cy={y - h * 0.62} rx={h * 0.05} ry={h * 0.38} fill="var(--tree-dark)" opacity="0.35" />
    </g>
  );
}

function RoundTree({ x, y, r, season }: { x: number; y: number; r: number; season: Season }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - r} stroke="var(--trunk)" strokeWidth="3" />
      {season !== "winter" && (
        <>
          <circle cx={x} cy={y - r * 1.5} r={r} fill={leafOf(season)} />
          <circle cx={x - r * 0.6} cy={y - r * 1.15} r={r * 0.7} fill={leafOf(season)} />
          <circle cx={x + r * 0.35} cy={y - r * 1.75} r={r * 0.45} fill="var(--tree-dark)" opacity="0.3" />
        </>
      )}
    </g>
  );
}

function Farm({ x, y }: { x: number; y: number }) {
  return (
    <g>
      {/* barn */}
      <rect x={x + 54} y={y - 26} width="36" height="26" fill="var(--barn)" />
      <path d={`M${x + 50} ${y - 24} L${x + 72} ${y - 40} L${x + 94} ${y - 24} Z`} fill="var(--barn-roof)" />
      <path d={`M${x + 64} ${y} v-14 h16 v14 M${x + 64} ${y - 14} l16 14 M${x + 80} ${y - 14} l-16 14`} stroke="var(--house-wall)" strokeWidth="1.5" fill="none" />
      {/* house */}
      <rect x={x} y={y - 24} width="44" height="24" fill="var(--house-wall)" />
      <path d={`M${x - 5} ${y - 22} L${x + 22} ${y - 42} L${x + 49} ${y - 22} Z`} fill="var(--house-roof)" />
      <rect x={x + 6} y={y - 16} width="9" height="8" fill="var(--window)" />
      <rect x={x + 28} y={y - 15} width="8" height="15" fill="var(--barn-roof)" />
      <rect x={x + 30} y={y - 46} width="5" height="10" fill="var(--barn-roof)" />
    </g>
  );
}

export function Trees({ horizon, season, terrain }: { horizon: number; season: Season; terrain: Terrain }) {
  const left = [28, 46, 64, 82, 100];
  const right = [872, 890, 908, 926, 944, 962, 980];
  return (
    <g>
      {terrain !== "plains" && <Farm x={150} y={horizon - 2} />}
      {left.map((x, i) => (
        <Poplar key={`l${x}`} x={x} y={horizon - 6 + (i % 2)} h={52 + (i % 3) * 6} season={season} />
      ))}
      {right.map((x, i) => (
        <Poplar key={`r${x}`} x={x} y={horizon - 4 + (i % 2)} h={48 + ((i + 1) % 3) * 7} season={season} />
      ))}
      <RoundTree x={810} y={horizon - 2} r={11} season={season} />
      {terrain === "plains" && <RoundTree x={190} y={horizon - 2} r={13} season={season} />}
    </g>
  );
}
