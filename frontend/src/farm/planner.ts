import { useQuery } from "@tanstack/react-query";
import { useLang } from "@/i18n";
import { create } from "zustand";
import { api, unwrap } from "@/api/client";

export const PRIORITIES: { id: string; label: string; hint: string }[] = [
  { id: "yield", label: "Урожай", hint: "% от потенциала культур" },
  { id: "income", label: "Доход", hint: "маржа на гектар" },
  { id: "water", label: "Экономия воды", hint: "меньше полива" },
  { id: "feed", label: "Корма", hint: "белок с гектара" },
  { id: "soil", label: "Органика и азот", hint: "рост гумуса, азот в почве" },
  { id: "erosion", label: "Меньше эрозии", hint: "эрозия и голая почва" },
  { id: "risk", label: "Низкий риск провала", hint: "неурожайные годы" },
  { id: "labour", label: "Меньше труда", hint: "часы на гектар" },
];

export const PRESETS: { id: string; label: string; weights: Record<string, number> }[] = [
  { id: "water", label: "Водосбережение", weights: { water: 5, risk: 3, income: 2, yield: 2 } },
  { id: "feed", label: "Корма для скота", weights: { feed: 5, yield: 3, risk: 2, income: 1 } },
  { id: "soil", label: "Восстановление почвы", weights: { soil: 5, erosion: 4, risk: 2, income: 1 } },
  { id: "income", label: "Максимум дохода", weights: { income: 5, risk: 3, yield: 2 } },
];

export const MACHINERY: { id: string; label: string }[] = [
  { id: "small_seed_drill", label: "Сеялка для мелкосемянных (люцерна, клевер, горчица)" },
  { id: "potato_digger", label: "Картофелекопалка" },
  { id: "cotton_picker", label: "Хлопкоуборочная машина" },
];

export interface Profile {
  weights: Record<string, number>;
  years: number;
  horizon: number | null;
  allowed: string[] | null;
  required: string[];
  forbidden: string[];
  sellable: string[] | null;
  machinery: string[];
  irrigated: boolean;
  water_limit_m3_ha: number;
  budget_usd_ha: number | null;
  prices: Record<string, number>;
  scenario: string;
  d_temp_c: number | null;
  d_precip: number | null;
  d_heat_c: number | null;
}

export const DEFAULT_PROFILE: Profile = {
  weights: { yield: 3, income: 3, risk: 3 },
  years: 4,
  horizon: null,
  allowed: null,
  required: [],
  forbidden: [],
  sellable: null,
  machinery: ["small_seed_drill"],
  irrigated: false,
  water_limit_m3_ha: 0,
  budget_usd_ha: null,
  prices: {},
  scenario: "history",
  d_temp_c: null,
  d_precip: null,
  d_heat_c: null,
};

type Dist = { p10: number; p50: number; p90: number };
export interface Scheme {
  id: string;
  rank: number;
  score: number;
  pareto: boolean;
  plan: { main: string | null; cover: string | null; main_ru: string; cover_ru: string | null; family: string | null; sow: string | null }[];
  metrics: Record<string, Dist>;
  crop_yields: Record<string, Dist>;
  contributions: Record<string, number>;
  annual_cost_usd_ha: number;
  rules: string[];
  trajectory: { soc_pct: number[]; n_mineral: number[]; bare_days: number[]; cover_weekly: number[] };
  explanation: string;
}

export interface PlanResult {
  n_candidates: number;
  n_weather_years: number;
  schemes: Scheme[];
  pareto_ids: string[];
  all_points: ({ id: string } & Record<string, number>)[];
  metrics: Record<string, { direction: number; label: string }>;
  economics_refs: string[];
  scenario: { id: string; name_ru: string; d_temp_c: number; d_precip: number; d_heat_c: number };
  weather_notes: string[];
  message?: string;
}

interface PlannerState {
  profile: Profile;
  chosen: string | null;
  set: (p: Partial<Profile>) => void;
  choose: (id: string | null) => void;
}

export const usePlanner = create<PlannerState>((set) => ({
  profile: DEFAULT_PROFILE,
  chosen: null,
  set: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),
  choose: (chosen) => set({ chosen }),
}));

export function usePlan(fid: string, profile: Profile, enabled: boolean) {
  return useQuery({
    queryKey: ["fields", fid, "plan", profile],
    enabled,
    staleTime: Infinity,
    queryFn: () => unwrap(api.POST("/fields/{fid}/plan", { params: { path: { fid } }, body: profile as never })) as unknown as Promise<PlanResult>,
  });
}

export interface Economics {
  crops: Record<string, { price_usd_t: number; seed_usd_ha: number; ops_usd_ha: number; labour_h_ha: number; machinery: string | null; estimate: boolean; reference: string }>;
  n_usd_kg: number;
  water_usd_m3: number;
  references: string[];
}

export function useEconomics() {
  return useQuery({ queryKey: ["economics"], staleTime: Infinity, queryFn: () => unwrap(api.GET("/economics")) as unknown as Promise<Economics> });
}

export interface Gaps {
  data: string[];
  model: string[];
  checklist: string[];
  disclaimer: string;
}

export function useGaps(fid: string) {
  const l = useLang();
  return useQuery({
    queryKey: ["fields", fid, "gaps", l],
    staleTime: Infinity,
    queryFn: () => unwrap(api.GET("/fields/{fid}/gaps", { params: { path: { fid }, query: { lang: l } } })) as unknown as Promise<Gaps>,
  });
}

/** Colour of a crop family (design tokens only). */
/** Seed-packet colours by family (docs/DESIGN.md §2.3) — one table for the whole product. */
export { FAMILY_COLOR } from "@/ui/crops";
