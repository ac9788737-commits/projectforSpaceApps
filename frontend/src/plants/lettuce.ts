import * as THREE from "three";
import { earlyStage, GOLDEN, rng } from "./common";
import { leaf, PlantBuilder, stem, type PlantGeometry } from "./geom";
import type { PlantShape } from "./types";

/** Lettuce: a rosette whose inner leaves stand up and cup into a head. */
export function lettuce(s: PlantShape, spinach = false): PlantGeometry {
  const early = earlyStage(s);
  if (early) return early;
  const rand = rng(s);
  const b = new PlantBuilder();
  const h = Math.max(0.03, s.heightM);
  const n = Math.max(3, s.leafCount);
  for (let i = 0; i < n; i++) {
    const age = 1 - i / n; // outer leaves are the oldest
    const yaw = i * GOLDEN;
    const length = (spinach ? 0.16 : 0.2) * (0.35 + 0.65 * age) * (h / (spinach ? 0.3 : 0.25)) * (1 + s.spread * 0.2);
    const width = length * (spinach ? 0.55 : 0.85);
    const pitch = 0.25 + (1 - age) * 0.95 - s.spread * 0.2;
    const tint: [number, number, number] = rand() < s.spots ? [0.55, 0.38, 0.22] : spinach ? [0.7, 0.85, 0.7] : [1.15, 1.2, 1];
    const base = new THREE.Vector3(Math.cos(yaw) * 0.01, 0.005, Math.sin(yaw) * 0.01);
    if (spinach) {
      const tip = base.clone().add(new THREE.Vector3(Math.cos(yaw) * length * 0.3, length * 0.25, Math.sin(yaw) * length * 0.3));
      b.add("stem", stem(base, tip, 0.002, 0.0015, 3));
      b.add("leaf", leaf(tip, yaw, pitch * 0.6, length * 0.75, width, s.droop, s.curl, 5, 0.5), tint);
    } else {
      b.add("leaf", leaf(base, yaw, pitch, length, width, s.droop, s.curl + (1 - age) * 0.5, 6, 0.4), tint);
    }
  }
  return b.build();
}
