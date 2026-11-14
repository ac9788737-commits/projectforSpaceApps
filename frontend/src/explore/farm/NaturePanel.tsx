import { Leaf, RotateCcw, Sprout, Sun, Tent, Warehouse, Wind, Droplets, Thermometer, Mountain, Orbit } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Crop } from "@/api/client";
import { cn } from "@/lib/utils";
import { CropCard } from "@/ui/data";
import { formatNumber } from "@/ui/format";
import { Button, CollapsiblePanel } from "@/ui/primitives";
import { cropById } from "../data";
import { useExplore, type Scenario } from "../store";
import { farmMutations, useCatalog, useWorld, type Catalog, type SessionState } from "./session";
import { useFarm } from "./store";

const TABS = [
  { id: "planting", label: "Посадка", Icon: Sprout },
  { id: "temperature", label: "Температура", Icon: Thermometer },
  { id: "water", label: "Вода", Icon: Droplets },
  { id: "light", label: "Свет", Icon: Sun },
  { id: "air", label: "Воздух", Icon: Wind },
  { id: "soil", label: "Почва", Icon: Mountain },
  { id: "space", label: "Космос", Icon: Orbit },
] as const;
type TabId = (typeof TABS)[number]["id"];

const SCENARIOS: { id: Scenario; label: string; Icon: typeof Sun }[] = [
  { id: "open_surface", label: "Грунт", Icon: Sun },
  { id: "greenhouse", label: "Купол", Icon: Tent },
  { id: "closed_farm", label: "Ферма", Icon: Warehouse },
];

type Param = Catalog["parameters"][number];

/** Green band of the crop's optimum on a slider (none when it does not apply). */
export function optimumFor(key: string, crop: Crop | undefined): [number, number] | null {
  if (!crop) return null;
  switch (key) {
    case "temp_day_c":
    case "temp_night_c":
    case "temp_soil_c":
      return [crop.t_opt_min_c, crop.t_opt_max_c];
    case "ppfd_max":
      return [crop.ppfd_sat, 2000];
    case "light_hours":
      return [12, crop.continuous_light_ok ? 24 : 18];
    case "co2_ppm":
      return [400, 1500];
    case "o2_kpa":
      return [Math.max(16, crop.o2_min_kpa * 4), 30];
    case "pressure_kpa":
      return [Math.max(50, crop.p_min_kpa * 3), 110];
    case "rh":
      return [0.5, 0.85];
    case "precip_mm_day":
      return [2, 6];
    case "wind_ms":
      return [0, 8];
    case "ph":
      return [crop.ph_min, crop.ph_max];
    case "salinity_ds_m":
      return [0, 4];
    case "gravity_g":
      return [0.9, 1.1];
    case "uv_rel":
      return [0, crop.uv_tolerance_rel];
    case "radiation_msv_yr":
      return [0, 2000];
    default:
      return null;
  }
}

/** World base values with the scenario's overrides and the live changes made so far. */
export function effectiveConditions(
  base: Record<string, number | string | boolean> | undefined,
  state: SessionState | undefined,
  hour: number,
  pending: Record<string, number | string>,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(base ?? {})) if (typeof v !== "boolean" && v !== null) out[k] = v as number | string;
  const scenario = state?.scenario as { overrides?: Record<string, number | string>; live_overrides?: { from_hour: number; values: Record<string, number | string> }[] } | undefined;
  Object.assign(out, scenario ? scenario.overrides : pending);
  for (const c of scenario?.live_overrides ?? []) if (c.from_hour <= hour + 0.5) Object.assign(out, c.values);
  return out;
}

