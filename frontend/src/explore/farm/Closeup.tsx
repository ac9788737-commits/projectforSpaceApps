import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import type { Crop } from "@/api/client";
import { TimeSeriesChart } from "@/ui/charts";
import { statusOf } from "@/ui/data";
import { Num } from "@/ui/format";
import { Button, GlassPanel, SourceBadge, StatusTag } from "@/ui/primitives";
import { cropById } from "../data";
import { useExplore } from "../store";
import { factorRu, STAGE_RU } from "../ui/labels";
import type { DayRecord, Trajectory } from "./session";
import { PLOT_IDS } from "./store";

type Metric = "growth" | "factors" | "water";

/** Close-up of one plant: limiting factor, day-by-day charts with the «today» line (§5, §7). */
export function CloseupPanel({ crops, traj, unit }: { crops: Crop[]; traj: Trajectory | undefined; unit: string }) {
  const [metric, setMetric] = useState<Metric>("growth");
  const day = useExplore((s) => Math.floor(s.day));
  const selectedBed = useExplore((s) => s.selectedBed);
  const bed = useExplore((s) => s.beds[s.selectedBed]);
  const setCloseup = useExplore((s) => s.setCloseup);
  const plot = PLOT_IDS[selectedBed];
  const crop = cropById(crops, bed.crop);
  const records = (traj?.plots[plot] ?? []) as unknown as DayRecord[];
  const rec = records[Math.min(day, records.length - 1)];
  const organ = traj?.morphology?.[plot]?.harvest_organ as string | undefined;
  const step = Math.max(1, Math.ceil(records.length / 140));
  const data = records
    .filter((_, i) => i % step === 0 || i === records.length - 1)
    .map((r) => ({
      day: r.day,
      biomass: r.biomassG,
      yield: r.yieldG,
      height: Number(r.heightM) * 100,
      temp: (r.factors.temperature ?? 1) * 100,
      light: Math.min(r.factors.light ?? 1, r.factors.photoperiod ?? 1) * 100,
      water: r.ks * 100,
      health: r.health * 100,
    }));
  return (
    <GlassPanel className="w-full p-4 sm:w-80">
      <div className="mb-3 flex items-center gap-2">
        <Button variant="ghost" size="icon" className="-ml-2" onClick={() => setCloseup(false)} aria-label="Назад к огороду (Esc)">
          <ArrowLeft size={20} strokeWidth={1.5} />
        </Button>
        <h2 className="font-head text-xl font-semibold">{crop?.name_ru ?? "Растение"}</h2>
        <SourceBadge source="estimate" className="ml-auto" />
      </div>
      {!rec ? (
        <p className="text-sm text-fg-muted">Нет данных для этой грядки.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs text-fg-muted">
              <span className="font-num">
                {unit} {day}
              </span>{" "}
              · {STAGE_RU[rec.stage] ?? rec.stage}
            </p>
            <p className="mt-1 font-head text-[28px] font-semibold leading-tight">
              {factorRu(rec.limiting_factor)}: <Num value={rec.limiting_f * 100} unit="%" digits={0} />
            </p>
            <p className="text-sm text-fg-muted">от оптимума — главный ограничитель сейчас</p>
            <div className="mt-1">
              <StatusTag status={statusOf(rec.limiting_f)} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-fg-muted">Биомасса</dt>
              <dd className="text-right"><Num value={rec.biomassG} unit="г" /></dd>
              <dt className="text-fg-muted">Урожай</dt>
              <dd className="text-right"><Num value={rec.yieldG} unit="г" /></dd>
              <dt className="text-fg-muted">Высота</dt>
              <dd className="text-right"><Num value={Number(rec.heightM) * 100} unit="см" digits={0} /></dd>
              <dt className="text-fg-muted">Вода в почве</dt>
              <dd className="text-right"><Num value={rec.water_mm} unit="мм" digits={0} /></dd>
            </dl>
            {(organ === "tuber" || organ === "root") && bed.scenario !== "closed_farm" && (
              <p className="mt-2 text-xs text-fg-muted">Под грядкой — разрез почвы: видно, как растут {organ === "tuber" ? "клубни" : "корнеплоды"}.</p>
            )}
          </div>
          <div className="flex gap-1" role="group" aria-label="График">
            {(
              [
                ["growth", "Рост"],
                ["factors", "Факторы"],
                ["water", "Вода и здоровье"],
              ] as const
            ).map(([id, label]) => (
              <Button key={id} variant="ghost" size="sm" pressed={metric === id} onClick={() => setMetric(id)} className="h-8 text-xs">
                {label}
              </Button>
            ))}
          </div>
          {metric === "growth" && (
            <TimeSeriesChart
              ariaLabel="Биомасса, урожай и высота по дням"
              data={data}
              xKey="day"
              today={day}
              xLabel={(x) => `${unit} ${x}`}
              series={[
                { key: "biomass", name: "Биомасса", color: "var(--series-1)", unit: "г" },
                { key: "yield", name: "Урожай", color: "var(--series-2)", unit: "г" },
                { key: "height", name: "Высота", color: "var(--series-3)", unit: "см" },
              ]}
            />
          )}
          {metric === "factors" && (
            <TimeSeriesChart
              ariaLabel="Отклик на температуру и свет по дням, с зонами нормы, стресса и гибели"
              data={data}
              xKey="day"
              today={day}
              zones
              yDomain={[0, 100]}
              xLabel={(x) => `${unit} ${x}`}
              series={[
                { key: "temp", name: "Температура", color: "var(--series-2)", unit: "%" },
                { key: "light", name: "Свет", color: "var(--series-3)", unit: "%" },
              ]}
            />
          )}
          {metric === "water" && (
            <TimeSeriesChart
              ariaLabel="Доступная вода и здоровье по дням"
              data={data}
              xKey="day"
              today={day}
              zones
              yDomain={[0, 100]}
              xLabel={(x) => `${unit} ${x}`}
              series={[
                { key: "water", name: "Вода для корней", color: "var(--series-1)", unit: "%" },
                { key: "health", name: "Здоровье", color: "var(--series-4)", unit: "%" },
              ]}
            />
          )}
          <p className="text-[11px] leading-snug text-fg-muted">Форма растения — визуальная модель; урожай, вода и повреждения — из пошаговой симуляции.</p>
        </div>
      )}
    </GlassPanel>
  );
}
