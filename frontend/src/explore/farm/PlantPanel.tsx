import { Droplets, Eye, Heart, Scissors, Shovel, Snowflake, Sprout, Sun, Wheat, X } from "lucide-react";
import type { Crop } from "@/api/client";
import { FactorBar } from "@/ui/data";
import { Num } from "@/ui/format";
import { Button, GlassPanel, ObjectTitle, SourceBadge, STATUS_META, type Status } from "@/ui/primitives";
import { LoadingLine } from "@/ui/states";
import { cropById } from "../data";
import { useExplore } from "../store";
import { STAGE_RU } from "../ui/labels";
import { farmMutations, type DayRecord, type Trajectory } from "./session";
import { dayUnitFor } from "./SeasonTimeline";
import { PLOT_IDS, useFarm } from "./store";

const ACTIONS: { id: string; label: string; Icon: typeof Droplets; params?: Record<string, number> }[] = [
  { id: "irrigate", label: "Полить 20 мм", Icon: Droplets, params: { mm: 20 } },
  { id: "fertilize", label: "Удобрить", Icon: Sprout },
  { id: "mulch", label: "Мульча", Icon: Shovel },
  { id: "frost_cover", label: "Укрыть", Icon: Snowflake },
  { id: "shade", label: "Затенить", Icon: Sun },
  { id: "drain", label: "Дренаж", Icon: Shovel },
  { id: "stake", label: "Подвязать", Icon: Wheat },
  { id: "harvest", label: "Собрать", Icon: Scissors },
];

const pct = (x: number) => Math.round(x * 100);

/** Human reason for an active stress, with the consequence from the injury counters (§5). */
export function stressText(s: DayRecord["stresses"][number], rec: DayRecord, tuberEff: number | undefined): string {
  const d = rec.damage;
  switch (s.cause) {
    case "frost":
      return `Заморозок до ${Math.round(rec.t_min_c ?? 0)} °C → листья повреждены на ${pct(d.leaf)} %`;
    case "heat":
      return `Жара ${Math.round(rec.t_max_c ?? 0)} °C → ожог листьев ${pct(d.leaf)} %`;
    case "heat_flowering":
      return `Жара ${Math.round(rec.t_max_c ?? 0)} °C во время цветения → −${pct(d.sterility)} % завязей`;
    case "drought":
      return `Сухая почва: воды для корней ${pct(rec.ks)} % → растение вянет`;
    case "waterlog":
      return `Переувлажнение ${Math.round(s.value)} ч → корни повреждены на ${pct(d.root)} %`;
    case "wind":
      return `Ветер ${Math.round(s.value)} м/с → полегание ${pct(d.stem)} %`;
    case "hail":
      return `Град → листья −${pct(d.leaf)} %, плодов потеряно ${pct(d.fruit_loss)} %`;
    case "uv":
      return `Ультрафиолет выше переносимого → повреждение листьев`;
    case "radiation":
      return `Радиация ${Math.round(s.value)} мЗв/год → некроз листьев`;
    case "warm_nights":
      return `Тёплые ночи мешают клубням → −${pct(1 - (tuberEff ?? 1))} % урожая`;
    default:
      return s.label;
  }
}

