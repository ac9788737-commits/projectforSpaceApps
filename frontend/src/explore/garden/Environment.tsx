import { Stars, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { PlanetScene } from "../data";
import { fbm, mulberry32 } from "../lib/noise";
import { softDot } from "../lib/planetTexture";
import { useSceneTokens } from "../lib/tokens";
import { useFarm } from "../farm/store";
import { prefersReducedMotion, useExplore } from "../store";
import { makeToon } from "./toon";

const SKY_RADIUS = 400;
const _sun = new THREE.Vector3();

export type EnvPreset = "earth" | "mars" | "moon" | "titan" | "reddwarf" | "icy" | "airless" | "rocky" | "gas";

/** Which §6.4 environment preset a world gets. */
export function envPreset(scene: PlanetScene): EnvPreset {
  if (!scene.has_solid_surface) return "gas";
  if (scene.id === "earth") return "earth";
  if (scene.id === "moon") return "moon";
  if (scene.star_teff_k < 3900 && scene.pressure_pa >= 100) return "reddwarf";
  if (scene.weather === "dust") return "mars";
  if (scene.weather === "haze") return "titan";
  if (scene.pressure_pa < 100) return "airless";
  if (scene.surface_type === "icy" || scene.weather === "snow") return "icy";
  return "rocky";
}

/**
 * Direction to the star for a moment of the simulated time. Tidally locked worlds keep the
 * star still; at fast playback the light is held at mid-morning to avoid strobing.
 */
export function sunDirection(scene: PlanetScene, stepHours: number, day: number, fast: boolean, out = _sun): THREE.Vector3 {
  let fraction: number;
  if (scene.tidally_locked || !scene.day_hours) fraction = 0.4;
  else if (fast && scene.day_hours <= 48) fraction = 0.4;
  else fraction = ((day * stepHours) / scene.day_hours) % 1; // day boundaries at midnight, as in the simulator
  const a = fraction * Math.PI * 2;
  return out.set(Math.sin(a) * 0.85, -Math.cos(a) * 0.85, 0.35).normalize();
}

/** Real light spans orders of magnitude; the picture uses a pleasant range, the panel shows the number (§6.4). */
export function stylisedSunIntensity(relative: number): number {
  return THREE.MathUtils.clamp(1.6 + 0.55 * Math.log10(Math.max(relative, 1e-4)), 0.7, 2.3);
}

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyFragment = /* glsl */ `
  uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunset; uniform vec3 uSunDir; uniform float uAir; uniform float uFlash; uniform float uDim; uniform float uWash;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float h = max(dir.y, 0.0);
    float day = smoothstep(-0.18, 0.12, uSunDir.y);
    vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, h));
    float low = (1.0 - smoothstep(0.0, 0.35, uSunDir.y)) * smoothstep(-0.25, 0.05, uSunDir.y);
    float toward = pow(max(dot(dir, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0);
    col = mix(col, uSunset, low * toward * (1.0 - smoothstep(0.0, 0.45, h)) * uAir);
    col *= mix(0.04, 1.0, day) * uDim;
    col = mix(col, vec3(0.92), uWash * day);
    if (dir.y < 0.0) col = mix(col, uHorizon * mix(0.04, 1.0, day) * uDim, 0.6);
    col += uFlash * vec3(0.5, 0.25, 0.2);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function Sky({ scene, stepHours }: { scene: PlanetScene; stepHours: number }) {
  const sunMesh = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const flash = useRef({ until: 0, lastUv: 0, maxPpfd: 1 });
  const quality = useExplore((s) => s.quality);
  const airless = scene.pressure_pa < 100;
  const preset = envPreset(scene);
  const uniforms = useMemo(
    () => ({
      uZenith: { value: new THREE.Color(scene.sky_day) },
      uHorizon: { value: new THREE.Color(scene.sky_horizon) },
      uSunset: { value: new THREE.Color(scene.sky_sunset) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uAir: { value: airless ? 0 : 1 },
      uFlash: { value: 0 },
      uDim: { value: 1 },
      uWash: { value: 0 },
    }),
    [scene, airless],
  );
  // Real angular size of the star; at least 0.25° so it stays visible.
  const angular = Math.max(0.25, scene.star_angular_diameter_deg ?? 0.5);
  const sunRadius = SKY_RADIUS * 0.95 * Math.tan(((angular / 2) * Math.PI) / 180);
  const brightness = stylisedSunIntensity(scene.sun_intensity_rel);
  const starColor = useMemo(() => new THREE.Color(scene.star_color), [scene.star_color]);
  // Without air the sky is black, so the fill light is a neutral earthshine/starlight tone.
  const tokens = useSceneTokens();
  const fillSky = airless ? tokens["--text-secondary"].css : scene.sky_day;

  useFrame(({ clock }) => {
    const { day, speed, playing } = useExplore.getState();
    const dir = sunDirection(scene, stepHours, day, playing && speed > 1);
    uniforms.uSunDir.value.copy(dir);
    // Weather of this hour: clouds, dust and eclipses dim the light; stellar flares flash.
    const env = useFarm.getState().env;
    const fl = flash.current;
    let dim = 1;
    if (env) {
      fl.maxPpfd = Math.max(fl.maxPpfd, env.ppfd);
      const expected = fl.maxPpfd * Math.max(0.15, Math.min(1, dir.y * 1.25));
      dim = dir.y > 0.02 ? THREE.MathUtils.clamp(env.ppfd / expected, 0.12, 1) : 1;
      if (env.uv_rel > 3 * Math.max(0.3, fl.lastUv) && env.uv_rel > 2 && !prefersReducedMotion()) fl.until = clock.elapsedTime + 0.7;
      fl.lastUv = env.uv_rel * 0.05 + fl.lastUv * 0.95;
    }
    const f = Math.max(0, fl.until - clock.elapsedTime) / 0.7;
    uniforms.uFlash.value = f * 0.6;
    uniforms.uDim.value = dim;
    uniforms.uWash.value = env ? THREE.MathUtils.clamp((env.temp_c - 30) / 14, 0, 0.45) : 0;
    const daylight = THREE.MathUtils.smoothstep(dir.y, -0.05, 0.2) * dim;
    if (sunMesh.current) {
      sunMesh.current.position.copy(dir).multiplyScalar(SKY_RADIUS * 0.95);
      sunMesh.current.lookAt(0, 0, 0);
      sunMesh.current.visible = dir.y > -0.05;
    }
    if (light.current) {
      light.current.position.copy(dir).multiplyScalar(30);
      light.current.intensity = brightness * daylight * (1 + f * 1.5);
    }
    // Night is never pitch black in the picture: starlight/earthshine floor (stylised, §6.4).
    if (hemi.current) hemi.current.intensity = (airless ? 0.45 : 0.7) * (0.25 + 0.75 * daylight) + (airless ? 0.55 : 0.22);
  });

  return (
    <>
      <mesh raycast={() => null} renderOrder={-1}>
        <sphereGeometry args={[SKY_RADIUS, 48, 24]} />
        <shaderMaterial vertexShader={skyVertex} fragmentShader={skyFragment} uniforms={uniforms} side={THREE.BackSide} depthWrite={false} fog={false} />
      </mesh>
      {(airless || scene.pressure_pa < 2000) && <Stars radius={SKY_RADIUS * 0.8} depth={20} count={2500} factor={6} saturation={0} fade speed={0} />}
      {preset === "moon" && (
        <Suspense fallback={null}>
          <EarthInSky />
        </Suspense>
      )}
      <mesh ref={sunMesh} raycast={() => null}>
        <circleGeometry args={[sunRadius, 48]} />
        <meshBasicMaterial color={starColor.clone().multiplyScalar(3)} toneMapped={false} fog={false} />
      </mesh>
      <directionalLight
        ref={light}
        color={starColor}
        castShadow={quality === "high"}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-bias={-0.0004}
        shadow-radius={4}
      />
      <hemisphereLight ref={hemi} args={[fillSky, scene.ground, 0.5]} />
    </>
  );
}

/** On the Moon, the Earth hangs in the black sky (§6.4). */
function EarthInSky() {
  const map = useTexture("/textures/2k_earth_daymap.jpg");
  map.colorSpace = THREE.SRGBColorSpace;
  return (
    <mesh position={[-120, 110, -260]} rotation={[0.3, 2.2, 0]} raycast={() => null}>
      <sphereGeometry args={[9, 48, 32]} />
      <meshStandardMaterial map={map} emissive={new THREE.Color(1, 1, 1)} emissiveMap={map} emissiveIntensity={0.25} fog={false} />
    </mesh>
  );
}

export function Fog({ scene }: { scene: PlanetScene }) {
  if (scene.pressure_pa < 100) return null;
  const preset = envPreset(scene);
  const density = preset === "titan" ? 0.035 : preset === "mars" ? 0.009 : preset === "reddwarf" ? 0.008 : 0.004;
  return <fogExp2 attach="fog" args={[scene.sky_horizon, density]} />;
}

/** Procedural ground: flat garden area, rolling relief further away, scattered rocks. */
export function Terrain({ scene, clip }: { scene: PlanetScene; clip: THREE.Plane[] }) {
  const quality = useExplore((s) => s.quality);
  const tokens = useSceneTokens();
  const preset = envPreset(scene);
  const segments = quality === "high" ? 120 : 60;
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(260, 260, segments, segments);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute("position");
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(scene.ground);
    const grass = tokens["--leaf"].color.clone().multiplyScalar(0.55);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const dist = Math.hypot(x, z);
      const ramp = THREE.MathUtils.smoothstep(dist, 11, 45);
      const crater = preset === "moon" || preset === "airless" ? -Math.max(0, 0.6 - fbm(x * 0.06, 7, z * 0.06, 2, 9)) * 3 * ramp : 0;
      const y = (fbm(x * 0.025, 0, z * 0.025, 4, 11) - 0.45) * 14 * ramp + (fbm(x * 0.5, 1, z * 0.5, 2, 5) - 0.5) * 0.12 + crater;
      pos.setY(i, y);
      const n = fbm(x * 0.15, 2, z * 0.15, 3, 3);
      c.copy(base).multiplyScalar(0.85 + n * 0.3);
      if (preset === "earth") c.lerp(grass, THREE.MathUtils.clamp((n - 0.35) * 2.2, 0, 0.85));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [scene.ground, segments, preset, tokens]);
  const material = useMemo(() => {
    const m = makeToon({ vertexColors: true, rimStrength: 0 });
    return m;
  }, []);
  useLayoutEffect(() => {
    material.clippingPlanes = clip;
    material.needsUpdate = true;
  }, [material, clip]);
  return (
    <>
      <mesh geometry={geometry} material={material} receiveShadow raycast={() => null} />
      <Rocks color={scene.ground} count={quality === "high" ? 120 : 45} />
      {preset === "earth" && <GrassTufts count={quality === "high" ? 900 : 300} />}
    </>
  );
}

function Rocks({ color, count }: { color: string; count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(() => makeToon({ color: new THREE.Color(color).multiplyScalar(0.75), rimStrength: 0.1 }), [color]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rand = mulberry32(7);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = 9 + rand() * 40;
      const s = 0.08 + rand() ** 3 * 0.9;
      q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
      m.compose(new THREE.Vector3(Math.cos(a) * r, s * 0.2, Math.sin(a) * r), q, new THREE.Vector3(s, s * 0.7, s));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [count]);
  return (
    <instancedMesh ref={ref} args={[undefined, material, count]} castShadow receiveShadow raycast={() => null}>
      <dodecahedronGeometry args={[1, 0]} />
    </instancedMesh>
  );
}

/** Low-poly grass tufts around the garden (Earth preset). */
function GrassTufts({ count }: { count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tokens = useSceneTokens();
  const material = useMemo(() => makeToon({ color: tokens["--leaf"].color.clone().multiplyScalar(0.7), side: THREE.DoubleSide, rimStrength: 0.15 }), [tokens]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rand = mulberry32(21);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = 6.5 + rand() * 22;
      const s = 0.12 + rand() * 0.18;
      q.setFromEuler(new THREE.Euler(0, rand() * 3, 0));
      m.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q, new THREE.Vector3(s, s * 1.4, s));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [count]);
  return (
    <instancedMesh ref={ref} args={[undefined, material, count]} raycast={() => null}>
      <coneGeometry args={[0.35, 1, 4, 1, true]} />
    </instancedMesh>
  );
}

/** Gas giants have no surface: the garden floats on a platform above the cloud deck. */
export function CloudDeck({ scene }: { scene: PlanetScene }) {
  const tokens = useSceneTokens();
  const deck = useMemo(() => makeToon({ color: scene.palette[0], rimStrength: 0 }), [scene.palette]);
  const platform = useMemo(() => makeToon({ color: tokens["--scene-metal"].color, rimStrength: 0.2 }), [tokens]);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -6, 0]} material={deck} raycast={() => null}>
        <planeGeometry args={[400, 400]} />
      </mesh>
      <mesh position={[0, -0.45, 0]} material={platform} receiveShadow raycast={() => null}>
        <cylinderGeometry args={[9, 8.5, 0.6, 48]} />
      </mesh>
    </>
  );
}

type Particles = "dust" | "snow" | "drizzle" | "motes" | "none";

function particleKind(preset: EnvPreset): Particles {
  if (preset === "mars") return "dust";
  if (preset === "icy") return "snow";
  if (preset === "titan") return "drizzle";
  if (preset === "earth") return "motes";
  return "none";
}

/** Atmospheric particles per preset: dust, snowflakes, slow drizzle, light motes (§6.4). */
export function Weather({ scene }: { scene: PlanetScene }) {
  const quality = useExplore((s) => s.quality);
  const kind = particleKind(envPreset(scene));
  const count = kind === "none" ? 0 : Math.round((quality === "high" ? 1600 : 450) * (kind === "motes" ? 0.25 : 1));
  const points = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const rand = mulberry32(3);
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) arr.set([(rand() - 0.5) * 60, rand() * 12, (rand() - 0.5) * 60], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, [count]);
  useFrame((_, delta) => {
    if (!points.current || count === 0 || prefersReducedMotion()) return;
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < count; i++) {
      if (kind === "dust") {
        arr[i * 3] += delta * (2.5 + (i % 7) * 0.3);
        arr[i * 3 + 1] += Math.sin(i + arr[i * 3] * 0.2) * delta * 0.2;
        if (arr[i * 3] > 30) arr[i * 3] = -30;
      } else if (kind === "motes") {
        arr[i * 3] += Math.sin(i * 0.7 + arr[i * 3 + 1]) * delta * 0.15;
        arr[i * 3 + 1] += Math.cos(i * 0.3 + arr[i * 3]) * delta * 0.08;
      } else {
        arr[i * 3 + 1] -= delta * (kind === "snow" ? 0.8 : 0.35);
        arr[i * 3] += Math.sin(i * 0.37 + arr[i * 3 + 1]) * delta * 0.1;
        if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = 12;
      }
    }
    pos.needsUpdate = true;
  });
  if (count === 0) return null;
  const look: Record<Exclude<Particles, "none">, { size: number; color: string; opacity: number }> = {
    dust: { size: 0.06, color: scene.sky_day, opacity: 0.4 },
    snow: { size: 0.06, color: scene.sky_horizon, opacity: 0.85 },
    drizzle: { size: 0.035, color: scene.sky_day, opacity: 0.55 },
    motes: { size: 0.05, color: scene.star_color, opacity: 0.6 },
  };
  const l = look[kind as Exclude<Particles, "none">];
  return (
    <points ref={points} geometry={geometry} raycast={() => null}>
      <pointsMaterial map={softDot()} size={l.size} color={l.color} transparent opacity={l.opacity} depthWrite={false} />
    </points>
  );
}

/** Small swirling dust devils on Mars-like worlds. */
export function DustDevils({ scene }: { scene: PlanetScene }) {
  const group = useRef<THREE.Group>(null);
  const count = 220;
  const geometry = useMemo(() => {
    const rand = mulberry32(13);
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const h = rand() * 6;
      const r = 0.2 + h * 0.18;
      const a = rand() * Math.PI * 2;
      arr.set([Math.cos(a) * r, h, Math.sin(a) * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, []);
  useFrame(({ clock }, delta) => {
    if (!group.current || prefersReducedMotion()) return;
    group.current.children.forEach((c, i) => {
      c.rotation.y += delta * (2.2 + i);
      const t = clock.elapsedTime * 0.05 + i * 2.1;
      c.position.set(Math.cos(t) * (24 + i * 7), 0, Math.sin(t * 1.3) * (20 + i * 5) - 10);
    });
  });
  if (envPreset(scene) !== "mars") return null;
  return (
    <group ref={group}>
      {[0, 1].map((i) => (
        <points key={i} geometry={geometry} raycast={() => null}>
          <pointsMaterial map={softDot()} size={0.35} color={scene.sky_day} transparent opacity={0.28} depthWrite={false} />
        </points>
      ))}
    </group>
  );
}

/** A handful of butterflies around Earth's garden (Earth preset). */
export function Butterflies({ scene }: { scene: PlanetScene }) {
  const group = useRef<THREE.Group>(null);
  const tokens = useSceneTokens();
  useFrame(({ clock }) => {
    if (!group.current || prefersReducedMotion()) return;
    const t = clock.elapsedTime;
    group.current.children.forEach((c, i) => {
      const p = t * (0.4 + i * 0.07) + i * 1.7;
      c.position.set(Math.cos(p) * (3 + i), 0.9 + Math.sin(p * 2.3) * 0.3, Math.sin(p * 0.8) * (2.5 + i * 0.6));
      c.rotation.y = -p;
      (c.children[0] as THREE.Mesh).rotation.z = Math.sin(t * 14 + i) * 0.9;
      (c.children[1] as THREE.Mesh).rotation.z = -Math.sin(t * 14 + i) * 0.9;
    });
  });
  if (envPreset(scene) !== "earth") return null;
  const wing = tokens["--accent"].color;
  return (
    <group ref={group}>
      {[0, 1, 2].map((i) => (
        <group key={i}>
          <mesh position={[0.05, 0, 0]} raycast={() => null}>
            <planeGeometry args={[0.1, 0.07]} />
            <meshBasicMaterial color={wing} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[-0.05, 0, 0]} raycast={() => null}>
            <planeGeometry args={[0.1, 0.07]} />
            <meshBasicMaterial color={wing} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
