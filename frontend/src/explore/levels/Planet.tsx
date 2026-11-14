import { Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { usePlanetScene, type PlanetScene } from "../data";
import { FresnelRim, PlanetMaterial, PlanetRings } from "../lib/PlanetBody";
import { useSceneTokens, VoidBackground } from "../lib/tokens";
import { useExplore } from "../store";
import { useLevelIntro } from "../travel";

export const PLANET_RADIUS = 2;

export function rotationSpeed(scene: PlanetScene): number {
  if (scene.tidally_locked || !scene.day_hours) return 0;
  return Math.min(0.35, Math.max(0.015, (24 / scene.day_hours) * 0.12));
}

export function PlanetLevel({ planetId }: { planetId: string }) {
  const scene = usePlanetScene(planetId);
  const quality = useExplore((s) => s.quality);
  const tokens = useSceneTokens();
  const globe = useRef<THREE.Group>(null);
  const data = scene.data;

  // Desktop: shift the globe left of the info panel; phones: centred and a bit farther away.
  const narrow = typeof window !== "undefined" && window.innerWidth < 700;
  useLevelIntro(
    data
      ? narrow
        ? { from: [0, 0.4, 2.6], to: [0, 1.6, 10.5], target: [0, -0.6, 0], minDistance: 2.6, maxDistance: 30 }
        : { from: [0, 0.4, 2.6], to: [1.4, 1.4, 7.2], target: [0.9, 0, 0], minDistance: 2.6, maxDistance: 30 }
      : null,
    [planetId, !!data],
  );

  useFrame((_, delta) => {
    if (globe.current && data) globe.current.rotation.y += delta * rotationSpeed(data);
  });

  if (!data) return <VoidBackground />;
  // Atmosphere: rim colour from the atmosphere model, strength by pressure; airless bodies keep a faint
  // neutral rim only for legibility on black (§6.2).
  const rimStrength = data.atmosphere_glow ? Math.min(1.1, 0.3 + 0.18 * Math.log10(1 + data.pressure_pa / 100)) : 0.25;
  const rimColor = data.atmosphere_glow ?? tokens["--text-secondary"].css;
  return (
    <>
      <VoidBackground />
      <Stars radius={200} depth={50} count={quality === "high" ? 2500 : 900} factor={2.5} saturation={0} fade speed={0} />
      <ambientLight intensity={0.05} />
      <directionalLight position={[-8, 3, 6]} intensity={2.6} color={data.star_color} />
      <group ref={globe} rotation={[0.2, 0, 0.12]}>
        <mesh raycast={() => null}>
          <sphereGeometry args={[PLANET_RADIUS, 96, 64]} />
          <PlanetMaterial id={data.id} palette={data.palette} surfaceType={data.surface_type} size={quality === "high" ? 512 : 256} />
        </mesh>
      </group>
      {data.id === "saturn" && <PlanetRings inner={PLANET_RADIUS * 1.25} outer={PLANET_RADIUS * 2.25} tint={data.palette[2] ?? data.palette[0]} />}
      <FresnelRim radius={PLANET_RADIUS} color={rimColor} strength={rimStrength} power={4.5} scale={1.035} />
    </>
  );
}
