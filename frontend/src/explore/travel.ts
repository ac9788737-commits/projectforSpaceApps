import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import * as THREE from "three";
import { pathFor, type ExploreRoute } from "./routes";
import { useExplore } from "./store";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Vec3 = [number, number, number];

/**
 * Fly the camera toward `focus`, fade out, then switch level. The new level fades in and pulls
 * the camera back to its own default view, so the journey feels continuous within one canvas.
 */
export function useTravel() {
  const navigate = useNavigate();
  return useCallback(
    async (route: ExploreRoute, focus?: Vec3, fadeColor = "var(--bg-void)", closeness = 0.12) => {
      const { controls, setFade } = useExplore.getState();
      if (controls && focus) {
        const [x, y, z] = focus;
        const cam = controls.camera.position;
        const dir = new THREE.Vector3(cam.x - x, cam.y - y, cam.z - z);
        const distance = dir.length();
        dir.normalize().multiplyScalar(Math.max(distance * closeness, 0.02));
        await Promise.race([
          controls.setLookAt(x + dir.x, y + dir.y, z + dir.z, x, y, z, true),
          sleep(1300),
        ]);
      }
      setFade(1, fadeColor);
      await sleep(350);
      navigate(pathFor(route));
    },
    [navigate],
  );
}

export interface IntroOptions {
  from: Vec3;
  to: Vec3;
  target: Vec3;
  minDistance?: number;
  maxDistance?: number;
}

/** Camera intro of a level: jump to `from`, then glide to `to`, and fade the overlay in. */
export function useLevelIntro(options: IntroOptions | null, deps: unknown[]) {
  const controls = useExplore((s) => s.controls);
  useEffect(() => {
    if (!controls || !options) return;
    const { from, to, target, minDistance = 0.01, maxDistance = 5000 } = options;
    controls.minDistance = minDistance;
    controls.maxDistance = maxDistance;
    controls.setLookAt(...from, ...target, false);
    controls.setLookAt(...to, ...target, true);
    useExplore.getState().setFade(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, ...deps]);
}
