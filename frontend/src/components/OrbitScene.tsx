import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

/** Approximate sRGB colour of a black body (Tanner Helland's fit). */
function starColor(teffK: number): string {
  const t = Math.min(Math.max(teffK, 1000), 40000) / 100;
  const clamp = (value: number) => Math.round(Math.min(255, Math.max(0, value)));
  const red = t <= 66 ? 255 : clamp(329.7 * (t - 60) ** -0.1332);
  const green = t <= 66 ? clamp(99.47 * Math.log(t) - 161.12) : clamp(288.12 * (t - 60) ** -0.0755);
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : clamp(138.52 * Math.log(t - 10) - 305.04);
  return `rgb(${red}, ${green}, ${blue})`;
}

function ring(radius: number, color: string, opacity: number) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.015, radius + 0.015, 128]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Planet({ orbit, size }: { orbit: number; size: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const angle = clock.elapsedTime * 0.3;
    ref.current.position.set(Math.cos(angle) * orbit, 0, Math.sin(angle) * orbit);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[size, 32, 32]} />
      <meshStandardMaterial color="#6da7ec" roughness={0.8} />
    </mesh>
  );
}

/** Schematic system view. Distances are normalised, so the picture is not to scale. */
export default function OrbitScene({
  teffK,
  semiMajorAxisAu,
  habitableZoneAu,
  radiusEarth,
}: {
  teffK: number;
  semiMajorAxisAu: number | null;
  habitableZoneAu: [number, number] | null;
  radiusEarth: number | null;
}) {
  const color = useMemo(() => starColor(teffK), [teffK]);
  const reference = Math.max(semiMajorAxisAu ?? 1, habitableZoneAu?.[1] ?? 0, 1e-6);
  const scale = 4 / reference;
  const orbit = (semiMajorAxisAu ?? reference) * scale;
  const size = Math.min(0.1 + Math.log10(1 + (radiusEarth ?? 1)) * 0.25, 0.45);

  return (
    <Canvas camera={{ position: [0, 5, 7], fov: 45 }} dpr={[1, 2]}>
      <color attach="background" args={["#0b0d12"]} />
      <ambientLight intensity={0.15} />
      <pointLight position={[0, 0, 0]} intensity={60} color={color} decay={2} />
      <mesh>
        <sphereGeometry args={[0.45, 48, 48]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {ring(orbit, "#c3c2b7", 0.6)}
      {habitableZoneAu && ring(habitableZoneAu[0] * scale, "#1baf7a", 0.8)}
      {habitableZoneAu && ring(habitableZoneAu[1] * scale, "#1baf7a", 0.8)}
      <Planet orbit={orbit} size={size} />
      <OrbitControls enablePan={false} minDistance={3} maxDistance={16} />
    </Canvas>
  );
}
