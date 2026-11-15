import { useDraggable, useDroppable } from "@dnd-kit/core";
import { X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { cropColor } from "@/ui/crops";
import { CropGlyph, Icon } from "@/ui/icons";
import { PAT } from "@/ui/patterns";
import type { Card, Link, Slot } from "./api";
import type { Clash } from "./rules";
import { SUMMER_SHARE } from "./SoilProfile";

const t = i18n.t.bind(i18n);

export const cellId = (year: number, slot: 0 | 1) => `cell-${year}-${slot}`;

export interface Fix {
  open: () => void;
  options: { crop: string; name_ru: string }[] | null;
  loading: boolean;
  pick: (crop: string) => void;
}

/** Grid columns of the plan: per year a wide summer strip and a narrow winter strip. */
export const planColumns = (years: number) => Array.from({ length: years }, () => `minmax(0, ${SUMMER_SHARE}fr) minmax(0, ${1 - SUMMER_SHARE}fr)`).join(" ");

function FixChips({ fix }: { fix: Fix }) {
  if (!fix.options) {
    return (
      <button type="button" onClick={fix.open} className="w-full cursor-pointer rounded-ctl border border-dashed border-subtle px-2 py-1 text-xs text-fg hover:bg-hover" disabled={fix.loading}>
        {fix.loading ? t("timeline.fix_loading") : t("timeline.fix")}
      </button>
    );
  }
  if (!fix.options.length) return <p className="text-xs text-fg-muted">{t("timeline.no_fix")}</p>;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-fg-muted">{t("timeline.replace")}</span>
      {fix.options.map((o) => (
        <button key={o.crop} type="button" onClick={() => fix.pick(o.crop)} className="inline-flex cursor-pointer items-center gap-1 rounded-ctl border border-accent px-1.5 py-0.5 hover:bg-hover">
          <CropGlyph crop={o.crop} size={14} /> {o.name_ru}
        </button>
      ))}
    </div>
  );
}

/** Fill of a strip: the seed-packet colour of the family, hatched for a cover crop; bare soil
 * shows the soil colour with a dust raster (docs/DESIGN.md §2.3). */
function StripFill({ crop, cover }: { crop: string | null; cover: boolean }) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
      {crop ? (
        <>
          <rect width="100%" height="100%" fill={cropColor(crop)} fillOpacity="0.42" />
          <rect width="100%" height="6" fill={cropColor(crop)} />
          {cover && <rect width="100%" height="100%" fill={PAT.cover} />}
        </>
      ) : cover ? (
        <>
          <rect width="100%" height="100%" fill="var(--soil-2)" fillOpacity="0.55" />
          <rect width="100%" height="100%" fill={PAT.bare} />
        </>
      ) : null}
    </svg>
  );
}

function Cell({
  year,
  slot,
  crop,
  card,
  clash,
  onClear,
  focus,
  first,
}: {
  year: number;
  slot: 0 | 1;
  crop: string | null;
  card?: Card;
  clash?: Clash;
  onClear: () => void;
  focus: boolean;
  first: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: cellId(year, slot), data: { year, slot } });
  const drag = useDraggable({ id: `placed-${year}-${slot}`, data: { crop, fromYear: year, fromSlot: slot }, disabled: !crop });
  const label = `${t("timeline.cell", { y: year + 1, season: t(slot === 0 ? "timeline.summer" : "timeline.winter") })}${crop && card ? `: ${card.name_ru}` : t("timeline.empty")}`;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative flex min-h-16 min-w-0 items-start gap-1 px-1.5 pb-1 pt-2.5 text-sm transition-[outline-color] duration-300",
        !crop && slot === 0 && "border border-dashed border-subtle",
        isOver && "outline-2 outline-offset-[-2px] outline-[var(--ink)]",
        clash && !isOver && (clash.warn ? "outline-2 outline-offset-[-2px] outline-[var(--caution)]" : "outline-2 outline-offset-[-2px] outline-[var(--risk)]"),
        focus && !isOver && !clash && "outline-1 outline-offset-[-1px] outline-[var(--ink)]",
      )}
      title={clash?.text}
      role="group"
      aria-label={label}
    >
      <StripFill crop={crop} cover={slot === 1} />
      {crop && card ? (
        <>
          <div ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes} className="relative flex min-w-0 flex-1 cursor-grab flex-col gap-0.5 active:cursor-grabbing">
            <CropGlyph crop={crop} size={slot === 0 ? 22 : 18} className="shrink-0" />
            <span className={cn("block font-medium leading-tight [hyphens:auto] [overflow-wrap:break-word]", slot === 1 && "text-xs")}>{card.name_ru}</span>
          </div>
          <button type="button" onClick={onClear} className="relative -mr-1 shrink-0 cursor-pointer rounded-ctl p-0.5 text-fg-muted hover:bg-panel hover:text-fg" aria-label={t("timeline.remove", { c: card.name_ru, y: year + 1 })}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </>
      ) : (
        <span className={cn("relative w-full text-xs", slot === 1 ? "font-medium text-fg" : "text-fg-muted")}>{slot === 1 ? t("plan.bare") : first ? t("plan.drop_first") : t("timeline.summer_hint")}</span>
      )}
    </div>
  );
}

/** One line of the notes under a year: a mark, then plain text. */
function Note({ icon, tone, children }: { icon: Parameters<typeof Icon>[0]["name"]; tone?: "risk" | "caution" | "good"; children: ReactNode }) {
  return (
    <p className={cn("flex gap-1 text-xs leading-snug", tone === "risk" ? "text-risk" : tone === "caution" ? "text-caution" : "text-fg")}>
      <Icon name={icon} size={14} className="mt-px shrink-0" />
      <span className={tone ? "" : "text-fg"}>{children}</span>
    </p>
  );
}

