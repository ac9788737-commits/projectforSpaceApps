import { CameraControls, PerformanceMonitor } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, DepthOfField, EffectComposer, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { useEffect, useRef } from "react";
import type CameraControlsImpl from "camera-controls";
import { useFarm } from "./farm/store";
import { HeatHaze } from "./garden/Weather3D";
import { prefersReducedMotion, useExplore } from "./store";

/** One CameraControls instance shared by every level; levels drive it through the store. */
export function CameraRig() {
  const ref = useRef<CameraControlsImpl>(null);
  const setControls = useExplore((s) => s.setControls);
  const { camera, scene, size } = useThree();
  useEffect(() => {
    // Development-only handle for automated browser checks (clicking 3D objects).
    if (import.meta.env.DEV) Object.assign(window, { __astro: { camera, scene, size }, __astroStore: useExplore, __farmStore: useFarm });
  }, [camera, scene, size]);
  useEffect(() => {
    if (ref.current) {
      ref.current.smoothTime = 0.55;
      ref.current.draggingSmoothTime = 0.12;
      setControls(ref.current);
    }
    return () => setControls(null);
  }, [setControls]);
  // After a flight the camera drifts almost imperceptibly so the scene stays alive (§8).
  const idle = useRef(0);
  useFrame((_, delta) => {
    const c = ref.current;
    if (!c || prefersReducedMotion()) return;
    const s = useExplore.getState();
    if (s.landing || s.closeup) return;
    if (c.active) {
      idle.current = 0;
      return;
    }
    idle.current += delta;
    if (idle.current > 2.5) c.azimuthAngle += delta * 0.008;
  });
  return <CameraControls ref={ref} makeDefault />;
}

/** Drops to low quality (fewer particles, no post-processing) when the frame rate sags. */
export function AutoQuality() {
  const setQuality = useExplore((s) => s.setQuality);
  return (
    <PerformanceMonitor
      bounds={() => [28, 55]}
      flipflops={2}
      onDecline={() => {
        if (!useExplore.getState().qualityLocked) setQuality("low");
      }}
      onFallback={() => {
        if (!useExplore.getState().qualityLocked) setQuality("low");
      }}
    />
  );
}

export function Effects({ garden = false }: { garden?: boolean }) {
  const quality = useExplore((s) => s.quality);
  const focus = useExplore((s) => (s.closeup ? s.focus : null));
  if (quality === "low") return null;
  return (
    <EffectComposer multisampling={0}>
      {/* Close-up: the background softly blurs (§6.5). */}
      {focus ? <DepthOfField target={new THREE.Vector3(...focus)} focalLength={0.02} bokehScale={3} height={480} /> : <></>}
      {/* Heat haze over the garden in a heatwave (docs/SIMULATOR.md §5). */}
      {garden ? <HeatHaze /> : <></>}
      <Bloom intensity={0.8} luminanceThreshold={0.85} luminanceSmoothing={0.15} mipmapBlur />
      <Vignette eskil={false} offset={0.25} darkness={0.55} />
    </EffectComposer>
  );
}
