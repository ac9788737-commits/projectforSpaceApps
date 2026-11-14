import { FlaskConical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, type Crop } from "@/api/client";
import { TimeSeriesChart } from "@/ui/charts";
import { Num } from "@/ui/format";
import { Button, CollapsiblePanel } from "@/ui/primitives";
import { LoadingLine } from "@/ui/states";
import { useExplore } from "../store";
import { useCatalog, type Trajectory } from "./session";
import { useFarm } from "./store";
import { create } from "zustand";

export interface Variant {
  label: string;
  param: string;
  value: number;
}

interface ExperimentState {
  crop: string;
  protection: "open" | "greenhouse" | "closed";
  irrigation: "rain" | "auto";
  variants: Variant[];
  trajectories: (Trajectory | null)[];
  running: boolean;
  set: (patch: Partial<Omit<ExperimentState, "set">>) => void;
}

export const useExperiment = create<ExperimentState>((set) => ({
  crop: "potato",
  protection: "open",
  irrigation: "auto",
  variants: [
    { label: "Как в мире", param: "temp_day_c", value: 23 },
    { label: "Жарче на 8 °C", param: "temp_day_c", value: 31 },
  ],
  trajectories: [],
  running: false,
  set: (patch) => set(patch),
}));

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];

async function runVariant(world: string, e: ExperimentState, v: Variant): Promise<Trajectory | null> {
  const body = {
    version: 1,
    world,
    seed: useFarm.getState().seed,
    duration_days: 200,
    crops: [{ crop: e.crop, plot: "A1", protection: e.protection, irrigation: e.irrigation }],
    overrides: { [v.param]: v.value },
    live_overrides: [],
    events: [],
    actions: [],
  };
  const { data } = await api.POST("/sim/sessions", { body });
  if (!data) return null;
  const traj = await api.GET("/sim/sessions/{sid}/trajectory", { params: { path: { sid: data.session_id } } });
  return traj.data ?? null;
}

