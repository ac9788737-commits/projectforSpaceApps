import * as THREE from "three";
import { earlyStage, rng } from "./common";
import { ellipsoid, leaf, PlantBuilder, stem, type PlantGeometry } from "./geom";
import type { PlantShape } from "./types";

/** Wheat (and rice with `rice`): tillers with long narrow leaves, ears or drooping panicles. */
export function wheat(s: PlantShape, rice = false): PlantGeometry {
  const early = earlyStage(s);
  if (early) return early;
  const rand = rng(s);
  const b = new PlantBuilder();
  const h = Math.max(0.05, s.heightM);
  const tillers = Math.max(2, s.organCount || 3);
  const headed = s.stage === "flowering" || s.stage === "fruiting" || s.stage === "mature" || (s.stage === "dead" && s.organCount > 0);
  for (let t = 0; t < tillers; t++) {
    const yaw = (t / tillers) * Math.PI * 2 + rand() * 0.6;
    const lean = 0.08 + s.spread * 0.2 + s.droop * 0.35 + rand() * 0.05;
    const top = new THREE.Vector3(Math.cos(yaw) * h * lean, h * (0.9 + rand() * 0.1) * (1 - s.droop * 0.5), Math.sin(yaw) * h * lean);
    b.add("stem", stem(new THREE.Vector3(0, 0, 0), top, 0.003, 0.0018, 4));
    const leaves = Math.max(2, Math.round(s.leafCount / tillers));
    for (let i = 0; i < leaves; i++) {
      const y = top.y * (0.12 + (0.6 * i) / leaves);
      const ly = yaw + (i % 2 ? Math.PI : 0) + rand() * 0.4;
      const tint: [number, number, number] = rand() < s.spots ? [0.55, 0.38, 0.22] : [1, 1, 1];
      b.add("leaf", leaf(new THREE.Vector3(top.x * (y / top.y), y, top.z * (y / top.y)), ly, 0.9 - s.spread * 0.2, h * 0.32, 0.012, Math.min(1, 0.5 + s.droop), s.curl * 0.6, 6, 0.9), tint);
    }
    if (headed) {
      const ear = Math.max(0.03, Math.min(0.1, 0.04 + s.organSizeM * 4));
      if (rice) {
        for (let g = 0; g < 9; g++) {
          const k = g / 8;
          const p = top.clone().add(new THREE.Vector3(Math.cos(yaw) * ear * k * 1.2, -ear * k * k * 1.4, Math.sin(yaw) * ear * k * 1.2));
          b.add("organ", ellipsoid(p, 0.004, 0.007, 0.004, 5));
        }
      } else {
        const center = top.clone().add(new THREE.Vector3(0, ear / 2, 0));
        b.add("organ", ellipsoid(center, 0.007, ear / 2, 0.007, 6));
      }
    }
  }
  return b.build();
}
