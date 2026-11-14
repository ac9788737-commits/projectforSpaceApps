import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Factor, PlanetDetail } from "@/api/client";
import { percent } from "@/lib/utils";

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--ink)",
  fontSize: 13,
};

const SHORT_LABELS: Record<string, string> = {
  temperature: "Темп.",
  light: "Свет",
  photoperiod: "День",
  spectrum: "Спектр",
  pressure: "Давление",
  gravity: "Гравитация",
  uv: "УФ",
  ionising: "Радиация",
};

export function FactorRadar({ factors }: { factors: Factor[] }) {
  const data = factors.map((factor) => ({
    label: SHORT_LABELS[factor.key] ?? factor.label,
    f: factor.f,
  }));
  return (
    <div role="img" aria-label="Радарная диаграмма факторов; значения приведены в таблице ниже">
      <ResponsiveContainer width="100%" height={360}>
        <RadarChart data={data} outerRadius="62%">
          <PolarGrid stroke="var(--grid)" />
          <PolarAngleAxis dataKey="label" tick={{ fill: "var(--ink-2)", fontSize: 11 }} />
          <PolarRadiusAxis
            domain={[0, 1]}
            tickCount={3}
            tick={{ fill: "var(--ink-3)", fontSize: 10 }}
            axisLine={false}
          />
          <Radar
            dataKey="f"
            name="Отклик"
            stroke="var(--series-1)"
            strokeWidth={2}
            fill="var(--series-1)"
            fillOpacity={0.18}
            dot={{ r: 3, fill: "var(--series-1)", strokeWidth: 0 }}
            isAnimationActive={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [percent(Number(value)), "Отклик"]}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SpectrumChart({ spectrum, starName }: { spectrum: PlanetDetail["spectrum"]; starName: string }) {
  const isSun = starName === "Солнце";
  return (
    <div role="img" aria-label="Спектр звезды в сравнении со спектром Солнца, полоса PAR 400–700 нм">
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={spectrum} margin={{ top: 22, right: 16, bottom: 20, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <ReferenceArea
            x1={400}
            x2={700}
            fill="var(--par-band)"
            stroke="none"
            ifOverflow="extendDomain"
            label={{ value: "PAR", position: "top", fill: "var(--ink-2)", fontSize: 12 }}
          />
          <XAxis
            dataKey="wavelength_nm"
            type="number"
            domain={[250, 2000]}
            ticks={[250, 500, 750, 1000, 1250, 1500, 1750, 2000]}
            stroke="var(--axis)"
            tick={{ fill: "var(--ink-3)", fontSize: 12 }}
            label={{ value: "Длина волны, нм", position: "insideBottom", offset: -12, fill: "var(--ink-3)", fontSize: 12 }}
          />
          <YAxis
            stroke="var(--axis)"
            tick={{ fill: "var(--ink-3)", fontSize: 12 }}
            tickFormatter={(value: number) => (value * 1000).toFixed(1)}
            width={44}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(value) => `${Math.round(Number(value))} нм`}
            formatter={(value, name) => [`${(Number(value) * 1000).toFixed(2)} ‰/нм`, name]}
          />
          {!isSun && (
            <Legend verticalAlign="top" align="right" height={24} wrapperStyle={{ fontSize: 13, color: "var(--ink-2)" }} />
          )}
          {!isSun && (
            <Line dataKey="star" name={starName} stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
          )}
          <Line dataKey="sun" name="Солнце" stroke="var(--series-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-ink-3">
        Вертикальная ось: доля полной мощности излучения на 1 нм, ‰/нм. Модель чёрного тела.
      </p>
    </div>
  );
}
