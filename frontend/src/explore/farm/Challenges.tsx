import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Play, Trophy } from "lucide-react";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { cn } from "@/lib/utils";
import { Button, CollapsiblePanel, StatusTag } from "@/ui/primitives";
import { useCrops } from "../data";
import { useExplore, type Scenario } from "../store";
import { useFarm } from "./store";

interface PlotReport {
  crop_id: string;
  alive: boolean;
  yield_rel_earth: number;
  yield_vs_norm: number;
  damage: Record<string, number>;
}

interface Challenge {
  id: string;
  title: string;
  goal: string;
  world: string;
  crop: string;
  scenario: Scenario;
  irrigation: "rain" | "auto";
  events: Record<string, unknown>[];
  overrides?: Record<string, number | string>;
  maxInterventions?: number;
  check: (p: PlotReport, kgPerM2: number, interventions: number) => boolean;
}

/** Ready-made tasks (§2, §6.7). Targets are checked against the season report. */
export const CHALLENGES: Challenge[] = [
  {
    id: "drought-potato",
    title: "Картофель против засухи",
    goal: "Собери 3 кг картофеля с квадратного метра, пережив 10-дневную засуху.",
    world: "earth:temperate",
    crop: "potato",
    scenario: "open_surface",
    irrigation: "rain",
    events: [{ id: "c1", type: "drought", start_day: 40, duration_days: 10, intensity: "strong" }],
    check: (p, kg) => p.alive && kg >= 3,
  },
  {
    id: "mars-lettuce",
    title: "Салат на Марсе",
    goal: "Вырасти салат на Марсе, используя не больше 2 вмешательств.",
    world: "mars",
    crop: "lettuce",
    scenario: "open_surface",
    irrigation: "rain",
    events: [],
    maxInterventions: 2,
    check: (p, _kg, n) => p.alive && p.yield_rel_earth > 0.2 && n <= 2,
  },
  {
    id: "wheat-frost",
    title: "Заморозок в цветение",
    goal: "Спаси пшеницу от заморозка во время цветения: не меньше 70 % от нормы.",
    world: "earth:temperate",
    crop: "wheat",
    scenario: "open_surface",
    irrigation: "auto",
    events: [{ id: "c1", type: "frost", start_day: 66, duration_hours: 10, min_temp_c: -5 }],
    check: (p) => p.alive && p.yield_vs_norm >= 0.7,
  },
  {
    id: "tomato-heat",
    title: "Томаты в жару",
    goal: "Сохрани хотя бы половину урожая томатов при недельной жаре во время цветения.",
    world: "earth:temperate",
    crop: "tomato",
    scenario: "open_surface",
    irrigation: "auto",
    events: [{ id: "c1", type: "heatwave", start_day: 40, duration_days: 7, intensity: "strong" }],
    check: (p) => p.alive && p.yield_vs_norm >= 0.5,
  },
  {
    id: "potato-flood",
    title: "Ливень на глине",
    goal: "Глинистая грядка, трёхдневный ливень: сохрани не меньше 85 % урожая картофеля от нормы.",
    world: "earth:temperate",
    crop: "potato",
    scenario: "open_surface",
    irrigation: "auto",
    overrides: { soil: "clay" },
    events: [{ id: "c1", type: "downpour", start_day: 30, duration_days: 3, intensity: "strong" }],
    check: (p) => p.alive && p.yield_vs_norm >= 0.85,
  },
  {
    id: "moon-harvest",
    title: "Урожай на Луне",
    goal: "Получи на Луне не меньше половины земного урожая любой культуры.",
    world: "moon",
    crop: "lettuce",
    scenario: "open_surface",
    irrigation: "rain",
    events: [],
    check: (p) => p.alive && p.yield_rel_earth >= 0.5,
  },
  {
    id: "mars-dust",
    title: "Пылевая буря",
    goal: "Переживи на Марсе 20-дневную пылевую бурю под куполом: не меньше 15 % земного урожая картофеля.",
    world: "mars",
    crop: "potato",
    scenario: "greenhouse",
    irrigation: "auto",
    events: [{ id: "c1", type: "dust_storm", start_day: 30, duration_days: 20, intensity: "strong" }],
    check: (p) => p.alive && p.yield_rel_earth >= 0.15,
  },
];

