import { Billboard, Stars } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { blackbodyColor } from "@/utils/blackbody";
import { DataRow, ObjectCard, Verdict } from "@/ui/data";
import { useGalaxy, type GalaxyStar } from "../data";
import { Anchor } from "../labels";
import { DustLanes, GalaxyCloud, type GalaxyShape } from "../lib/GalaxyCloud";
import { softDot } from "../lib/planetTexture";
import { useSceneAlpha, useSceneTokens, VoidBackground } from "../lib/tokens";
import { useExplore, type StarFilters } from "../store";
import { useLevelIntro, useTravel } from "../travel";
import { holdHighlight, releaseHighlight } from "./System";

type Vec3 = [number, number, number];
const toThree = (x: number, y: number, z: number): Vec3 => [x / 1000, z / 1000, y / 1000];
/** Log radial scale of the solar neighbourhood bubble (units of kpc in the scene). */
export const bubbleRadius = (distancePc: number) => 0.45 * Math.log10(1 + distancePc / 10);

export function passesFilters(star: GalaxyStar, f: StarFilters): boolean {
  if (f.hzOnly && !star.habitable) return false;
  if (f.starClass && star.star_class !== f.starClass) return false;
  if (!star.hypothetical && star.distance_pc != null && star.distance_pc > f.maxDistancePc) return false;
  return true;
}

/** Stars as small spheres; systems with habitable-zone planets are a little larger with a soft halo (§6.1). */
function StarInstances({
  stars,
  positions,
  size,
  onPick,
}: {
  stars: GalaxyStar[];
  positions: Vec3[];
  size: number;
  onPick: (index: number) => void;
}) {
  const core = useRef<THREE.InstancedMesh>(null);
  const halo = useRef<THREE.InstancedMesh>(null);
  const alpha = useSceneAlpha();
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    stars.forEach((star, i) => {
      // Far, dense fields (Kepler) get smaller dots so they do not merge into a blob.
      const far = !star.hypothetical && (star.distance_pc ?? 0) > 300 ? 0.55 : 1;
      const s = size * far * (star.planets > 1 || star.habitable ? 1.35 : 1) * (star.hypothetical ? 1.3 : 1);
      const color = blackbodyColor(star.teff_k);
      if (core.current) {
        m.makeScale(s, s, s).setPosition(...positions[i]);
        core.current.setMatrixAt(i, m);
        core.current.setColorAt(i, color.clone().multiplyScalar(1.1));
      }
      if (halo.current) {
        // Only systems with habitable-zone planets get a halo, so dense fields stay readable.
        const h = star.habitable ? s * 4 : 0;
        m.makeScale(h, h, h).setPosition(...positions[i]);
        halo.current.setMatrixAt(i, m);
        halo.current.setColorAt(i, color);
      }
    });
    for (const mesh of [core.current, halo.current]) {
      if (!mesh) continue;
      mesh.count = stars.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [stars, positions, size]);
  const id = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId != null ? stars[e.instanceId]?.id : undefined);
  return (
    <>
      <instancedMesh key={`h${stars.length}`} ref={halo} args={[undefined, undefined, Math.max(stars.length, 1)]} raycast={() => null}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial transparent opacity={alpha(0.12)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        key={`c${stars.length}`}
        ref={core}
        args={[undefined, undefined, Math.max(stars.length, 1)]}
        onPointerMove={(e) => {
          e.stopPropagation();
          const sid = id(e);
          if (sid) holdHighlight(sid);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          releaseHighlight();
          document.body.style.cursor = "";
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (e.instanceId != null) onPick(e.instanceId);
        }}
      >
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  );
}

