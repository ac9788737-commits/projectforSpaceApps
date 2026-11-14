import { CloudOff, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { LogoMark } from "./Logo";
import { Button, GlassPanel } from "./primitives";

/** §9 Loading: dark screen, logo, a slowly orbiting dot-planet, one calm line. */
export function LoadingScreen({ text = "Рассчитываем орбиты…" }: { text?: string }) {
  return (
    <div data-mood="space" className="grid h-dvh w-full place-items-center bg-void" role="status">
      <div className="flex flex-col items-center gap-5">
        <div className="relative size-20">
          <LogoMark size={80} className="text-fg-muted" />
          <span className="absolute inset-0 animate-[spin-slow_6s_linear_infinite] motion-reduce:animate-none">
            <span className="absolute left-1/2 top-0 size-2.5 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_12px_var(--accent-glow)]" />
          </span>
        </div>
        <p className="font-head text-sm tracking-[0.12em] text-fg-muted uppercase">AstroCrop</p>
        <p className="text-sm text-fg">{text}</p>
      </div>
    </div>
  );
}

/** Soft in-scene loading line (data still coming, scene already visible). */
export function LoadingLine({ text }: { text: string }) {
  return (
    <GlassPanel className="flex items-center gap-3 px-4 py-3 text-sm" role="status">
      <span className="relative size-4">
        <span className="absolute inset-0 rounded-full border border-subtle" />
        <span className="absolute inset-0 animate-[spin-slow_2.4s_linear_infinite] motion-reduce:animate-none">
          <span className="absolute left-1/2 top-[-2px] size-1.5 -translate-x-1/2 rounded-full bg-accent" />
        </span>
      </span>
      {text}
    </GlassPanel>
  );
}

/** §9 Source error: a soft plaque, never a blocking error. */
export function SourceNotice({ children }: { children: ReactNode }) {
  return (
    <GlassPanel className="flex items-start gap-2 px-3 py-2 text-xs leading-snug text-fg-muted" role="status">
      <CloudOff size={16} strokeWidth={1.5} className="mt-px shrink-0 text-stress" aria-hidden />
      <span>{children}</span>
    </GlassPanel>
  );
}

/** §9 No data: ask the user to choose instead of showing an empty screen. */
export function NoDataPanel({
  question,
  options,
  onPick,
}: {
  question: string;
  options: { id: string; label: string }[];
  onPick: (id: string) => void;
}) {
  return (
    <GlassPanel className="w-full max-w-sm p-4">
      <p className="mb-3 text-sm leading-snug">{question}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <Button key={o.id} variant="secondary" size="sm" onClick={() => onPick(o.id)}>
            {o.label}
          </Button>
        ))}
      </div>
    </GlassPanel>
  );
}

/** §9 Plant died: calm card with the reason and what would have helped. */
export function DeadPlantCard({
  crop,
  cause,
  when,
  suggestions,
  retryLabel,
  onRetry,
}: {
  crop: string;
  cause: string;
  when: string;
  suggestions: ReactNode[];
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-pnl border border-subtle bg-hover p-3 text-sm">
      <p className="font-medium">
        {crop} не выжил{crop.endsWith("а") ? "а" : ""}: {when}
      </p>
      <p className="mt-1 text-fg-muted">Причина: <span className="text-fg">{cause}</span></p>
      {suggestions.length > 0 && (
        <>
          <p className="mt-2 text-fg-muted">Что помогло бы:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {suggestions.map((s, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-leaf" aria-hidden>+</span>
                {s}
              </li>
            ))}
          </ul>
        </>
      )}
      {onRetry && retryLabel && (
        <Button variant="primary" size="sm" className="mt-3" onClick={onRetry}>
          <RotateCcw size={16} strokeWidth={1.5} /> {retryLabel}
        </Button>
      )}
    </div>
  );
}
