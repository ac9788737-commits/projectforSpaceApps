import { RoundedBox, Text } from "@react-three/drei";
import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import interCyrillic from "@fontsource/inter/files/inter-cyrillic-500-normal.woff?url";
import type { Crop } from "@/api/client";
import { UNDERGROUND_ORGANS } from "@/plants";
import type { CropTraits } from "@/plants/appearance";
import type { PlanetScene, PlantStateOut } from "../data";

/** What a bed needs to draw its plants: daily plant states and a few crop facts. */
export interface BedTimeline {
  days: PlantStateOut[];
  morphology: { harvest_organ: string; biomass_max_g: number };
  summary: { survival: boolean; yield_rel: number };
}
type Timeline = BedTimeline;
import { Anchor } from "../labels";
import { useSceneAlpha, useSceneTokens } from "../lib/tokens";
import { effectiveBed, useExplore, type Bed, type Scenario } from "../store";
import { PlantInstances, SpirulinaTank } from "./Plants";
import { makeToon } from "./toon";

type Vec3 = [number, number, number];
export const BED_SPACING = 3.4;
export const BED_SIZE = 2.4;
/** Raised bed: plants stand on the soil surface at this height. */
export const BED_TOP = 0.3;

export function bedPosition(index: number): Vec3 {
  return [((index % 3) - 1) * BED_SPACING, 0, (Math.floor(index / 3) - 1) * BED_SPACING];
}

export function plantGrid(perSide: number, center: Vec3, size = 2.0, y = BED_TOP): Vec3[] {
  const step = size / perSide;
  const out: Vec3[] = [];
  for (let r = 0; r < perSide; r++)
    for (let c = 0; c < perSide; c++) out.push([center[0] - size / 2 + step * (c + 0.5), y, center[2] - size / 2 + step * (r + 0.5)]);
  return out;
}

export function cropTraits(crop: Crop, timeline: Timeline): CropTraits {
  return { id: crop.id, harvestOrgan: timeline.morphology.harvest_organ, tOptMinC: crop.t_opt_min_c, tOptMaxC: crop.t_opt_max_c };
}

export const SCENARIO_SHORT: Record<Scenario, string> = {
  open_surface: "открытый грунт",
  greenhouse: "купол",
  closed_farm: "подземная ферма",
};

const glassVertex = /* glsl */ `
  varying vec3 vNormal; varying vec3 vView;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const glassFragment = /* glsl */ `
  uniform vec3 uColor; uniform float uBase; uniform float uRim;
  varying vec3 vNormal; varying vec3 vView;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vNormal), vView)), 2.5);
    gl_FragColor = vec4(uColor, uBase + f * uRim);
    #include <colorspace_fragment>
  }
