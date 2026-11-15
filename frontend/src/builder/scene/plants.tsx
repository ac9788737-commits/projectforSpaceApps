import type { ReactNode } from "react";

/**
 * Flat poster-style plant silhouettes (docs/DESIGN_V3.md §2.2). Each crop has a form, each form
 * five stages: sprout → bush → flower → ripe → stubble. Drawn at the origin, growing upwards,
 * in a 0…1 box scaled by `h`. Colours come from tokens; the leaf colour carries the model state
 * (pale = short of nitrogen, dry = short of water).
 */
export type Stage = "sprout" | "bush" | "flower" | "ripe" | "stubble";
export type Form = "cereal" | "maize" | "legume" | "cotton" | "potato" | "tomato" | "sunflower" | "mustard" | "phacelia";

export const FORM: Record<string, Form> = {
  wheat: "cereal",
  winter_wheat: "cereal",
  barley: "cereal",
  rye_cover: "cereal",
  maize: "maize",
  pea: "legume",
  chickpea: "legume",
  soybean: "legume",
  vetch: "legume",
  clover: "legume",
  alfalfa: "legume",
  cotton: "cotton",
  potato: "potato",
  tomato: "tomato",
  sunflower: "sunflower",
  mustard: "mustard",
  phacelia: "phacelia",
};

/** Relative height of a fully grown plant of each form. */
const TALL: Record<Form, number> = { cereal: 0.8, maize: 1.35, legume: 0.55, cotton: 0.85, potato: 0.6, tomato: 0.7, sunflower: 1.3, mustard: 0.7, phacelia: 0.6 };

export function stageOf(stage: string | null, crop: string | null, soilCover: number): Stage | null {
  if (!crop) return soilCover > 0.3 ? "stubble" : null;
  return stage === "ini" ? "sprout" : stage === "dev" ? "bush" : stage === "mid" ? "flower" : stage === "late" ? "ripe" : "bush";
}

export interface Health {
  water: number; // 0…1 of available water
  nitrogen: number; // kg/ha mineral N
}

export function leafColor(h: Health): string {
  if (h.water < 0.25) return "var(--leaf-dry)";
  if (h.nitrogen < 25) return "var(--leaf-pale)";
  return "var(--leaf)";
}

