import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, unwrap } from "@/api/client";
import { lang, useLang } from "@/i18n";

export type Slot = [string | null, string | null]; // [main, cover]
export type Level = "good" | "ok" | "bad";
export type Irrigation = "none" | "furrow" | "drip";

export interface Card {
  id: string;
  name_ru: string;
  family: string;
  family_ru: string;
  is_cover: boolean;
  is_legume: boolean;
  min_break_years: number;
  allow_consecutive: boolean;
  root_depth_m: number;
  water: string; // «мало / средне / много» in the request language
  hint: string;
  hints: string[];
  estimate: boolean;
  needs_water?: boolean;
  start_cost_usd: number;
  labour_days: number;
  expensive: boolean;
}

export interface Indicator {
  key: "water" | "money" | "soil" | "risk";
  value: number;
  unit: string;
  level: Level;
  irrigated?: boolean;
  detail: Record<string, number | boolean | Record<string, number>>;
}

export interface Week {
  year: number;
  month: number;
  crop: string | null;
  is_cover: boolean;
  stage: "ini" | "dev" | "mid" | "late" | null;
  canopy: number;
  soil_cover: number;
  water: number;
  soc_pct: number;
  n_mineral: number;
  erosion_cum: number;
  rain: number;
  storm: boolean;
  tmax: number;
  heat: boolean;
  frost: boolean;
  pest: number;
}

export interface Link {
  kind: "nitrogen" | "erosion" | "warning";
  good: boolean;
  from: { year: number; slot: "main" | "cover" };
  to: { year: number; slot: "main" | "cover" } | null;
  text: string;
}

export interface Quick {
  plan: Slot[];
  scenario: string;
  indicators: Record<"water" | "money" | "soil" | "risk", Indicator>;
  outcomes: { start_year: number; score: number; class: "good" | "ok" | "fail" }[];
  summary: { good_years: number; ok_years: number; fail_years: number; n_years: number };
  years: { crop: string | null; cover: string | null; yield_t_ha: number; normal_t_ha: number; cover_biomass_t_ha: number; sow: string | null }[];
  links: Link[];
  playback: { start_year: number; weather_years: number[]; weeks: Week[]; captions: { week: number; year: number; month: number; weight: number; text: string }[] };
  soil_reserve: { year: number; value: number; soc_pct: number; n_kg: number; pest_pct: number }[];
  costs: { start_usd: number; labour_days: number }[];
  salinity: { risk: boolean; reasons: string[]; text: string | null };
  cover_notes: { year: number; end: string; next_sow: string; dry: boolean; text: string }[];
  economy: {
    years: number;
    tonnes: Record<string, number>;
    n_kg: number;
    water_m3: number;
    prices: Record<string, number>;
    world_prices: Record<string, number>;
    n_usd_kg: number;
    water_usd_m3: number;
    world_n_usd_kg: number;
    world_water_usd_m3: number;
  };
  work_calendar: { kind: string; label: string; start: number; end: number }[];
  names: Record<string, string>;
  estimate_note: string;
}

export interface FieldInfo {
  id: string;
  name: string;
  region: string | null;
  demo: boolean;
  card_ru: string | null;
  irrigated: boolean;
  irrigation_method: Irrigation;
  water_limit_m3_ha: number;
  current_plan: Slot[] | null;
  farmer: string | null;
  story_ru: string | null;
  area_ha: number;
  centroid: [number, number];
  geometry: unknown;
}

export interface Passport {
  trends: { label: string; text: string; changed: boolean }[];
  cards: { icon: string; title: string; text: string; level: Level }[];
  calendar: { year: number; precip_mm: number; notes: string[]; months: { heat: number; storm: number; drought: boolean; cover: "bare" | "covered" | null }[] }[];
  sources: { icon: string; text: string; ok: boolean }[];
}

