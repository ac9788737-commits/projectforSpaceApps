import { useTranslation } from "react-i18next";
import { PAT } from "@/ui/patterns";

/** Bar colour per kind of work; every bar also carries its label, so colour is never alone. */
const COLOR: Record<string, string> = {
  sow: "var(--good)",
  critical: "var(--risk)",
  harvest: "var(--crop-cereal)",
  cover_sow: "var(--crop-legume)",
  cover_end: "var(--soil-3)",
};

/** First-year field work on a 12-month ruler (docs/IMPROVEMENTS.md B11), drawn like a chart on a
 * form: label column, month grid, flat bars (docs/DESIGN.md §4). */
export function WorkCalendar({ items }: { items: { kind: string; label: string; start: number; end: number }[] }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  const MONTHS = t("common.months_short", { returnObjects: true }) as string[];
  const pct = (d: number) => (Math.max(0, Math.min(365, d)) / 365) * 100;
  return (
    <div className="grid grid-cols-[minmax(7rem,12rem)_minmax(0,1fr)] text-sm">
      <span />
      <div className="grid grid-cols-12 text-xs text-fg-muted">
        {MONTHS.map((m) => (
          <span key={m} className="border-l border-subtle pl-1">
            {m}
          </span>
        ))}
      </div>
      {items.map((it, i) => (
        <div key={i} className="contents">
          <span className="border-t border-subtle py-1 pr-2 leading-tight">{it.label}</span>
          <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-7 w-full border-t border-subtle" aria-hidden>
            {Array.from({ length: 11 }, (_, k) => (
              <line key={k} x1={((k + 1) * 100) / 12} x2={((k + 1) * 100) / 12} y1="0" y2="10" stroke="var(--rule)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            <rect x={pct(it.start)} y="2.5" width={Math.max(1.6, pct(Math.max(it.end, it.start + 6)) - pct(it.start))} height="5" fill={COLOR[it.kind] ?? "var(--ink)"} />
            {it.kind === "cover_sow" && <rect x={pct(it.start)} y="2.5" width={Math.max(1.6, pct(Math.max(it.end, it.start + 6)) - pct(it.start))} height="5" fill={PAT.cover} />}
          </svg>
        </div>
      ))}
    </div>
  );
}
