import * as THREE from "three";
import { earlyStage, rng } from "./common";
import { ellipsoid, leaf, PlantBuilder, stem, type PlantGeometry } from "./geom";
import type { PlantShape } from "./types";

/** Tomato: a staked main stem with side leaves, yellow flowers and fruit trusses. */
export function tomato(s: PlantShape): PlantGeometry {
  const early = earlyStage(s);
  if (early) return early;
  const rand = rng(s);
  const b = new PlantBuilder();
  const h = Math.max(0.05, s.heightM);
  const bend = s.droop * 0.4 + s.spread * 0.15;
  const pts: THREE.Vector3[] = [];
  const segments = 6;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    pts.push(new THREE.Vector3(Math.sin(t * 3) * 0.02 + bend * t * t * h, h * t * (1 - s.droop * 0.3 * t), Math.cos(t * 2) * 0.01));
  }
  for (let i = 0; i < segments; i++) b.add("stem", stem(pts[i], pts[i + 1], 0.011 - i * 0.001, 0.01 - i * 0.001));
  b.add("stem", stem(new THREE.Vector3(0.05, -0.05, 0.03), new THREE.Vector3(0.05, h * 1.05 + 0.05, 0.03), 0.006, 0.006, 4), [0.55, 0.42, 0.28]);
  const n = Math.max(2, s.leafCount);
  for (let i = 0; i < n; i++) {
    const t = 0.1 + (0.85 * i) / n;
    const at = pts[Math.min(segments, Math.round(t * segments))].clone();
    const yaw = i * 2.2 + rand() * 0.5;
    const tint: [number, number, number] = rand() < s.spots ? [0.55, 0.38, 0.22] : [0.9, 1, 0.9];
    b.add("leaf", leaf(at, yaw, 0.25 - s.spread * 0.2, 0.09 + h * 0.06, 0.06, Math.min(1, 0.35 + s.droop), s.curl), tint);
  }
  if (s.stage === "flowering" || s.stage === "fruiting") {
    for (let f = 0; f < 6; f++) {
      const at = pts[2 + (f % 4)].clone().add(new THREE.Vector3((rand() - 0.5) * 0.08, 0.02, (rand() - 0.5) * 0.08));
      b.add("flower", ellipsoid(at, 0.01, 0.004, 0.01, 6));
    }
  }
  if (s.organCount > 0) {
    const r = Math.max(0.008, s.organSizeM);
    for (let i = 0; i < s.organCount; i++) {
      const truss = pts[2 + (i % 4)];
      const yaw = i * 1.7;
      const center = truss.clone().add(new THREE.Vector3(Math.cos(yaw) * (0.04 + r), -0.03 - (i % 3) * r * 1.2, Math.sin(yaw) * (0.04 + r)));
      b.add("organ", ellipsoid(center, r, r * 0.88, r, 10));
    }
  }
  return b.build();
}