export function useDeck(fid?: string) {
  const l = useLang();
  return useQuery({
    queryKey: ["rotation", "deck", fid, l],
    staleTime: Infinity,
    queryFn: () => unwrap(api.GET("/rotation/deck", { params: { query: { field_id: fid, lang: l } } })) as unknown as Promise<Card[]>,
  });
}

export function useField(fid: string | undefined) {
  const l = useLang();
  return useQuery({
    queryKey: ["fields", fid, l],
    enabled: !!fid,
    staleTime: Infinity,
    queryFn: () => unwrap(api.GET("/fields/{fid}", { params: { path: { fid: fid! }, query: { lang: l } } })) as unknown as Promise<FieldInfo>,
  });
}

export function usePassport(fid: string | undefined) {
  const l = useLang();
  return useQuery({
    queryKey: ["fields", fid, "passport", l],
    enabled: !!fid,
    staleTime: Infinity,
    queryFn: () => unwrap(api.GET("/fields/{fid}/passport", { params: { path: { fid: fid! }, query: { lang: l } } })) as unknown as Promise<Passport>,
  });
}

/** Value that follows `value` after `ms` of quiet (drag storms send one request). */
export function useDebounced<T>(value: T, ms: number): T {
  // keyed by content: re-renders with an equal value (e.g. during playback) must not restart the timer
  const key = JSON.stringify(value);
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(JSON.parse(key) as T), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return v;
}

export function useQuick(field: FieldInfo | undefined, plan: Slot[], scenario: string, startYear: number | null, irrigation: Irrigation, prices: Record<string, number> = {}) {
  const crops = Object.fromEntries(Object.entries(prices).filter(([k]) => !k.startsWith("_")));
  const extra = { ...crops, ...(prices._n != null ? { _n_fertiliser: prices._n * 1000 } : {}), ...(prices._water != null ? { _water: prices._water } : {}) };
  const l = useLang();
  const body = useDebounced(
    field ? { lang: l, field_id: field.id, plan, irrigation, water_limit_m3_ha: field.water_limit_m3_ha, scenario, start_year: startYear, prices: extra } : null,
    100,
  );
  // decide on the debounced plan: the request must never go out for an older, empty plan
  const filled = !!body && body.plan.some(([m]) => m);
  return useQuery({
    queryKey: ["rotation", "quick", body],
    enabled: filled,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    queryFn: () => unwrap(api.POST("/rotation/quick", { body: body as never })) as unknown as Promise<Quick>,
  });
}

export async function fetchAdvice(field: FieldInfo, priorities: string[], years: number, irrigation: Irrigation, budget: number | null = null, labour: number | null = null) {
  return (await unwrap(
    api.POST("/rotation/advice", {
      body: { lang: lang(), field_id: field.id, priorities, years, irrigation, water_limit_m3_ha: field.water_limit_m3_ha, budget_usd_ha: budget, labour_days_max: labour } as never,
    }),
  )) as unknown as { plan: Slot[]; reasons: { main: string | null; cover: string | null }[]; label: string };
}

export async function fetchQuick(field: FieldInfo, plan: Slot[], scenario: string, irrigation: Irrigation) {
  return (await unwrap(
    api.POST("/rotation/quick", {
      body: { lang: lang(), field_id: field.id, plan, irrigation, water_limit_m3_ha: field.water_limit_m3_ha, scenario } as never,
    }),
  )) as unknown as Quick;
}

export async function fetchFix(field: FieldInfo, plan: Slot[], year: number, slot: 0 | 1, priorities: string[], irrigation: Irrigation, budget: number | null) {
  return (await unwrap(
    api.POST("/rotation/fix", {
      body: { lang: lang(), field_id: field.id, plan, year, slot, priorities, irrigation, water_limit_m3_ha: field.water_limit_m3_ha, budget_usd_ha: budget } as never,
    }),
  )) as unknown as { crop: string; name_ru: string; indicators: Record<string, number> }[];
}
