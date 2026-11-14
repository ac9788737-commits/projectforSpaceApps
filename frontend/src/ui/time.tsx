import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CloudHail, CloudRainWind, Droplets, Flame, Flower2, History, Moon, Pause, Play, RotateCcw, Shovel, Skull, Snowflake, Sparkles, Sprout, Sun, ThermometerSnowflake, ThermometerSun, Tornado, Wheat, Wind, Wrench, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { cn } from "@/lib/utils";
import { formatNumber } from "./format";
import { Button, GlassPanel } from "./primitives";

export type EventType =
  | "germination"
  | "flowering"
  | "organ_init"
  | "harvest"
  | "death"
  | "dust_storm"
  | "flare"
  | "frost"
  | "heatwave"
  | "cold_snap"
  | "drought"
  | "downpour"
  | "hail"
  | "storm"
  | "eclipse"
  | "greenhouse_failure"
  | "irrigate"
  | "fertilize"
  | "mulch"
  | "frost_cover"
  | "shade"
  | "drain"
  | "stake"
  | "replant";

export const EVENT_META: Record<EventType, { Icon: LucideIcon; label: string; emoji: string; tone: string }> = {
  germination: { Icon: Sprout, label: "всходы", emoji: "🌱", tone: "text-leaf" },
  flowering: { Icon: Flower2, label: "цветение", emoji: "🌼", tone: "text-fg" },
  organ_init: { Icon: Sparkles, label: "закладка урожая", emoji: "✨", tone: "text-fg" },
  harvest: { Icon: Wheat, label: "урожай", emoji: "🧺", tone: "text-ok" },
  death: { Icon: Skull, label: "гибель", emoji: "☠", tone: "text-lethal" },
  dust_storm: { Icon: Wind, label: "пылевая буря", emoji: "🌪", tone: "text-stress" },
  flare: { Icon: Sun, label: "вспышка звезды", emoji: "☀", tone: "text-stress" },
  frost: { Icon: Snowflake, label: "заморозок", emoji: "❄", tone: "text-real" },
  heatwave: { Icon: ThermometerSun, label: "волна жары", emoji: "🔥", tone: "text-lethal" },
  cold_snap: { Icon: ThermometerSnowflake, label: "похолодание", emoji: "🥶", tone: "text-real" },
  drought: { Icon: Flame, label: "засуха", emoji: "🏜", tone: "text-stress" },
  downpour: { Icon: CloudRainWind, label: "ливень", emoji: "🌧", tone: "text-real" },
  hail: { Icon: CloudHail, label: "град", emoji: "🧊", tone: "text-real" },
  storm: { Icon: Tornado, label: "буря", emoji: "🌬", tone: "text-stress" },
  eclipse: { Icon: Moon, label: "долгая ночь", emoji: "🌑", tone: "text-fg-muted" },
  greenhouse_failure: { Icon: Wrench, label: "сбой теплицы", emoji: "⚠", tone: "text-lethal" },
  irrigate: { Icon: Droplets, label: "полив", emoji: "💧", tone: "text-real" },
  fertilize: { Icon: Sprout, label: "удобрение", emoji: "🌱", tone: "text-leaf" },
  mulch: { Icon: Shovel, label: "мульча", emoji: "🍂", tone: "text-fg" },
  frost_cover: { Icon: Snowflake, label: "укрытие", emoji: "🧣", tone: "text-fg" },
  shade: { Icon: Sun, label: "затенение", emoji: "⛱", tone: "text-fg" },
  drain: { Icon: Shovel, label: "дренаж", emoji: "🕳", tone: "text-fg" },
  stake: { Icon: Wheat, label: "подвязка", emoji: "🪵", tone: "text-fg" },
  replant: { Icon: Sprout, label: "пересев", emoji: "🌱", tone: "text-leaf" },
};

export interface TimeMarker {
  day: number;
  type: EventType;
  title: string;
}

