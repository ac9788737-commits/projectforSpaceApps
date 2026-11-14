import type { PlantShape, PlantState } from "./types";

export interface CropTraits {
  id: string;
  harvestOrgan: string;
  tOptMinC: number;
  tOptMaxC: number;
}

export interface PlantLook {
  shape: PlantShape;
  leaf: [number, number, number];
  stem: [number, number, number];
  organ: [number, number, number];
  flower: [number, number, number];
  under: [number, number, number];
}

type RGB = [number, number, number];
const HEALTHY: RGB = [0.22, 0.52, 0.2];
const COLD: RGB = [0.36, 0.28, 0.55]; // anthocyanin: bluish purple
const HOT_DRY: RGB = [0.78, 0.69, 0.22]; // chlorosis: yellow
const PALE: RGB = [0.62, 0.76, 0.5]; // etiolated
const DEAD: RGB = [0.4, 0.27, 0.14];

function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// Dry-matter share of the harvested organ, only to turn dry grams into a visible size.
const DRY_SHARE: Record<string, number> = { tuber: 0.2, root: 0.08, fruit: 0.06, pod: 0.25, grain: 0.85, leaf: 0.05 };

/** Visible size (radius, m) of one harvest organ from its fresh mass (density ≈ 1 g/cm³). */
export function organRadiusM(yieldG: number, organCount: number, organ: string): number {
  if (organCount <= 0 || yieldG <= 0) return 0;
  const fresh = yieldG / organCount / (DRY_SHARE[organ] ?? 0.2);
  return Math.cbrt((3 * fresh) / (4 * Math.PI)) / 100;
}

/**
 * Stress → visual code: cold = purple and drooping, heat/drought = yellow and curled,
 * low light = pale and stretched (stretch is already in heightM), radiation = spots,
 * low gravity = lankier spread (a model, not a measurement), death = brown and collapsed.
 */
export function plantLook(
  state: PlantState,
  tMeanC: number,
  gravityG: number,
  crop: CropTraits,
  seed: number,
  healthy: RGB = HEALTHY,
): PlantLook {
  const dead = state.stage === "dead";
  const cold = tMeanC < crop.tOptMinC ? state.stress.temp : 0;
  const hot = tMeanC > crop.tOptMaxC ? state.stress.temp : 0;
  const dry = Math.max(hot, state.stress.water * 0.8);
  let leaf = healthy;
  leaf = mix(leaf, PALE, state.stress.light * 0.8);
  leaf = mix(leaf, COLD, cold);
  leaf = mix(leaf, HOT_DRY, dry);
  leaf = mix(leaf, [0.55, 0.5, 0.2], (1 - state.health) * 0.35);
  if (state.stage === "mature" && ["grain", "pod"].includes(crop.harvestOrgan)) leaf = mix(leaf, [0.78, 0.66, 0.32], 0.75);
  if (dead) leaf = DEAD;

  const ripeness =
    state.stage === "mature" ? 1 : state.stage === "fruiting" ? Math.min(1, Math.max(0, (state.progress - 0.6) / 0.4)) : 0;
  const organColors: Record<string, RGB> = {
    tuber: [0.78, 0.66, 0.45],
    root: [0.82, 0.18, 0.28],
    fruit: mix([0.3, 0.55, 0.2], [0.85, 0.16, 0.1], ripeness),
    pod: mix([0.35, 0.6, 0.25], [0.72, 0.62, 0.38], ripeness),
    grain: mix([0.45, 0.62, 0.25], [0.86, 0.72, 0.38], ripeness),
    leaf: leaf,
    biomass: [0.1, 0.45, 0.35],
  };
  const organ = dead ? DEAD : organColors[crop.harvestOrgan] ?? [0.6, 0.6, 0.4];
  return {
    shape: {
      heightM: state.heightM,
      leafCount: state.leafCount,
      organCount: state.organCount,
      organSizeM: organRadiusM(state.yieldG, state.organCount, crop.harvestOrgan),
      stage: state.stage,
      ripeness,
      // Wilting: water stress makes the plant hang its leaves; it perks up after watering.
      droop: dead ? 1 : Math.min(1, cold * 0.8 + (1 - state.health) * 0.35 + state.stress.water * 0.8),
      curl: dead ? 0.6 : Math.min(1, dry),
      spread: Math.min(1, Math.max(0, (1 - gravityG) * 0.7)),
      spots: Math.min(1, state.stress.radiation * 1.2),
      seed,
    },
    leaf,
    stem: dead ? DEAD : mix([0.3, 0.5, 0.22], leaf, 0.4),
    organ,
    flower: crop.id === "potato" ? [0.82, 0.78, 0.95] : crop.id === "tomato" ? [0.98, 0.85, 0.2] : [0.97, 0.97, 0.95],
    under: crop.harvestOrgan === "root" ? [0.82, 0.18, 0.28] : [0.8, 0.68, 0.48],
  };
}

/** Linear interpolation between two days so plants grow smoothly. */
export function interpolateState(a: PlantState, b: PlantState, t: number): PlantState {
  const l = (x: number, y: number) => x + (y - x) * t;
  const pick = t < 0.5 ? a : b;
  return {
    day: l(a.day, b.day),
    stage: b.stage === "dead" ? b.stage : pick.stage,
    heightM: l(a.heightM, b.heightM),
    leafCount: Math.round(l(a.leafCount, b.leafCount)),
    leafAreaIndex: l(a.leafAreaIndex, b.leafAreaIndex),
    biomassG: l(a.biomassG, b.biomassG),
    yieldG: l(a.yieldG, b.yieldG),
    organCount: pick.organCount,
    stress: {
      temp: l(a.stress.temp, b.stress.temp),
      light: l(a.stress.light, b.stress.light),
      water: l(a.stress.water, b.stress.water),
      gravity: l(a.stress.gravity, b.stress.gravity),
      radiation: l(a.stress.radiation, b.stress.radiation),
    },
    health: l(a.health, b.health),
    progress: l(a.progress, b.progress),
  };
}