/** One plant. `size` is the full-grown height in px at this depth of the field. */
export function Plant({ crop, stage, size, health, flower }: { crop: string; stage: Stage; size: number; health: Health; flower: string }): ReactNode {
  const form = FORM[crop] ?? "legume";
  const leaf = stage === "ripe" ? "var(--ripe)" : leafColor(health);
  const dryK = health.water < 0.25 ? 0.75 : 1; // drought: shorter
  const grow = stage === "sprout" ? 0.22 : stage === "bush" ? 0.6 : 1;
  const H = size * TALL[form] * grow * dryK;
  const W = size * 0.5;

  if (stage === "stubble") {
    return (
      <g stroke="var(--stubble)" strokeWidth={Math.max(1, size * 0.05)} strokeLinecap="round">
        <line x1={-W * 0.3} y1={0} x2={-W * 0.35} y2={-size * 0.14} />
        <line x1={0} y1={0} x2={0} y2={-size * 0.17} />
        <line x1={W * 0.3} y1={0} x2={W * 0.35} y2={-size * 0.13} />
      </g>
    );
  }
  if (stage === "sprout") {
    const s = Math.max(2.5, size * 0.18);
    return (
      <g fill={leaf}>
        <line x1={0} y1={0} x2={0} y2={-s * 0.9} stroke={leaf} strokeWidth={Math.max(1, size * 0.04)} />
        <ellipse cx={-s * 0.45} cy={-s * 0.95} rx={s * 0.5} ry={s * 0.22} transform={`rotate(-25 ${-s * 0.45} ${-s * 0.95})`} />
        <ellipse cx={s * 0.45} cy={-s * 0.95} rx={s * 0.5} ry={s * 0.22} transform={`rotate(25 ${s * 0.45} ${-s * 0.95})`} />
      </g>
    );
  }
  const sw = Math.max(1, size * 0.045);
  const bloom = stage === "flower";
  const ripe = stage === "ripe";

  switch (form) {
    case "cereal": {
      const ear = ripe ? "var(--ripe)" : bloom ? flower : leaf;
      return (
        <g stroke={leaf} strokeWidth={sw} strokeLinecap="round" fill="none">
          <path d={`M0 0 Q${-W * 0.5} ${-H * 0.5} ${-W * 0.55} ${-H * 0.8}`} />
          <path d={`M0 0 Q${W * 0.1} ${-H * 0.6} 0 ${-H}`} />
          <path d={`M0 0 Q${W * 0.5} ${-H * 0.45} ${W * 0.6} ${-H * 0.75}`} />
          {(bloom || ripe) && (
            <g fill={ear} stroke="none">
              <ellipse cx={0} cy={-H * 1.04} rx={W * 0.12} ry={H * 0.13} />
              <ellipse cx={-W * 0.55} cy={-H * 0.84} rx={W * 0.1} ry={H * 0.1} transform={`rotate(-20 ${-W * 0.55} ${-H * 0.84})`} />
              <ellipse cx={W * 0.6} cy={-H * 0.79} rx={W * 0.1} ry={H * 0.1} transform={`rotate(22 ${W * 0.6} ${-H * 0.79})`} />
            </g>
          )}
        </g>
      );
    }
    case "maize":
      return (
        <g strokeLinecap="round">
          <line x1={0} y1={0} x2={0} y2={-H} stroke={leaf} strokeWidth={sw * 1.4} />
          {[0.3, 0.5, 0.7].map((k, i) => (
            <path key={k} d={`M0 ${-H * k} Q${(i % 2 ? 1 : -1) * W * 0.7} ${-H * (k + 0.02)} ${(i % 2 ? 1 : -1) * W * 0.85} ${-H * (k - 0.12)}`} stroke={leaf} strokeWidth={sw * 1.3} fill="none" />
          ))}
          {(bloom || ripe) && <path d={`M0 ${-H} l${-W * 0.15} ${-H * 0.12} M0 ${-H} l${W * 0.15} ${-H * 0.12} M0 ${-H} v${-H * 0.14}`} stroke={ripe ? "var(--ripe)" : "var(--crop-cereal)"} strokeWidth={sw} />}
          {ripe && <ellipse cx={W * 0.18} cy={-H * 0.55} rx={W * 0.13} ry={H * 0.13} fill="var(--crop-cereal)" />}
        </g>
      );
    case "sunflower":
      return (
        <g strokeLinecap="round">
          <line x1={0} y1={0} x2={0} y2={-H} stroke={leaf} strokeWidth={sw * 1.3} />
          <ellipse cx={-W * 0.35} cy={-H * 0.45} rx={W * 0.35} ry={W * 0.16} fill={leaf} />
          <ellipse cx={W * 0.35} cy={-H * 0.62} rx={W * 0.35} ry={W * 0.16} fill={leaf} />
          {(bloom || ripe) && (
            <g transform={`translate(${ripe ? W * 0.12 : 0} ${-H}) rotate(${ripe ? 35 : 0})`}>
              <circle r={W * 0.42} fill={ripe ? "var(--ripe)" : "var(--flower-yellow)"} />
              <circle r={W * 0.2} fill="var(--seed)" />
            </g>
          )}
        </g>
      );
    default: {
      // bushes: legumes, cotton, potato, tomato, mustard, phacelia
      const blobs: [number, number, number][] = [
        [-0.32, 0.45, 0.32],
        [0.32, 0.45, 0.32],
        [0, 0.7, 0.36],
        [-0.2, 0.85, 0.26],
        [0.22, 0.88, 0.25],
      ];
      const dots: { x: number; y: number; r: number; fill: string }[] = [];
      const spot = (fill: string, r: number) =>
        [
          [-0.3, 0.7],
          [0.28, 0.75],
          [0, 0.98],
          [0.05, 0.55],
        ].forEach(([x, y]) => dots.push({ x: x * W, y: -y * H, r: r * W, fill }));
      if (form === "cotton") {
        if (bloom) spot("var(--flower-pink)", 0.1);
        if (ripe) spot("var(--boll)", 0.16);
      } else if (form === "tomato") {
        if (bloom) spot("var(--flower-yellow)", 0.08);
        if (ripe) spot("var(--fruit-red)", 0.13);
      } else if (form === "potato") {
        if (bloom) spot("var(--flower-white)", 0.09);
      } else if (form === "mustard") {
        if (bloom || ripe) spot("var(--flower-yellow)", 0.12);
      } else if (form === "phacelia") {
        if (bloom || ripe) spot("var(--flower-purple)", 0.12);
      } else if (bloom) spot(flower === "var(--crop-legume)" ? "var(--flower-white)" : flower, 0.08);
      else if (ripe) spot("var(--seed)", 0.07);
      const bush = ripe && form === "cotton" ? "var(--leaf-dry)" : leaf;
      return (
        <g>
          <line x1={0} y1={0} x2={0} y2={-H * 0.5} stroke={bush} strokeWidth={sw} />
          {blobs.map(([x, y, r], i) => (
            <ellipse key={i} cx={x * W} cy={-y * H} rx={r * W} ry={r * W * 0.8} fill={bush} />
          ))}
          {dots.map((d, i) => (
            <circle key={`d${i}`} cx={d.x} cy={d.y} r={d.r} fill={d.fill} />
          ))}
        </g>
      );
    }
  }
}

/** A big plant for a seed packet: the crop at flowering (or ripe, where the fruit is the point). */
export function PacketPlant({ crop, size }: { crop: string; size: number }) {
  const ripeFirst = ["cotton", "tomato", "maize", "wheat", "winter_wheat", "barley", "rye_cover", "sunflower"].includes(crop);
  return <Plant crop={crop} stage={ripeFirst ? "ripe" : "flower"} size={size} health={{ water: 0.8, nitrogen: 60 }} flower="var(--flower-white)" />;
}
