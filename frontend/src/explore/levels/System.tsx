import { Line, Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { blackbodyColor } from "@/utils/blackbody";
import { DataRow, ObjectCard, Verdict } from "@/ui/data";
import { kelvinToC } from "@/ui/format";
import { useSystem, type SystemPlanet, type SystemScene } from "../data";
import { Anchor } from "../labels";
import { hashString } from "../lib/noise";
import { FresnelRim, PlanetMaterial, PlanetRings } from "../lib/PlanetBody";
import { softDot } from "../lib/planetTexture";
import { useSceneAlpha, useSceneTokens, VoidBackground } from "../lib/tokens";
import { useExplore } from "../store";
import { useLevelIntro, useTravel } from "../travel";
import { verdictShort, verdictStatus } from "../ui/LevelPanels";

const AU_UNITS_REAL = 40;
const EARTH_RADIUS_AU = 6371 / 149_597_870.7;
const SUN_RADIUS_AU = 695_700 / 149_597_870.7;

export interface SystemLayout {
  starRadius: number;
  orbit: (aAu: number) => number;
  planetRadius: (rEarth: number | null) => number;
}

const MIN_ORBIT_GAP = 1.0;

/** Compressed layout keeps order and relative sizes; the real one is to scale. */
export function systemLayout(scene: Pick<SystemScene, "star" | "planets">, real: boolean): SystemLayout {
  const rsun = scene.star.radius_rsun ?? 1;
  if (real) {
    return {
      starRadius: rsun * SUN_RADIUS_AU * AU_UNITS_REAL,
      orbit: (a) => a * AU_UNITS_REAL,
      planetRadius: (r) => (r ?? 1) * EARTH_RADIUS_AU * AU_UNITS_REAL,
    };
  }
  const starRadius = Math.min(2.5, Math.max(0.5, 0.9 * rsun ** 0.4));
  const base = (a: number) => starRadius + 1.4 + 5 * Math.sqrt(a);
  // Keep a minimum gap between neighbouring orbits (compact M-dwarf systems), preserving order.
  const known = [...new Set(scene.planets.filter((p) => !p.parent_id && p.semi_major_axis_au != null).map((p) => p.semi_major_axis_au!))].sort((x, y) => x - y);
  const radii: number[] = [];
  known.forEach((a, i) => radii.push(i === 0 ? base(a) : Math.max(base(a), radii[i - 1] + MIN_ORBIT_GAP)));
  const orbit = (a: number) => {
    if (known.length === 0) return base(a);
    if (a <= known[0]) return Math.max(starRadius + 0.6, radii[0] - (base(known[0]) - base(a)));
    for (let i = 1; i < known.length; i++) {
      if (a <= known[i]) {
        const t = (a - known[i - 1]) / (known[i] - known[i - 1]);
        return radii[i - 1] + (radii[i] - radii[i - 1]) * t;
      }
    }
    return radii[radii.length - 1] + (base(a) - base(known[known.length - 1]));
  };
  return { starRadius, orbit, planetRadius: (r) => 0.18 + 0.22 * Math.sqrt(r ?? 1) };
}

function displayPeriodS(days: number | null): number {
  return Math.min(90, Math.max(3, 8 * Math.sqrt((days ?? 365) / 365)));
}

const phaseOf = (id: string) => ((hashString(id) % 6283) / 1000) % (Math.PI * 2);

/** Deterministic position of a body at time t (seconds of animation). */
function orbitPosition(planet: SystemPlanet, layout: SystemLayout, real: boolean, t: number, parent: SystemPlanet | undefined, moonIndex: number, out: THREE.Vector3): THREE.Vector3 {
  if (parent) {
    orbitPosition(parent, layout, real, t, undefined, 0, out);
    const orbit = real
      ? ((planet.moon_orbit_km ?? 4e5) / 149_597_870.7) * AU_UNITS_REAL
      : layout.planetRadius(parent.radius_earth) + 0.45 + moonIndex * 0.3;
    const a = phaseOf(planet.id) + (t / (3 + moonIndex * 1.5)) * Math.PI * 2;
    return out.set(out.x + Math.cos(a) * orbit, out.y, out.z + Math.sin(a) * orbit);
  }
  const orbit = layout.orbit(planet.semi_major_axis_au ?? 0);
  const a = phaseOf(planet.id) + (t / displayPeriodS(planet.orbital_period_days)) * Math.PI * 2;
  return out.set(Math.cos(a) * orbit, 0, Math.sin(a) * orbit);
}

// Hover → card stays while the pointer travels from the planet to the card.
let clearTimer: ReturnType<typeof setTimeout> | undefined;
export function holdHighlight(id: string) {
  clearTimeout(clearTimer);
  useExplore.getState().setHighlight(id);
}
export function releaseHighlight(delay = 350) {
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => useExplore.getState().setHighlight(null), delay);
}

