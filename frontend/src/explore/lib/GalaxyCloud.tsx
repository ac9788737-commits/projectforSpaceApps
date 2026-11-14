import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { blackbodyColor } from "@/utils/blackbody";
import { hashString, mulberry32 } from "./noise";
import { softDot } from "./planetTexture";

export type GalaxyShape = "spiral" | "irregular" | "elliptical" | "dwarf" | "starburst";

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Procedural star particles of a galaxy in units of `radius` (visual model, not a catalogue). */
export function galaxyParticles(id: string, shape: GalaxyShape, arms: number, radius: number, count: number) {
  const rand = mulberry32(hashString(id));
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  // Star colours from black-body temperatures: old warm bulge, young blue-white arms.
  const core = blackbodyColor(4600);
  const disk = blackbodyColor(11000);
  const old = blackbodyColor(3800);
  // H II regions glow in hydrogen lines (red + blue): a pink mix, not a black body.
  const pink = blackbodyColor(1900).lerp(blackbodyColor(20000), 0.35);
  const c = new THREE.Color();
  const pitch = (12 * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    let x = 0, y = 0, z = 0;
    const roll = rand();
    if ((shape === "spiral" || shape === "starburst") && arms > 0) {
      if (roll < 0.22) {
        x = gaussian(rand) * radius * 0.12;
        z = gaussian(rand) * radius * 0.12;
        y = gaussian(rand) * radius * 0.06;
        c.copy(core);
      } else {
        const r = radius * (0.12 + 0.88 * Math.sqrt(rand()));
        const arm = Math.floor(rand() * arms);
        const theta = (2 * Math.PI * arm) / arms + Math.log(r / (0.12 * radius)) / Math.tan(pitch) + gaussian(rand) * 0.28;
        x = r * Math.cos(theta) + gaussian(rand) * radius * 0.02;
        z = r * Math.sin(theta) + gaussian(rand) * radius * 0.02;
        y = gaussian(rand) * radius * 0.012;
        c.copy(core).lerp(disk, Math.min(1, r / radius + 0.2));
        if (shape === "starburst" && rand() < 0.15) c.copy(pink);
      }
    } else if (shape === "elliptical") {
      x = gaussian(rand) * radius * 0.35;
      y = gaussian(rand) * radius * 0.25;
      z = gaussian(rand) * radius * 0.3;
      c.copy(old).lerp(core, rand() * 0.5);
    } else {
      // irregular / dwarf: a few clumps
      const clump = Math.floor(rand() * 4);
      const cx = Math.cos(clump * 1.9) * radius * 0.35, cz = Math.sin(clump * 2.7) * radius * 0.25;
      x = cx + gaussian(rand) * radius * 0.3;
      z = cz + gaussian(rand) * radius * 0.22;
      y = gaussian(rand) * radius * 0.08;
      c.copy(disk).lerp(core, rand() * 0.6);
    }
    positions.set([x, y, z], i * 3);
    const brightness = 0.6 + rand() * 0.6;
    colors.set([c.r * brightness, c.g * brightness, c.b * brightness], i * 3);
  }
  return { positions, colors };
}

export function GalaxyCloud({
  id,
  shape,
  arms,
  radius,
  count,
  size,
  spin = 0.01,
  opacity = 0.9,
}: {
  id: string;
  shape: GalaxyShape;
  arms: number;
  radius: number;
  count: number;
  size: number;
  spin?: number;
  opacity?: number;
}) {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const { positions, colors } = galaxyParticles(id, shape, arms, radius, count);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [id, shape, arms, radius, count]);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * spin;
  });
  return (
    <points ref={ref} geometry={geometry} raycast={() => null}>
      <pointsMaterial
        size={size}
        map={softDot()}
        vertexColors
        transparent
        opacity={opacity}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  );
}

/** Dark dust lanes along the inner edge of spiral arms (normal blending darkens the glow). */
export function DustLanes({ id, arms, radius, count, color }: { id: string; arms: number; radius: number; count: number; color: THREE.Color }) {
  const geometry = useMemo(() => {
    const rand = mulberry32(hashString(id) + 99);
    const positions = new Float32Array(count * 3);
    const pitch = (12 * Math.PI) / 180;
    for (let i = 0; i < count; i++) {
      const r = radius * (0.18 + 0.75 * Math.sqrt(rand()));
      const arm = Math.floor(rand() * Math.max(arms, 1));
      const theta = (2 * Math.PI * arm) / Math.max(arms, 1) + Math.log(r / (0.12 * radius)) / Math.tan(pitch) - 0.22 + gaussian(rand) * 0.08;
      positions.set([r * Math.cos(theta), gaussian(rand) * radius * 0.006, r * Math.sin(theta)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [id, arms, radius, count]);
  return (
    <points geometry={geometry} raycast={() => null} renderOrder={1}>
      <pointsMaterial size={radius * 0.03} map={softDot()} color={color} transparent opacity={0.5} depthWrite={false} sizeAttenuation />
    </points>
  );
}
