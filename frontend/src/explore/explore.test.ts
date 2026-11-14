import { describe, expect, it } from "vitest";
import { buildPlant, PARTS } from "@/plants";
import { interpolateState, organRadiusM, plantLook, type CropTraits } from "@/plants/appearance";
import type { PlantState } from "@/plants/types";
import { bubbleRadius, passesFilters } from "./levels/Galaxy";
import { systemLayout } from "./levels/System";
import { parsePath, pathFor, type ExploreRoute } from "./routes";
import { effectiveBed, NO_WHAT_IF, type Bed } from "./store";

const base: PlantState = {
  day: 10,
  stage: "vegetative",
  heightM: 0.3,
  leafCount: 20,
  leafAreaIndex: 2,
  biomassG: 50,
  yieldG: 0,
  organCount: 0,
  stress: { temp: 0, light: 0, water: 0, gravity: 0, radiation: 0 },
  health: 1,
  progress: 0.3,
};
const potato: CropTraits = { id: "potato", harvestOrgan: "tuber", tOptMinC: 15, tOptMaxC: 20 };

describe("routes", () => {
  const cases: ExploreRoute[] = [
    { level: "universe" },
    { level: "galaxy", galaxyId: "milky_way" },
    { level: "system", galaxyId: "milky_way", starId: "sun" },
    { level: "planet", galaxyId: "milky_way", starId: "sun", planetId: "mars" },
    { level: "garden", galaxyId: "milky_way", starId: "sun", planetId: "mars" },
    { level: "garden", galaxyId: "lmc", starId: "star-hyp-magellanic-42-001", planetId: "hyp-magellanic-42-001" },
  ];
  it("uses the URL scheme from the spec", () => {
    expect(pathFor(cases[4])).toBe("/galaxy/milky-way/system/sol/planet/mars/garden");
  });
  it.each(cases)("round-trips %o", (route) => {
    expect(parsePath(pathFor(route))).toEqual(route);
  });
  it("falls back to the universe", () => {
    expect(parsePath("/something/else")).toEqual({ level: "universe" });
  });
});

describe("stress appearance", () => {
  it("cold stress turns leaves purple and droopy", () => {
    const cold = plantLook({ ...base, stress: { ...base.stress, temp: 0.8 } }, 2, 1, potato, 1);
    const healthy = plantLook(base, 18, 1, potato, 1);
    expect(cold.leaf[2]).toBeGreaterThan(healthy.leaf[2]); // more blue
    expect(cold.shape.droop).toBeGreaterThan(healthy.shape.droop);
  });
  it("heat stress yellows and curls leaves", () => {
    const hot = plantLook({ ...base, stress: { ...base.stress, temp: 0.8 } }, 35, 1, potato, 1);
    expect(hot.leaf[0]).toBeGreaterThan(hot.leaf[2] * 2);
    expect(hot.shape.curl).toBeGreaterThan(0.5);
  });
  it("low gravity widens the silhouette; Earth gravity does not", () => {
    expect(plantLook(base, 18, 0.38, potato, 1).shape.spread).toBeGreaterThan(0.3);
    expect(plantLook(base, 18, 1, potato, 1).shape.spread).toBe(0);
  });
  it("dead plants are brown", () => {
    const dead = plantLook({ ...base, stage: "dead", health: 0 }, 18, 1, potato, 1);
    expect(dead.leaf).toEqual([0.4, 0.27, 0.14]);
  });
  it("interpolates numbers smoothly between days", () => {
    const mid = interpolateState(base, { ...base, day: 11, heightM: 0.5, biomassG: 70 }, 0.5);
    expect(mid.heightM).toBeCloseTo(0.4);
    expect(mid.biomassG).toBeCloseTo(60);
  });
  it("organ size follows fresh mass", () => {
    // 225 g dry over 10 tubers at 20 % dry matter ≈ 112 g fresh ≈ 3 cm radius.
    expect(organRadiusM(225, 10, "tuber")).toBeCloseTo(0.03, 2);
    expect(organRadiusM(0, 0, "tuber")).toBe(0);
  });
});