function PlanetObjectCard({ planet, onFly }: { planet: SystemPlanet; onFly: () => void }) {
  const src = planet.hypothetical ? "hypothetical" : "real";
  return (
    <div onMouseEnter={() => holdHighlight(planet.id)} onMouseLeave={() => releaseHighlight()}>
      <ObjectCard
        title={planet.name}
        type={planet.parent_id ? "Спутник" : planet.hypothetical ? "Гипотетическая планета" : planet.kind === "solar_system" ? "Планета" : "Экзопланета"}
        source={src}
        onFly={onFly}
        verdict={<Verdict status={verdictStatus(planet)}>{verdictShort(planet)}</Verdict>}
      >
        <DataRow label="Температура" value={kelvinToC(planet.surface_temp_k)} unit="°C" digits={0} />
        <DataRow label="Гравитация" value={planet.gravity_g} unit="g" digits={2} />
        <DataRow label="Радиус" value={planet.radius_earth} unit="R⊕" digits={2} />
        <DataRow label="Освещённость" value={planet.insolation_earth} unit="× Земля" digits={2} />
      </ObjectCard>
    </div>
  );
}

function OrbitingPlanet({
  planet,
  parent,
  moonIndex,
  layout,
  real,
  onFly,
}: {
  planet: SystemPlanet;
  parent: SystemPlanet | undefined;
  moonIndex: number;
  layout: SystemLayout;
  real: boolean;
  onFly: (planet: SystemPlanet, position: THREE.Vector3) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  const highlighted = useExplore((s) => s.highlight === planet.id);
  const tokens = useSceneTokens();
  const alpha = useSceneAlpha();
  const [near, setNear] = useState(false);
  const size = layout.planetRadius(planet.radius_earth);
  const orbit = layout.orbit(planet.semi_major_axis_au ?? 0);
  const points = useMemo(
    () =>
      Array.from({ length: 161 }, (_, i) => {
        const a = (i / 160) * Math.PI * 2;
        return [Math.cos(a) * orbit, 0, Math.sin(a) * orbit] as [number, number, number];
      }),
    [orbit],
  );
  const rimColor = useMemo(() => new THREE.Color(planet.palette[2] ?? planet.palette[0]).lerp(new THREE.Color(1, 1, 1), 0.35), [planet.palette]);

  useFrame(({ clock, camera }) => {
    if (!group.current) return;
    orbitPosition(planet, layout, real, clock.elapsedTime, parent, moonIndex, group.current.position);
    if (body.current) body.current.rotation.y += 0.003;
    // Labels appear as the camera approaches (§6.2).
    const isNear = camera.position.distanceTo(group.current.position) < Math.max(size, 0.2) * 55;
    if (isNear !== near) setNear(isNear);
  });

  const fly = () => onFly(planet, group.current!.position.clone());
  const orbitColor = highlighted ? tokens["--accent"] : tokens["--border-subtle"];
  return (
    <>
      {!parent && (
        <Line points={points} color={orbitColor.color} transparent opacity={alpha(highlighted ? 0.9 : 0.3)} lineWidth={1} />
      )}
      <group ref={group} name={planet.id}>
        <mesh
          ref={body}
          onClick={(e) => {
            e.stopPropagation();
            fly();
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            holdHighlight(planet.id);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            releaseHighlight();
            document.body.style.cursor = "";
          }}
        >
          <sphereGeometry args={[size, 48, 32]} />
          <PlanetMaterial id={planet.id} palette={planet.palette} surfaceType={planet.surface_type} size={128} />
        </mesh>
        {!real && <FresnelRim radius={size} color={rimColor} strength={0.55} />}
        {planet.id === "saturn" && <PlanetRings inner={size * 1.25} outer={size * 2.25} tint={planet.palette[2] ?? planet.palette[0]} />}
        {/* Invisible, larger hit target so small bodies stay clickable (≥ 40 px feel). */}
        <mesh
          visible={false}
          onClick={(e) => {
            e.stopPropagation();
            fly();
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            holdHighlight(planet.id);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            releaseHighlight();
            document.body.style.cursor = "";
          }}
        >
          <sphereGeometry args={[Math.max(size * 1.8, real ? 0.4 : 0.35), 12, 8]} />
        </mesh>
        {real && (
          <sprite scale={0.03} raycast={() => null}>
            <spriteMaterial map={softDot()} color={tokens["--accent"].color} sizeAttenuation={false} transparent opacity={0.8} depthWrite={false} />
          </sprite>
        )}
        {highlighted ? (
          <Anchor position={[size * 0.7, size * 0.7, 0]} center={false} z={25} autoFlip>
            <PlanetObjectCard planet={planet} onFly={fly} />
          </Anchor>
        ) : (
          (near || real) && (
            <Anchor position={[0, size + 0.22, 0]}>
              <span className="pointer-events-none whitespace-nowrap font-head text-[12px] uppercase tracking-[0.12em] text-fg [text-shadow:0_1px_3px_var(--bg-void)]">
                {planet.name}
              </span>
            </Anchor>
          )
        )}
      </group>
    </>
  );
}

const hzVertex = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const hzFragment = /* glsl */ `
  uniform vec3 uColor; uniform float uInner; uniform float uOuter; uniform float uOpacity;
  varying vec2 vPos;
  void main() {
    float t = (length(vPos) - uInner) / (uOuter - uInner);
    float a = smoothstep(0.0, 0.3, t) * (1.0 - smoothstep(0.7, 1.0, t));
    gl_FragColor = vec4(uColor, a * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Habitable zone: --habitable at ~10 % opacity with soft edges (§6.2). */
function HabitableZone({ inner, outer }: { inner: number; outer: number }) {
  const tokens = useSceneTokens();
  const alpha = useSceneAlpha();
  const pad = (outer - inner) * 0.15;
  const uniforms = useMemo(
    () => ({
      uColor: { value: tokens["--habitable"].color.clone() },
      uInner: { value: inner - pad },
      uOuter: { value: outer + pad },
      uOpacity: { value: alpha(0.11) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tokens, inner, outer, pad, alpha(1)],
  );
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <ringGeometry args={[inner - pad, outer + pad, 160, 1]} />
      <shaderMaterial vertexShader={hzVertex} fragmentShader={hzFragment} uniforms={uniforms} transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

export function SystemLevel({ galaxyId, starId }: { galaxyId: string; starId: string }) {
  const scene = useSystem(starId);
  const real = useExplore((s) => s.realScale);
  const quality = useExplore((s) => s.quality);
  const travel = useTravel();
  const data = scene.data;
  const layout = useMemo(() => (data ? systemLayout(data, real) : null), [data, real]);
  const far = layout && data ? layout.orbit(Math.max(...data.planets.map((p) => p.semi_major_axis_au ?? 0), 0.05)) : 10;

  useLevelIntro(
    layout ? { from: [0, 2, 3], to: [0, far * 0.62, far * 1.3], target: [0, 0, 0], minDistance: 0.05, maxDistance: far * 6 } : null,
    [starId, !!layout, real],
  );

  if (!data || !layout) return <VoidBackground />;
  const starColor = blackbodyColor(data.star.teff_k);
  const hz = data.habitable_zone_au;

  return (
    <>
      <VoidBackground />
      <Stars radius={300} depth={60} count={quality === "high" ? 2500 : 900} factor={2.5} saturation={0} fade speed={0} />
      <ambientLight intensity={0.06} />
      <pointLight color={starColor} intensity={3.2} decay={0} />
      <mesh raycast={() => null}>
        <sphereGeometry args={[layout.starRadius, 48, 32]} />
        <meshBasicMaterial color={starColor.clone().multiplyScalar(1.6)} toneMapped={false} />
      </mesh>
      <sprite scale={layout.starRadius * 5} raycast={() => null}>
        <spriteMaterial map={softDot()} color={starColor} transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      {hz && <HabitableZone inner={layout.orbit(hz[0])} outer={layout.orbit(hz[1])} />}
      {data.planets
        .filter((p) => p.semi_major_axis_au != null)
        .map((p) => {
          const parent = data.planets.find((x) => x.id === p.parent_id);
          const siblings = data.planets.filter((x) => p.parent_id && x.parent_id === p.parent_id);
          return (
            <OrbitingPlanet
              key={p.id}
              planet={p}
              parent={parent}
              moonIndex={Math.max(0, siblings.indexOf(p))}
              layout={layout}
              real={real}
              onFly={(planet, position) =>
                travel({ level: "planet", galaxyId, starId, planetId: planet.id }, [position.x, position.y, position.z], "var(--bg-void)", 0.15)
              }
            />
          );
        })}
    </>
  );
}
