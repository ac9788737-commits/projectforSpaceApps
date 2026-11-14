import { ArrowRight, Sprout, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CropGlyph } from "./CropIcon";
import { Num } from "./format";
import { Button, GlassPanel, SourceDot, STATUS_META, StatusTag, type Source, type Status } from "./primitives";

// ---------- Data Row: icon · label · value · unit · source ----------

export function DataRow({
  icon: Icon,
  label,
  value,
  unit,
  digits = 1,
  source,
  sourceDetail,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  value?: number | null;
  unit?: string;
  digits?: number;
  source?: Source;
  sourceDetail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center gap-2 text-sm">
      {Icon && <Icon size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" aria-hidden />}
      <span className="min-w-0 flex-1 truncate text-fg-muted">{label}</span>
      <span className="text-fg">{children ?? <Num value={value} unit={unit} digits={digits} />}</span>
      {source && <SourceDot source={source} detail={sourceDetail} />}
    </div>
  );
}

// ---------- Factor Bar: 0–100 % with ok/stress/lethal zones and a marker ----------

export const LETHAL_AT = 0.02;
export const STRESS_BELOW = 0.8;

export function statusOf(f: number): Status {
  if (f <= LETHAL_AT) return "lethal";
  return f < STRESS_BELOW ? "stress" : "ok";
}

export function FactorBar({
  icon: Icon,
  label,
  f,
  detail,
  status,
}: {
  icon?: LucideIcon;
  label: string;
  f: number;
  detail?: ReactNode;
  status?: Status;
}) {
  const s = status ?? statusOf(f);
  const pct = Math.max(0, Math.min(1, f)) * 100;
  return (
    <div className="text-sm">
      <div className="mb-1.5 flex items-center gap-2">
        {Icon && <Icon size={16} strokeWidth={1.5} className="text-fg-muted" aria-hidden />}
        <span className="flex-1 text-fg">{label}</span>
        {detail && <span className="text-xs">{detail}</span>}
        <StatusTag status={s} />
        <Num value={pct} unit="%" digits={0} className="w-12 text-right" />
      </div>
      <div
        className="relative h-2 rounded-full"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={`${Math.round(pct)} % от оптимума, ${STATUS_META[s].label}`}
      >
        <div className="absolute inset-0 flex overflow-hidden rounded-full opacity-35">
          <span className="bg-lethal" style={{ width: `${LETHAL_AT * 100}%` }} />
          <span className="bg-stress" style={{ width: `${(STRESS_BELOW - LETHAL_AT) * 100}%` }} />
          <span className="flex-1 bg-ok" />
        </div>
        <span
          className={cn("absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--bg-panel-strong)]", STATUS_META[s].bg)}
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------- Verdict line ----------

export function Verdict({ status, children }: { status: Status | "none"; children: ReactNode }) {
  const color = status === "none" ? "text-fg-muted" : STATUS_META[status].text;
  return (
    <p className={cn("flex items-start gap-1.5 text-sm leading-snug", color)}>
      <Sprout size={16} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden />
      <span className="text-fg">{children}</span>
    </p>
  );
}

// ---------- Object Card with a leader line (atlas style) ----------

export function ObjectCard({
  title,
  type,
  source,
  children,
  verdict,
  onFly,
  flyLabel = "Лететь",
  leader = true,
}: {
  title: string;
  type: string;
  source?: Source;
  children?: ReactNode;
  verdict?: ReactNode;
  onFly?: () => void;
  flyLabel?: string;
  leader?: boolean;
}) {
  return (
    <div className={cn("relative", leader && "pl-10 pt-1 group-data-[flip=1]/label:pl-0 group-data-[flip=1]/label:pr-10 group-data-[flipy=1]/label:pt-0 group-data-[flipy=1]/label:pb-1")}>
      {leader && (
        <svg
          className="pointer-events-none absolute left-0 top-0 h-6 w-10 overflow-visible text-fg-muted group-data-[flip=1]/label:left-auto group-data-[flip=1]/label:right-0 group-data-[flip=1]/label:-scale-x-100 group-data-[flipy=1]/label:top-auto group-data-[flipy=1]/label:bottom-0 group-data-[flipy=1]/label:-scale-y-100"
          aria-hidden
        >
          <circle cx="0" cy="0" r="2.5" fill="currentColor" />
          <polyline points="0,0 18,18 40,18" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      )}
      <GlassPanel strong className="w-72 p-4">
        <div className="mb-0.5 flex items-start justify-between gap-2">
          <h3 className="font-head text-lg font-semibold leading-tight tracking-[var(--title-tracking)]">{title}</h3>
          {source && <SourceDot source={source} />}
        </div>
        <p className="mb-2 text-xs uppercase tracking-[0.08em] text-fg-muted">{type}</p>
        <div className="flex flex-col">{children}</div>
        {verdict && <div className="mt-2 border-t border-subtle pt-2">{verdict}</div>}
        {onFly && (
          <Button variant="primary" className="mt-3 w-full" onClick={onFly}>
            {flyLabel} <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
          </Button>
        )}
      </GlassPanel>
    </div>
  );
}

// ---------- Crop Card ----------

export function CropCard({
  id,
  name,
  optimum,
  compatibility,
  selected,
  onSelect,
}: {
  id: string;
  name: string;
  optimum: [number, number];
  compatibility?: number | null;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const s = compatibility == null ? null : statusOf(compatibility);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-ctl border p-2 text-left transition-colors duration-[120ms] ease-out",
        selected ? "border-accent bg-glow" : "border-subtle hover:bg-hover",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-hover">
        <CropGlyph id={id} className="size-7" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{name}</span>
        <span className="block text-xs text-fg-muted">
          оптимум: <Num value={optimum[0]} digits={0} />–<Num value={optimum[1]} unit="°C" digits={0} />
        </span>
        {compatibility != null && s && (
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-hover">
              <span className={cn("block h-full rounded-full", STATUS_META[s].bg)} style={{ width: `${Math.max(3, compatibility * 100)}%` }} />
            </span>
            <Num value={compatibility * 100} unit="%" digits={0} className="text-[11px]" />
          </span>
        )}
      </span>
    </button>
  );
}