const KEY = "astrocrop.challenges";

function readDone(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function markDone(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set([...readDone(), id])]));
  } catch {
    /* progress is a convenience; without storage it is simply not remembered */
  }
}

export function startChallenge(c: Challenge) {
  const ex = useExplore.getState();
  ex.beds.forEach((_, i) => ex.plant(i, null));
  ex.selectBed(4);
  ex.setScenario(4, c.scenario);
  ex.plant(4, c.crop);
  const farm = useFarm.getState();
  farm.setIrrigation(4, c.irrigation);
  useFarm.setState({ pendingOverrides: c.overrides ?? {}, world: c.world, scheduled: c.events, mode: "challenge" });
  farm.setChallenge(c.id);
}

export function ChallengePanel({ planetId }: { planetId: string }) {
  const [done, setDone] = useState(readDone);
  const current = useFarm((s) => s.challengeId);
  const interventions = useFarm((s) => s.interventions);
  const sessionId = useFarm((s) => s.sessionId);
  const version = useFarm((s) => s.version);
  const finished = useExplore((s) => s.maxDay > 0 && s.day >= s.maxDay - 0.01 && !s.playing);
  const crops = useCrops();
  const challenge = CHALLENGES.find((c) => c.id === current);
  const report = useQuery({
    queryKey: ["farm", sessionId, "report", version],
    enabled: !!challenge && finished && !!sessionId,
    staleTime: Infinity,
    queryFn: () => unwrap(api.GET("/sim/sessions/{sid}/report", { params: { path: { sid: sessionId! } } })) as unknown as Promise<{ plots: Record<string, PlotReport> }>,
  });
  const plot = report.data?.plots.B2;
  const crop = crops.data?.find((c) => c.id === challenge?.crop);
  const kg = plot && crop?.yield_kg_m2_cycle ? plot.yield_rel_earth * crop.yield_kg_m2_cycle : 0;
  const success = !!(challenge && plot && challenge.check(plot, kg, interventions));
  if (success && challenge && !done.includes(challenge.id)) {
    markDone(challenge.id);
    setDone(readDone());
  }
  return (
    <CollapsiblePanel title="Испытания" icon={Trophy}>
      {challenge && (
        <div className="mb-3 rounded-ctl border border-accent bg-glow p-3 text-sm">
          <p className="font-medium">{challenge.title}</p>
          <p className="mt-0.5 text-fg">{challenge.goal}</p>
          <p className="mt-1 text-xs text-fg-muted">
            Вмешательств: <span className="font-num text-fg">{interventions}</span>
            {challenge.maxInterventions != null && <> из {challenge.maxInterventions}</>}
            {planetId && challenge.world !== planetId && <> · мир задания: {challenge.world}</>}
          </p>
          {finished && plot && (
            <div className="mt-2">
              <StatusTag status={success ? "ok" : "lethal"} label={success ? "Задание выполнено" : "Не получилось — попробуйте ещё раз"} />
              {challenge.id === "drought-potato" && <p className="mt-1 text-xs">Собрано: <span className="font-num">{kg.toFixed(1)}</span> кг/м²</p>}
            </div>
          )}
        </div>
      )}
      <ul className="flex flex-col gap-1.5" aria-label="Задания">
        {CHALLENGES.map((c) => (
          <li key={c.id} className={cn("rounded-ctl border p-2 text-sm", current === c.id ? "border-accent" : "border-subtle")}>
            <div className="flex items-center gap-2">
              {done.includes(c.id) ? <CircleCheck size={16} strokeWidth={1.75} className="shrink-0 text-ok" aria-label="выполнено" /> : <Trophy size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" aria-hidden />}
              <span className="flex-1 font-medium">{c.title}</span>
              <Button variant="secondary" size="sm" className="h-8" onClick={() => startChallenge(c)} aria-label={`Начать: ${c.title}`}>
                <Play size={14} strokeWidth={1.5} /> {current === c.id ? "Заново" : "Начать"}
              </Button>
            </div>
            <p className="mt-1 text-xs leading-snug text-fg-muted">{c.goal}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-fg-muted">Прогресс сохраняется в этом браузере.</p>
    </CollapsiblePanel>
  );
}
