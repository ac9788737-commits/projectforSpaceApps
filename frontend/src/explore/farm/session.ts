import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { api, unwrap, type Crop } from "@/api/client";
import type { components } from "@/api/schema";
import { useToasts, type EventType } from "@/ui/time";
import { useExplore, type Bed } from "../store";
import { PLOT_IDS, protectionOf, useFarm, worldForPlanet, type FarmEnv } from "./store";

type S = components["schemas"];
export type SessionState = S["SessionOut"];
export type Trajectory = S["TrajectoryOut"];
export type DayRecord = Record<string, unknown> & {
  day: number;
  stage: string;
  health: number;
  yieldG: number;
  biomassG: number;
  stresses: { cause: string; label: string; value: number }[];
  damage: Record<string, number>;
  ks: number;
  water_mm: number;
  t_min_c: number | null;
  t_max_c: number | null;
  factors: Record<string, number>;
  limiting_factor: string;
  limiting_f: number;
};
export interface Catalog {
  worlds: { id: string; name_ru: string }[];
  parameters: { key: string; label: string; group: string; unit: string; min?: number; max?: number; step?: number; options?: [string, string][] }[];
  events: { id: string; name_ru: string; unit: string; levels: Record<string, number>; default_hours: number; harm_ru: string }[];
  actions: { id: string; name_ru: string; param: string | null; default: number | null }[];
}

export const useCatalog = () =>
  useQuery({ queryKey: ["sim", "catalog"], queryFn: () => unwrap(api.GET("/sim/catalog")) as unknown as Promise<Catalog>, staleTime: Infinity });

export const useWorld = (worldId: string | null) =>
  useQuery({
    queryKey: ["sim", "world", worldId],
    enabled: !!worldId,
    staleTime: Infinity,
    queryFn: () => unwrap(api.GET("/sim/worlds/{world_id}", { params: { path: { world_id: worldId! } } })) as unknown as Promise<Record<string, number | string | boolean>>,
  });

/** Season long enough for the slowest crop planted (local days). */
export function seasonDays(beds: Bed[], crops: Crop[] | undefined): number {
  const cycles = beds.filter((b) => b.crop).map((b) => crops?.find((c) => c.id === b.crop)?.cycle_days ?? 100);
  return Math.min(300, Math.max(30, Math.ceil(Math.max(60, ...cycles) * 1.5)));
}

export function scenarioFor(world: string, beds: Bed[], crops: Crop[] | undefined) {
  const farm = useFarm.getState();
  return {
    version: 1,
    world,
    seed: farm.seed,
    duration_days: seasonDays(beds, crops),
    crops: beds
      .map((b, i) => (b.crop ? { crop: b.crop, plot: PLOT_IDS[i], protection: protectionOf(b.scenario), irrigation: farm.irrigation[i] } : null))
      .filter((x): x is NonNullable<typeof x> => x !== null),
    overrides: farm.pendingOverrides,
    live_overrides: [],
    events: farm.scheduled,
    actions: [],
  };
}

interface SharedScenario {
  world: string;
  seed?: number;
  crops: { crop: string; plot: string; protection: string; irrigation: "rain" | "auto" }[];
  overrides?: Record<string, number>;
  events?: Record<string, unknown>[];
}

const SCENARIO_OF_PROTECTION: Record<string, Bed["scenario"]> = { open: "open_surface", greenhouse: "greenhouse", closed: "closed_farm" };

/** Puts a saved scenario into the garden: beds, irrigation, world, conditions, events. */
export function applySavedScenario(sc: SharedScenario) {
  const ex = useExplore.getState();
  ex.beds.forEach((_, i) => ex.plant(i, null));
  const farm = useFarm.getState();
  for (const c of sc.crops) {
    const i = (PLOT_IDS as readonly string[]).indexOf(c.plot);
    if (i < 0) continue;
    ex.setScenario(i, SCENARIO_OF_PROTECTION[c.protection] ?? "open_surface");
    ex.plant(i, c.crop);
    farm.setIrrigation(i, c.irrigation);
  }
  useFarm.setState({ mode: "scenario", world: sc.world, seed: sc.seed ?? farm.seed, pendingOverrides: sc.overrides ?? {}, scheduled: sc.events ?? [] });
}

