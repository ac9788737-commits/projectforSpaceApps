import { useFrame } from "@react-three/fiber";
import { Effect } from "postprocessing";
import { forwardRef, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFarm } from "../farm/store";
import { mulberry32 } from "../lib/noise";
import { softDot } from "../lib/planetTexture";
import { useSceneTokens } from "../lib/tokens";
import { prefersReducedMotion, useExplore } from "../store";

const AREA = 28;
const TOP = 14;

/** Rain streaks (or snow when it is freezing) whose density follows the hourly precipitation. */
function Precipitation() {
  const quality = useExplore((s) => s.quality);
  const count = quality === "high" ? 2400 : 800;
  const lines = useRef<THREE.LineSegments>(null);
  const flakes = useRef<THREE.Points>(null);
  const t = useSceneTokens();
  const { positions, seeds } = useMemo(() => {
    const rand = mulberry32(17);
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) p.set([(rand() - 0.5) * AREA, rand() * TOP, (rand() - 0.5) * AREA], i * 3);
    return { positions: p, seeds: Float32Array.from({ length: count }, () => rand()) };
  }, [count]);
  const rainGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    return g;
  }, [count]);
  const snowGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  useFrame((_, delta) => {
    const env = useFarm.getState().env;
    const rate = env ? Math.min(1, env.precip_mm / 8) : 0;
    const snow = !!env && env.temp_c < 0.5;
    const visible = Math.floor(count * rate);
    const wind = env ? Math.min(env.wind_ms, 25) * 0.06 : 0;
    const dt = prefersReducedMotion() ? 0 : Math.min(delta, 0.05);
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      positions[o + 1] -= dt * (snow ? 1.2 + seeds[i] : 14 + seeds[i] * 6);
      positions[o] += dt * wind * (snow ? 4 : 8);
      if (positions[o + 1] < 0) {
        positions[o + 1] += TOP;
        positions[o] = (seeds[(i * 7) % count] - 0.5) * AREA;
      }
      if (positions[o] > AREA / 2) positions[o] -= AREA;
    }
    if (lines.current) {
      lines.current.visible = !snow && visible > 0;
      const arr = rainGeo.getAttribute("position").array as Float32Array;
      for (let i = 0; i < count; i++) {
        const o = i * 3;
        const on = i < visible ? 1 : 0;
        arr.set([positions[o], positions[o + 1] * on - (1 - on) * 99, positions[o + 2], positions[o] - wind * 0.4, (positions[o + 1] + 0.45) * on - (1 - on) * 99, positions[o + 2]], i * 6);
      }
      rainGeo.getAttribute("position").needsUpdate = true;
    }
    if (flakes.current) {
      flakes.current.visible = snow && visible > 0;
      snowGeo.setDrawRange(0, visible);
      snowGeo.getAttribute("position").needsUpdate = true;
    }
  });
  return (
    <>
      <lineSegments ref={lines} geometry={rainGeo} raycast={() => null} frustumCulled={false}>
        <lineBasicMaterial color={t["--scene-glass"].color} transparent opacity={0.45} depthWrite={false} />
      </lineSegments>
      <points ref={flakes} geometry={snowGeo} raycast={() => null} frustumCulled={false}>
        <pointsMaterial map={softDot()} size={0.09} color={t["--scene-glass"].color} transparent opacity={0.9} depthWrite={false} />
      </points>
    </>
  );
}

