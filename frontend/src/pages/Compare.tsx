import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, unwrap } from "@/api/client";
import { PlanetPicker, planetLabel } from "@/components/PlanetPicker";
import { Button, Card, Field, Notice, Select } from "@/components/ui";
import { cn, percent, SCENARIOS, type ScenarioId } from "@/lib/utils";

const DEFAULT_PLANETS = [
  { id: "earth", name: "Земля" },
  { id: "mars", name: "Марс" },
  { id: "moon", name: "Луна" },
  { id: "venus", name: "Венера" },
  { id: "titan", name: "Титан" },
];

function bin(value: number): number {
  return Math.min(5, Math.floor(value * 5) + 1);
}

function Legend() {
  const labels = ["0–20 %", "20–40 %", "40–60 %", "60–80 %", "80–100 %"];
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-2">
      <span>Урожайность от земной:</span>
      {labels.map((label, index) => (
        <span key={label} className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded-sm" style={{ background: `var(--seq-${index + 1})` }} />
          {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <X size={13} aria-hidden /> гибель
      </span>
    </div>
  );
}

export default function Compare() {
  const [planets, setPlanets] = useState(DEFAULT_PLANETS);
  const [scenario, setScenario] = useState<ScenarioId>("greenhouse");
  const [excluded, setExcluded] = useState<string[]>([]);
  const crops = useQuery({ queryKey: ["crops"], queryFn: () => unwrap(api.GET("/crops")) });

  const compare = useMutation({
    mutationFn: (body: {
      planet_ids: string[];
      crop_ids: string[];
      scenario: ScenarioId;
    }) => unwrap(api.POST("/compare", { body })),
  });
  const cropIds = crops.data?.map((c) => c.id).filter((id) => !excluded.includes(id)) ?? [];

  const run = () => compare.mutate({ planet_ids: planets.map((p) => p.id), crop_ids: cropIds, scenario });
  const started = useRef(false);
  useEffect(() => {
    if (crops.data && !started.current) {
      started.current = true;
      run();
    }
    // Run once when the crop list arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crops.data]);

  const result = compare.data;
  const cell = (planetId: string, cropId: string) =>
    result?.cells.find((c) => c.planet_id === planetId && c.crop_id === cropId);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Сравнение</h1>
      <Card className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Добавить планету">
            <PlanetPicker
              onPick={(p) =>
                setPlanets((list) =>
                  list.some((x) => x.id === p.id) || list.length >= 30
                    ? list
                    : [...list, { id: p.id, name: planetLabel(p) }],
                )
              }
            />
          </Field>
          <Field label="Сценарий">
            <Select value={scenario} onChange={(e) => setScenario(e.target.value as ScenarioId)}>
              {SCENARIOS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          {planets.map((planet) => (
            <button
              key={planet.id}
              type="button"
              aria-label={`Убрать ${planet.name}`}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-line px-2.5 py-1 text-sm hover:bg-surface-2"
              onClick={() => setPlanets((list) => list.filter((x) => x.id !== planet.id))}
            >
              {planet.name} <X size={13} aria-hidden />
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {crops.data?.map((crop) => (
            <label key={crop.id} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={!excluded.includes(crop.id)}
                onChange={(e) =>
                  setExcluded((list) =>
                    e.target.checked ? list.filter((id) => id !== crop.id) : [...list, crop.id],
                  )
                }
              />
              {crop.name_ru}
            </label>
          ))}
        </div>
        <Button onClick={run} disabled={compare.isPending || !planets.length || !cropIds.length}>
          {compare.isPending ? "Считаем…" : "Построить матрицу"}
        </Button>
      </Card>

      {compare.error && <Notice tone="error">{compare.error.message}</Notice>}

      {result && (
        <Card className={cn("space-y-3 overflow-x-auto", compare.isPending && "opacity-60")}>
          <Legend />
          <table className="w-full min-w-[640px] border-separate text-sm" style={{ borderSpacing: 2 }}>
            <thead>
              <tr>
                <th className="px-2 py-1 text-left text-xs font-medium text-ink-2">Планета</th>
                {result.crops.map((crop) => (
                  <th key={crop.id} className="px-2 py-1 text-center text-xs font-medium text-ink-2">
                    {crop.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {result.planets.map((planet) => (
                <tr key={planet.id}>
                  <th className="whitespace-nowrap px-2 py-1 text-left font-medium">{planet.name}</th>
                  {result.crops.map((crop) => {
                    const item = cell(planet.id, crop.id);
                    if (!item || item.yield_rel === null || item.yield_rel === undefined) {
                      return (
                        <td key={crop.id} title={item?.error ?? ""} className="h-10 rounded bg-surface-2 text-center text-xs text-ink-3">
                          нет данных
                        </td>
                      );
                    }
                    const title = `${planet.name}, ${crop.name}: ${percent(item.yield_rel)}. Лимит: ${item.limiting_factor_label}.`;
                    if (!item.survival) {
                      return (
                        <td key={crop.id} title={title} className="h-10 rounded bg-surface-2 text-center text-ink-2">
                          <span className="inline-flex items-center gap-1 text-xs">
                            <X size={13} aria-hidden /> гибель
                          </span>
                        </td>
                      );
                    }
                    const step = bin(item.yield_rel);
                    return (
                      <td
                        key={crop.id}
                        title={title}
                        className="h-10 rounded text-center font-medium"
                        style={{ background: `var(--seq-${step})`, color: `var(--seq-${step}-ink)` }}
                      >
                        {percent(item.yield_rel)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