function StarCard({ star, onFly }: { star: GalaxyStar; onFly: () => void }) {
  return (
    <div onMouseEnter={() => holdHighlight(star.id)} onMouseLeave={() => releaseHighlight()}>
      <ObjectCard
        title={star.id === "sun" ? "Солнце" : star.name}
        type={star.hypothetical ? "Гипотетическая система" : `Звезда${star.star_class ? ` класса ${star.star_class}` : ""}`}
        source={star.hypothetical ? "hypothetical" : "real"}
        onFly={onFly}
        verdict={
          <Verdict status={star.habitable ? "ok" : "none"}>
            {star.habitable ? "Есть планета в обитаемой зоне" : "Планет в обитаемой зоне не найдено"}
          </Verdict>
        }
      >
        <DataRow label="Температура" value={star.teff_k} unit="К" digits={0} />
        {star.distance_pc != null && star.id !== "sun" && <DataRow label="Расстояние" value={star.distance_pc} unit="пк" digits={1} />}
        <DataRow label="Планет" value={star.planets} digits={0} />
        {!star.hypothetical && star.coords_source && (
          <p className="pt-1 text-[11px] leading-snug text-fg-muted">Координаты: {star.coords_source}</p>
        )}
      </ObjectCard>
    </div>
  );
}

/** Thin --accent ring around the star under the cursor (§6.1). */
function HoverRing({ position, size }: { position: Vec3; size: number }) {
  const t = useSceneTokens();
  return (
    <Billboard position={position}>
      <mesh raycast={() => null}>
        <ringGeometry args={[size * 2.4, size * 2.4 + Math.max(size * 0.35, 0.002), 48]} />
        <meshBasicMaterial color={t["--accent"].color} transparent opacity={0.95} depthWrite={false} toneMapped={false} />
      </mesh>
    </Billboard>
  );
}

