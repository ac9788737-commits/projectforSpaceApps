import { create } from "zustand";

export type FarmMode = "sandbox" | "scenario" | "experiment" | "challenge";
export type Protection = "open" | "greenhouse" | "closed";
export type Irrigation = "rain" | "auto";

export interface FarmEnv {
  temp_c: number;
  rh: number;
  precip_mm: number;
  ppfd: number;
  wind_ms: number;
  uv_rel: number;
  hail: number;
  flood: number;
}

export const PLOT_IDS = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"] as const;

interface FarmState {
  mode: FarmMode;
  setMode: (mode: FarmMode) => void;
  world: string | null; // world id of the farm (null: derived from the planet)
  setWorld: (world: string | null) => void;
  irrigation: Irrigation[]; // per bed
  setIrrigation: (index: number, value: Irrigation) => void;
  pendingOverrides: Record<string, number | string>; // conditions chosen before planting
  setPending: (patch: Record<string, number | string>) => void;
  scheduled: Record<string, unknown>[]; // events planned before a session exists (scenario mode, challenges)
  setScheduled: (events: Record<string, unknown>[]) => void;
  seed: number;

  sessionId: string | null;
  version: number;
  reportDayHours: number;
  endHour: number;
  serverHour: number;
  serverAt: number;
  hour: number;
  env: FarmEnv | null;
  setSession: (id: string | null, reportDayHours?: number, endHour?: number) => void;
  applyFrame: (frame: { version: number; hour: number; env: FarmEnv }) => void;
  setHour: (hour: number) => void;
  setEndHour: (hour: number) => void;

  interventions: number;
  addIntervention: () => void;
  challengeId: string | null;
  setChallenge: (id: string | null) => void;
  reportOpen: boolean;
  setReportOpen: (open: boolean) => void;
}

export const useFarm = create<FarmState>((set) => ({
  mode: "sandbox",
  setMode: (mode) => set({ mode }),
  world: null,
  setWorld: (world) => set({ world }),
  irrigation: PLOT_IDS.map(() => "rain" as Irrigation),
  setIrrigation: (index, value) => set((s) => ({ irrigation: s.irrigation.map((v, i) => (i === index ? value : v)) })),
  pendingOverrides: {},
  setPending: (patch) => set((s) => ({ pendingOverrides: { ...s.pendingOverrides, ...patch } })),
  scheduled: [],
  setScheduled: (scheduled) => set({ scheduled }),
  seed: 42,

  sessionId: null,
  version: 0,
  reportDayHours: 24,
  endHour: 0,
  serverHour: 0,
  serverAt: 0,
  hour: 0,
  env: null,
  setSession: (sessionId, reportDayHours = 24, endHour = 0) =>
    set({ sessionId, reportDayHours, endHour, hour: 0, serverHour: 0, serverAt: performance.now(), env: null, version: 0 }),
  applyFrame: (frame) => set({ version: frame.version, serverHour: frame.hour, serverAt: performance.now(), env: frame.env }),
  setHour: (hour) => set({ hour }),
  setEndHour: (endHour) => set({ endHour }),

  interventions: 0,
  addIntervention: () => set((s) => ({ interventions: s.interventions + 1 })),
  challengeId: null,
  setChallenge: (challengeId) => set({ challengeId, interventions: 0 }),
  reportOpen: false,
  setReportOpen: (reportOpen) => set({ reportOpen }),
}));

export const protectionOf = (scenario: string): Protection =>
  scenario === "greenhouse" ? "greenhouse" : scenario === "closed_farm" ? "closed" : "open";

/** Default starting world for a catalogue planet. */
export function worldForPlanet(planetId: string): string {
  if (planetId === "earth") return "earth:temperate";
  if (["mars", "moon", "titan"].includes(planetId)) return planetId;
  return `planet:${planetId}`;
}
