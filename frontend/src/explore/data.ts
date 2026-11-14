import { useQueries, useQuery } from "@tanstack/react-query";
import { api, unwrap, type Crop } from "@/api/client";
import type { components } from "@/api/schema";
import { effectiveBed, type Bed } from "./store";

type S = components["schemas"];
export type Universe = S["UniverseOut"];
export type GalaxyInfo = S["GalaxyOut"];
export type GalaxyScene = S["GalaxySceneOut"];
export type GalaxyStar = S["GalaxyStarOut"];
export type SystemScene = S["SystemSceneOut"];
export type SystemPlanet = S["SystemPlanetOut"];
export type PlanetScene = S["PlanetSceneOut"];
export type Timeline = S["TimelineOut"];
export type PlantStateOut = S["PlantStateOut"];
export type TimelineEvent = S["TimelineEventOut"];

const forever = { staleTime: Infinity };

export const useUniverse = () =>
  useQuery({ queryKey: ["scene", "universe"], queryFn: () => unwrap(api.GET("/scene/universe")), ...forever });

export const useGalaxy = (id: string | undefined) =>
  useQuery({
    queryKey: ["scene", "galaxy", id],
    enabled: !!id,
    queryFn: () => unwrap(api.GET("/scene/galaxy/{galaxy_id}", { params: { path: { galaxy_id: id! } } })),
    ...forever,
  });

export const useSystem = (id: string | undefined) =>
  useQuery({
    queryKey: ["scene", "system", id],
    enabled: !!id,
    queryFn: () => unwrap(api.GET("/scene/system/{star_id}", { params: { path: { star_id: id! } } })),
    ...forever,
  });

export const usePlanetScene = (id: string | undefined) =>
  useQuery({
    queryKey: ["scene", "planet", id],
    enabled: !!id,
    queryFn: () =>
      unwrap(api.GET("/scene/planet/{planet_id}", { params: { path: { planet_id: id! } } })),
    ...forever,
  });

export const useCrops = () =>
  useQuery({ queryKey: ["crops"], queryFn: () => unwrap(api.GET("/crops")), ...forever });

export function timelineRequest(planetId: string, bed: Bed) {
  const { scenario, overrides } = effectiveBed(bed);
  return {
    planet_id: planetId,
    crop_id: bed.crop!,
    scenario,
    overrides,
    seed: 42,
    events: true,
    monte_carlo_n: 1000,
  };
}

export const fetchTimeline = (body: ReturnType<typeof timelineRequest>) =>
  unwrap(api.POST("/simulate/timeline", { body }));

/** One timeline query per planted bed; empty beds yield `undefined`. */
export function useBedTimelines(planetId: string | undefined, beds: Bed[]) {
  return useQueries({
    queries: beds.map((bed, index) => {
      const body = planetId && bed.crop ? timelineRequest(planetId, bed) : null;
      return {
        queryKey: body ? ["timeline", body] : ["timeline", "empty", index],
        enabled: !!body,
        queryFn: () => fetchTimeline(body!),
        ...forever,
      };
    }),
  });
}

export function cropById(crops: Crop[] | undefined, id: string | null): Crop | undefined {
  return id ? crops?.find((c) => c.id === id) : undefined;
}
