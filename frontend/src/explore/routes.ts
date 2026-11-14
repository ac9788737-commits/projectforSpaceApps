// URL scheme of the 3D journey:
//   /universe
//   /galaxy/milky-way
//   /galaxy/milky-way/system/sol
//   /galaxy/milky-way/system/sol/planet/mars
//   /galaxy/milky-way/system/sol/planet/mars/garden

export type Level = "universe" | "galaxy" | "system" | "planet" | "garden";

export interface ExploreRoute {
  level: Level;
  galaxyId?: string;
  starId?: string;
  planetId?: string;
}

const galaxySlug = (id: string) => id.replace(/_/g, "-");
const galaxyFromSlug = (slug: string) => slug.replace(/-/g, "_");
const starSlug = (id: string) => (id === "sun" ? "sol" : id);
const starFromSlug = (slug: string) => (slug === "sol" ? "sun" : slug);

export function pathFor(route: ExploreRoute): string {
  if (route.level === "universe" || !route.galaxyId) return "/universe";
  let path = `/galaxy/${galaxySlug(route.galaxyId)}`;
  if (route.level === "galaxy" || !route.starId) return path;
  path += `/system/${encodeURIComponent(starSlug(route.starId))}`;
  if (route.level === "system" || !route.planetId) return path;
  path += `/planet/${encodeURIComponent(route.planetId)}`;
  return route.level === "garden" ? `${path}/garden` : path;
}

export function parsePath(pathname: string): ExploreRoute {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== "galaxy" || !parts[1]) return { level: "universe" };
  const route: ExploreRoute = { level: "galaxy", galaxyId: galaxyFromSlug(parts[1]) };
  if (parts[2] === "system" && parts[3]) {
    route.level = "system";
    route.starId = starFromSlug(parts[3]);
    if (parts[4] === "planet" && parts[5]) {
      route.level = "planet";
      route.planetId = parts[5];
      if (parts[6] === "garden") route.level = "garden";
    }
  }
  return route;
}
