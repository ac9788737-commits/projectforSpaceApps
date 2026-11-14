import { Layers } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button, GlassPanel } from "@/ui/primitives";
import { EVENT_META, type EventType } from "@/ui/time";
import { farmMutations, type Catalog } from "./session";
import { DECK_MIME } from "./SeasonTimeline";
import { useFarm } from "./store";

const LEVEL_RU = { weak: "слабо", medium: "средне", strong: "сильно" } as const;
type Level = keyof typeof LEVEL_RU;

/** Deck of weather cards: click — the event starts now; drag onto the timeline — it is scheduled. */
export function EventDeck({ catalog }: { catalog: Catalog | undefined }) {
  // Opens above the timeline; open by default only on tall screens where it leaves the scene visible.
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerHeight >= 1000);
  const [level, setLevel] = useState<Level>("medium");
  const sessionId = useFarm((s) => s.sessionId);
  const m = farmMutations(sessionId);
  // On short screens the deck covers the scene, so it folds away after use.
  const collapseIfCramped = () => {
    if (window.innerHeight < 1000) setOpen(false);
  };
  if (!catalog) return null;
  return (
    <>
      <Button variant="secondary" size="sm" className="h-8" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="event-deck">
        <Layers size={16} strokeWidth={1.5} /> События
      </Button>
      {open && (
    <GlassPanel id="event-deck" strong className="absolute bottom-full right-0 z-30 mb-2 max-h-[min(70vh,calc(100vh-180px))] w-80 max-w-[calc(100vw-2*var(--edge))] overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-2">
        <Layers size={16} strokeWidth={1.5} className="text-fg-muted" aria-hidden />
        <h2 className="font-head text-sm font-semibold">Колода событий</h2>
        <Button variant="ghost" size="sm" className="ml-auto h-8" onClick={() => setOpen(false)}>
          Свернуть
        </Button>
      </div>
      <div className="mb-2 flex gap-1" role="group" aria-label="Сила события">
        {(Object.keys(LEVEL_RU) as Level[]).map((l) => (
          <Button key={l} variant="ghost" size="sm" pressed={level === l} onClick={() => setLevel(l)} className="h-8 flex-1 text-xs">
            {LEVEL_RU[l]}
          </Button>
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-1.5" aria-label="Карточки событий">
        {catalog.events.map((e) => {
          const meta = EVENT_META[e.id as EventType];
          return (
            <li key={e.id}>
              <button
                type="button"
                draggable
                onDragStart={(ev) => {
                  ev.dataTransfer.setData(DECK_MIME, JSON.stringify({ type: e.id, intensity: level }));
                  ev.dataTransfer.effectAllowed = "copy";
                }}
                onDragEnd={collapseIfCramped}
                onClick={() => {
                  m.event(e.id, level, "now");
                  collapseIfCramped();
                }}
                title={`${e.name_ru}: ${e.harm_ru}. Клик — начать сейчас, перетащить на таймлайн — запланировать.`}
                className={cn(
                  "flex min-h-10 w-full cursor-grab items-center gap-2 rounded-ctl border border-subtle bg-hover px-2 py-1.5 text-left text-xs leading-tight text-fg transition-colors duration-[120ms] hover:border-accent active:cursor-grabbing",
                )}
              >
                {meta && <meta.Icon size={16} strokeWidth={1.5} className={cn("shrink-0", meta.tone)} aria-hidden />}
                <span>{e.name_ru}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-fg-muted">Клик — событие начнётся сейчас. Перетащите карточку на дорожку внизу, чтобы запланировать.</p>
    </GlassPanel>
      )}
    </>
  );
}
