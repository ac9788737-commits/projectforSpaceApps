import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type Part = "stem" | "leaf" | "organ" | "flower" | "under";
export const PARTS: Part[] = ["stem", "leaf", "organ", "flower", "under"];
export type PlantGeometry = Record<Part, THREE.BufferGeometry | null>;

const UP = new THREE.Vector3(0, 1, 0);
const WHITE: [number, number, number] = [1, 1, 1];

/** Collects primitive pieces per material slot and merges them into one geometry each. */
export class PlantBuilder {
  private parts: Record<Part, THREE.BufferGeometry[]> = { stem: [], leaf: [], organ: [], flower: [], under: [] };

  add(part: Part, geometry: THREE.BufferGeometry, tint: [number, number, number] = WHITE): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    }
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const count = g.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set(tint, i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.parts[part].push(g);
  }

  build(): PlantGeometry {
    const out = {} as PlantGeometry;
    for (const part of PARTS) {
      const list = this.parts[part];
      out[part] = list.length ? mergeGeometries(list, false) : null;
      list.forEach((g) => g.dispose());
    }
    return out;
  }
}

/** Tapered cylinder from a to b. */
export function stem(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, radial = 5): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = Math.max(dir.length(), 1e-4);
  const g = new THREE.CylinderGeometry(r1, r0, length, radial, 1, true);
  g.translate(0, length / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

/**
 * A single leaf blade starting at `base`, heading toward azimuth `yaw` at elevation `pitch`.
 * `droop` bends it down along its length, `curl` lifts the edges into a cup.
 */
export function leaf(
  base: THREE.Vector3,
  yaw: number,
  pitch: number,
  length: number,
  width: number,
  droop: number,
  curl: number,
  segments = 6,
  tipShape = 0.7,
): THREE.BufferGeometry {
  const forward = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const side = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  const positions: number[] = [];
  const rows: THREE.Vector3[][] = [];
  const p = base.clone();
  for (let j = 0; j <= segments; j++) {
    const t = j / segments;
    if (j > 0) {
      const angle = pitch - droop * t * 1.5;
      p.addScaledVector(forward, Math.cos(angle) * (length / segments));
      p.y += Math.sin(angle) * (length / segments);
    }
    const w = (width / 2) * Math.max(0.12, Math.sin(Math.PI * Math.min(t * 1.08, 1)) ** tipShape);
    const lift = curl * w * 0.9;
    rows.push([
      p.clone().addScaledVector(side, -w * (1 - curl * 0.35)).add(new THREE.Vector3(0, lift, 0)),
      p.clone().add(new THREE.Vector3(0, -w * 0.08, 0)),
      p.clone().addScaledVector(side, w * (1 - curl * 0.35)).add(new THREE.Vector3(0, lift, 0)),
    ]);
  }
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let j = 0; j < segments; j++) {
    const [l0, m0, r0] = rows[j];
    const [l1, m1, r1] = rows[j + 1];
    tri(l0, m0, l1);
    tri(m0, m1, l1);
    tri(m0, r0, m1);
    tri(r0, r1, m1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

export function ellipsoid(center: THREE.Vector3, rx: number, ry: number, rz: number, segments = 8, rotY = 0): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, segments, Math.max(4, Math.round(segments * 0.75)));
  g.scale(rx, ry, rz);
  g.rotateY(rotY);
  g.translate(center.x, center.y, center.z);
  return g;
}

export function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Leaf tint: most leaves white (material colour shows), a share gets necrotic spots. */
export function leafTint(rand: () => number, spots: number): [number, number, number] {
  return rand() < spots ? [0.55, 0.38, 0.22] : [1, 1, 1];
}
