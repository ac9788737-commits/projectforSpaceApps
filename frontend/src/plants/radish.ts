import * as THREE from "three";
import { earlyStage, GOLDEN, rng } from "./common";
import { ellipsoid, leaf, PlantBuilder, stem, type PlantGeometry } from "./geom";
import type { PlantShape } from "./types";

/** Radish: a small rosette; the storage root swells just below the surface. */
export function radish(s: PlantShape): PlantGeometry {
  const early = earlyStage(s);
  if (early) return early;
  const rand = rng(s);
  const b = new PlantBuilder();
  const h = Math.max(0.03, s.heightM);
  const n = Math.max(3, s.leafCount);
  for (let i = 0; i < n; i++) {
    const yaw = i * GOLDEN;
    const petiole = new THREE.Vector3(Math.cos(yaw) * h * 0.25, h * 0.35, Math.sin(yaw) * h * 0.25);
    b.add("stem", stem(new THREE.Vector3(0, 0, 0), petiole, 0.0025, 0.0018, 3));
    const tint: [number, number, number] = rand() < s.spots ? [0.55, 0.38, 0.22] : [1, 1, 1];
    b.add("leaf", leaf(petiole, yaw, 0.55 - s.spread * 0.2, h * 0.7, h * 0.32, s.droop, s.curl, 5, 0.6), tint);
  }
  for (let i = 0; i < 5; i++) {
    const yaw = (i / 5) * Math.PI * 2 + rand() * 0.5;
    const top = new THREE.Vector3(0, -Math.max(0.01, s.organSizeM * 1.4), 0);
    b.add("under", stem(top, top.clone().add(new THREE.Vector3(Math.cos(yaw) * 0.05, -0.08 - rand() * 0.05, Math.sin(yaw) * 0.05)), 0.0012, 0.0005, 3), [1.2, 1.15, 1.1]);
  }
  if (s.organSizeM > 0) {
    const r = s.organSizeM;
    b.add("under", ellipsoid(new THREE.Vector3(0, -r * 0.55, 0), r, r * 1.15, r, 12));
    b.add("under", stem(new THREE.Vector3(0, -r * 1.6, 0), new THREE.Vector3(0, -r * 1.6 - 0.06, 0), 0.002, 0.0005, 3), [0.95, 0.9, 0.85]);
  }
  return b.build();
}