export function GalaxyLevel({ galaxyId }: { galaxyId: string }) {
  const scene = useGalaxy(galaxyId);
  const quality = useExplore((s) => s.quality);
  const filters = useExplore((s) => s.filters);
  const controls = useExplore((s) => s.controls);
  const highlight = useExplore((s) => s.highlight);
  const tokens = useSceneTokens();
  const alpha = useSceneAlpha();
  const travel = useTravel();
  const [near, setNear] = useState(false);

  const data = scene.data;
  const radius = (data?.galaxy.radius_pc ?? 15000) / 1000;
  const sp = data?.sun_position_pc;
  const sun: Vec3 | null = sp ? toThree(sp[0], sp[1], sp[2]) : null;

  const real = useMemo(() => (data?.stars ?? []).filter((s) => !s.hypothetical && s.id !== "sun" && passesFilters(s, filters)), [data, filters]);
  const hyp = useMemo(() => (data?.stars ?? []).filter((s) => s.hypothetical && passesFilters(s, filters)), [data, filters]);
  const realPositions = useMemo<Vec3[]>(() => {
    if (!sun || !sp) return [];
    return real.map((s) => {
      const o = new THREE.Vector3(s.x_pc - sp[0], s.y_pc, s.z_pc);
      const d = Math.max(o.length(), 1e-6);
      o.multiplyScalar(bubbleRadius(d) / d);
      return [sun[0] + o.x, sun[1] + o.z, sun[2] + o.y];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, sp?.[0]]);
  const hypPositions = useMemo<Vec3[]>(() => hyp.map((s) => toThree(s.x_pc, s.y_pc, s.z_pc)), [hyp]);

  useLevelIntro(
    data ? { from: [0, radius * 4, radius * 3], to: [radius * 0.2, radius * 1.1, radius * 1.5], target: [0, 0, 0], minDistance: 0.2, maxDistance: radius * 6 } : null,
    [galaxyId, !!data],
  );

  useFrame(({ camera }) => {
    if (!sun) return;
    const isNear = camera.position.distanceTo(new THREE.Vector3(...sun)) < 5;
    if (isNear !== near) setNear(isNear);
  });

  const goToSystem = (star: GalaxyStar, position: Vec3) => travel({ level: "system", galaxyId, starId: star.id }, position, "var(--bg-void)", 0.05);

  // Highlighted star (hover in the scene or focus in the left list).
  const hi = (() => {
    if (!highlight) return null;
    if (highlight === "sun" && sun) return { star: data!.stars.find((s) => s.id === "sun")!, pos: sun, size: near ? 0.02 : 0.15 };
    const ri = near ? real.findIndex((s) => s.id === highlight) : -1;
    if (ri >= 0) return { star: real[ri], pos: realPositions[ri], size: 0.006 };
    const hiIdx = !near ? hyp.findIndex((s) => s.id === highlight) : -1;
    if (hiIdx >= 0) return { star: hyp[hiIdx], pos: hypPositions[hiIdx], size: radius * 0.006 };
    return null;
  })();

  return (
    <>
      <VoidBackground />
      {/* Distant star layers at different depths give a quiet parallax (§6.1). */}
      <Stars radius={500} depth={40} count={quality === "high" ? 2200 : 800} factor={2} saturation={0} fade speed={0} />
      <Stars radius={260} depth={30} count={quality === "high" ? 900 : 300} factor={3} saturation={0} fade speed={0} />
      {data && (
        <>
          <GalaxyCloud
            id={galaxyId}
            shape={data.galaxy.shape as GalaxyShape}
            arms={data.galaxy.arms}
            radius={radius}
            count={quality === "high" ? 40000 : 12000}
            size={radius * 0.012}
            spin={0}
            opacity={near ? 0.3 : 0.85}
          />
          {(data.galaxy.shape === "spiral" || data.galaxy.shape === "starburst") && data.galaxy.arms > 0 && !near && (
            <DustLanes id={galaxyId} arms={data.galaxy.arms} radius={radius} count={quality === "high" ? 9000 : 3000} color={tokens["--bg-void"].color} />
          )}
          {/* Very faint nebular glow around the bulge — colour from a warm black body, barely visible. */}
          <sprite scale={radius * 1.6} raycast={() => null}>
            <spriteMaterial map={softDot()} color={blackbodyColor(5200)} transparent opacity={alpha(near ? 0.02 : 0.07)} depthWrite={false} blending={THREE.AdditiveBlending} />
          </sprite>
        </>
      )}
      {sun && (
        <group position={sun}>
          <sprite
            scale={near ? 0.12 : 0.5}
            onClick={(e) => {
              e.stopPropagation();
              if (near) travel({ level: "system", galaxyId, starId: "sun" }, sun, "var(--bg-void)", 0.05);
              else controls?.setLookAt(sun[0] + 1.3, sun[1] + 1.1, sun[2] + 2.4, ...sun, true);
            }}
            onPointerOver={() => {
              holdHighlight("sun");
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              releaseHighlight();
              document.body.style.cursor = "";
            }}
          >
            <spriteMaterial map={softDot()} color={blackbodyColor(5772).multiplyScalar(2.2)} toneMapped={false} depthWrite={false} />
          </sprite>
          {highlight !== "sun" && (
            <Anchor position={[0, near ? 0.12 : 0.45, 0]}>
              <span className="pointer-events-none whitespace-nowrap font-head text-[12px] uppercase tracking-[0.12em] text-fg [text-shadow:0_1px_3px_var(--bg-void)]">
                {near ? "Солнце · нажмите, чтобы войти" : "Солнце · нажмите, чтобы приблизиться"}
              </span>
            </Anchor>
          )}
          {near && (
            <mesh raycast={() => null}>
              <sphereGeometry args={[bubbleRadius(10000), 12, 6]} />
              <meshBasicMaterial color={tokens["--border-subtle"].color} wireframe transparent opacity={alpha(0.04)} />
            </mesh>
          )}
        </group>
      )}
      {near && real.length > 0 && <StarInstances stars={real} positions={realPositions} size={0.006} onPick={(i) => goToSystem(real[i], realPositions[i])} />}
      {hyp.length > 0 && !near && <StarInstances stars={hyp} positions={hypPositions} size={radius * 0.006} onPick={(i) => goToSystem(hyp[i], hypPositions[i])} />}
      {hi && (
        <>
          <HoverRing position={hi.pos} size={hi.size} />
          <Anchor position={hi.pos} center={false} z={25} autoFlip>
            <StarCard
              star={hi.star}
              onFly={() =>
                hi.star.id === "sun" && !near
                  ? controls?.setLookAt(hi.pos[0] + 1.3, hi.pos[1] + 1.1, hi.pos[2] + 2.4, ...hi.pos, true)
                  : goToSystem(hi.star, hi.pos)
              }
            />
          </Anchor>
        </>
      )}
    </>
  );
}
