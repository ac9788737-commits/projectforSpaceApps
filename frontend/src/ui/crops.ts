/** Seed-packet colours by family (docs/DESIGN.md §2.3) and the crop → family link. */
export const FAMILY_COLOR: Record<string, string> = {
  poaceae: "var(--crop-cereal)",
  fabaceae: "var(--crop-legume)",
  malvaceae: "var(--crop-malva)",
  solanaceae: "var(--crop-solan)",
  brassicaceae: "var(--crop-brassica)",
  asteraceae: "var(--crop-aster)",
  boraginaceae: "var(--crop-borage)",
};

export const CROP_FAMILY: Record<string, string> = {
  wheat: "poaceae",
  winter_wheat: "poaceae",
  barley: "poaceae",
  maize: "poaceae",
  rye_cover: "poaceae",
  pea: "fabaceae",
  chickpea: "fabaceae",
  alfalfa: "fabaceae",
  soybean: "fabaceae",
  vetch: "fabaceae",
  clover: "fabaceae",
  cotton: "malvaceae",
  potato: "solanaceae",
  tomato: "solanaceae",
  mustard: "brassicaceae",
  sunflower: "asteraceae",
  phacelia: "boraginaceae",
};

export const cropColor = (crop: string | null | undefined, family?: string): string =>
  FAMILY_COLOR[family ?? CROP_FAMILY[crop ?? ""] ?? ""] ?? "var(--ink-soft)";
