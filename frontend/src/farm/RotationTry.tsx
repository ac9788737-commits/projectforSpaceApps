import { Play, Plus, Sprout, Trash2 } from "lucide-react";
import { useState } from "react";
import { errorText } from "@/api/client";
import { Num } from "@/ui/format";
import { Button } from "@/ui/primitives";
import { LoadingLine } from "@/ui/states";
import { runRotation, useRotationCrops, type RunResult } from "./api";

// Nitrogen fertiliser by crop, kg/ha — a plain starting point the farmer can change (estimate).
export const DEFAULT_N: Record<string, number> = {
  wheat: 100,
  barley: 80,
  maize: 150,
  potato: 120,
  tomato: 120,
  cotton: 120,
  sunflower: 60,
};

type Row = [string | null, string | null];

/** Quick check of one rotation on the field's real weather (stage 7.1). */
export function RotationTry({ fid }: { fid: string }) {
  const crops = useRotationCrops();
  const [plan, setPlan] = useState<Row[]>([
    ["pea", null],
    ["wheat", "vetch"],
    ["sunflower", null],
  ]);
  const [irrigated, setIrrigated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<RunResult | null>(null);
  const mains = crops.data?.filter((c) => !c.is_cover) ?? [];
  const covers = crops.data?.filter((c) => c.is_cover) ?? [];
  const name = (id: string | null) => crops.data?.find((c) => c.id === id)?.name_ru ?? "голое поле";

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const fert = Object.fromEntries(plan.filter(([m]) => m && DEFAULT_N[m]).map(([m]) => [m!, DEFAULT_N[m!]]));
      setRes(await runRotation(fid, { plan, fert, irrigated, irrigation_limit_mm: irrigated ? 500 : 0, start_year: 2015 }));
    } catch (e) {
      setError(errorText(e) || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="try-h">
      <h3 id="try-h" className="mb-2 flex items-center gap-2 font-head text-base font-semibold text-fg">
        <Sprout size={14} strokeWidth={1.5} aria-hidden /> Пробная схема на погоде поля
      </h3>
      <ol className="flex flex-col gap-1.5">
        {plan.map(([m, c], i) => (
          <li key={i} className="flex items-center gap-1.5 text-xs">
            <span className="w-10 shrink-0 font-num text-fg-muted">{i + 1}-й</span>
            <select
              value={m ?? ""}
              onChange={(e) => setPlan(plan.map((r, j) => (j === i ? [e.target.value || null, r[1]] : r)))}
              aria-label={`Основная культура, год ${i + 1}`}
              className="h-8 min-w-0 flex-1 rounded-ctl border border-subtle bg-panel-strong px-1 text-fg"
            >
              <option value="">голое поле</option>
              {mains.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name_ru}
                </option>
              ))}
            </select>
            <select
              value={c ?? ""}
              onChange={(e) => setPlan(plan.map((r, j) => (j === i ? [r[0], e.target.value || null] : r)))}
              aria-label={`Покровная культура после уборки, год ${i + 1}`}
              className="h-8 min-w-0 flex-1 rounded-ctl border border-subtle bg-panel-strong px-1 text-fg"
            >
              <option value="">без покровной</option>
              {covers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name_ru}
                </option>
              ))}
            </select>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => setPlan(plan.filter((_, j) => j !== i))} disabled={plan.length <= 1} aria-label={`Убрать год ${i + 1}`}>
              <Trash2 size={14} strokeWidth={1.5} />
            </Button>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setPlan([...plan, ["wheat", null]])} disabled={plan.length >= 5}>
          <Plus size={14} strokeWidth={1.5} /> Год
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-fg">
          <input type="checkbox" checked={irrigated} onChange={(e) => setIrrigated(e.target.checked)} className="accent-[var(--accent)]" />
          орошение до 500 мм/год
        </label>
        <Button variant="primary" size="sm" className="ml-auto" onClick={run} disabled={busy}>
          <Play size={14} strokeWidth={1.5} /> Прогнать
        </Button>
      </div>
      <p className="mt-1 text-xs text-fg-muted">Погода — реальные годы NASA POWER с 2015-го. Азот: обычные дозы для небобовых (оценка).</p>
      {busy && <LoadingLine text="Считаю сезоны по дням…" />}
      {error && <p className="mt-2 text-xs text-lethal">{error}</p>}
      {res && (
        <div className="mt-3">
          <p className="mb-1 text-xs text-fg-muted">
            Почва: {res.site.texture}, органика <Num value={res.site.soc_pct} unit="%" digits={2} />, уклон <Num value={res.site.slope_pct} unit="%" digits={1} />
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-fg-muted">
                <tr>
                  <th className="py-1 pr-2 font-normal">Год</th>
                  <th className="py-1 pr-2 font-normal">Культура</th>
                  <th className="py-1 pr-2 text-right font-normal">т/га</th>
                  <th className="py-1 pr-2 text-right font-normal">вода</th>
                  <th className="py-1 pr-2 text-right font-normal">азот</th>
                  <th className="py-1 pr-2 text-right font-normal">эрозия, т/га</th>
                  <th className="py-1 text-right font-normal">голых дней</th>
                </tr>
              </thead>
              <tbody>
                {res.years.map((y) => (
                  <tr key={y.year} className="border-t border-subtle">
                    <td className="py-1 pr-2 font-num">{y.weather_year}</td>
                    <td className="py-1 pr-2">
                      {name(y.crop)}
                      {y.cover && <span className="text-fg-muted"> + {name(y.cover)}</span>}
                    </td>
                    <td className="py-1 pr-2 text-right"><Num value={y.yield_t_ha} digits={1} /></td>
                    <td className="py-1 pr-2 text-right">{y.factors.water != null ? <Num value={y.factors.water * 100} unit="%" digits={0} /> : "—"}</td>
                    <td className="py-1 pr-2 text-right">{y.factors.nitrogen != null ? <Num value={y.factors.nitrogen * 100} unit="%" digits={0} /> : "—"}</td>
                    <td className="py-1 pr-2 text-right"><Num value={y.erosion_t_ha} digits={1} /></td>
                    <td className="py-1 text-right font-num">{y.bare_days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-fg-muted">«вода», «азот» — доля урожая, которую оставил каждый фактор.</p>
          {res.years.flatMap((y) => y.events).map((e, i) => (
            <p key={i} className="mt-1 text-xs text-stress">{e}</p>
          ))}
          {res.rules.map((r, i) => (
            <p key={i} className="mt-1 text-xs text-stress">Внимание: {r.message_ru}</p>
          ))}
        </div>
      )}
    </section>
  );
}
