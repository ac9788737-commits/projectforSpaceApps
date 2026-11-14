import * as THREE from "three";
import { mulberry32 } from "@/explore/lib/noise";
import { leaf, PlantBuilder, stem, type PlantGeometry } from "./geom";
import type { PlantShape } from "./types";

export const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function rng(shape: PlantShape) {
  return mulberry32(shape.seed);
}

/** Seed and germination stages look the same for every crop: a seed, then two cotyledons. */
export function earlyStage(shape: PlantShape): PlantGeometry | null {
  if (shape.stage === "seed") {
    const b = new PlantBuilder();
    b.add("under", new THREE.SphereGeometry(0.006, 6, 4).translate(0, -0.01, 0));
    return b.build();
  }
  if (shape.stage === "germination") {
    const b = new PlantBuilder();
    const h = Math.max(0.015, shape.heightM);
    b.add("stem", stem(new THREE.Vector3(0, -0.01, 0), new THREE.Vector3(0, h, 0), 0.0025, 0.002, 4));
    b.add("leaf", leaf(new THREE.Vector3(0, h, 0), 0, 0.3, 0.02, 0.012, shape.droop, 0, 3));
    b.add("leaf", leaf(new THREE.Vector3(0, h, 0), Math.PI, 0.3, 0.02, 0.012, shape.droop, 0, 3));
    return b.build();
  }
  return null;
}

/** Dead plants keep their last shape but collapse toward the ground (handled by droop). */
export function canopyLeaves(
  b: PlantBuilder,
  s: PlantShape,
  rand: () => number,
  opts: { count: number; heightOf: (i: number, n: number) => number; length: number; width: number; pitch: number; radius?: number },
) {
  const { count, heightOf, length, width, pitch, radius = 0 } = opts;
  for (let i = 0; i < count; i++) {
    const yaw = i * GOLDEN + rand() * 0.4;
    const y = heightOf(i, count);
    const base = new THREE.Vector3(Math.cos(yaw) * radius, y, Math.sin(yaw) * radius);
    const tint: [number, number, number] = rand() < s.spots ? [0.55, 0.38, 0.22] : [1, 1, 1];
    const p = pitch - s.spread * 0.25;
    b.add("leaf", leaf(base, yaw, p, length * (0.8 + rand() * 0.4) * (1 + s.spread * 0.15), width * (0.85 + rand() * 0.3), s.droop, s.curl), tint);
  }
}