/** Garden time bar (§5): 56 px amber play button, 1× 5× 20×, slider with event marks, «Сол 47 / 120». */
export function TimeBar({
  day,
  maxDay,
  playing,
  speed,
  unit,
  hint,
  markers,
  onToggle,
  onReset,
  onSpeed,
  onSeek,
}: {
  day: number;
  maxDay: number;
  playing: boolean;
  speed: 1 | 5 | 20;
  unit: string;
  hint?: string;
  markers: TimeMarker[];
  onToggle: () => void;
  onReset: () => void;
  onSpeed: (speed: 1 | 5 | 20) => void;
  onSeek: (day: number) => void;
}) {
  const disabled = maxDay <= 0;
  return (
    <GlassPanel className="flex w-full items-center gap-3 p-3 sm:gap-4">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={playing ? "Пауза (пробел)" : "Запустить рост (пробел)"}
        className="flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-[var(--accent-ink)] transition-shadow duration-[120ms] ease-out hover:shadow-[0_0_0_6px_var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {playing ? <Pause size={24} strokeWidth={1.75} /> : <Play size={24} strokeWidth={1.75} className="translate-x-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex gap-1" role="group" aria-label="Скорость">
            {([1, 5, 20] as const).map((s) => (
              <Button key={s} variant="ghost" size="sm" pressed={speed === s} onClick={() => onSpeed(s)} className="w-12 px-0 font-num">
                {s}×
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="icon" onClick={onReset} disabled={disabled} aria-label="В начало">
            <RotateCcw size={16} strokeWidth={1.5} />
          </Button>
          <span className="ml-auto font-num text-sm text-fg sm:text-base" title={hint}>
            {unit} {formatNumber(Math.floor(day), 0)} <span className="text-fg-muted">/ {formatNumber(maxDay, 0)}</span>
          </span>
        </div>
        <div className="relative h-9">
          <input
            type="range"
            min={0}
            max={Math.max(maxDay, 1)}
            step={0.01}
            value={day}
            disabled={disabled}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-label="День симуляции"
            aria-valuetext={`${unit} ${Math.floor(day)} из ${maxDay}`}
            className="absolute inset-x-0 top-0 h-4 w-full cursor-pointer accent-[var(--accent)]"
          />
          {maxDay > 0 &&
            markers.map((m, i) => {
              const { Icon, tone } = EVENT_META[m.type];
              return (
                <button
                  key={`${m.type}-${m.day}-${i}`}
                  type="button"
                  title={m.title}
                  aria-label={m.title}
                  onClick={() => onSeek(m.day)}
                  className={cn("absolute top-4 flex size-5 -translate-x-1/2 cursor-pointer items-center justify-center", tone)}
                  style={{ left: `${(m.day / maxDay) * 100}%` }}
                >
                  <Icon size={14} strokeWidth={1.5} aria-hidden />
                </button>
              );
            })}
        </div>
      </div>
    </GlassPanel>
  );
}

// ---------- Toasts: bottom right, 4 s, accumulated into a journal ----------

export interface ToastItem {
  id: string;
  type: EventType;
  text: string;
}

interface ToastState {
  live: ToastItem[];
  journal: ToastItem[];
  push: (items: ToastItem[]) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToasts = create<ToastState>((set) => ({
  live: [],
  journal: [],
  push: (items) =>
    set((s) => ({
      live: [...s.live, ...items.filter((i) => !s.live.some((l) => l.id === i.id))].slice(-3),
      journal: [...s.journal, ...items.filter((i) => !s.journal.some((l) => l.id === i.id))].slice(-100),
    })),
  dismiss: (id) => set((s) => ({ live: s.live.filter((t) => t.id !== id) })),
  clear: () => set({ live: [], journal: [] }),
}));

function ToastView({ item }: { item: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss);
  useEffect(() => {
    const t = setTimeout(() => dismiss(item.id), 4000);
    return () => clearTimeout(t);
  }, [item.id, dismiss]);
  return (
    <GlassPanel strong className="flex w-72 max-w-full items-start gap-2 px-3 py-2 text-sm leading-snug">
      <span aria-hidden>{EVENT_META[item.type].emoji}</span>
      <span>{item.text}</span>
    </GlassPanel>
  );
}

export function ToastStack({ max = 2 }: { max?: number }) {
  const live = useToasts((s) => s.live).slice(-max);
  const journal = useToasts((s) => s.journal);
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  return (
    <div className="pointer-events-none flex flex-col items-end gap-2" aria-live="polite">
      <AnimatePresence>
        {live.map((t) => (
          <motion.div
            key={t.id}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="pointer-events-auto"
          >
            <ToastView item={t} />
          </motion.div>
        ))}
      </AnimatePresence>
      {journal.length > 0 && (
        <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="pointer-events-auto">
          <History size={16} strokeWidth={1.5} /> Журнал · <span className="font-num">{journal.length}</span>
        </Button>
      )}
      {open && (
        <GlassPanel strong className="max-h-72 w-80 overflow-y-auto p-3" role="log" aria-label="Журнал событий">
          <div className="mb-2 flex items-center">
            <span className="text-sm font-medium">Журнал событий</span>
            <Button variant="ghost" size="icon" className="ml-auto -my-2 -mr-2" onClick={() => setOpen(false)} aria-label="Закрыть журнал">
              <X size={16} strokeWidth={1.5} />
            </Button>
          </div>
          <ol className="flex flex-col gap-1.5 text-xs leading-snug">
            {[...journal].reverse().map((t) => {
              const { Icon, tone } = EVENT_META[t.type];
              return (
                <li key={t.id} className="flex gap-2">
                  <Icon size={14} strokeWidth={1.5} className={cn("mt-px shrink-0", tone)} aria-hidden />
                  <span>{t.text}</span>
                </li>
              );
            })}
          </ol>
        </GlassPanel>
      )}
    </div>
  );
}
