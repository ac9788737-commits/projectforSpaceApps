import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { buildPlant, PARTS, type PlantGeometry } from "@/plants";
import { interpolateState, plantLook, type CropTraits } from "@/plants/appearance";
import type { Part } from "@/plants/geom";
import type { PlantState } from "@/plants/types";
import type { PlantStateOut } from "../data";
import { mulberry32 } from "../lib/noise";
import { useSceneTokens } from "../lib/tokens";
import { useFarm } from "../farm/store";
import { prefersReducedMotion, useExplore } from "../store";
import { makeToon, setRim } from "./toon";

type Vec3 = [number, number, number];

/** Plant state at a fractional day, holding the last state after the timeline ends. */
export function sampleDays(days: PlantStateOut[], day: number): PlantStateOut & PlantState {
  const last = days.length - 1;
  const i = Math.max(0, Math.min(Math.floor(day), last));
  const j = Math.min(i + 1, last);
  const t = Math.min(1, Math.max(0, day - i));
  const base = days[t < 0.5 ? i : j];
  return { ...base, ...interpolateState(days[i], days[j], t) };
}

const q10 = (v: number) => Math.round(v * 10);

export function PlantInstances({
  cropId,
  traits,
  days,
  gravityG,
  wind,
  warm,
  positions,
  rimColor,
}: {
  cropId: string;
  traits: CropTraits;
  days: PlantStateOut[];
  gravityG: number;
  wind: number;
  warm: boolean;
  positions: Vec3[];
  rimColor: string;
}) {
  const tokens = useSceneTokens();
  const frostTint = useMemo(() => tokens["--scene-glass"].color.clone(), [tokens]);
  const time = useMemo(() => ({ value: 0 }), []);
  const windU = useMemo(() => ({ value: wind }), [wind]);
  const materials = useMemo(() => {
    const wind = { time, strength: windU };
    const m = {
      stem: makeToon({ vertexColors: true, wind }),
      leaf: makeToon({ vertexColors: true, wind, side: THREE.DoubleSide }),
      organ: makeToon({ vertexColors: true, wind }),
      flower: makeToon({ vertexColors: true, wind }),
      under: makeToon({ vertexColors: true }),
    } satisfies Record<Part, THREE.MeshToonMaterial>;
    Object.values(m).forEach((mat) => setRim(mat, rimColor, 0.28));
    return m;
  }, [time, windU, rimColor]);
  // Healthy leaves use --leaf, slightly deepened so the cel-shaded lit side keeps colour (§6.5).
  const healthyLeaf = useMemo<[number, number, number]>(() => {
    const c = tokens["--leaf"].color.clone().multiplyScalar(0.62);
    return [c.r, c.g, c.b];
  }, [tokens]);
  // Inside a dome the light is a little warmer and greener (§6.4).
  const domeTint = useMemo(() => tokens["--accent"].color.clone().lerp(tokens["--leaf"].color, 0.4), [tokens]);
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);

  const jitter = useMemo(() => {
    const rand = mulberry32(cropId.length * 977 + positions.length);
    return positions.map(() => ({ yaw: rand() * Math.PI * 2, scale: 0.88 + rand() * 0.24 }));
  }, [cropId, positions]);

  const [built, setBuilt] = useState<{ geo: PlantGeometry; h: number; key: string } | null>(null);
  const keyRef = useRef("");
  const lastYield = useRef(0);
  const lastLeaves = useRef(0);
  const springAt = useRef(-10);
  const meshes = useRef<Partial<Record<Part, THREE.InstancedMesh | null>>>({});
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const s = useMemo(() => new THREE.Vector3(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const axis = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useEffect(
    () => () => {
      if (built) PARTS.forEach((part) => built.geo[part]?.dispose());
    },
    [built],
  );

  useFrame(({ clock }) => {
    time.value = clock.elapsedTime;
    if (days.length === 0) return;
    const state = sampleDays(days, useExplore.getState().day);
    const look = plantLook(state, state.t_mean_c, gravityG, traits, 1, healthyLeaf);
    materials.leaf.color.setRGB(...look.leaf);
    // Rime on the leaves when it freezes (§5); wind from the weather of this hour.
    const env = useFarm.getState().env;
    if (env && env.temp_c < 1) materials.leaf.color.lerp(frostTint, Math.min(0.65, (1 - env.temp_c) / 6));
    windU.value = wind > 0 && env ? wind + Math.min(0.12, env.wind_ms * 0.005) : wind;
    // Light passing through the blade keeps the undersides soft; domes add a warm green cast.
    materials.leaf.emissive.setRGB(look.leaf[0] * 0.3, look.leaf[1] * 0.3, look.leaf[2] * 0.3);
    if (warm) materials.leaf.emissive.lerp(domeTint, 0.25);
    // Tubers glow softly while they are growing.
    const growing = state.yieldG > lastYield.current + 1e-6 && useExplore.getState().playing;
    lastYield.current = state.yieldG;
    const glow = growing ? 0.22 : 0;
    materials.under.emissive.setRGB(look.under[0] * glow, look.under[1] * glow, look.under[2] * glow);
    materials.stem.color.setRGB(...look.stem);
    materials.organ.color.setRGB(...look.organ);
    materials.flower.color.setRGB(...look.flower);
    materials.under.color.setRGB(...look.under);

    const sh = look.shape;
    const hq = Math.max(0.01, Math.round(sh.heightM * 40) / 40);
    const key = [sh.stage, sh.leafCount, sh.organCount, hq, q10(sh.droop), q10(sh.curl), q10(sh.spread), q10(sh.spots), q10(sh.ripeness), Math.round(sh.organSizeM * 400)].join("|");
    if (key !== keyRef.current) {
      if (sh.leafCount > lastLeaves.current && !prefersReducedMotion()) springAt.current = clock.elapsedTime;
      lastLeaves.current = sh.leafCount;
      keyRef.current = key;
      const geo = buildPlant(cropId, { ...sh, heightM: hq, seed: 7 });
      if (geo) setBuilt({ geo, h: hq, key });
    }
    if (!built) return;
    // Gentle spring when a new leaf appears (§6.5).
    const ts = clock.elapsedTime - springAt.current;
    const spring = ts < 0.8 ? 1 + 0.06 * Math.exp(-6 * ts) * Math.sin(16 * ts) : 1;
    const sy = THREE.MathUtils.clamp(sh.heightM / built.h, 0.6, 1.6) * spring;
    for (const part of PARTS) {
      const mesh = meshes.current[part];
      if (!mesh) continue;
      positions.forEach((pos, i) => {
        const j = jitter[i];
        q.setFromAxisAngle(axis, j.yaw);
        s.set(j.scale * spring, part === "under" ? j.scale : j.scale * sy, j.scale * spring);
        m.compose(p.set(...pos), q, s);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  if (!built) return null;
  return (
    <>
      {PARTS.map((part) =>
        built.geo[part] ? (
          <instancedMesh
            key={`${part}-${built.key}`}
            ref={(mesh) => {
              meshes.current[part] = mesh;
            }}
            args={[built.geo[part]!, materials[part], positions.length]}
            frustumCulled={false}
            castShadow={part !== "under"}
            raycast={() => null}
          />
        ) : null,
      )}
    </>
  );
}

/** Spirulina is grown in a culture tank: the water turns greener as biomass builds up. */
export function SpirulinaTank({ days, maxBiomassG, open }: { days: PlantStateOut[]; maxBiomassG: number; open: boolean }) {
  const water = useRef<THREE.MeshStandardMaterial>(null);
  const tokens = useSceneTokens();
  const clear = useMemo(() => tokens["--scene-glass"].color.clone(), [tokens]);
  const dense = useMemo(() => tokens["--leaf"].color.clone().multiplyScalar(0.35), [tokens]);
  const dead = useMemo(() => tokens["--soil"].color.clone(), [tokens]);
  useFrame(() => {
    if (!water.current || days.length === 0) return;
    const state = sampleDays(days, useExplore.getState().day);
    const k = Math.min(1, state.biomassG / maxBiomassG);
    water.current.color.copy(clear).lerp(dense, k);
    if (state.stage === "dead") water.current.color.lerp(dead, 0.7);
  });
  return (
    <group position={[0, 0.12, 0]}>
      <mesh position={[0, open ? 0.04 : 0.18, 0]} raycast={() => null}>
        <boxGeometry args={[2, open ? 0.08 : 0.36, 2]} />
        <meshStandardMaterial ref={water} transparent opacity={0.85} roughness={0.1} />
      </mesh>
      {!open && (
        <mesh position={[0, 0.2, 0]} raycast={() => null}>
          <boxGeometry args={[2.06, 0.4, 2.06]} />
          <meshStandardMaterial color={tokens["--scene-glass"].color} transparent opacity={0.15} roughness={0.05} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
