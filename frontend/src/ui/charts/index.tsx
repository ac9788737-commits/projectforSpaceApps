import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { formatNumber } from "../format";

/** Shared chart style (§7): 2 px monotone lines, horizontal grid, glass tooltip, mono values. */
export const chartTheme = {
  grid: "var(--border-subtle)",
  axis: "var(--border-subtle)",
  tick: { fill: "var(--text-secondary)", fontSize: 12, fontFamily: "var(--font-data)" },
  today: "var(--accent)",
};

export interface Series {
  key: string;
  name: string;
  color: string; // a CSS variable, e.g. "var(--series-1)"
  unit?: string;
}

function GlassTooltip({ active, payload, label, labelFormatter, units }: TooltipProps<number, string> & { units: Record<string, string> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-ctl border border-subtle bg-panel-strong px-3 py-2 text-xs text-fg shadow-lg backdrop-blur-[16px]">
      <p className="mb-1 text-fg-muted">{labelFormatter ? labelFormatter(label, payload) : label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded" style={{ background: p.color }} aria-hidden />
          <span className="text-fg-muted">{p.name}</span>
          <span className="ml-auto font-num">
            {formatNumber(Number(p.value), 1)}
            <span className="text-fg-muted"> {units[String(p.dataKey)] ?? ""}</span>
          </span>
        </p>
      ))}
    </div>
  );
}

export function TimeSeriesChart({
  data,
  xKey,
  series,
  today,
  height = 160,
  yDomain,
  zones,
  xLabel,
  ariaLabel,
}: {
  data: Record<string, number>[];
  xKey: string;
  series: Series[];
  today?: number;
  height?: number;
  yDomain?: [number | "auto", number | "auto"];
  zones?: boolean; // ok/stress/lethal bands for 0–100 % response charts
  xLabel?: (x: number) => string;
  ariaLabel: string;
}) {
  const units = Object.fromEntries(series.map((s) => [s.key, s.unit ?? ""]));
  return (
    <div role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
          {zones && (
            <>
              <ReferenceArea y1={0} y2={2} fill="var(--lethal)" fillOpacity={0.12} stroke="none" />
              <ReferenceArea y1={2} y2={80} fill="var(--stress)" fillOpacity={0.07} stroke="none" />
              <ReferenceArea y1={80} y2={100} fill="var(--ok)" fillOpacity={0.08} stroke="none" />
            </>
          )}
          <CartesianGrid stroke={chartTheme.grid} vertical={false} />
          <XAxis dataKey={xKey} type="number" domain={[0, "dataMax"]} tick={chartTheme.tick} stroke={chartTheme.axis} tickLine={false} />
          <YAxis tick={chartTheme.tick} stroke={chartTheme.axis} tickLine={false} axisLine={false} domain={yDomain ?? [0, "auto"]} width={40} />
          <Tooltip
            content={<GlassTooltip units={units} />}
            labelFormatter={(v) => (xLabel ? xLabel(Number(v)) : String(v))}
            cursor={{ stroke: "var(--border-subtle)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "var(--font-ui)" }} iconType="plainline" iconSize={12} />
          {today != null && <ReferenceLine x={today} stroke={chartTheme.today} strokeWidth={1.5} />}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
