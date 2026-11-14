import * as THREE from "three";
import { canopyLeaves, earlyStage, rng } from "./common";
import { ellipsoid, PlantBuilder, stem, type PlantGeometry } from "./geom";
import type { PlantShape } from "./types";

/** Soybean (bush) and pea (climbing vine on a trellis) with pods. */
export function legume(s: PlantShape, vine: boolean): PlantGeometry {
  const early = earlyStage(s);
  if (early) return early;
  const rand = rng(s);
  const b = new PlantBuilder();
  const h = Math.max(0.04, s.heightM);
  const stems = vine ? 1 : 3;
  const tops: THREE.Vector3[] = [];
  for (let i = 0; i < stems; i++) {
    const yaw = (i / stems) * Math.PI * 2;
    const lean = vine ? 0.05 : 0.15 + s.spread * 0.2 + s.droop * 0.3;
    const top = new THREE.Vector3(Math.cos(yaw) * h * lean, h * (1 - s.droop * 0.35), Math.sin(yaw) * h * lean);
    b.add("stem", stem(new THREE.Vector3(0, 0, 0), top, vine ? 0.003 : 0.006, 0.003, 4));
    tops.push(top);
  }
  if (vine) {
    b.add("stem", stem(new THREE.Vector3(-0.06, -0.05, 0), new THREE.Vector3(-0.06, h * 1.1 + 0.05, 0), 0.003, 0.003, 3), [0.6, 0.5, 0.35]);
    b.add("stem", stem(new THREE.Vector3(0.06, -0.05, 0), new THREE.Vector3(0.06, h * 1.1 + 0.05, 0), 0.003, 0.003, 3), [0.6, 0.5, 0.35]);
  }
  const perStem = Math.max(1, Math.round(s.leafCount / stems));
  for (const top of tops) {
    canopyLeaves(b, s, rand, {
      count: vine ? perStem : perStem * 3,
      heightOf: (j, n) => top.y * (0.15 + (0.85 * j) / n),
      length: vine ? 0.035 : 0.06,
      width: vine ? 0.025 : 0.04,
      pitch: 0.35,
      radius: vine ? 0.02 : Math.hypot(top.x, top.z) * 0.5,
    });
  }
  if (s.stage === "flowering") {
    for (let f = 0; f < 5; f++) {
      const top = tops[f % stems];
      b.add("flower", ellipsoid(top.clone().multiplyScalar(0.5 + rand() * 0.5).add(new THREE.Vector3(0.02, 0, 0.02)), 0.008, 0.006, 0.008, 5));
    }
  }
  if (s.organCount > 0) {
    const len = Math.max(0.02, Math.min(0.08, s.organSizeM * 6));
    for (let i = 0; i < s.organCount; i++) {
      const top = tops[i % stems];
      const k = 0.3 + rand() * 0.6;
      const yaw = rand() * Math.PI * 2;
      const at = new THREE.Vector3(top.x * k + Math.cos(yaw) * 0.03, top.y * k, top.z * k + Math.sin(yaw) * 0.03);
      b.add("organ", ellipsoid(at, 0.006, len / 2, 0.009, 6, yaw));
    }
  }
  return b.build();
}
