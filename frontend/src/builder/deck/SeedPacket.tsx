import { useDraggable } from "@dnd-kit/core";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { cropColor } from "@/ui/crops";
import type { Card } from "../api";
import { PacketPlant } from "../scene/plants";

const t = i18n.t.bind(i18n);

/** Paper grain for the packets: a faint SVG noise, rendered once. */
export function PaperGrainDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <filter id="paper-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
        <feColorMatrix values="0 0 0 0 0.14  0 0 0 0 0.19  0 0 0 0 0.12  0 0 0 0.9 0" />
      </filter>
    </svg>
  );
}

/** The picture half of a packet: the crop on its family colour, a crimped top edge, paper grain. */
export function PacketFace({ card, tall = 96 }: { card: Card; tall?: number }) {
  return (
    <svg viewBox="0 0 120 100" className="block w-full" style={{ height: tall }} aria-hidden>
      <path d="M0 6 L6 0 L12 6 L18 0 L24 6 L30 0 L36 6 L42 0 L48 6 L54 0 L60 6 L66 0 L72 6 L78 0 L84 6 L90 0 L96 6 L102 0 L108 6 L114 0 L120 6 V100 H0 Z" fill={cropColor(card.id, card.family)} />
      {/* the packet's window: a light oval the picture sits in */}
      <ellipse cx="60" cy="56" rx="44" ry="38" fill="var(--paper-sheet)" fillOpacity="0.9" />
      <ellipse cx="60" cy="56" rx="44" ry="38" fill="none" stroke="var(--paper-sheet)" strokeWidth="3" />
      <g transform="translate(60 90)">
        <PacketPlant crop={card.id} size={82} />
      </g>
      <rect width="120" height="100" filter="url(#paper-grain)" opacity="0.04" />
    </svg>
  );
}

/** A seed packet in the deck (docs/DESIGN_V3.md §2.3): picture on top, name and use below; lies on
 * the table with a short shadow; picked up, it is tilted in the hand (the drag overlay). */
export function SeedPacket({ card }: { card: Card }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `deck-${card.id}`, data: { crop: card.id } });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      className={cn(
        "group relative flex w-32 shrink-0 cursor-grab flex-col overflow-hidden rounded-md bg-[var(--paper-sheet)] text-left shadow-[var(--shadow-packet)] transition-transform duration-300 ease-[var(--ease-panel)] hover:-translate-y-1 active:cursor-grabbing",
        isDragging && "opacity-30",
      )}
      aria-label={t("timeline.drag", { c: card.name_ru, hint: card.hint })}
    >
      <PacketFace card={card} />
      <span className="flex flex-1 flex-col gap-0.5 px-2 pb-2 pt-1.5">
        <span className="font-head text-lg font-semibold leading-tight [hyphens:auto]">{card.name_ru}</span>
        <span className="line-clamp-2 text-xs leading-snug text-fg-muted">{card.hint}</span>
        <span className="mt-auto flex flex-wrap gap-x-2 pt-1 text-xs text-fg-muted">
          <span>{t("timeline.water_need", { w: card.water })}</span>
          <span>{t("timeline.start", { v: card.start_cost_usd })}</span>
        </span>
        {(card.expensive || card.needs_water) && (
          <span className="flex flex-wrap gap-1 pt-0.5 text-xs">
            {card.expensive && <span className="rounded border border-[var(--risk)] px-1 text-risk">{t("timeline.expensive")}</span>}
            {card.needs_water && <span className="rounded border border-[var(--water)] px-1 text-water">{t("timeline.needs_water")}</span>}
          </span>
        )}
      </span>
    </button>
  );
}

/** The packet in the hand: lifted, tilted 4°, longer shadow. */
export function PacketInHand({ card }: { card: Card }) {
  return (
    <div className="w-32 rotate-[4deg] overflow-hidden rounded-md bg-[var(--paper-sheet)] shadow-[var(--shadow-lifted)]">
      <PacketFace card={card} />
      <p className="px-2 pb-2 pt-1 font-head text-lg font-semibold leading-tight">{card.name_ru}</p>
    </div>
  );
}
