import { create } from "zustand";
import i18n from "@/i18n";
import type { IconName } from "@/ui/icons";
import type { Irrigation, Slot } from "./api";

export const PRIORITY_CHIPS: { id: string; icon: IconName; label: string }[] = [
  { id: "water", icon: "drop", get label() { return i18n.t("priority.water"); } },
  { id: "income", icon: "coin", get label() { return i18n.t("priority.income"); } },
  { id: "soil", icon: "shovel", get label() { return i18n.t("priority.soil"); } },
  { id: "risk", icon: "shield", get label() { return i18n.t("priority.risk"); } },
];

export const STRESS: { id: string; icon: IconName; label: string }[] = [
  { id: "plus15_dry", icon: "thermometer", get label() { return i18n.t("scenario.plus15_dry"); } },
  { id: "dry_springs", icon: "drop", get label() { return i18n.t("scenario.dry_springs"); } },
  { id: "hot_days", icon: "sun", get label() { return i18n.t("scenario.hot_days"); } },
];

const empty = (n: number): Slot[] => Array.from({ length: n }, () => [null, null] as Slot);

interface BuilderState {
  fid: string | null;
  plan: Slot[];
  past: Slot[][];
  future: Slot[][];
  priorities: string[];
  scenario: string;
  startYear: number | null; // weather year for playback (dice / 20-years grid)
  irrigation: Record<string, Irrigation>; // chosen per field (default: the field's own)
  budget: number | null; // money for the start of a season, $/ha
  labour: number | null; // hand labour per season, person-days/ha
  setLimits: (budget: number | null, labour: number | null) => void;
  setIrrigation: (fid: string, m: Irrigation) => void;
  advice: { plan: Slot[]; reasons: { main: string | null; cover: string | null }[]; label: string } | null;
  reset: (fid: string, years?: number) => void;
  setPlan: (plan: Slot[], record?: boolean) => void;
  put: (year: number, slot: 0 | 1, crop: string | null) => void;
  undo: () => void;
  redo: () => void;
  togglePriority: (id: string) => void;
  setScenario: (s: string) => void;
  setStartYear: (y: number | null) => void;
  setAdvice: (a: BuilderState["advice"]) => void;
}

export const useBuilder = create<BuilderState>((set, get) => ({
  fid: null,
  plan: empty(4),
  past: [],
  future: [],
  priorities: ["water", "soil"],
  scenario: "history",
  startYear: null,
  advice: null,
  irrigation: {},
  budget: null,
  labour: null,
  setLimits: (budget, labour) => set({ budget, labour, advice: null }),
  setIrrigation: (fid, m) => set((s) => ({ irrigation: { ...s.irrigation, [fid]: m }, advice: null })),
  reset: (fid, years = 4) => set({ fid, plan: empty(years), past: [], future: [], advice: null, startYear: null, scenario: "history" }),
  setPlan: (plan, record = true) =>
    set((s) => ({ plan, past: record ? [...s.past.slice(-49), s.plan] : s.past, future: record ? [] : s.future })),
  put: (year, slot, crop) => {
    const plan = get().plan.map((p) => [...p] as Slot);
    plan[year][slot] = crop;
    get().setPlan(plan);
  },
  undo: () =>
    set((s) => (s.past.length ? { plan: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.plan, ...s.future] } : s)),
  redo: () => set((s) => (s.future.length ? { plan: s.future[0], future: s.future.slice(1), past: [...s.past, s.plan] } : s)),
  togglePriority: (id) =>
    set((s) => {
      const has = s.priorities.includes(id);
      const next = has ? s.priorities.filter((x) => x !== id) : [...s.priorities, id].slice(-2);
      return { priorities: next.length ? next : s.priorities };
    }),
  setScenario: (scenario) => set({ scenario }),
  setStartYear: (startYear) => set({ startYear }),
  setAdvice: (advice) => set({ advice }),
}));

/** Plan as a short string for sharing links: "cotton.,chickpea.vetch,…". */
export const encodePlan = (plan: Slot[]) => plan.map(([m, c]) => `${m ?? ""}.${c ?? ""}`).join(",");
export const decodePlan = (s: string | null): Slot[] | null => {
  if (!s) return null;
  const out = s.split(",").map((x) => {
    const [m, c] = x.split(".");
    return [m || null, c || null] as Slot;
  });
  return out.length >= 1 && out.length <= 6 ? out : null;
};

export const IRRIGATION: { id: Irrigation; label: string }[] = [
  { id: "none", get label() { return i18n.t("irrigation.none"); } },
  { id: "furrow", get label() { return i18n.t("irrigation.furrow"); } },
  { id: "drip", get label() { return i18n.t("irrigation.drip"); } },
];