function Slider({
  param,
  value,
  base,
  optimum,
  onCommit,
}: {
  param: Param;
  value: number;
  base: number | undefined;
  optimum: [number, number] | null;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setLocal(value), [value]);
  const min = param.min ?? 0;
  const max = param.max ?? 100;
  const pos = (v: number) => `${((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100}%`;
  const inZone = optimum ? local >= optimum[0] && local <= optimum[1] : true;
  const digits = (param.step ?? 1) < 0.1 ? 2 : (param.step ?? 1) < 1 ? 1 : 0;
  return (
    <label className="block text-sm">
      <span className="mb-1 flex items-center gap-2">
        <span className="flex-1 text-fg">{param.label}</span>
        <span className={cn("font-num", inZone ? "text-fg" : "text-stress")}>
          {formatNumber(local, digits)}
          {param.unit && <span className="text-fg-muted">&nbsp;{param.unit}</span>}
        </span>
      </span>
      <span className="relative block h-6">
        <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-hover" aria-hidden />
        {optimum && (
          <span
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-ok opacity-60"
            style={{ left: pos(optimum[0]), width: `calc(${pos(optimum[1])} - ${pos(optimum[0])})` }}
            aria-hidden
          />
        )}
        {base !== undefined && (
          <span className="absolute top-0 h-6 w-px bg-[var(--text-secondary)]" style={{ left: pos(base) }} title={`Как в мире: ${formatNumber(base, digits)}`} aria-hidden />
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={param.step ?? 1}
          value={local}
          aria-label={param.label}
          aria-valuetext={`${formatNumber(local, digits)} ${param.unit}${optimum ? (inZone ? ", в зоне оптимума" : ", вне зоны оптимума") : ""}`}
          onChange={(e) => {
            const v = Number(e.target.value);
            setLocal(v);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => onCommit(v), 450);
          }}
          className="absolute inset-0 h-6 w-full cursor-pointer appearance-none bg-transparent accent-[var(--accent)]"
        />
      </span>
    </label>
  );
}

function PlantingTab({ crops, catalog }: { crops: Crop[]; catalog: Catalog | undefined }) {
  const selectedBed = useExplore((s) => s.selectedBed);
  const bed = useExplore((s) => s.beds[s.selectedBed]);
  const { plant, setScenario } = useExplore.getState();
  const irrigation = useFarm((s) => s.irrigation[selectedBed] ?? "rain");
  const setIrrigation = useFarm((s) => s.setIrrigation);
  const world = useFarm((s) => s.world);
  const setWorld = useFarm((s) => s.setWorld);
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-fg-muted">Стартовый мир</span>
        <select
          value={world ?? ""}
          onChange={(e) => setWorld(e.target.value || null)}
          className="h-10 rounded-ctl border border-subtle bg-panel-strong px-2 text-fg"
        >
          <option value="">Как у выбранной планеты</option>
          {catalog?.worlds.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name_ru}
            </option>
          ))}
        </select>
      </label>
      <div>
        <p className="mb-1 text-xs text-fg-muted">Грядка {selectedBed + 1}: укрытие и полив</p>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Тип грядки">
          {SCENARIOS.map(({ id, label, Icon }) => (
            <Button key={id} variant="secondary" size="sm" pressed={bed.scenario === id} onClick={() => setScenario(selectedBed, id)} className="px-1">
              <Icon size={16} strokeWidth={1.5} aria-hidden /> {label}
            </Button>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-2 gap-1" role="group" aria-label="Полив">
          <Button variant="secondary" size="sm" pressed={irrigation === "rain"} onClick={() => setIrrigation(selectedBed, "rain")}>
            Только дождь
          </Button>
          <Button variant="secondary" size="sm" pressed={irrigation === "auto"} onClick={() => setIrrigation(selectedBed, "auto")}>
            Капельный полив
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5" role="group" aria-label="Культура">
        {crops.map((c) => (
          <CropCard key={c.id} id={c.id} name={c.name_ru} optimum={[c.t_opt_min_c, c.t_opt_max_c]} selected={bed.crop === c.id} onSelect={() => plant(selectedBed, c.id)} />
        ))}
      </div>
    </div>
  );
}

export function NaturePanel({ crops, state, worldId }: { crops: Crop[]; state: SessionState | undefined; worldId: string | null }) {
  const [tab, setTab] = useState<TabId>("planting");
  const catalog = useCatalog();
  const world = useWorld(worldId);
  const hour = useFarm((s) => s.hour);
  const pending = useFarm((s) => s.pendingOverrides);
  const sessionId = useFarm((s) => s.sessionId);
  const bed = useExplore((s) => s.beds[s.selectedBed]);
  const crop = cropById(crops, bed.crop);
  const values = useMemo(() => effectiveConditions(world.data, state, Math.floor(hour / 6) * 6, pending), [world.data, state, hour, pending]);
  const m = farmMutations(sessionId);
  const params = catalog.data?.parameters.filter((p) => p.group === tab) ?? [];
  const reset = () => {
    const patch: Record<string, number | string> = {};
    for (const p of params) {
      const v = world.data?.[p.key];
      if (typeof v === "number" || typeof v === "string") patch[p.key] = v;
    }
    if (Object.keys(patch).length) m.conditions(patch);
  };
  return (
    <CollapsiblePanel title="Природа" icon={Leaf}>
      <div className="-mx-1 mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Группы условий">
        {TABS.map(({ id, label, Icon }) => (
          <Button key={id} role="tab" aria-selected={tab === id} variant="ghost" size="sm" pressed={tab === id} onClick={() => setTab(id)} className="h-9 px-2 text-xs">
            <Icon size={14} strokeWidth={1.5} aria-hidden /> {label}
          </Button>
        ))}
      </div>
      {tab === "planting" ? (
        <PlantingTab crops={crops} catalog={catalog.data} />
      ) : (
        <div className="flex flex-col gap-3">
          {params.map((p) =>
            p.options ? (
              <div key={p.key} className="text-sm">
                <p className="mb-1 text-fg">{p.label}</p>
                <div className="flex flex-wrap gap-1">
                  {p.options.map(([v, label]) => (
                    <Button key={v} variant="secondary" size="sm" pressed={values[p.key] === v} onClick={() => m.conditions({ [p.key]: v })}>
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <Slider
                key={p.key}
                param={p}
                value={Number(values[p.key] ?? (p.key === "temp_soil_c" ? (Number(values.temp_day_c) + Number(values.temp_night_c)) / 2 : 0))}
                base={typeof world.data?.[p.key] === "number" ? (world.data[p.key] as number) : undefined}
                optimum={optimumFor(p.key, crop)}
                onCommit={(v) => m.conditions({ [p.key]: v })}
              />
            ),
          )}
          <p className="text-xs leading-snug text-fg-muted">
            Зелёная полоса — оптимум {crop ? `культуры «${crop.name_ru}»` : "выбранной культуры"}, черта — значение мира. Изменения действуют с текущего момента.
          </p>
          <Button variant="ghost" size="sm" onClick={reset} className="self-start">
            <RotateCcw size={16} strokeWidth={1.5} /> Вернуть как в мире
          </Button>
        </div>
      )}
    </CollapsiblePanel>
  );
}