const TOAST_TYPES: Record<string, EventType> = {
  germination: "germination",
  flowering: "flowering",
  organ_init: "organ_init",
  harvest: "harvest",
  death: "death",
};

/**
 * One live session per garden: created when beds are planted, re-created when the
 * planting changes; frames stream over a WebSocket and move the shared clock.
 */
export function useFarmSession(planetId: string | undefined, crops: Crop[] | undefined) {
  const beds = useExplore((s) => s.beds);
  const world = useFarm((s) => s.world) ?? (planetId ? worldForPlanet(planetId) : null);
  const irrigation = useFarm((s) => s.irrigation);
  const scheduled = useFarm((s) => s.scheduled);
  const pending = useFarm((s) => s.pendingOverrides);
  const sessionId = useFarm((s) => s.sessionId);
  const version = useFarm((s) => s.version);
  const qc = useQueryClient();
  const ws = useRef<WebSocket | null>(null);

  const mode = useFarm((s) => s.mode);
  const planted = beds.some((b) => b.crop) && mode !== "experiment";
  const key = useMemo(
    () => (world && planted ? JSON.stringify(scenarioFor(world, beds, crops)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, beds, crops, irrigation, scheduled, pending, planted],
  );

  // (Re)create the session when the planting or the starting conditions change.
  useEffect(() => {
    if (!key) {
      useFarm.getState().setSession(null);
      return;
    }
    let cancelled = false;
    api.POST("/sim/sessions", { body: JSON.parse(key) }).then(({ data }) => {
      if (cancelled || !data) return;
      useFarm.getState().setSession(data.session_id, data.report_day_hours, data.hours - 1);
      useExplore.getState().setMaxDay(Math.max(0, data.days - 1));
      useExplore.getState().setPlaying(false);
      // Open the season in the morning of the first day (the simulation itself starts at midnight).
      const morning = data.report_day_hours * 0.375;
      useExplore.getState().setDay(0.375);
      void api.POST("/sim/sessions/{sid}/control", { params: { path: { sid: data.session_id } }, body: { action: "seek", value: morning } });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // WebSocket stream of frames.
  useEffect(() => {
    if (!sessionId) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${proto}://${location.host}/api/sim/sessions/${sessionId}/stream`);
    ws.current = socket;
    let lastVersion = -1;
    socket.onmessage = (msg) => {
      const frame = JSON.parse(msg.data) as {
        version: number;
        hour: number;
        playing: boolean;
        speed: number;
        env: FarmEnv;
        events_fired: { hour: number; day: number; plot: string | null; type: string; event: string; message: string }[];
        error?: string;
      };
      if (frame.error) return;
      const farm = useFarm.getState();
      farm.applyFrame(frame);
      const ex = useExplore.getState();
      if (ex.playing !== frame.playing) ex.setPlaying(frame.playing);
      const speed = ([1, 5, 20] as const).find((s) => s === frame.speed) ?? ex.speed;
      if (speed !== ex.speed) ex.setSpeed(speed);
      if (!frame.playing) {
        farm.setHour(frame.hour);
        ex.setDay(frame.hour / farm.reportDayHours);
      }
      if (frame.version !== lastVersion) {
        lastVersion = frame.version;
        qc.invalidateQueries({ queryKey: ["farm", sessionId] });
      }
      const toasts = frame.events_fired
        .filter((e) => e.type !== "germination" && e.type !== "event_end")
        .map((e) => ({
          id: `${e.hour}-${e.plot}-${e.type}-${e.event}`,
          type: (e.type === "event_start" || e.type === "action" ? e.event : TOAST_TYPES[e.type] ?? "flowering") as EventType,
          text: `${e.plot ? `Грядка ${e.plot}, ` : ""}${Math.floor(e.day)}-е сутки: ${e.message}`,
        }));
      if (toasts.length) useToasts.getState().push(toasts);
    };
    return () => {
      socket.close();
      ws.current = null;
    };
  }, [sessionId, qc]);

  // Shared link: ?scenario=<id> restores world, planting, conditions and events (§4).
  useEffect(() => {
    if (!planetId) return;
    const id = new URLSearchParams(window.location.search).get("scenario");
    if (!id) return;
    let cancelled = false;
    void unwrap(api.GET("/sim/scenarios/{scenario_id}", { params: { path: { scenario_id: id } } })).then((saved) => {
      if (cancelled) return;
      applySavedScenario(saved.scenario as unknown as SharedScenario);
      const url = new URL(window.location.href);
      url.searchParams.delete("scenario");
      window.history.replaceState(null, "", url);
    });
    return () => {
      cancelled = true;
    };
  }, [planetId]);

  const send = (action: "play" | "pause" | "speed" | "seek", value?: number) => {
    if (useFarm.getState().mode === "experiment") {
      // Experiment gardens are precomputed: the clock runs locally.
      const ex = useExplore.getState();
      if (action === "play") ex.setPlaying(true);
      else if (action === "pause") ex.setPlaying(false);
      else if (action === "speed" && (value === 1 || value === 5 || value === 20)) ex.setSpeed(value);
      else if (action === "seek" && value != null) ex.setDay(value / useFarm.getState().reportDayHours);
      return;
    }
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ action, value }));
    else if (sessionId) api.POST("/sim/sessions/{sid}/control", { params: { path: { sid: sessionId } }, body: { action, value: value ?? null } });
  };

  const state = useQuery({
    queryKey: ["farm", sessionId, "state", version],
    enabled: !!sessionId,
    staleTime: Infinity,
    queryFn: () => unwrap(api.GET("/sim/sessions/{sid}", { params: { path: { sid: sessionId! } } })),
  });
  const trajectory = useFarmTrajectory();
  useEffect(() => {
    const t = trajectory.data;
    if (!t) return;
    useFarm.getState().setEndHour(t.hours - 1);
    useExplore.getState().setMaxDay(Math.max(0, t.days - 1));
  }, [trajectory.data]);

  return { world, sessionId, state: state.data, trajectory: trajectory.data, send };
}

export function useFarmTrajectory() {
  const sessionId = useFarm((s) => s.sessionId);
  const version = useFarm((s) => s.version);
  return useQuery({
    queryKey: ["farm", sessionId, "trajectory", version],
    enabled: !!sessionId,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
    queryFn: () => unwrap(api.GET("/sim/sessions/{sid}/trajectory", { params: { path: { sid: sessionId! } } })),
  });
}

/** Mutations on the live session; every user change counts as an intervention in challenges. */
export function farmMutations(sessionId: string | null) {
  const path = { params: { path: { sid: sessionId ?? "" } } };
  const bump = () => useFarm.getState().addIntervention();
  return {
    conditions: (values: Record<string, number | string>) => {
      if (!sessionId) {
        useFarm.getState().setPending(values);
        return Promise.resolve();
      }
      bump();
      return api.PATCH("/sim/sessions/{sid}/conditions", { ...path, body: { values } });
    },
    event: (type: string, intensity: string, start: "now" | number, durationHours?: number) => {
      if (!sessionId) {
        const ev: Record<string, unknown> = { id: `p${Date.now()}`, type, intensity, start_hour: start === "now" ? 0 : start };
        if (durationHours) ev.duration_hours = durationHours;
        useFarm.getState().setScheduled([...useFarm.getState().scheduled, ev]);
        return Promise.resolve();
      }
      bump();
      return api.POST("/sim/sessions/{sid}/events", {
        ...path,
        body: { type, intensity: intensity as "weak" | "medium" | "strong", start, duration_hours: durationHours ?? null, params: {} },
      });
    },
    moveEvent: (eventId: string, startHour: number, durationHours: number) =>
      api.PATCH("/sim/sessions/{sid}/events/{event_id}", {
        params: { path: { sid: sessionId ?? "", event_id: eventId } },
        body: { start_hour: startHour, duration_hours: durationHours, intensity: null },
      }),
    removeEvent: (eventId: string) =>
      api.DELETE("/sim/sessions/{sid}/events/{event_id}", { params: { path: { sid: sessionId ?? "", event_id: eventId } } }),
    action: (type: string, plot: string | null, params: Record<string, number | string> = {}) => {
      bump();
      return api.POST("/sim/sessions/{sid}/actions", { ...path, body: { type, plot, at_hour: null, params } });
    },
  };
}
