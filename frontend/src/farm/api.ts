import type * as GeoJSON from "geojson";
import { useLang } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";

export interface FieldRec {
  id: string;
  name: string;
  region: string | null;
  demo: boolean;
  note: string | null;
  geometry: GeoJSON.Polygon;
  area_ha: number;
  centroid: [number, number];
}

export interface DataLayer {
  id: string;
  source: string;
  what: string;
  space: string;
  time: string;
  coverage: string | null;
  missing_share: number;
  coarse: boolean;
  pixel_to_field: number | null;
  status: "ok" | "cached" | "missing" | "failed" | "no_access" | "not_loaded";
  retrieved_at: string | null;
  notes: string[];
  values?: Record<string, number | null> | null;
  elevation_m?: number | null;
}

export interface RotCropInfo {
  id: string;
  name_ru: string;
  family: string;
  family_ru: string;
  is_cover: boolean;
  is_legume: boolean;
  season_days: number;
  sow_mmdd: string | null;
  root_depth_m: number;
  min_break_years: number;
  ymax_t_ha: number;
  estimate: boolean;
  references: string[];
}

export interface YearResult {
  year: number;
  crop: string | null;
  cover: string | null;
  yield_t_ha: number;
  yield_rel: number;
  factors: Record<string, number>;
  eta_mm: number;
  irrigation_mm: number;
  precip_mm: number;
  runoff_mm: number;
  drainage_mm: number;
  n_leached_kg_ha: number;
  n_fixed_kg_ha: number;
  n_mineral_end: number;
  soc_pct_end: number;
  erosion_t_ha: number;
  bare_days: number;
  heat_days: number;
  frost_kill: boolean;
  cover_biomass_kg_ha: number;
  infiltration_idx: number;
  pest_pressure: number;
  weather_year: number;
  events: string[];
}

export interface RuleViolation {
  code: string;
  level: "warning" | "error";
  year: number;
  message_ru: string;
}

export interface RunResult {
  site: { texture: string; soc_pct: number; slope_pct: number; k_factor: number; ls: number };
  years: YearResult[];
  soil_cover_weekly: number[];
  rules: RuleViolation[];
}

export function useFields() {
  const l = useLang();
  return useQuery({ queryKey: ["fields", l], queryFn: () => unwrap(api.GET("/fields", { params: { query: { lang: l } } })) as unknown as Promise<FieldRec[]> });
}

export function useDataCard(fid: string | undefined) {
  return useQuery({
    queryKey: ["fields", fid, "data-card"],
    enabled: !!fid,
    staleTime: Infinity,
    queryFn: () =>
      unwrap(api.GET("/fields/{fid}/data-card", { params: { path: { fid: fid! }, query: {} } })) as unknown as Promise<{
        field: FieldRec;
        layers: DataLayer[];
      }>,
  });
}

export function useRotationCrops() {
  return useQuery({
    queryKey: ["rotation", "crops"],
    staleTime: Infinity,
    queryFn: () => unwrap(api.GET("/rotation/crops")) as unknown as Promise<RotCropInfo[]>,
  });
}

export async function createField(name: string, geometry: GeoJSON.Polygon): Promise<FieldRec> {
  return (await unwrap(api.POST("/fields", { body: { name, geometry: geometry as unknown as Record<string, never> } }))) as unknown as FieldRec;
}

export async function runRotation(
  fid: string,
  body: { plan: [string | null, string | null][]; fert: Record<string, number>; irrigated: boolean; irrigation_limit_mm: number; start_year?: number },
): Promise<RunResult> {
  return (await unwrap(
    api.POST("/fields/{fid}/rotation/run", { params: { path: { fid } }, body: body as never }),
  )) as unknown as RunResult;
}
