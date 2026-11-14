import { Cloud, CloudFog, CloudHail, CloudRain, CloudRainWind, Pause, Play, RotateCcw, Snowflake, Sun, ThermometerSun, Wind, X } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/ui/format";
import { Button, GlassPanel } from "@/ui/primitives";
import { EVENT_META, type EventType } from "@/ui/time";
import { useExplore } from "../store";
import { farmMutations, type Catalog, type SessionState, type Trajectory } from "./session";
import { useFarm, type FarmMode } from "./store";

export const DECK_MIME = "application/x-astrocrop-event";

const MODES: { id: FarmMode; label: string }[] = [
  { id: "sandbox", label: "Песочница" },
  { id: "scenario", label: "Сценарий" },
  { id: "experiment", label: "Эксперимент" },
  { id: "challenge", label: "Испытания" },
];

export function dayUnitFor(world: string | null, reportDayHours: number): string {
  if (world === "mars" || world === "planet:mars") return "Сол";
  return reportDayHours === 24 ? "Сутки" : "Сутки";
}

interface ScenarioEvent {
  id: string;
  type: string;
  start_hour?: number;
  start_day?: number;
  duration_hours?: number;
  duration_days?: number;
  intensity?: string | number;
}

function eventSpan(ev: ScenarioEvent, rdh: number, catalog: Catalog | undefined): [number, number] {
  const start = ev.start_hour ?? (ev.start_day ?? 0) * rdh;
  const dur = ev.duration_hours ?? (ev.duration_days ? ev.duration_days * rdh : (catalog?.events.find((e) => e.id === ev.type)?.default_hours ?? 24));
  return [start, dur];
}

function ForecastIcon({ day, events }: { day: Trajectory["env_days"][number] | undefined; events: string[] }) {
  if (!day) return <Cloud size={18} strokeWidth={1.5} className="text-fg-muted" />;
  const has = (t: string) => events.includes(t);
  if (has("hail") || (day.hail ?? 0) > 0) return <CloudHail size={18} strokeWidth={1.5} className="text-real" />;
  if (has("storm") || (day.wind_max_ms ?? 0) > 12) return <Wind size={18} strokeWidth={1.5} className="text-stress" />;
  if ((day.t_min_c ?? 5) < 0) return <Snowflake size={18} strokeWidth={1.5} className="text-real" />;
  if ((day.precip_mm ?? 0) > 8) return <CloudRainWind size={18} strokeWidth={1.5} className="text-real" />;
  if ((day.precip_mm ?? 0) > 0.5) return <CloudRain size={18} strokeWidth={1.5} className="text-real" />;
  if (has("dust_storm") || has("eclipse")) return <CloudFog size={18} strokeWidth={1.5} className="text-stress" />;
  if ((day.t_max_c ?? 20) > 32) return <ThermometerSun size={18} strokeWidth={1.5} className="text-lethal" />;
  return <Sun size={18} strokeWidth={1.5} className="text-stress" />;
}