`;

/** Glass dome: fresnel shell plus faint hexagonal ribs (§6.4). */
function Dome() {
  const t = useSceneTokens();
  const alpha = useSceneAlpha();
  const uniforms = useMemo(
    () => ({ uColor: { value: t["--scene-glass"].color.clone() }, uBase: { value: alpha(0.05) }, uRim: { value: alpha(0.45) } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, alpha(1)],
  );
  const ribs = useMemo(() => {
    const ico = new THREE.IcosahedronGeometry(1.72, 2);
    const edges = new THREE.EdgesGeometry(ico, 1);
    const pos = edges.getAttribute("position");
    const keep: number[] = [];
    for (let i = 0; i < pos.count; i += 2) {
      if (pos.getY(i) >= -0.01 && pos.getY(i + 1) >= -0.01) keep.push(pos.getX(i), pos.getY(i), pos.getZ(i), pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(keep, 3));
    return g;
  }, []);
  const ring = useMemo(() => makeToon({ color: t["--scene-metal"].color, rimStrength: 0.25 }), [t]);
  return (
    <group position={[0, BED_TOP, 0]} scale={[1, 0.78, 1]}>
      <mesh raycast={() => null} renderOrder={2}>
        <sphereGeometry args={[1.72, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <shaderMaterial vertexShader={glassVertex} fragmentShader={glassFragment} uniforms={uniforms} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={ribs} raycast={() => null} renderOrder={3}>
        <lineBasicMaterial color={t["--scene-glass"].color} transparent opacity={alpha(0.32)} depthWrite={false} />
      </lineSegments>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={ring} raycast={() => null}>
        <torusGeometry args={[1.72, 0.045, 8, 64]} />
      </mesh>
    </group>
  );
}

/** Entrance to the underground farm: a cosy little hatch with a pink LED strip. */
function Hatch() {
  const t = useSceneTokens();
  const metal = useMemo(() => makeToon({ color: t["--scene-metal"].color, rimStrength: 0.25 }), [t]);
  const roof = useMemo(() => makeToon({ color: t["--scene-rover"].color, rimStrength: 0.25 }), [t]);
  return (
    <group>
      <mesh position={[0, 0.32, 0]} material={metal} castShadow raycast={() => null}>
        <cylinderGeometry args={[0.85, 0.95, 0.64, 32]} />
      </mesh>
      <mesh position={[0, 0.64, 0]} material={roof} castShadow raycast={() => null}>
        <sphereGeometry args={[0.85, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <RoundedBox args={[0.5, 0.42, 0.05]} radius={0.04} position={[0, 0.34, 0.92]} raycast={() => null}>
        <meshBasicMaterial color={t["--scene-led-pink"].color.clone().multiplyScalar(1.6)} toneMapped={false} />
      </RoundedBox>
    </group>
  );
}

/** Small wooden sign with the crop name. */
function Sign({ text }: { text: string }) {
  const t = useSceneTokens();
  const post = useMemo(() => makeToon({ color: t["--scene-wood-dark"].color }), [t]);
  const plank = useMemo(() => makeToon({ color: t["--scene-sign"].color, rimStrength: 0.15 }), [t]);
  return (
    <group position={[-BED_SIZE / 2 + 0.05, 0, BED_SIZE / 2 + 0.12]} rotation={[0, 0.25, 0]}>
      <mesh position={[0, 0.3, 0]} material={post} castShadow raycast={() => null}>
        <boxGeometry args={[0.05, 0.6, 0.05]} />
      </mesh>
      <RoundedBox args={[0.78, 0.2, 0.04]} radius={0.02} position={[0.3, 0.56, 0.03]} material={plank} castShadow raycast={() => null} />
      <Text font={interCyrillic} fontSize={0.085} position={[0.3, 0.56, 0.055]} color={t["--scene-wood-dark"].css} anchorX="center" anchorY="middle" maxWidth={0.72}>
        {text}
      </Text>
    </group>
  );
}

export function BedView({
  index,
  bed,
  crop,
  timeline,
  scene,
  selected,
  perSide,
  soilClip,
  signText,
}: {
  signText?: string;
  index: number;
  bed: Bed;
  crop: Crop | undefined;
  timeline: Timeline | undefined;
  scene: PlanetScene;
  selected: boolean;
  perSide: number;
  soilClip: THREE.Plane[];
}) {
  const position = bedPosition(index);
  const { scenario } = effectiveBed(bed);
  const selectBed = useExplore((s) => s.selectBed);
  const setCloseup = useExplore((s) => s.setCloseup);
  const t = useSceneTokens();
  const positions = useMemo(() => plantGrid(perSide, [0, 0, 0]), [perSide]);
  const frame = useMemo(() => makeToon({ color: t["--scene-wood"].color, rimStrength: 0.18 }), [t]);
  const soil = useMemo(() => {
    const color = scenario === "open_surface" ? new THREE.Color(scene.ground).lerp(t["--soil"].color, 0.55) : t["--soil"].color.clone();
    return makeToon({ color, rimStrength: 0 });
  }, [scenario, scene.ground, t]);
  useLayoutEffect(() => {
    soil.clippingPlanes = soilClip;
    frame.clippingPlanes = soilClip;
    soil.needsUpdate = true;
    frame.needsUpdate = true;
  }, [soil, frame, soilClip]);
  const wind = scenario === "open_surface" && scene.pressure_pa >= 100 ? Math.min(0.08, Math.log10(scene.pressure_pa / 100) * 0.03) : 0;
  const traits = crop && timeline ? cropTraits(crop, timeline) : null;
  const pick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    selectBed(index);
  };

  return (
    <group position={position}>
      {/* Wooden frame with rounded corners and warm soil inside. */}
      <RoundedBox
        args={[BED_SIZE + 0.16, 0.7, BED_SIZE + 0.16]}
        radius={0.07}
        smoothness={3}
        position={[0, BED_TOP - 0.31, 0]}
        material={frame}
        castShadow
        receiveShadow
        onClick={pick}
        onDoubleClick={(e) => {
          pick(e);
          if (bed.crop) setCloseup(true);
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      />
      <mesh position={[0, BED_TOP - 0.36, 0]} material={soil} receiveShadow onClick={pick}>
        <boxGeometry args={[BED_SIZE, 0.7, BED_SIZE]} />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} raycast={() => null}>
          <ringGeometry args={[BED_SIZE * 0.76, BED_SIZE * 0.8, 4, 1, Math.PI / 4]} />
          <meshBasicMaterial color={t["--accent"].color} toneMapped={false} />
        </mesh>
      )}
      {scenario === "greenhouse" && <Dome />}
      {scenario === "closed_farm" && <Hatch />}
      <Sign text={signText ?? (crop ? crop.name_ru : "пусто")} />
      {crop &&
        timeline &&
        traits &&
        scenario !== "closed_farm" &&
        (crop.id === "spirulina" ? (
          <SpirulinaTank days={timeline.days} maxBiomassG={timeline.morphology.biomass_max_g} open={scenario === "open_surface"} />
        ) : (
          <PlantInstances cropId={crop.id} traits={traits} days={timeline.days} gravityG={scene.gravity_g} wind={wind} warm={scenario === "greenhouse"} positions={positions} rimColor={scene.star_color} />
        ))}
      {selected && crop && timeline && (
        <Anchor position={[0, scenario === "greenhouse" ? 1.6 : 1.2, 0]}>
          <span className="pointer-events-none whitespace-nowrap rounded-full border border-subtle bg-panel-strong px-2.5 py-1 text-xs text-fg">
            {timeline.summary.survival ? (
              <>
                урожай <span className="font-num">{Math.round(timeline.summary.yield_rel * 100)}&nbsp;%</span>
              </>
            ) : (
              <span className="text-lethal">✕ гибель</span>
            )}
          </span>
        </Anchor>
      )}
    </group>
  );
}

export const INTERIOR_Y = -40;

/** Underground farm: racks with trays under pink-violet LED bars. */
export function Interior({ crop, timeline, scene, perSide }: { crop: Crop | undefined; timeline: Timeline | undefined; scene: PlanetScene; perSide: number }) {
  const t = useSceneTokens();
  const tiers = [0.4, 1.2, 2.0];
  const room = useMemo(() => makeToon({ color: t["--scene-room"].color, side: THREE.BackSide, rimStrength: 0 }), [t]);
  const shelf = useMemo(() => makeToon({ color: t["--scene-metal"].color, rimStrength: 0.2 }), [t]);
  const positions = useMemo(() => {
    const out: Vec3[] = [];
    const perTier = Math.max(3, Math.ceil((perSide * perSide) / tiers.length));
    tiers.forEach((y) => {
      for (let i = 0; i < perTier; i++) out.push([-2.4 + (4.8 * (i + 0.5)) / perTier, INTERIOR_Y + y + 0.06, 0]);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perSide]);
  const pink = t["--scene-led-pink"].color;
  const violet = t["--scene-led-violet"].color;
  return (
    <group>
      <mesh position={[0, INTERIOR_Y + 1.6, 0]} material={room} raycast={() => null}>
        <boxGeometry args={[10, 3.2, 7]} />
      </mesh>
      <hemisphereLight args={[violet.clone().lerp(new THREE.Color(1, 1, 1), 0.7), t["--scene-room"].color, 0.9]} />
      <pointLight position={[0, INTERIOR_Y + 2.8, 1.5]} color={pink} intensity={8} distance={14} decay={1.5} />
      <pointLight position={[0, INTERIOR_Y + 1.2, 2.5]} color={violet} intensity={4} distance={10} decay={1.5} />
      {tiers.map((y) => (
        <group key={y}>
          <mesh position={[0, INTERIOR_Y + y, 0]} material={shelf} raycast={() => null}>
            <boxGeometry args={[5.2, 0.08, 0.9]} />
          </mesh>
          <mesh position={[0, INTERIOR_Y + y + 0.72, 0]} raycast={() => null}>
            <boxGeometry args={[5, 0.04, 0.12]} />
            <meshBasicMaterial color={pink.clone().multiplyScalar(2.2)} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {[-2.6, 2.6].map((x) => (
        <mesh key={x} position={[x, INTERIOR_Y + 1.2, 0]} material={shelf} raycast={() => null}>
          <boxGeometry args={[0.06, 2.4, 0.9]} />
        </mesh>
      ))}
      {crop && timeline && crop.id !== "spirulina" && (
        <PlantInstances cropId={crop.id} traits={cropTraits(crop, timeline)} days={timeline.days} gravityG={scene.gravity_g} wind={0} warm={false} positions={positions} rimColor={pink.getStyle()} />
      )}
      {crop?.id === "spirulina" && timeline && (
        <group position={[0, INTERIOR_Y + 0.4 - BED_TOP, 0]} scale={[2.4, 1, 0.4]}>
          <SpirulinaTank days={timeline.days} maxBiomassG={timeline.morphology.biomass_max_g} open={false} />
        </group>
      )}
    </group>
  );
}

let strataTexture: THREE.CanvasTexture | null = null;
/** Soil layers for the cut face; colours derived from the --soil token. */
function strata(soil: THREE.Color): THREE.CanvasTexture {
  if (strataTexture) return strataTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const shades = [0.62, 0.75, 0.88, 0.7, 0.55];
  shades.forEach((k, i) => {
    ctx.fillStyle = `#${soil.clone().multiplyScalar(k).getHexString()}`;
    ctx.fillRect(0, (i * 256) / shades.length, 64, 256 / shades.length + 1);
  });
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.2})`;
    ctx.fillRect(Math.random() * 64, Math.random() * 256, 2, 2);
  }
  strataTexture = new THREE.CanvasTexture(canvas);
  strataTexture.colorSpace = THREE.SRGBColorSpace;
  strataTexture.wrapS = THREE.RepeatWrapping;
  strataTexture.repeat.set(20, 1);
  return strataTexture;
}

/** Cut face shown in close-up for tubers and roots; the soil in front of it is clipped away. */
export function SoilSection({ z }: { z: number }) {
  const t = useSceneTokens();
  const map = useMemo(() => strata(t["--soil"].color), [t]);
  return (
    <mesh position={[0, BED_TOP - 1.52, z]} raycast={() => null}>
      <planeGeometry args={[60, 3.04]} />
      <meshToonMaterial map={map} />
    </mesh>
  );
}

export function hasUndergroundOrgan(timeline: Timeline | undefined): boolean {
  return !!timeline && UNDERGROUND_ORGANS.has(timeline.morphology.harvest_organ);
}
