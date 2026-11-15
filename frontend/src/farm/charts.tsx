import { formatNumber } from "@/ui/format";

/** Small bar chart: one bar per label; value printed on hover (title) and on the tallest bar. */
export function Bars({
  labels,
  values,
  unit,
  label,
  color = "var(--series-1)",
  height = 96,
}: {
  labels: string[];
  values: (number | null)[];
  unit: string;
  label: string;
  color?: string;
  height?: number;
}) {
  const max = Math.max(1e-9, ...values.map((v) => v ?? 0));
  const n = values.length;
  const w = 100 / n;
  const top = values.indexOf(Math.max(...values.map((v) => v ?? -Infinity)));
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-24 w-full" role="img" aria-label={label}>
        <line x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} stroke="var(--border-subtle)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {values.map((v, i) =>
          v == null ? (
            <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={height - 3} height={2} fill="var(--border-subtle)">
              <title>{`${labels[i]}: нет данных`}</title>
            </rect>
          ) : (
            <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={height - (v / max) * (height - 12)} height={(v / max) * (height - 12)} rx="0.8" fill={color}>
              <title>{`${labels[i]}: ${formatNumber(v, v < 10 ? 1 : 0)} ${unit}`}</title>
            </rect>
          ),
        )}
      </svg>
      <figcaption className="mt-0.5 flex justify-between text-xs text-fg-muted">
        <span>{labels[0]}</span>
        {top >= 0 && values[top] != null && (
          <span>
            макс. {formatNumber(values[top]!, (values[top] ?? 0) < 10 ? 1 : 0)} {unit} ({labels[top]})
          </span>
        )}
        <span>{labels[labels.length - 1]}</span>
      </figcaption>
    </figure>
  );
}

const MONTHS = ["я", "ф", "м", "а", "м", "и", "и", "а", "с", "о", "н", "д"];

/** Years × months grid of a standardised index (SPEI): dry = lethal hue, wet = real-data hue. */
export function IndexGrid({ years, values, label }: { years: number[]; values: (number | null)[][]; label: string }) {
  const cell = (v: number | null) => {
    if (v == null) return { fill: "var(--border-subtle)", opacity: 1 };
    const k = Math.min(1, Math.abs(v) / 2);
    if (Math.abs(v) < 0.5) return { fill: "var(--text-secondary)", opacity: 0.15 };
    return { fill: v < 0 ? "var(--lethal)" : "var(--data-real)", opacity: 0.25 + 0.75 * k };
  };
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${12 * 10 + 30} ${years.length * 8 + 10}`} className="w-full" role="img" aria-label={label}>
        {MONTHS.map((m, j) => (
          <text key={j} x={30 + j * 10 + 5} y={7} textAnchor="middle" fontSize="6" fill="var(--text-secondary)">
            {m}
          </text>
        ))}
        {years.map((y, i) => (
          <g key={y}>
            <text x={26} y={10 + i * 8 + 6} textAnchor="end" fontSize="6" fill="var(--text-secondary)">
              {y}
            </text>
            {values[i].map((v, j) => {
              const c = cell(v);
              return (
                <rect key={j} x={30 + j * 10 + 0.5} y={10 + i * 8 + 0.5} width={9} height={7} rx="1" fill={c.fill} fillOpacity={c.opacity}>
                  <title>{`${y}, ${j + 1}-й месяц: ${v == null ? "нет данных" : formatNumber(v, 1)}`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-3 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-[var(--lethal)]" aria-hidden /> засуха (SPEI ≤ −0,5)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-[var(--text-secondary)] opacity-30" aria-hidden /> норма
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-[var(--data-real)]" aria-hidden /> влажно
        </span>
      </figcaption>
    </figure>
  );
}
