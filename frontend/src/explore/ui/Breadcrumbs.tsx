import { Breadcrumbs as Crumbs, type Crumb } from "@/ui/primitives";
import { useGalaxy, usePlanetScene, useSystem } from "../data";
import type { ExploreRoute, Level } from "../routes";
import { useTravel } from "../travel";

export function Breadcrumbs({ route }: { route: ExploreRoute }) {
  const travel = useTravel();
  const galaxy = useGalaxy(route.galaxyId);
  const system = useSystem(route.starId);
  const planet = usePlanetScene(route.planetId);

  const levels: { level: Level; label: string }[] = [{ level: "universe", label: "Вселенная" }];
  if (route.galaxyId) levels.push({ level: "galaxy", label: galaxy.data?.galaxy.name_ru ?? "Галактика" });
  if (route.starId) levels.push({ level: "system", label: route.starId === "sun" ? "Солнце" : (system.data?.star.name ?? "Звезда") });
  if (route.planetId) levels.push({ level: "planet", label: planet.data?.name ?? "Планета" });
  if (route.level === "garden") levels.push({ level: "garden", label: "Огород" });

  const items: Crumb[] = levels.map((l, i) => ({
    label: l.label,
    onClick: i < levels.length - 1 ? () => travel({ ...route, level: l.level }) : undefined,
  }));
  return <Crumbs items={items} />;
}