export function PlantPanel({ crops, traj, world }: { crops: Crop[]; traj: Trajectory | undefined; world: string | null }) {
  const selectedBed = useExplore((s) => s.selectedBed);
  const bed = useExplore((s) => s.beds[s.selectedBed]);
  const day = useExplore((s) => Math.floor(s.day));
  const setCloseup = useExplore((s) => s.setCloseup);
  const plant = useExplore((s) => s.plant);
  const sessionId = useFarm((s) => s.sessionId);
  const rdh = useFarm((s) => s.reportDayHours);
  const mode = useFarm((s) => s.mode);
  const interventions = useFarm((s) => s.interventions);
  const m = farmMutations(sessionId);
  const plot = PLOT_IDS[selectedBed];
  const crop = cropById(crops, bed.crop);
  const records = (traj?.plots[plot] ?? []) as unknown as DayRecord[];
  const rec = records[Math.min(day, records.length - 1)];
  const summary = traj?.summary[plot] as { yield_g: number; yield_rel: number; alive: boolean; death_day: number | null; damage: Record<string, number> } | undefined;
  const unit = dayUnitFor(world, rdh);
  const health = rec?.health ?? 0;
  const healthStatus: Status = health <= 0.02 ? "lethal" : health < 0.6 ? "stress" : "ok";
  const deadNow = summary && !summary.alive && summary.death_day != null && day >= summary.death_day;
  return (
    <GlassPanel className="w-80 p-4">
      <div className="flex items-start gap-2">
        <ObjectTitle kicker={`Грядка ${plot} · растение`} className="flex-1">
          {crop ? crop.name_ru : "Пусто"}
        </ObjectTitle>
        {crop && (
          <Button variant="ghost" size="icon" onClick={() => plant(selectedBed, null)} aria-label="Очистить грядку">
            <X size={16} strokeWidth={1.5} />
          </Button>
        )}
      </div>
      {!crop && <p className="mt-3 text-sm text-fg-muted">Выберите культуру во вкладке «Посадка» панели «Природа».</p>}
      {crop && !rec && (
        <div className="mt-3">
          <LoadingLine text="Готовим грядки…" />
        </div>
      )}
      {crop && rec && (
        <>
          <p className="mt-2 text-sm">
            <span className="text-fg-muted">{unit}</span> <span className="font-num">{day}</span> · {deadNow ? "погибло" : (STAGE_RU[rec.stage] ?? rec.stage)}
          </p>
          <div className="mt-2">
            <FactorBar icon={Heart} label="Здоровье" f={health} status={healthStatus} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-fg-muted">Урожай сейчас</dt>
            <dd className="text-right">
              <Num value={rec.yieldG} unit="г" />
            </dd>
            <dt className="text-fg-muted">Прогноз к концу</dt>
            <dd className="text-right">
              {summary?.alive ? <Num value={summary.yield_rel * 100} unit="% от земного" digits={0} /> : <span className="text-lethal">гибель</span>}
            </dd>
            <dt className="text-fg-muted">Вода в почве</dt>
            <dd className="text-right">
              <Num value={rec.ks * 100} unit="%" digits={0} />
            </dd>
          </dl>
          <div className="mt-3 border-t border-subtle pt-3">
            <h3 className="mb-1.5 text-xs uppercase tracking-[0.08em] text-fg-muted">Активные стрессы</h3>
            {rec.stresses.length === 0 ? (
              <p className="text-sm text-ok">✓ Сейчас ничего не мешает</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm leading-snug">
                {rec.stresses.map((s) => {
                  const { Icon, text } = STATUS_META[s.cause === "heat_flowering" || s.cause === "frost" ? "lethal" : "stress"];
                  return (
                    <li key={s.cause} className="flex gap-1.5">
                      <Icon size={16} strokeWidth={1.75} className={`mt-0.5 shrink-0 ${text}`} aria-hidden />
                      <span>{stressText(s, rec, summary?.damage?.tuber_efficiency)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="mt-3 border-t border-subtle pt-3">
            <div className="mb-1.5 flex items-center">
              <h3 className="text-xs uppercase tracking-[0.08em] text-fg-muted">Действия фермера</h3>
              {mode === "challenge" && <span className="ml-auto font-num text-xs text-fg-muted">вмешательств: {interventions}</span>}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {ACTIONS.map((a) => (
                <Button key={a.id} variant="secondary" size="sm" disabled={!sessionId || !!deadNow} onClick={() => m.action(a.id, plot, a.params ?? {})} className="justify-start px-2 text-xs">
                  <a.Icon size={16} strokeWidth={1.5} aria-hidden /> {a.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SourceBadge source="estimate" />
            {!deadNow && (
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setCloseup(true)}>
                <Eye size={16} strokeWidth={1.5} /> Крупный план
              </Button>
            )}
          </div>
        </>
      )}
    </GlassPanel>
  );
}
