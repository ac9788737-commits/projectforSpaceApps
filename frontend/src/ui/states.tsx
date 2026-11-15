import { CloudOff, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { LogoMark } from "./Logo";
import { Button, Panel } from "./primitives";

/** Loading: paper, the name, one calm line; no orbiting planets (docs/DESIGN.md §8). */
export function LoadingScreen({ text = "Загружаю…" }: { text?: string }) {
  return (
    <div data-mood="field" className="grid h-dvh w-full place-items-center bg-panel text-fg" role="status">
      <div className="flex flex-col items-center gap-2">
        <LogoMark size={48} className="text-fg-muted" />
        <p className="font-head text-lg">WhatCropNext</p>
        <p className="text-sm text-fg-muted">{text}</p>
      </div>
    </div>
  );
}

/** Loading line: a short ruler that fills, like a progress mark on a form. */
export function LoadingLine({ text }: { text: string }) {
  return (
    <Panel className="flex items-center gap-3 px-4 py-3 text-sm" role="status">
      <span className="relative h-1 w-10 overflow-hidden bg-hover" aria-hidden>
        <span className="absolute inset-y-0 left-0 w-1/3 bg-fg-muted motion-safe:animate-[ruler_1.2s_ease-in-out_infinite]" />
      </span>
      {text}
    </Panel>
  );
}

/** §9 Source error: a soft plaque, never a blocking error. */
export function SourceNotice({ children }: { children: ReactNode }) {
  return (
    <Panel className="flex items-start gap-2 px-3 py-2 text-xs leading-snug text-fg-muted" role="status">
      <CloudOff size={16} strokeWidth={1.5} className="mt-px shrink-0 text-stress" aria-hidden />
      <span>{children}</span>
    </Panel>
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
    <Panel className="w-full max-w-sm p-4">
      <p className="mb-3 text-sm leading-snug">{question}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <Button key={o.id} variant="secondary" size="sm" onClick={() => onPick(o.id)}>
            {o.label}
          </Button>
        ))}
      </div>
    </Panel>
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
