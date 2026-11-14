import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, unwrap, type SimulateRequest, type Simulation } from "@/api/client";
import { FactorRadar } from "@/components/charts";
import { PlanetPicker, planetLabel } from "@/components/PlanetPicker";
import { Badge, Button, Card, CardTitle, Field, Input, Notice, Select, StatusLabel } from "@/components/ui";
import {
  CONFIDENCE_LABELS,
  ENGINEERING_LABELS,
  cn,
  fmt,
  percent,
  SCENARIOS,
  type ScenarioId,
} from "@/lib/utils";

const RANGE_OPTIONS = [
  { id: "albedo", label: "Альбедо", low: "0.1", high: "0.6" },
  { id: "surface_temp_k", label: "Температура поверхности, К", low: "250", high: "320" },
  { id: "insolation_earth", label: "Освещённость, S⊕", low: "0.5", high: "1.5" },
];

function Result({ result }: { result: Simulation }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs text-ink-2">Урожайность от земной</p>
          <p className="mt-1 text-4xl font-semibold">{percent(result.yield_rel)}</p>
          {result.monte_carlo && (
            <p className="mt-1 text-xs text-ink-2">
              P10 {percent(result.monte_carlo.p10)}, P50 {percent(result.monte_carlo.p50)}, P90{" "}
              {percent(result.monte_carlo.p90)}. Выживание в{" "}
              {percent(result.monte_carlo.survival_probability)} прогонов.
            </p>
          )}
        </Card>
        <Card>
          <p className="text-xs text-ink-2">Выживаемость</p>
          <p className="mt-2">
            <StatusLabel status={result.survival ? "ok" : "lethal"} />
          </p>
          <p className="mt-1 text-sm">{result.survival ? "Растение выживает" : "Растение погибает"}</p>
        </Card>
        <Card>
          <p className="text-xs text-ink-2">Время до урожая</p>
          <p className="mt-1 text-2xl font-semibold">
            {result.days_to_harvest ? `${Math.round(result.days_to_harvest)} сут` : "нет урожая"}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-ink-2">Лимитирующий фактор</p>
          <p className="mt-1 text-lg font-semibold">{result.limiting_factor_label}</p>
          <p className="mt-1 text-xs text-ink-2">Уверенность: {CONFIDENCE_LABELS[result.confidence]}</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Отклик по факторам</CardTitle>
          <FactorRadar factors={result.factors} />
        </Card>
        <Card className="overflow-x-auto">
          <CardTitle>Таблица факторов</CardTitle>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-2">
                <th className="py-1 font-medium">Фактор</th>
                <th className="py-1 text-right font-medium">Значение</th>
                <th className="py-1 text-right font-medium">Отклик</th>
                <th className="py-1 pl-3 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {result.factors.map((factor) => (
                <tr key={factor.key} className="border-b border-line last:border-0">
                  <td className="py-1.5">{factor.label}</td>
                  <td className="py-1.5 text-right text-ink-2">
                    {factor.key === "water"
                      ? factor.value
                        ? "доступна"
                        : "нет жидкой воды"
                      : fmt(factor.value, factor.unit)}
                  </td>
                  <td className="py-1.5 text-right">{percent(factor.f)}</td>
                  <td className="py-1.5 pl-3">
                    <StatusLabel status={factor.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle>Рекомендации</CardTitle>
          {result.recommendations.length ? (
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {result.recommendations.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">Условия подходят, менять ничего не нужно.</p>
          )}
        </Card>
        <Card>
          <CardTitle>Допущения</CardTitle>
          <ul className="list-disc space-y-1 pl-4 text-sm text-ink-2">
            {result.assumptions.map((item) => (
              <li key={item.code}>{item.text}</li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Инженерия</CardTitle>
          <dl className="space-y-1 text-sm">
            {Object.entries(result.engineering).map(([key, value]) => {
              const meta = ENGINEERING_LABELS[key] ?? { label: key };
              const text =
                typeof value === "boolean"
                  ? value
                    ? "да"
                    : "нет"
                  : typeof value === "number"
                    ? fmt(value, meta.unit)
                    : (value ?? "нет данных");
              return (
                <div key={key} className="flex justify-between gap-3">
                  <dt className="text-ink-2">{meta.label}</dt>
                  <dd className="tabular text-right">{text}</dd>
                </div>
              );
            })}
          </dl>
        </Card>
      </div>
    </div>
  );
}

export default function Simulator() {
  const [params] = useSearchParams();
  const initialPlanet = params.get("planet") ?? "mars";
  const [planetId, setPlanetId] = useState(initialPlanet);
  const [planetName, setPlanetName] = useState("");
  const [cropId, setCropId] = useState("potato");
  const [scenario, setScenario] = useState<ScenarioId>("greenhouse");
  const [preset, setPreset] = useState("");
  const [monteCarlo, setMonteCarlo] = useState(false);
  const [range, setRange] = useState(RANGE_OPTIONS[0]);
  const [low, setLow] = useState(RANGE_OPTIONS[0].low);
  const [high, setHigh] = useState(RANGE_OPTIONS[0].high);

  const planet = useQuery({
    queryKey: ["planet", planetId],
    queryFn: () =>
      unwrap(api.GET("/planets/{planet_id}", { params: { path: { planet_id: planetId } } })),
  });
  useEffect(() => {
    if (planet.data) {
      const row = planet.data.planet as { name: string; name_ru: string | null };
      setPlanetName(planetLabel(row));
    }
  }, [planet.data]);

  const crops = useQuery({ queryKey: ["crops"], queryFn: () => unwrap(api.GET("/crops")) });
  const presets = useQuery({
    queryKey: ["presets"],
    queryFn: () => unwrap(api.GET("/atmosphere-presets")),
  });

  const simulate = useMutation({
    mutationFn: (body: SimulateRequest) => unwrap(api.POST("/simulate", { body })),
  });

  const run = () => {
    const ranges = monteCarlo ? { [range.id]: [Number(low), Number(high)] as [number, number] } : undefined;
    simulate.mutate({
      planet_id: planetId,
      crop_id: cropId,
      scenario,
      atmosphere_preset: (preset || null) as SimulateRequest["atmosphere_preset"],
      ranges,
      monte_carlo_n: 1000,
    });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Симулятор</h1>
      <Card className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Планета">
            <PlanetPicker value={planetName} onPick={(p) => setPlanetId(p.id)} />
          </Field>
          <Field label="Культура">
            <Select value={cropId} onChange={(e) => setCropId(e.target.value)}>
              {crops.data?.map((crop) => (
                <option key={crop.id} value={crop.id}>
                  {crop.name_ru}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Атмосфера">
            <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="">Данные планеты</option>
              {presets.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Сценарий">
          {SCENARIOS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={scenario === item.id}
              onClick={() => setScenario(item.id)}
              className={cn(
                "cursor-pointer rounded-md border p-3 text-left",
                scenario === item.id ? "border-accent bg-surface-2" : "border-line hover:bg-surface-2",
              )}
            >
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="block text-xs text-ink-2">{item.hint}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={monteCarlo} onChange={(e) => setMonteCarlo(e.target.checked)} />
            Монте-Карло, 1000 прогонов
          </label>
          {monteCarlo && (
            <>
              <div className="w-56">
                <Field label="Неопределённый параметр">
                  <Select
                    value={range.id}
                    onChange={(e) => {
                      const next = RANGE_OPTIONS.find((o) => o.id === e.target.value)!;
                      setRange(next);
                      setLow(next.low);
                      setHigh(next.high);
                    }}
                  >
                    {RANGE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="w-24">
                <Field label="От">
                  <Input inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
                </Field>
              </div>
              <div className="w-24">
                <Field label="До">
                  <Input inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} />
                </Field>
              </div>
            </>
          )}
          <Button className="ml-auto" onClick={run} disabled={simulate.isPending}>
            {simulate.isPending ? "Считаем…" : "Рассчитать"}
          </Button>
        </div>
      </Card>

      {simulate.error && <Notice tone="error">{simulate.error.message}</Notice>}
      {simulate.data && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <Badge>{simulate.data.planet_name}</Badge>
            <Badge>{simulate.data.crop_name}</Badge>
            <Badge>{SCENARIOS.find((s) => s.id === simulate.data.scenario)?.label}</Badge>
          </div>
          <div className={cn(simulate.isPending && "opacity-60")}>
            <Result result={simulate.data} />
          </div>
        </>
      )}
      {!simulate.data && !simulate.error && (
        <Notice>Выберите планету, культуру и сценарий, затем нажмите «Рассчитать».</Notice>
      )}
    </div>
  );
}
