import * as THREE from "three";
import { canopyLeaves, earlyStage, rng } from "./common";
import { ellipsoid, PlantBuilder, stem, type PlantGeometry } from "./geom";
import type { PlantShape } from "./types";

/** Potato: a few leafy stems, pale flowers, tubers on stolons underground. */
export function potato(s: PlantShape): PlantGeometry {
  const early = earlyStage(s);
  if (early) return early;
  const rand = rng(s);
  const b = new PlantBuilder();
  const h = Math.max(0.04, s.heightM);
  const stems = 4;
  const lean = 0.18 + s.spread * 0.25 + s.droop * 0.3;
  const tops: THREE.Vector3[] = [];
  for (let i = 0; i < stems; i++) {
    const yaw = (i / stems) * Math.PI * 2 + rand() * 0.5;
    const top = new THREE.Vector3(Math.cos(yaw) * h * lean, h * (0.85 + rand() * 0.15) * (1 - s.droop * 0.35), Math.sin(yaw) * h * lean);
    b.add("stem", stem(new THREE.Vector3(0, 0, 0), top, 0.008, 0.004));
    tops.push(top);
  }
  const perStem = Math.max(1, Math.round(s.leafCount / stems));
  tops.forEach((top, i) => {
    canopyLeaves(b, s, rand, {
      count: perStem,
      heightOf: (j, n) => top.y * (0.25 + (0.75 * j) / n),
      length: 0.09 + h * 0.12,
      width: 0.05 + h * 0.05,
      pitch: 0.45,
      radius: Math.hypot(top.x, top.z) * 0.6,
    });
    if (s.stage === "flowering" || (s.stage === "fruiting" && i % 2 === 0)) {
      for (let f = 0; f < 4; f++) {
        const p = top.clone().add(new THREE.Vector3((rand() - 0.5) * 0.05, 0.02 + rand() * 0.02, (rand() - 0.5) * 0.05));
        b.add("flower", ellipsoid(p, 0.012, 0.006, 0.012, 6));
      }
    }
  });
  // Fine roots: thin light lines below the stem base (visible in the soil cut).
  for (let i = 0; i < 7; i++) {
    const yaw = (i / 7) * Math.PI * 2 + rand() * 0.4;
    const end = new THREE.Vector3(Math.cos(yaw) * (0.06 + rand() * 0.08), -0.12 - rand() * 0.14, Math.sin(yaw) * (0.06 + rand() * 0.08));
    b.add("under", stem(new THREE.Vector3(0, -0.01, 0), end, 0.0016, 0.0006, 3), [1.15, 1.12, 1.05]);
  }
  // Tubers: placed on a ring 5–20 cm deep around the stem base.
  if (s.organCount > 0 && s.organSizeM > 0) {
    for (let i = 0; i < s.organCount; i++) {
      const yaw = i * 2.39996 + rand() * 0.6;
      const r = 0.05 + rand() * 0.12;
      const depth = -0.05 - rand() * 0.15;
      const size = s.organSizeM * (0.6 + rand() * 0.7);
      const center = new THREE.Vector3(Math.cos(yaw) * r, depth, Math.sin(yaw) * r);
      b.add("stem", stem(new THREE.Vector3(0, -0.03, 0), center, 0.002, 0.002, 3), [0.85, 0.8, 0.7]);
      b.add("under", ellipsoid(center, size * 1.25, size * 0.9, size, 10, yaw));
    }
  }
  return b.build();
}