/** Hailstones that fall and bounce, plus leaves knocked off by hail or strong wind. */
function HailAndLeaves() {
  const count = 260;
  const hail = useRef<THREE.InstancedMesh>(null);
  const leaves = useRef<THREE.InstancedMesh>(null);
  const t = useSceneTokens();
  const state = useMemo(() => {
    const rand = mulberry32(5);
    return Array.from({ length: count }, () => ({ p: new THREE.Vector3((rand() - 0.5) * 16, rand() * TOP, (rand() - 0.5) * 16), v: 0, spin: rand() * 6 }));
  }, []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  useFrame(({ clock }, delta) => {
    const env = useFarm.getState().env;
    const h = env?.hail ?? 0;
    const blowing = env ? Math.max(0, Math.min(1, (env.wind_ms - 9) / 12)) : 0;
    const dt = prefersReducedMotion() ? 0 : Math.min(delta, 0.05);
    const nHail = Math.floor(count * Math.min(1, h * 1.5));
    const nLeaves = Math.floor(80 * Math.max(Math.min(1, h * 2), blowing));
    state.forEach((s, i) => {
      if (i < nHail) {
        s.v -= 25 * dt;
        s.p.y += s.v * dt;
        if (s.p.y < 0.05) {
          s.p.y = 0.05;
          s.v = Math.abs(s.v) * 0.35 > 0.6 ? Math.abs(s.v) * 0.35 : 0; // bounce, then settle and respawn
          if (s.v === 0) s.p.set(s.p.x, TOP * (0.6 + 0.4 * Math.random()), s.p.z);
        }
      }
      m.compose(s.p, q, new THREE.Vector3(1, 1, 1).multiplyScalar(i < nHail ? 1 : 0));
      hail.current?.setMatrixAt(i, m);
      if (i < 80) {
        const lx = ((i * 1.7 + clock.elapsedTime * (2 + blowing * 6)) % 18) - 9;
        const ly = 0.3 + ((i * 0.37 + clock.elapsedTime * 0.5) % 2.5);
        q.setFromEuler(new THREE.Euler(clock.elapsedTime * 3 + i, i, clock.elapsedTime * 2));
        m.compose(new THREE.Vector3(lx, ly, ((i * 2.3) % 10) - 5), q, new THREE.Vector3(1, 1, 1).multiplyScalar(i < nLeaves ? 1 : 0));
        leaves.current?.setMatrixAt(i, m);
        q.identity();
      }
    });
    if (hail.current) hail.current.instanceMatrix.needsUpdate = true;
    if (leaves.current) leaves.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={hail} args={[undefined, undefined, count]} raycast={() => null} frustumCulled={false}>
        <icosahedronGeometry args={[0.035, 0]} />
        <meshStandardMaterial color={t["--scene-glass"].color} roughness={0.2} />
      </instancedMesh>
      <instancedMesh ref={leaves} args={[undefined, undefined, 80]} raycast={() => null} frustumCulled={false}>
        <planeGeometry args={[0.06, 0.04]} />
        <meshStandardMaterial color={t["--leaf"].color} side={THREE.DoubleSide} />
      </instancedMesh>
    </>
  );
}

/** Puddles between the beds after heavy rain or a flood. */
function Puddles() {
  const group = useRef<THREE.Group>(null);
  const wet = useRef(0);
  const t = useSceneTokens();
  const spots = useMemo(() => {
    const rand = mulberry32(9);
    return Array.from({ length: 14 }, () => ({ x: (rand() - 0.5) * 12, z: (rand() - 0.5) * 12, r: 0.3 + rand() * 0.7 }));
  }, []);
  useFrame((_, delta) => {
    const env = useFarm.getState().env;
    const target = env ? Math.min(1, env.precip_mm / 6 + (env.flood ? 1 : 0)) : 0;
    wet.current += (target - wet.current) * Math.min(1, delta * (target > wet.current ? 1.5 : 0.08));
    if (group.current) {
      group.current.visible = wet.current > 0.03;
      group.current.scale.setScalar(Math.max(0.01, wet.current));
    }
  });
  return (
    <group ref={group}>
      {spots.map((s, i) => (
        <mesh key={i} position={[s.x, 0.015, s.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <circleGeometry args={[s.r, 24]} />
          <meshStandardMaterial color={t["--scene-glass"].color.clone().multiplyScalar(0.35)} roughness={0.05} metalness={0.4} transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/** Weather layer of the garden (docs/SIMULATOR.md §5, «Визуализация погоды в 3D»). */
export function WeatherLayer({ open }: { open: boolean }) {
  if (!open) return null;
  return (
    <>
      <Precipitation />
      <HailAndLeaves />
      <Puddles />
    </>
  );
}

// ---------- Heat haze: screen-space shimmer near the ground (post-processing) ----------

const hazeFragment = /* glsl */ `
  uniform float strength;
  uniform float time;
  void mainUv(inout vec2 uv) {
    float ground = smoothstep(0.65, 0.0, uv.y);
    uv.x += sin(uv.y * 90.0 + time * 6.0) * 0.0022 * strength * ground;
    uv.y += cos(uv.x * 70.0 + time * 4.0) * 0.0016 * strength * ground;
  }
`;

class HeatHazeEffect extends Effect {
  constructor() {
    super("HeatHaze", hazeFragment, {
      uniforms: new Map<string, THREE.Uniform>([
        ["strength", new THREE.Uniform(0)],
        ["time", new THREE.Uniform(0)],
      ]),
    });
  }
}

export const HeatHaze = forwardRef<HeatHazeEffect>(function HeatHaze(_, ref) {
  const effect = useMemo(() => new HeatHazeEffect(), []);
  useLayoutEffect(() => {
    if (typeof ref === "function") ref(effect);
    else if (ref) ref.current = effect;
  }, [effect, ref]);
  useFrame(({ clock }) => {
    const env = useFarm.getState().env;
    const k = env && !prefersReducedMotion() ? Math.max(0, Math.min(1, (env.temp_c - 30) / 10)) : 0;
    (effect.uniforms.get("strength") as THREE.Uniform).value = k;
    (effect.uniforms.get("time") as THREE.Uniform).value = clock.elapsedTime;
  });
  return <primitive object={effect} dispose={null} />;
});
