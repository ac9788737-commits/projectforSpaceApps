import { useTexture } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { planetTexture } from "./planetTexture";

/**
 * Solar-system maps by Solar System Scope (CC BY 4.0, based on NASA data), see docs/CREDITS.md.
 * Other bodies fall back to procedural textures generated from their palette.
 */
export const PLANET_MAPS: Record<string, string> = {
  mercury: "/textures/2k_mercury.jpg",
  venus: "/textures/2k_venus_atmosphere.jpg",
  earth: "/textures/2k_earth_daymap.jpg",
  moon: "/textures/2k_moon.jpg",
  mars: "/textures/2k_mars.jpg",
  jupiter: "/textures/2k_jupiter.jpg",
  saturn: "/textures/2k_saturn.jpg",
  uranus: "/textures/2k_uranus.jpg",
  neptune: "/textures/2k_neptune.jpg",
};

function MappedMaterial({ url }: { url: string }) {
  const map = useTexture(url);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return <meshStandardMaterial map={map} roughness={0.95} metalness={0} />;
}

function ProceduralMaterial({ id, palette, surfaceType, size }: { id: string; palette: string[]; surfaceType: string | null; size: number }) {
  const map = useMemo(() => planetTexture(id, palette, surfaceType, size), [id, palette, surfaceType, size]);
  return <meshStandardMaterial map={map} roughness={0.95} metalness={0} />;
}

export function PlanetMaterial({ id, palette, surfaceType, size = 256 }: { id: string; palette: string[]; surfaceType: string | null; size?: number }) {
  const procedural = <ProceduralMaterial id={id} palette={palette} surfaceType={surfaceType} size={size} />;
  const url = PLANET_MAPS[id];
  if (!url) return procedural;
  return (
    <Suspense fallback={procedural}>
      <MappedMaterial url={url} />
    </Suspense>
  );
}

const rimVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const rimFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uPower;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - abs(dot(vNormal, vView)), uPower);
    gl_FragColor = vec4(uColor, rim * uStrength);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Fresnel rim: a thin atmosphere-like edge that keeps bodies readable on black (§6.2). */
export function FresnelRim({ radius, color, strength = 0.6, power = 4, scale = 1.04 }: { radius: number; color: THREE.ColorRepresentation; strength?: number; power?: number; scale?: number }) {
  const uniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uPower: { value: power } }),
    [color, strength, power],
  );
  return (
    <mesh scale={scale} raycast={() => null}>
      <sphereGeometry args={[radius, 48, 24]} />
      <shaderMaterial vertexShader={rimVertex} fragmentShader={rimFragment} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}

/** Saturn's rings with the alpha map laid out radially. */
export function PlanetRings({ inner, outer, tint }: { inner: number; outer: number; tint: THREE.ColorRepresentation }) {
  const geometry = useMemo(() => {
    const g = new THREE.RingGeometry(inner, outer, 128, 1);
    const pos = g.getAttribute("position");
    const uv = g.getAttribute("uv");
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (r - inner) / (outer - inner), 0.5);
    }
    return g;
  }, [inner, outer]);
  return (
    <Suspense fallback={null}>
      <RingMaterialMesh geometry={geometry} tint={tint} />
    </Suspense>
  );
}

function RingMaterialMesh({ geometry, tint }: { geometry: THREE.BufferGeometry; tint: THREE.ColorRepresentation }) {
  const alpha = useTexture("/textures/2k_saturn_ring_alpha.png");
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2 + 0.45, 0, 0]} raycast={() => null}>
      <meshStandardMaterial color={tint} alphaMap={alpha} transparent side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}