describe("plant generators", () => {
  const crops = ["potato", "lettuce", "spinach", "wheat", "rice", "tomato", "soybean", "pea", "radish"];
  const stages: PlantState["stage"][] = ["seed", "germination", "vegetative", "flowering", "fruiting", "mature", "dead"];
  it.each(crops)("%s builds geometry for every stage", (crop) => {
    for (const stage of stages) {
      const geo = buildPlant(crop, {
        heightM: 0.4,
        leafCount: 12,
        organCount: 4,
        organSizeM: 0.02,
        stage,
        ripeness: 0.5,
        droop: 0.2,
        curl: 0.1,
        spread: 0.3,
        spots: 0.2,
        seed: 1,
      });
      expect(geo).not.toBeNull();
      const vertices = PARTS.reduce((n, part) => n + (geo![part]?.getAttribute("position").count ?? 0), 0);
      expect(vertices).toBeGreaterThan(0);
    }
  });
  it("potato puts tubers underground", () => {
    const geo = buildPlant("potato", { heightM: 0.5, leafCount: 30, organCount: 8, organSizeM: 0.03, stage: "fruiting", ripeness: 0.3, droop: 0, curl: 0, spread: 0, spots: 0, seed: 1 })!;
    geo.under!.computeBoundingBox();
    expect(geo.under!.boundingBox!.max.y).toBeLessThan(0);
  });
  it("spirulina has no plant generator (drawn as a tank)", () => {
    expect(buildPlant("spirulina", { heightM: 0, leafCount: 0, organCount: 0, organSizeM: 0, stage: "vegetative", ripeness: 0, droop: 0, curl: 0, spread: 0, spots: 0, seed: 1 })).toBeNull();
  });
});

describe("system layout", () => {
  const planet = (id: string, a: number) => ({ id, semi_major_axis_au: a, parent_id: null }) as never;
  it("keeps order and a minimum gap in compact systems", () => {
    const layout = systemLayout({ star: { radius_rsun: 0.12 } as never, planets: [planet("b", 0.0115), planet("c", 0.0158), planet("d", 0.0223)] }, false);
    const r = [0.0115, 0.0158, 0.0223].map(layout.orbit);
    expect(r[1] - r[0]).toBeGreaterThanOrEqual(1);
    expect(r[2] - r[1]).toBeGreaterThanOrEqual(1);
  });
  it("real scale is proportional to the semi-major axis", () => {
    const layout = systemLayout({ star: { radius_rsun: 1 } as never, planets: [] }, true);
    expect(layout.orbit(2) / layout.orbit(1)).toBeCloseTo(2);
  });
});

describe("galaxy helpers", () => {
  it("bubble radius grows logarithmically", () => {
    expect(bubbleRadius(1000)).toBeGreaterThan(bubbleRadius(100));
    expect(bubbleRadius(10000) / bubbleRadius(1000)).toBeLessThan(2);
  });
  it("filters stars", () => {
    const star = { habitable: false, star_class: "M", hypothetical: false, distance_pc: 50 } as never;
    expect(passesFilters(star, { hzOnly: true, starClass: "", maxDistancePc: 100 })).toBe(false);
    expect(passesFilters(star, { hzOnly: false, starClass: "M", maxDistancePc: 100 })).toBe(true);
    expect(passesFilters(star, { hzOnly: false, starClass: "", maxDistancePc: 10 })).toBe(false);
  });
});

describe("what if", () => {
  const bed: Bed = { crop: "potato", scenario: "open_surface", whatIf: NO_WHAT_IF };
  it("dome turns an open bed into a greenhouse", () => {
    expect(effectiveBed({ ...bed, whatIf: { ...NO_WHAT_IF, dome: true } }).scenario).toBe("greenhouse");
  });
  it("LED and heating become timeline overrides", () => {
    expect(effectiveBed(bed).overrides).toBeNull();
    expect(effectiveBed({ ...bed, whatIf: { dome: false, led: true, heating: true } }).overrides).toEqual({
      supplemental_ppfd_umol_m2_s: 300,
      heating_k: 15,
    });
  });
});
