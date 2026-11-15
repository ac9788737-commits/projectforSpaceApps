import type * as GeoJSON from "geojson";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Layers, MapPin, Pencil, Search, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";

import { SPACE_LAB } from "@/flags";
import { FieldMap, type Overlay } from "@/map/FieldMap";
import { Num } from "@/ui/format";
import { Button, GlassPanel } from "@/ui/primitives";
import { LoadingLine } from "@/ui/states";
import { createField, useDataCard, useFields, type FieldRec } from "./api";
import { DataCard } from "./DataCard";
import { CompareView } from "./CompareView";
import { HistoryView } from "./HistoryView";
import { PlanView } from "./PlanView";
import { PriorityForm } from "./PriorityForm";
import { parseFieldFile } from "./fieldFile";
import { RotationTry } from "./RotationTry";

const OVERLAYS: { id: Overlay; label: string }[] = [
  { id: "none", label: "Карта" },
  { id: "truecolor", label: "Снимок MODIS" },
  { id: "ndvi", label: "NDVI" },
];

function parseCoords(q: string): [number, number] | null {
  const m = q.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(",", "."));
  const lon = Number(m[2].replace(",", "."));
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

/** Main path, step 1–2: map → field (docs/ROTATION.md §2.1, §5.1). */
export default function FieldPage() {
  const { fid } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fields = useFields();
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [name, setName] = useState("Моё поле");
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [fly, setFly] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const selected = fields.data?.find((f) => f.id === fid) ?? null;
  const [step, setStep] = useState<Step>("field");
  const wide = WIDE.includes(step) && !!selected;

  const select = (f: FieldRec) => {
    navigate(`/expert/fields/${f.id}`);
    setFly({ center: f.centroid, zoom: 15 });
  };

  const search = async () => {
    setMsg(null);
    const xy = parseCoords(query);
    if (xy) {
      setFly({ center: xy, zoom: 14 });
      return;
    }
    try {
      // OpenStreetMap Nominatim (open geocoder; one request per search).
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
      const [hit] = (await r.json()) as { lon: string; lat: string }[];
      if (hit) setFly({ center: [Number(hit.lon), Number(hit.lat)], zoom: 14 });
      else setMsg("Ничего не найдено. Попробуйте координаты: 38.53, 68.40");
    } catch {
      setMsg("Поиск по адресу недоступен. Введите координаты: широта, долгота");
    }
  };

  const save = async (geometry: GeoJSON.Polygon, title: string) => {
    try {
      const f = await createField(title, geometry);
      await qc.invalidateQueries({ queryKey: ["fields"] });
      setDrawing(false);
      setDraft([]);
      select(f);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const upload = async (file: File) => {
    setMsg(null);
    try {
      const geom = parseFieldFile(file.name, await file.text());
      await save(geom, file.name.replace(/\.(geo)?json|\.kml$/i, ""));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const demo = useMemo(() => fields.data?.filter((f) => f.demo) ?? [], [fields.data]);
  const mine = useMemo(() => fields.data?.filter((f) => !f.demo) ?? [], [fields.data]);

  return (
    <div data-mood="field" className="relative h-dvh overflow-hidden bg-[var(--bg-void)] text-fg print:h-auto print:overflow-visible">
      <div className="print:hidden">
      <FieldMap
        fields={fields.data ?? []}
        selected={fid ?? null}
        onSelect={(id) => {
          const f = fields.data?.find((x) => x.id === id);
          if (f) select(f);
        }}
        drawing={drawing}
        draft={draft}
        onDraftPoint={(p) => setDraft((d) => [...d, p])}
        overlay={overlay}
        flyTo={fly}
      />
      </div>

      <div className="pointer-events-none absolute inset-x-[var(--edge)] top-[var(--edge)] z-10 flex items-start gap-2">
        <GlassPanel className="flex h-12 items-center gap-3 px-3">
          <Link to="/fields" className="font-head font-semibold">WhatCropNext</Link>
          <Link to={fid ? `/fields/${fid}/plan` : "/fields"} className="rounded-ctl px-2 text-xs text-fg-muted hover:text-fg">← простой режим</Link>
          <span className="hidden text-sm text-fg-muted sm:inline">Планировщик севооборота</span>
          {SPACE_LAB && (
            <Link to="/universe" className="hidden rounded-ctl px-2 text-xs text-fg-muted hover:text-fg md:inline" title="Необязательный режим: растения на других планетах">
              Лаборатория
            </Link>
          )}
        </GlassPanel>
        <GlassPanel className="ml-auto flex h-12 items-center gap-0.5 px-1" role="radiogroup" aria-label="Подложка">
          <Layers size={16} strokeWidth={1.5} className="mx-1 text-fg-muted" aria-hidden />
          {OVERLAYS.map((o) => (
            <Button key={o.id} variant="ghost" size="sm" role="radio" aria-checked={overlay === o.id} pressed={overlay === o.id} onClick={() => setOverlay(o.id)} className="h-9 px-2 text-xs">
              {o.label}
            </Button>
          ))}
        </GlassPanel>
      </div>

      {/* Left: choose or draw a field. */}
      <div className={cn("pointer-events-none absolute left-[var(--edge)] top-[calc(var(--edge)+64px)] z-10 flex max-h-[calc(100dvh-2*var(--edge)-64px)] w-80 max-w-[calc(100%-2*var(--edge))] flex-col", selected && "max-sm:hidden", wide && "hidden", "print:hidden")}>
        <GlassPanel className="overflow-y-auto p-4">
          <h2 className="mb-2 flex items-center gap-2 font-head text-sm font-semibold"><MapPin size={16} strokeWidth={1.5} aria-hidden /> Поле</h2>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Адрес или «широта, долгота»" aria-label="Поиск места" className="h-9 min-w-0 flex-1 rounded-ctl border border-subtle bg-panel-strong px-2 text-sm text-fg placeholder:text-fg-muted" />
            <Button variant="secondary" size="icon" type="submit" aria-label="Найти"><Search size={16} strokeWidth={1.5} /></Button>
          </form>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!drawing ? (
              <Button variant="secondary" size="sm" onClick={() => { setDrawing(true); setDraft([]); }}>
                <Pencil size={14} strokeWidth={1.5} /> Нарисовать контур
              </Button>
            ) : (
              <>
                <Button variant="primary" size="sm" disabled={draft.length < 3} onClick={() => void save({ type: "Polygon", coordinates: [[...draft, draft[0]]] }, name)}>
                  <Check size={14} strokeWidth={1.5} /> Сохранить
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setDrawing(false); setDraft([]); }}>
                  <X size={14} strokeWidth={1.5} /> Отмена
                </Button>
              </>
            )}
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-ctl border border-subtle px-2 text-xs hover:bg-hover">
              <Upload size={14} strokeWidth={1.5} aria-hidden /> GeoJSON / KML
              <input type="file" accept=".geojson,.json,.kml" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            </label>
          </div>
          {drawing && (
            <div className="mt-2 text-xs text-fg-muted">
              <p>Кликайте по углам поля на карте (точек: {draft.length}).</p>
              <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Название поля" className="mt-1 h-8 w-full rounded-ctl border border-subtle bg-panel-strong px-2 text-sm text-fg" />
            </div>
          )}
          {msg && <p className="mt-2 text-xs text-stress">{msg}</p>}

          <h3 className="mt-4 mb-1.5 font-head text-base font-semibold text-fg">Демо-поля (работают без сети)</h3>
          {fields.isLoading && <LoadingLine text="Загружаю поля…" />}
          <ul className="flex flex-col gap-1">
            {demo.map((f) => (
              <FieldItem key={f.id} f={f} active={f.id === fid} onClick={() => select(f)} />
            ))}
          </ul>
          {mine.length > 0 && (
            <>
              <h3 className="mt-3 mb-1.5 font-head text-base font-semibold text-fg">Мои поля</h3>
              <ul className="flex flex-col gap-1">
                {mine.map((f) => (
                  <FieldItem key={f.id} f={f} active={f.id === fid} onClick={() => select(f)} />
                ))}
              </ul>
            </>
          )}
        </GlassPanel>
      </div>

      {/* Right: the field. */}
      {selected && (
        <div
          className={cn(
            "pointer-events-none absolute right-[var(--edge)] top-[calc(var(--edge)+64px)] z-10 flex max-h-[calc(100dvh-2*var(--edge)-64px)] max-w-[calc(100%-2*var(--edge))] flex-col print:static print:max-h-none print:w-full print:max-w-none",
            WIDE.includes(step) ? "w-[min(72rem,calc(100%-2*var(--edge)))]" : "w-[26rem]",
          )}
        >
          <FieldPanel f={selected} step={step} setStep={setStep} onClose={() => navigate("/expert/fields")} />
        </div>
      )}
    </div>
  );
}

function FieldItem({ f, active, onClick }: { f: FieldRec; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className={cn("w-full cursor-pointer rounded-ctl border px-2 py-1.5 text-left text-sm hover:bg-hover", active ? "border-accent" : "border-subtle")}>
        <span className="font-medium">{f.name}</span>
        {f.region && <span className="text-fg-muted">, {f.region}</span>}
        <span className="block text-xs text-fg-muted"><Num value={f.area_ha} unit="га" digits={1} /></span>
      </button>
    </li>
  );
}

export type Step = "field" | "history" | "priorities" | "compare" | "plan";
const STEPS: { id: Step; label: string }[] = [
  { id: "field", label: "Поле" },
  { id: "history", label: "История" },
  { id: "priorities", label: "Приоритеты" },
  { id: "compare", label: "Сравнение" },
  { id: "plan", label: "План" },
];
const WIDE: Step[] = ["compare", "plan"];

function FieldPanel({ f, step, setStep, onClose }: { f: FieldRec; step: Step; setStep: (s: Step) => void; onClose: () => void }) {
  const card = useDataCard(f.id);
  const soil = card.data?.layers.find((l) => l.id === "soilgrids")?.values;
  const terr = card.data?.layers.find((l) => l.id === "terrain")?.values;
  return (
    <GlassPanel className="overflow-y-auto p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg-muted">{f.region ?? "поле"}</p>
          <h2 className="font-head text-2xl font-semibold leading-tight">{f.name}</h2>
          <p className="text-sm text-fg-muted">
            <Num value={f.area_ha} unit="га" digits={1} />, {f.centroid[1].toFixed(3)}°, {f.centroid[0].toFixed(3)}°
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть поле"><X size={16} strokeWidth={1.5} /></Button>
      </div>
      {f.note && <p className="mt-2 text-xs text-fg-muted">{f.note}</p>}
      <nav className="mt-3 flex gap-0.5 overflow-x-auto rounded-ctl bg-hover p-0.5" role="tablist" aria-label="Шаги планирования">
        {STEPS.map((s, i) => (
          <Button key={s.id} role="tab" aria-selected={step === s.id} variant="ghost" size="sm" pressed={step === s.id} onClick={() => setStep(s.id)} className="h-8 flex-1 shrink-0 px-2 text-xs">
            <span className="font-num text-fg-muted">{i + 1}</span> {s.label}
          </Button>
        ))}
      </nav>
      {step === "history" && <div className="mt-3"><HistoryView fid={f.id} /></div>}
      {step === "priorities" && <div className="mt-3"><PriorityForm onDone={() => setStep("compare")} /></div>}
      {step === "compare" && <div className="mt-3"><CompareView fid={f.id} /></div>}
      {step === "plan" && <div className="mt-3"><PlanView f={f} /></div>}
      {step === "field" && card.isLoading && <LoadingLine text="Загружаю NASA POWER, SoilGrids и рельеф…" />}
      {step === "field" && card.error && <p className="mt-2 text-xs text-lethal">{String(card.error)}</p>}
      {step === "field" && card.data && (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-fg-muted">Песок / глина</dt>
            <dd>{soil?.sand != null && soil?.clay != null ? <><Num value={soil.sand} digits={0} /> / <Num value={soil.clay} unit="%" digits={0} /></> : "—"}</dd>
            <dt className="text-fg-muted">Органический C</dt>
            <dd>{soil?.soc != null ? <Num value={soil.soc} unit="%" digits={2} /> : "—"}</dd>
            <dt className="text-fg-muted">pH</dt>
            <dd>{soil?.phh2o != null ? <Num value={soil.phh2o} digits={1} /> : "—"}</dd>
            <dt className="text-fg-muted">Высота, уклон</dt>
            <dd>{terr?.elevation_m != null ? <><Num value={terr.elevation_m} unit="м" digits={0} />, <Num value={terr.slope_pct ?? 0} unit="%" digits={1} /></> : "—"}</dd>
          </dl>
          <div className="mt-4"><RotationTry fid={f.id} /></div>
          <div className="mt-4"><DataCard layers={card.data.layers} /></div>
          <p className="mt-3 text-xs text-fg-muted">Это инструмент поддержки решений, а не замена агроному.</p>
        </>
      )}
    </GlassPanel>
  );
}