function Comparison({ crops, world }: { crops: Crop[]; world: string }) {
  const e = useExperiment();
  const catalog = useCatalog();
  const params = (catalog.data?.parameters ?? []).filter((p) => !p.options);
  const run = async () => {
    e.set({ running: true });
    const results = await Promise.all(e.variants.map((v) => runVariant(world, useExperiment.getState(), v)));
    const days = Math.max(1, ...results.map((r) => r?.days ?? 1));
    useExplore.getState().setMaxDay(days - 1);
    useExplore.getState().setDay(0);
    useExplore.getState().setPlaying(false);
    e.set({ trajectories: results, running: false });
  };
  const series = e.trajectories.map((t) => (t?.plots.A1 ?? []) as unknown as { day: number; yieldG: number; health: number }[]);
  const maxLen = Math.max(0, ...series.map((s) => s.length));
  const data = Array.from({ length: maxLen }, (_, d) => ({ day: d, ...Object.fromEntries(series.map((s, i) => [`v${i}`, s[Math.min(d, s.length - 1)]?.yieldG ?? 0])) }));
  const day = useExplore((s) => Math.floor(s.day));
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted">Культура</span>
          <select value={e.crop} onChange={(ev) => e.set({ crop: ev.target.value })} className="h-10 rounded-ctl border border-subtle bg-panel-strong px-2 text-fg">
            {crops.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_ru}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted">Укрытие</span>
          <select value={e.protection} onChange={(ev) => e.set({ protection: ev.target.value as ExperimentState["protection"] })} className="h-10 rounded-ctl border border-subtle bg-panel-strong px-2 text-fg">
            <option value="open">открытый грунт</option>
            <option value="greenhouse">купол</option>
            <option value="closed">подземная ферма</option>
          </select>
        </label>
      </div>
      <ul className="flex flex-col gap-2" aria-label="Варианты условий">
        {e.variants.map((v, i) => (
          <li key={i} className="rounded-ctl border border-subtle p-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="size-3 rounded-full" style={{ background: SERIES[i] }} aria-hidden />
              <input
                value={v.label}
                onChange={(ev) => e.set({ variants: e.variants.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)) })}
                aria-label={`Название варианта ${i + 1}`}
                className="h-8 min-w-0 flex-1 rounded-ctl border border-subtle bg-transparent px-2 text-fg"
              />
              {e.variants.length > 2 && (
                <Button variant="ghost" size="icon" className="size-8" onClick={() => e.set({ variants: e.variants.filter((_, j) => j !== i) })} aria-label={`Убрать вариант ${i + 1}`}>
                  <Trash2 size={14} strokeWidth={1.5} />
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <select value={v.param} onChange={(ev) => e.set({ variants: e.variants.map((x, j) => (j === i ? { ...x, param: ev.target.value } : x)) })} aria-label="Параметр" className="h-8 min-w-0 flex-1 rounded-ctl border border-subtle bg-panel-strong px-1 text-xs text-fg">
                {params.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={v.value}
                step={params.find((p) => p.key === v.param)?.step ?? 1}
                onChange={(ev) => e.set({ variants: e.variants.map((x, j) => (j === i ? { ...x, value: Number(ev.target.value) } : x)) })}
                aria-label="Значение"
                className="h-8 w-20 rounded-ctl border border-subtle bg-transparent px-2 font-num text-fg"
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        {e.variants.length < 4 && (
          <Button variant="secondary" size="sm" onClick={() => e.set({ variants: [...e.variants, { label: `Вариант ${e.variants.length + 1}`, param: "co2_ppm", value: 1000 }] })}>
            <Plus size={16} strokeWidth={1.5} /> Вариант
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={run} disabled={e.running}>
          <FlaskConical size={16} strokeWidth={1.5} /> Сравнить
        </Button>
      </div>
      {e.running && <LoadingLine text="Считаем варианты…" />}
      {data.length > 0 && (
        <>
          <TimeSeriesChart
            ariaLabel="Урожай по дням для каждого варианта"
            data={data}
            xKey="day"
            today={day}
            series={e.variants.map((v, i) => ({ key: `v${i}`, name: v.label, color: SERIES[i], unit: "г" }))}
          />
          <ul className="flex flex-col gap-1">
            {e.trajectories.map((t, i) => {
              const s = t?.summary.A1 as { yield_rel: number; alive: boolean } | undefined;
              return (
                <li key={i} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: SERIES[i] }} aria-hidden />
                  <span className="flex-1">{e.variants[i]?.label}</span>
                  {s?.alive ? <Num value={s.yield_rel * 100} unit="%" digits={0} /> : <span className="text-lethal">гибель</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function Sweep({ world }: { world: string }) {
  const e = useExperiment();
  const catalog = useCatalog();
  const params = (catalog.data?.parameters ?? []).filter((p) => !p.options);
  const [param, setParam] = useState("temp_day_c");
  const [from, setFrom] = useState(5);
  const [to, setTo] = useState(40);
  const [rows, setRows] = useState<{ x: number; y: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const unit = params.find((p) => p.key === param)?.unit ?? "";
  const run = async () => {
    setBusy(true);
    const n = 8;
    const values = Array.from({ length: n }, (_, i) => +(from + ((to - from) * i) / (n - 1)).toFixed(2));
    const { data } = await api.POST("/sim/batch", {
      body: {
        scenario: { version: 1, world, seed: 42, duration_days: 200, crops: [{ crop: e.crop, plot: "A1", protection: e.protection, irrigation: e.irrigation }], overrides: {}, live_overrides: [], events: [], actions: [] },
        parameter: param,
        values,
        variants: [],
      },
    });
    setRows((data?.rows ?? []).map((r) => ({ x: Number(r.value), y: Number((r.plots.A1 as { yield_rel: number }).yield_rel) * 100 })));
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      <select value={param} onChange={(ev) => setParam(ev.target.value)} aria-label="Параметр перебора" className="h-10 rounded-ctl border border-subtle bg-panel-strong px-2 text-fg">
        {params.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <input type="number" value={from} onChange={(ev) => setFrom(Number(ev.target.value))} aria-label="От" className="h-9 w-20 rounded-ctl border border-subtle bg-transparent px-2 font-num text-fg" />
        <span className="text-fg-muted">—</span>
        <input type="number" value={to} onChange={(ev) => setTo(Number(ev.target.value))} aria-label="До" className="h-9 w-20 rounded-ctl border border-subtle bg-transparent px-2 font-num text-fg" />
        <span className="text-fg-muted">{unit}</span>
        <Button variant="primary" size="sm" className="ml-auto" onClick={run} disabled={busy}>
          Перебрать
        </Button>
      </div>
      {busy && <LoadingLine text="Перебираем значения…" />}
      {rows && (
        <TimeSeriesChart
          ariaLabel="Урожай в зависимости от параметра"
          data={rows}
          xKey="x"
          zones
          yDomain={[0, 100]}
          xLabel={(x) => `${x} ${unit}`}
          series={[{ key: "y", name: "Урожай, % от земного", color: "var(--series-1)", unit: "%" }]}
        />
      )}
    </div>
  );
}

export function ExperimentPanel({ crops, world }: { crops: Crop[]; world: string | null }) {
  const [tab, setTab] = useState<"compare" | "sweep">("compare");
  if (!world) return null;
  return (
    <CollapsiblePanel title="Эксперимент" icon={FlaskConical}>
      <div className="mb-3 flex gap-1" role="tablist">
        <Button role="tab" aria-selected={tab === "compare"} variant="ghost" size="sm" pressed={tab === "compare"} onClick={() => setTab("compare")} className="h-8 text-xs">
          Сравнение условий
        </Button>
        <Button role="tab" aria-selected={tab === "sweep"} variant="ghost" size="sm" pressed={tab === "sweep"} onClick={() => setTab("sweep")} className="h-8 text-xs">
          Перебор параметра
        </Button>
      </div>
      {tab === "compare" ? <Comparison crops={crops} world={world} /> : <Sweep world={world} />}
    </CollapsiblePanel>
  );
}

/** Garden beds that show the experiment variants, in variant order. */
export const EXPERIMENT_BEDS = [3, 4, 5, 1];

/** Right panel in experiment mode: the variant grown on the selected bed. */
export function ExperimentBedPanel({ crops }: { crops: Crop[] }) {
  const e = useExperiment();
  const selectedBed = useExplore((s) => s.selectedBed);
  const day = useExplore((s) => s.day);
  const i = EXPERIMENT_BEDS.indexOf(selectedBed);
  const variant = i >= 0 ? e.variants[i] : undefined;
  const t = i >= 0 ? e.trajectories[i] : undefined;
  const crop = crops.find((c) => c.id === e.crop);
  const records = (t?.plots.A1 ?? []) as unknown as { stage: string; health: number; yieldG: number }[];
  const rec = records[Math.min(records.length - 1, Math.max(0, Math.floor(day)))];
  const s = t?.summary.A1 as { yield_rel: number; alive: boolean } | undefined;
  return (
    <CollapsiblePanel title={variant ? `Вариант: ${variant.label}` : "Эксперимент"} icon={FlaskConical}>
      {!variant ? (
        <p className="text-sm text-fg-muted">Варианты растут на грядках средней линии. Выберите одну из них, чтобы увидеть её показатели.</p>
      ) : !t ? (
        <p className="text-sm text-fg-muted">Нажмите «Сравнить», чтобы вырастить варианты.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-fg-muted">Культура</dt>
          <dd>{crop?.name_ru ?? e.crop}</dd>
          <dt className="text-fg-muted">Сутки</dt>
          <dd className="font-num">{Math.floor(day)}</dd>
          <dt className="text-fg-muted">Здоровье</dt>
          <dd>{rec ? <Num value={rec.health * 100} unit="%" digits={0} /> : "—"}</dd>
          <dt className="text-fg-muted">Урожай сейчас</dt>
          <dd>{rec ? <Num value={rec.yieldG} unit="г" digits={1} /> : "—"}</dd>
          <dt className="text-fg-muted">Итог сезона</dt>
          <dd>{s?.alive ? <><Num value={s.yield_rel * 100} unit="%" digits={0} /> от земного</> : <span className="text-lethal">гибель</span>}</dd>
        </dl>
      )}
      <p className="mt-2 text-[11px] text-fg-muted">Действия фермера и события доступны в режимах «Песочница» и «Сценарий».</p>
    </CollapsiblePanel>
  );
}
