import { RoundedBox } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { useSceneTokens } from "../lib/tokens";
import { makeToon } from "./toon";

/** A few small things that make the garden lived-in (§6.4: 5–7 objects at most). */
export function Decor({ groundColor }: { groundColor: string }) {
  const t = useSceneTokens();
  const m = useMemo(
    () => ({
      rover: makeToon({ color: t["--scene-rover"].color, rimStrength: 0.25 }),
      metal: makeToon({ color: t["--scene-metal"].color, rimStrength: 0.2 }),
      dark: makeToon({ color: t["--scene-wood-dark"].color.clone().multiplyScalar(0.5) }),
      wood: makeToon({ color: t["--scene-wood"].color, rimStrength: 0.15 }),
      woodDark: makeToon({ color: t["--scene-wood-dark"].color }),
      accent: makeToon({ color: t["--accent"].color, rimStrength: 0.3 }),
      track: new THREE.MeshBasicMaterial({ color: new THREE.Color(groundColor).multiplyScalar(0.62), transparent: true, opacity: 0.8, depthWrite: false }),
    }),
    [t, groundColor],
  );
  return (
    <group>
      {/* 1. Rover helper */}
      <group position={[6.6, 0, 3.4]} rotation={[0, -0.7, 0]}>
        <RoundedBox args={[1.0, 0.32, 0.7]} radius={0.08} smoothness={3} position={[0, 0.42, 0]} material={m.rover} castShadow />
        <mesh position={[0, 0.62, 0]} material={m.metal} castShadow>
          <boxGeometry args={[0.9, 0.04, 0.62]} />
        </mesh>
        {[-0.38, 0, 0.38].flatMap((x) =>
          [-0.4, 0.4].map((z) => (
            <mesh key={`${x}${z}`} position={[x, 0.16, z]} rotation={[Math.PI / 2, 0, 0]} material={m.dark} castShadow>
              <cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
            </mesh>
          )),
        )}
        <mesh position={[0.32, 0.9, 0]} material={m.metal}>
          <cylinderGeometry args={[0.025, 0.025, 0.5, 8]} />
        </mesh>
        <RoundedBox args={[0.16, 0.12, 0.22]} radius={0.03} position={[0.36, 1.18, 0]} material={m.rover} />
        <mesh position={[0.45, 1.18, 0]} material={m.accent}>
          <sphereGeometry args={[0.035, 12, 8]} />
        </mesh>
      </group>
      {/* 2. Rover tracks */}
      {[-0.4, 0.4].map((z) => (
        <mesh key={z} position={[9.3, 0.012, 5.6 + z]} rotation={[-Math.PI / 2, 0, -0.7]} material={m.track} raycast={() => null}>
          <planeGeometry args={[6.5, 0.16]} />
        </mesh>
      ))}
      {/* 3–4. Crates */}
      <RoundedBox args={[0.7, 0.5, 0.55]} radius={0.05} position={[-6.4, 0.25, -4.6]} rotation={[0, 0.3, 0]} material={m.wood} castShadow />
      <RoundedBox args={[0.55, 0.42, 0.5]} radius={0.05} position={[-6.9, 0.21, -3.85]} rotation={[0, -0.2, 0]} material={m.woodDark} castShadow />
      {/* 5. Watering can */}
      <group position={[-5.6, 0, 3.9]} rotation={[0, 0.8, 0]}>
        <mesh position={[0, 0.17, 0]} material={m.accent} castShadow>
          <cylinderGeometry args={[0.15, 0.17, 0.32, 16]} />
        </mesh>
        <mesh position={[0.2, 0.22, 0]} rotation={[0, 0, -0.9]} material={m.accent}>
          <cylinderGeometry args={[0.02, 0.035, 0.32, 8]} />
        </mesh>
        <mesh position={[-0.02, 0.34, 0]} rotation={[0, 0, 0]} material={m.accent}>
          <torusGeometry args={[0.1, 0.018, 8, 16, Math.PI]} />
        </mesh>
      </group>
      {/* 6. Antenna */}
      <group position={[-7.2, 0, 1.2]}>
        <mesh position={[0, 1.1, 0]} material={m.metal} castShadow>
          <cylinderGeometry args={[0.03, 0.04, 2.2, 8]} />
        </mesh>
        <mesh position={[0, 2.25, 0]} rotation={[0.6, 0, 0]} material={m.rover}>
          <sphereGeometry args={[0.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.6]} />
        </mesh>
      </group>
    </group>
  );
}
