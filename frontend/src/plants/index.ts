import type { PlantGeometry } from "./geom";
import { legume } from "./legumes";
import { lettuce } from "./lettuce";
import { potato } from "./potato";
import { radish } from "./radish";
import { tomato } from "./tomato";
import type { PlantShape } from "./types";
import { wheat } from "./wheat";

export type { PlantGeometry } from "./geom";
export { PARTS } from "./geom";

const GENERATORS: Record<string, (s: PlantShape) => PlantGeometry> = {
  potato,
  lettuce: (s) => lettuce(s),
  spinach: (s) => lettuce(s, true),
  wheat: (s) => wheat(s),
  rice: (s) => wheat(s, true),
  tomato,
  soybean: (s) => legume(s, false),
  pea: (s) => legume(s, true),
  radish,
};

/** Build the geometry of one plant; spirulina is drawn as a culture tank instead. */
export function buildPlant(cropId: string, shape: PlantShape): PlantGeometry | null {
  const generator = GENERATORS[cropId];
  return generator ? generator(shape) : null;
}

export const UNDERGROUND_ORGANS = new Set(["tuber", "root"]);
