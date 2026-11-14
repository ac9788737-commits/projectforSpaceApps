/** Plant state for one local day, as returned by POST /simulate/timeline. */
export interface PlantState {
  day: number;
  stage: "seed" | "germination" | "vegetative" | "flowering" | "fruiting" | "mature" | "dead";
  heightM: number;
  leafCount: number;
  leafAreaIndex: number;
  biomassG: number;
  yieldG: number; // tubers / fruits / leaves, dry mass per plant
  organCount: number; // tubers, fruits, pods, ears
  stress: { temp: number; light: number; water: number; gravity: number; radiation: number }; // 0..1
  health: number; // 0..1
  progress: number; // 0..1 of the development cycle
}

/** Everything a generator needs to build the geometry of one plant. */
export interface PlantShape {
  heightM: number;
  leafCount: number;
  organCount: number;
  organSizeM: number;
  stage: PlantState["stage"];
  ripeness: number; // 0 green … 1 ripe
  droop: number; // 0..1 cold / weak / dead plants hang their leaves
  curl: number; // 0..1 heat and drought curl leaf edges
  spread: number; // 0..1 low gravity: wider, lankier silhouette (model)
  spots: number; // 0..1 share of leaves with necrotic spots (radiation)
  seed: number;
}