/** Next 7 days: icons from the computed weather including scheduled events (§5). */
function Forecast({ traj, events, rdh, unit }: { traj: Trajectory; events: ScenarioEvent[]; rdh: number; unit: string }) {
  const day = useExplore((s) => Math.floor(s.day));
  const days = Array.from({ length: 7 }, (_, i) => day + i).filter((d) => d < traj.days);
  return (
    <ol className="flex gap-1 overflow-x-auto" aria-label="Прогноз на 7 дней">
      {days.map((d) => {
        const env = traj.env_days[d];
        const active = events.filter((ev) => {
          const [s, dur] = eventSpan(ev, rdh, undefined);
          return s < (d + 1) * rdh && s + dur > d * rdh;
        });
        return (
          <li key={d} className="flex w-11 shrink-0 flex-col items-center rounded-ctl bg-hover px-1 py-1 text-[10px] leading-tight" title={`${unit} ${d}`}>
            <span className="font-num text-fg-muted">{d}</span>
            <ForecastIcon day={env} events={active.map((a) => a.type)} />
            <span className="font-num text-fg">{env ? Math.round(env.t_max_c ?? 0) : "—"}°</span>
            <span className="font-num text-fg-muted">{env ? Math.round(env.t_min_c ?? 0) : "—"}°</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Small SVG charts of temperature band, rain and daily light under the event track. */
function WeatherCharts({ traj, width }: { traj: Trajectory; width: number }) {
  const d = traj.env_days;
  if (!d.length || width <= 0) return null;
  const x = (i: number) => (i / Math.max(1, d.length - 1)) * width;
  const tMin = Math.min(...d.map((e) => e.t_min_c ?? 0));
  const tMax = Math.max(...d.map((e) => e.t_max_c ?? 0));
  const ty = (t: number) => 26 - ((t - tMin) / Math.max(1, tMax - tMin)) * 24;
  const band = d.map((e, i) => `${x(i)},${ty(e.t_max_c ?? 0)}`).join(" ") + " " + [...d].reverse().map((e, i) => `${x(d.length - 1 - i)},${ty(e.t_min_c ?? 0)}`).join(" ");
  const pMax = Math.max(1, ...d.map((e) => e.precip_mm ?? 0));
  const lMax = Math.max(1, ...d.map((e) => e.dli_mol_m2 ?? 0));
  const light = d.map((e, i) => `${x(i)},${22 - ((e.dli_mol_m2 ?? 0) / lMax) * 20}`).join(" ");
  return (
    <div className="flex flex-col gap-0.5" role="img" aria-label={`Погода сезона: температура от ${Math.round(tMin)} до ${Math.round(tMax)} °C, осадки до ${Math.round(pMax)} мм в сутки`}>
      <svg width={width} height={28} className="block">
        <polygon points={band} fill="var(--series-2)" opacity={0.35} />
        {tMin < 0 && tMax > 0 && <line x1={0} x2={width} y1={ty(0)} y2={ty(0)} stroke="var(--border-subtle)" strokeDasharray="2 3" />}
      </svg>
      <svg width={width} height={16} className="block">
        {d.map((e, i) => (
          <rect key={i} x={x(i)} y={16 - ((e.precip_mm ?? 0) / pMax) * 15} width={Math.max(1, width / d.length - 0.5)} height={((e.precip_mm ?? 0) / pMax) * 15} fill="var(--series-1)" opacity={0.8} />
        ))}
      </svg>
      <svg width={width} height={24} className="block">
        <polyline points={light} fill="none" stroke="var(--series-3)" strokeWidth={1.5} />
      </svg>
      <div className="flex gap-3 text-[10px] text-fg-muted">
        <span><span className="mr-1 inline-block h-1 w-3 rounded bg-[var(--series-2)] align-middle" />температура</span>
        <span><span className="mr-1 inline-block h-1 w-3 rounded bg-[var(--series-1)] align-middle" />осадки</span>
        <span><span className="mr-1 inline-block h-1 w-3 rounded bg-[var(--series-3)] align-middle" />свет за сутки</span>
      </div>
    </div>
  );
}

function EventBar({
  ev,
  total,
  rdh,
  width,
  catalog,
  onMove,
  onRemove,
}: {
  ev: ScenarioEvent;
  total: number;
  rdh: number;
  width: number;
  catalog: Catalog | undefined;
  onMove: (start: number, duration: number) => void;
  onRemove: () => void;
}) {
  const [start, dur] = eventSpan(ev, rdh, catalog);
  const [drag, setDrag] = useState<{ start: number; dur: number } | null>(null);
  const s = drag?.start ?? start;
  const du = drag?.dur ?? dur;
  const meta = EVENT_META[ev.type as EventType];
  const name = catalog?.events.find((e) => e.id === ev.type)?.name_ru ?? ev.type;
  const begin = (e: ReactPointerEvent, mode: "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const perPx = total / width;
    let cur = { start, dur };
    const move = (m: PointerEvent) => {
      const dh = (m.clientX - x0) * perPx;
      cur = mode === "move" ? { start: Math.max(0, Math.round((start + dh) / 6) * 6), dur } : { start, dur: Math.max(1, Math.round((dur + dh) / 1) * 1) };
      setDrag(cur);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (cur.start !== start || cur.dur !== dur) onMove(cur.start, cur.dur);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const left = (s / total) * width;
  const w = Math.max(10, (du / total) * width);
  return (
    <div
      className="group absolute top-1 flex h-7 items-center gap-1 overflow-hidden rounded-ctl border border-subtle bg-panel-strong pl-1 text-[11px] text-fg"
      style={{ left, width: w }}
      title={`${name}: с ${formatNumber(s / rdh, 1)} по ${formatNumber((s + du) / rdh, 1)} сутки — перетащите, чтобы сдвинуть, тяните правый край, чтобы растянуть`}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", meta ? meta.tone.replace("text-", "bg-") : "bg-accent")} aria-hidden />
      <button type="button" className="flex min-w-0 flex-1 cursor-grab items-center gap-1 pl-1.5 active:cursor-grabbing" onPointerDown={(e) => begin(e, "move")} aria-label={`Сдвинуть: ${name}`}>
        {meta && <meta.Icon size={12} strokeWidth={1.5} className={cn("shrink-0", meta.tone)} aria-hidden />}
        <span className="truncate">{name}</span>
      </button>
      <button type="button" className="hidden size-5 shrink-0 cursor-pointer items-center justify-center rounded text-fg-muted hover:text-fg group-hover:flex" onClick={onRemove} aria-label={`Убрать: ${name}`}>
        <X size={12} strokeWidth={1.5} />
      </button>
      <span className="h-full w-1.5 shrink-0 cursor-ew-resize bg-hover" onPointerDown={(e) => begin(e, "resize")} aria-hidden />
    </div>
  );
}

export function SeasonTimeline({
  traj,
  state,
  catalog,
  send,
  world,
  deck,
}: {
  traj: Trajectory | undefined;
  state: SessionState | undefined;
  catalog: Catalog | undefined;
  send: (action: "play" | "pause" | "speed" | "seek", value?: number) => void;
  world: string | null;
  deck?: ReactNode;
}) {
  const day = useExplore((s) => s.day);
  const playing = useExplore((s) => s.playing);
  const speed = useExplore((s) => s.speed);
  const mode = useFarm((s) => s.mode);
  const setMode = useFarm((s) => s.setMode);
  const sessionId = useFarm((s) => s.sessionId);
  // The experiment runs precomputed gardens on a local clock, without a live session.
  const live = !!sessionId || mode === "experiment";
  const rdh = useFarm((s) => s.reportDayHours);
  const scheduled = useFarm((s) => s.scheduled);
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const m = farmMutations(sessionId);
  const unit = dayUnitFor(world, rdh);
  const days = traj?.days ?? 0;
  const total = Math.max(1, (traj?.hours ?? 1) - 1);
  const events = mode === "experiment" ? [] : ((state?.scenario as { events?: ScenarioEvent[] } | undefined)?.events ?? (scheduled as unknown as ScenarioEvent[])) as ScenarioEvent[];
  const measure = (el: HTMLDivElement | null) => {
    track.current = el;
    if (el && Math.abs(el.clientWidth - width) > 2) setWidth(el.clientWidth);
  };
  const toggle = () => send(playing ? "pause" : "play");

  return (
    <GlassPanel className="relative flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded-ctl bg-hover p-0.5" role="tablist" aria-label="Режим">
          {MODES.map((mo) => (
            <Button key={mo.id} role="tab" aria-selected={mode === mo.id} variant="ghost" size="sm" pressed={mode === mo.id} onClick={() => setMode(mo.id)} className="h-8 px-2 text-xs">
              {mo.label}
            </Button>
          ))}
        </div>
        {deck}
        {traj && <div className="ml-auto max-w-full"><Forecast traj={traj} events={events} rdh={rdh} unit={unit} /></div>}
      </div>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={!live}
          aria-label={playing ? "Пауза (пробел)" : "Запустить сезон (пробел)"}
          className="mt-1 flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-[var(--accent-ink)] transition-shadow duration-[120ms] ease-out hover:shadow-[0_0_0_6px_var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {playing ? <Pause size={24} strokeWidth={1.75} /> : <Play size={24} strokeWidth={1.75} className="translate-x-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-x-2">
            <div className="flex gap-1" role="group" aria-label="Скорость">
              {([1, 5, 20] as const).map((s) => (
                <Button key={s} variant="ghost" size="sm" pressed={speed === s} onClick={() => send("speed", s)} className="h-8 w-11 px-0 font-num">
                  {s}×
                </Button>
              ))}
            </div>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => send("seek", 0)} disabled={!live} aria-label="В начало сезона">
              <RotateCcw size={16} strokeWidth={1.5} />
            </Button>
            <span className="ml-auto font-num text-sm text-fg">
              {unit} {Math.floor(day)} <span className="text-fg-muted">/ {Math.max(0, days - 1)}</span>
            </span>
          </div>
          {/* Event track: drop cards here, drag bars to move, pull the right edge to stretch. */}
          <div
            ref={measure}
            className="relative h-9 rounded-ctl border border-dashed border-subtle bg-hover"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DECK_MIME)) e.preventDefault();
            }}
            onDrop={(e) => {
              const raw = e.dataTransfer.getData(DECK_MIME);
              if (!raw || !track.current) return;
              e.preventDefault();
              const { type, intensity } = JSON.parse(raw) as { type: string; intensity: string };
              const rect = track.current.getBoundingClientRect();
              const hour = Math.max(0, Math.round((((e.clientX - rect.left) / rect.width) * total) / 6) * 6);
              m.event(type, intensity, hour);
            }}
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget || !track.current) return;
              const rect = track.current.getBoundingClientRect();
              send("seek", ((e.clientX - rect.left) / rect.width) * total);
            }}
            aria-label="Дорожка событий: перетащите сюда карточку из колоды"
          >
            {!events.length && mode !== "experiment" && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-fg-muted">Перетащите сюда карточку события</span>}
            {events.map((ev) => (
              <EventBar
                key={ev.id}
                ev={ev}
                total={total}
                rdh={rdh}
                width={width}
                catalog={catalog}
                onMove={(s, d) => (sessionId ? m.moveEvent(ev.id, s, d) : undefined)}
                onRemove={() => (sessionId ? m.removeEvent(ev.id) : useFarm.getState().setScheduled(scheduled.filter((x) => x.id !== ev.id)))}
              />
            ))}
            <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${Math.min(100, ((day * rdh) / total) * 100)}%` }} aria-hidden />
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(1, days - 1)}
            step={0.05}
            value={day}
            disabled={!live}
            onChange={(e) => {
              // Move the local clock at once so the controlled slider does not snap back before the server frame.
              const d = Number(e.target.value);
              useExplore.getState().setDay(d);
              send("seek", d * rdh);
            }}
            aria-label={`${unit} сезона`}
            className="mt-1 h-3 w-full cursor-pointer accent-[var(--accent)]"
          />
          {traj && <WeatherCharts traj={traj} width={width} />}
        </div>
      </div>
    </GlassPanel>
  );
}
