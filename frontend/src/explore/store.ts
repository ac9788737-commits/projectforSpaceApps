import type CameraControlsImpl from "camera-controls";
import { create } from "zustand";

export type Scenario = "open_surface" | "greenhouse" | "closed_farm";
export type Quality = "high" | "low";

export interface WhatIf {
  dome: boolean;
  led: boolean;
  heating: boolean;
}

export interface Bed {
  crop: string | null;
  scenario: Scenario;
  whatIf: WhatIf;
}

export const BED_COUNT = 9;
export const NO_WHAT_IF: WhatIf = { dome: false, led: false, heating: false };

const emptyBeds = (): Bed[] =>
  Array.from({ length: BED_COUNT }, () => ({
    crop: null,
    scenario: "open_surface" as Scenario,
    whatIf: { ...NO_WHAT_IF },
  }));

export interface StarFilters {
  hzOnly: boolean;
  starClass: string;
  maxDistancePc: number;
}

export type Mood = "space" | "garden";

interface ExploreState {
  // Interface temperature (docs/DESIGN.md §1)
  mood: Mood;
  setMood: (mood: Mood) => void;
  landing: boolean;
  setLanding: (landing: boolean) => void;

  // Rendering
  quality: Quality;
  qualityLocked: boolean;
  setQuality: (quality: Quality, locked?: boolean) => void;
  controls: CameraControlsImpl | null;
  setControls: (controls: CameraControlsImpl | null) => void;
  fade: number;
  fadeColor: string;
  setFade: (fade: number, color?: string) => void;
  realScale: boolean;
  setRealScale: (value: boolean) => void;
  focus: [number, number, number] | null; // depth-of-field target in close-up
  setFocus: (focus: [number, number, number] | null) => void;
  highlight: string | null; // object hovered in the scene or focused in the list
  setHighlight: (id: string | null) => void;

  // Galaxy filters
  filters: StarFilters;
  setFilters: (patch: Partial<StarFilters>) => void;

  // Garden
  gardenPlanet: string | null;
  beds: Bed[];
  selectedBed: number;
  closeup: boolean;
  setGardenPlanet: (planetId: string) => void;
  selectBed: (index: number) => void;
  setCloseup: (value: boolean) => void;
  plant: (index: number, crop: string | null) => void;
  setScenario: (index: number, scenario: Scenario) => void;
  setWhatIf: (index: number, patch: Partial<WhatIf>) => void;

  // Simulated time (in timeline steps = local days)
  day: number;
  playing: boolean;
  speed: 1 | 5 | 20;
  maxDay: number;
  setDay: (day: number) => void;
  setMaxDay: (day: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: 1 | 5 | 20) => void;
}

export const useExplore = create<ExploreState>((set) => ({
  mood: "space",
  setMood: (mood) => set({ mood }),
  landing: false,
  setLanding: (landing) => set({ landing }),
  quality: "high",
  qualityLocked: false,
  setQuality: (quality, locked = false) => set({ quality, qualityLocked: locked }),
  controls: null,
  setControls: (controls) => set({ controls }),
  fade: 0,
  fadeColor: "var(--bg-void)",
  setFade: (fade, color) => set(color ? { fade, fadeColor: color } : { fade }),
  realScale: false,
  setRealScale: (realScale) => set({ realScale }),
  focus: null,
  setFocus: (focus) => set({ focus }),
  highlight: null,
  setHighlight: (highlight) => set({ highlight }),

  filters: { hzOnly: false, starClass: "", maxDistancePc: 10_000 },
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),

  gardenPlanet: null,
  beds: emptyBeds(),
  selectedBed: 4,
  closeup: false,
  setGardenPlanet: (planetId) =>
    set((s) =>
      s.gardenPlanet === planetId
        ? {}
        : { gardenPlanet: planetId, day: 0, playing: false, closeup: false, maxDay: 0 },
    ),
  selectBed: (selectedBed) => set({ selectedBed }),
  setCloseup: (closeup) => set({ closeup }),
  plant: (index, crop) =>
    set((s) => ({
      beds: s.beds.map((bed, i) => (i === index ? { ...bed, crop, whatIf: { ...NO_WHAT_IF } } : bed)),
      day: 0,
      playing: false,
    })),
  setScenario: (index, scenario) =>
    set((s) => ({
      beds: s.beds.map((bed, i) =>
        i === index ? { ...bed, scenario, whatIf: { ...NO_WHAT_IF } } : bed,
      ),
      day: 0,
      playing: false,
    })),
  setWhatIf: (index, patch) =>
    set((s) => ({
      beds: s.beds.map((bed, i) =>
        i === index ? { ...bed, whatIf: { ...bed.whatIf, ...patch } } : bed,
      ),
    })),

  day: 0,
  playing: false,
  speed: 1,
  maxDay: 0,
  setDay: (day) => set({ day }),
  setMaxDay: (maxDay) => set({ maxDay }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
}));

/** Scenario and overrides actually simulated for a bed, after "what if" toggles. */
export function effectiveBed(bed: Bed): {
  scenario: Scenario;
  overrides: { supplemental_ppfd_umol_m2_s: number; heating_k: number } | null;
} {
  const scenario = bed.whatIf.dome && bed.scenario === "open_surface" ? "greenhouse" : bed.scenario;
  const led = bed.whatIf.led ? LED_BOOST_UMOL : 0;
  const heat = bed.whatIf.heating ? HEATING_K : 0;
  return {
    scenario,
    overrides: led || heat ? { supplemental_ppfd_umol_m2_s: led, heating_k: heat } : null,
  };
}

export const LED_BOOST_UMOL = 300;
export const HEATING_K = 15;

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