/**
 * The plan of the field (docs/DESIGN.md §6): years × (summer | winter) strips that take the
 * cards, links drawn as thin ink lines between the years, and the soil profile underneath
 * (passed in as `profile`, column for column).
 */
export function Timeline({
  plan,
  deck,
  clashes,
  links,
  reasons,
  focus,
  onClear,
  weatherYears,
  fixFor,
  coverNotes,
  profile,
}: {
  fixFor?: (year: number, slot: 0 | 1) => Fix;
  coverNotes?: { year: number; text: string; dry: boolean }[];
  plan: Slot[];
  deck: Card[];
  clashes: Clash[];
  links: Link[];
  reasons?: { main: string | null; cover: string | null }[];
  focus: { year: number; slot: 0 | 1 } | null;
  onClear: (year: number, slot: 0 | 1) => void;
  weatherYears?: number[];
  profile?: ReactNode;
}) {
  const byId = new Map(deck.map((c) => [c.id, c]));
  const cols: CSSProperties = { gridTemplateColumns: planColumns(plan.length) };
  const between = links.filter((l) => (l.kind === "nitrogen" || l.kind === "warning") && l.to && l.to.year !== l.from.year);
  const col = (year: number, slot: "main" | "cover") => year * 2 + (slot === "main" ? 1 : 2);
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[620px]">
        {/* year heads */}
        <div className="grid border-b border-subtle" style={cols}>
          {plan.map((_, y) => (
            <p key={y} className="col-span-2 flex items-baseline justify-between gap-2 border-l border-subtle px-1.5 pb-1 text-xs text-fg-muted first:border-l-0" style={{ gridColumn: `${y * 2 + 1} / span 2` }}>
              <span className="font-head text-sm font-semibold text-fg">{t("timeline.year", { y: y + 1 })}</span>
              {weatherYears?.[y] ? <span>{t("timeline.weather", { y: weatherYears[y] })}</span> : null}
            </p>
          ))}
        </div>
        {/* strips */}
        <div className="grid gap-x-[2px] pt-[2px]" style={cols}>
          {plan.map(([m, c], y) => [
            <Cell key={`${y}-0`} year={y} slot={0} crop={m} card={m ? byId.get(m) : undefined} clash={clashes.find((x) => x.year === y && x.slot === 0)} onClear={() => onClear(y, 0)} focus={focus?.year === y && focus.slot === 0} first={y === 0} />,
            <Cell key={`${y}-1`} year={y} slot={1} crop={c} card={c ? byId.get(c) : undefined} clash={clashes.find((x) => x.year === y && x.slot === 1)} onClear={() => onClear(y, 1)} focus={focus?.year === y && focus.slot === 1} first={false} />,
          ])}
        </div>
        {/* the soil profile, column for column */}
        {profile}
        {/* links between years: thin ink lines from one strip to another, text under the line */}
        {between.length > 0 && (
          <div className="mt-2 grid gap-y-1.5" style={cols} aria-label={t("timeline.links")} role="list">
            {between.map((l, i) => (
              <div key={i} role="listitem" className="relative px-1 pt-1.5 text-xs leading-snug" style={{ gridColumn: `${col(l.from.year, l.from.slot)} / ${col(l.to!.year, l.to!.slot) + 1}` }}>
                <svg className="absolute inset-x-0 top-0 h-2 w-full" preserveAspectRatio="none" viewBox="0 0 100 8" aria-hidden>
                  <path key={l.text} d="M0.5,8 V1 H99.5 V8" className="draw-on" fill="none" stroke={l.good ? "var(--ink)" : "var(--risk)"} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                </svg>
                <span className={l.good ? "text-fg" : "text-risk"}>
                  <b className="font-medium">{t(l.good ? "plan.plus" : "plan.risk")}:</b> {l.text}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* notes under each year: warnings, swaps, reasons, cover crop timing */}
        <div className="mt-2 grid gap-x-3" style={{ gridTemplateColumns: `repeat(${plan.length}, minmax(0, 1fr))` }}>
          {plan.map(([m, c], y) => {
            const clash = clashes.filter((x) => x.year === y);
            // a warning line already drawn into this year says the same thing in more detail
            const lined = between.some((l) => !l.good && l.to?.year === y);
            const self = links.filter((l) => l.from.year === y && (l.to === null || l.to.year === y) && l.kind !== "warning");
            const reason = reasons?.[y];
            return (
              <div key={y} className="flex min-w-0 flex-col gap-1">
                {clash.filter((x) => x.warn || !lined).map((x, i) => (
                  <Note key={`k${i}`} icon="shield" tone={x.warn ? "caution" : "risk"}>
                    {x.text}
                  </Note>
                ))}
                {m && fixFor && clash.some((x) => x.slot === 0) && <FixChips fix={fixFor(y, 0)} />}
                {c && fixFor && clash.some((x) => x.slot === 1) && <FixChips fix={fixFor(y, 1)} />}
                {reason?.main && <Note icon="sprout">{reason.main}</Note>}
                {reason?.cover && <Note icon="sprout">{reason.cover}</Note>}
                {coverNotes
                  ?.filter((n) => n.year === y)
                  .map((n) => (
                    <Note key={`c${n.year}`} icon="calendar" tone={n.dry ? "caution" : undefined}>
                      {n.text}
                    </Note>
                  ))}
                {self.map((l, i) => (
                  <Note key={i} icon={l.kind === "erosion" ? "rain" : "sprout"} tone={l.good ? undefined : "risk"}>
                    {l.text}
                  </Note>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
