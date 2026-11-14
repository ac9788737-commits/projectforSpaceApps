import { Billboard, Stars } from "@react-three/drei";
import { useMemo } from "react";
import { DataRow, ObjectCard, Verdict } from "@/ui/data";
import { useUniverse, type GalaxyInfo } from "../data";
import { Anchor } from "../labels";
import { GalaxyCloud, type GalaxyShape } from "../lib/GalaxyCloud";
import { hashString } from "../lib/noise";
import { useSceneTokens, VoidBackground } from "../lib/tokens";
import { useExplore } from "../store";
import { useLevelIntro, useTravel } from "../travel";
import { holdHighlight, releaseHighlight } from "./System";

type Vec3 = [number, number, number];

const REAL_ANGLES: Record<string, number> = { milky_way: 0, lmc: -0.55, smc: -1.5, m31: 2.0 };
const HYPOTHETICAL_ANGLES = [2.95, 3.85, 4.75];

/** Schematic layout: real galaxies by log distance, hypothetical ones on an outer ring. */
export function universeLayout(galaxies: GalaxyInfo[]): Map<string, { position: Vec3; radius: number }> {
  const layout = new Map<string, { position: Vec3; radius: number }>();
  let hypotheticalIndex = 0;
  for (const g of galaxies) {
    const radius = Math.min(8, Math.max(2.2, g.radius_pc / 2500));
    let position: Vec3;
    if (g.id === "milky_way") position = [0, 0, 0];
    else if (g.real && g.distance_kpc != null) {
      const r = 12 + 12 * Math.log10(1 + g.distance_kpc / 5);
      const a = REAL_ANGLES[g.id] ?? (hashString(g.id) % 628) / 100;
      position = [Math.cos(a) * r, (hashString(g.id) % 5) - 2, Math.sin(a) * r];
    } else {
      const a = HYPOTHETICAL_ANGLES[hypotheticalIndex % 3] + Math.floor(hypotheticalIndex / 3) * 0.3;
      hypotheticalIndex++;
      position = [Math.cos(a) * 46, hypotheticalIndex % 2 ? 3 : -3, Math.sin(a) * 46];
    }
    layout.set(g.id, { position, radius });
  }
  return layout;
}

const SHAPE_RU: Record<string, string> = {
  spiral: "спиральная",
  irregular: "неправильная",
  elliptical: "эллиптическая",
  dwarf: "карликовая",
  starburst: "со вспышкой звездообразования",
};

function GalaxyCard({ galaxy, onFly }: { galaxy: GalaxyInfo; onFly: () => void }) {
  return (
    <div onMouseEnter={() => holdHighlight(galaxy.id)} onMouseLeave={() => releaseHighlight()}>
      <ObjectCard
        title={galaxy.name_ru}
        type={`${galaxy.real ? "Галактика" : "Гипотетическая галактика"} · ${SHAPE_RU[galaxy.shape]}`}
        source={galaxy.real ? "real" : "hypothetical"}
        onFly={onFly}
        verdict={
          <Verdict status={galaxy.confirmed_planets > 0 ? "ok" : "none"}>
            {galaxy.confirmed_planets > 0 ? "Есть подтверждённые планеты" : "0 подтверждённых — только гипотетические миры"}
          </Verdict>
        }
      >
        {galaxy.distance_kpc != null && galaxy.distance_kpc > 0 && <DataRow label="Расстояние" value={galaxy.distance_kpc} unit="кпк" digits={2} />}
        <DataRow label="Подтверждённых планет" value={galaxy.confirmed_planets} digits={0} />
        <DataRow label="Гипотетических систем" value={galaxy.hypothetical_planets} digits={0} />
      </ObjectCard>
    </div>
  );
}

export function UniverseLevel() {
  const universe = useUniverse();
  const quality = useExplore((s) => s.quality);
  const highlight = useExplore((s) => s.highlight);
  const tokens = useSceneTokens();
  const travel = useTravel();
  const galaxies = universe.data?.galaxies ?? [];
  const layout = useMemo(() => universeLayout(galaxies), [galaxies]);

  const narrow = typeof window !== "undefined" && window.innerWidth < 700;
  useLevelIntro({ from: [0, 90, 150], to: narrow ? [0, 95, 150] : [2, 50, 88], target: narrow ? [-6, 0, 4] : [-4, 0, 2], minDistance: 3, maxDistance: 260 }, []);

  return (
    <>
      <VoidBackground />
      <Stars radius={520} depth={60} count={quality === "high" ? 2600 : 900} factor={2.2} saturation={0} fade speed={0} />
      <Stars radius={300} depth={40} count={quality === "high" ? 900 : 300} factor={3} saturation={0} fade speed={0} />
      {galaxies.map((g) => {
        const place = layout.get(g.id)!;
        const tilt = ((hashString(g.id) % 60) - 30) / 100;
        const fly = () => travel({ level: "galaxy", galaxyId: g.id }, place.position, "var(--bg-void)", 0.3);
        const lit = highlight === g.id;
        return (
          <group key={g.id} position={place.position}>
            <group rotation={[tilt, 0, tilt / 2]}>
              <GalaxyCloud
                id={g.id}
                shape={g.shape as GalaxyShape}
                arms={g.arms}
                radius={place.radius}
                count={Math.round((g.id === "milky_way" ? 9000 : 4000) * (quality === "high" ? 1 : 0.5))}
                size={place.radius * 0.07}
                spin={0.02}
              />
            </group>
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                fly();
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                holdHighlight(g.id);
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                releaseHighlight();
                document.body.style.cursor = "";
              }}
            >
              <sphereGeometry args={[place.radius * 0.9, 16, 16]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {lit && (
              <Billboard>
                <mesh raycast={() => null}>
                  <ringGeometry args={[place.radius * 1.05, place.radius * 1.05 + 0.12, 64]} />
                  <meshBasicMaterial color={tokens["--accent"].color} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
                </mesh>
              </Billboard>
            )}
            {lit ? (
              <Anchor position={[place.radius * 0.6, place.radius * 0.4, 0]} center={false} z={25} autoFlip>
                <GalaxyCard galaxy={g} onFly={fly} />
              </Anchor>
            ) : (
              <Anchor position={[0, place.radius * 0.55 + 0.8, 0]}>
                <span className="pointer-events-none block max-w-44 text-center font-head text-[12px] uppercase leading-tight tracking-[0.12em] text-fg [text-shadow:0_1px_3px_var(--bg-void)] sm:max-w-none sm:whitespace-nowrap">
                  {g.name_ru}
                  {!g.real && <span className="block text-hypo sm:ml-1.5 sm:inline">· гипотетическая</span>}
                </span>
              </Anchor>
            )}
          </group>
        );
      })}
    </>
  );
}
