import { useQueryClient } from "@tanstack/react-query";
import { EXPERT } from "@/flags";
import { Check, Pencil, Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LangSwitch } from "@/i18n/LangSwitch";
import { AppBar, BarLink } from "@/ui/AppBar";
import { createField, useFields } from "@/farm/api";
import { cn } from "@/lib/utils";
import { FieldMap } from "@/map/FieldMap";
import { Icon, type IconName } from "@/ui/icons";
import { PAT } from "@/ui/patterns";
import { DndContext } from "@dnd-kit/core";
import { FieldScene } from "./scene/FieldScene";
import { Button } from "@/ui/primitives";
import { useDeck, usePassport, type FieldInfo, type Passport } from "./api";
import { Postcard } from "./scene/Postcard";
import { FieldImage } from "./FieldImage";
import { IrrigationPills } from "./IrrigationPills";

/** The poster's field: a varied rotation on a summer day in the mountains. */
const HERO_PLAN: [string | null, string | null][] = [["cotton", null], ["chickpea", "vetch"], ["winter_wheat", null], ["sunflower", "mustard"]];
const HERO_WEEK = { year: -1, month: 6, crop: null, is_cover: false, stage: "mid" as const, canopy: 0.8, soil_cover: 0.8, water: 0.7, soc_pct: 1.6, n_mineral: 60, erosion_cum: 0, rain: 0, storm: false, tmax: 29, heat: false, frost: false, pest: 0 };

/** Screen 1 «Какое у вас поле?» (docs/UX.md §2). */
export default function FieldsHome() {
  const { t: tr } = useTranslation();
  const { fid } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fields = useFields();
  const deck = useDeck();
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [fly, setFly] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const all = (fields.data ?? []) as unknown as FieldInfo[];
  const demo = all.filter((f) => f.demo);
  const selected = all.find((f) => f.id === fid);

  useEffect(() => {
    if (selected) setFly({ center: selected.centroid, zoom: 14 });
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = async () => {
    setMsg(null);
    const m = query.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)$/);
    if (m) return setFly({ center: [Number(m[2].replace(",", ".")), Number(m[1].replace(",", "."))], zoom: 14 });
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
      const [hit] = (await r.json()) as { lon: string; lat: string }[];
      if (hit) setFly({ center: [Number(hit.lon), Number(hit.lat)], zoom: 14 });
      else setMsg(tr("home.not_found"));
    } catch {
      setMsg(tr("home.no_geocoder"));
    }
  };

  const save = async () => {
    try {
      const f = await createField(tr("home.my_field"), { type: "Polygon", coordinates: [[...draft, draft[0]]] });
      await qc.invalidateQueries({ queryKey: ["fields"] });
      setDrawing(false);
      setDraft([]);
      navigate(`/fields/${f.id}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div data-mood="field" className="min-h-dvh bg-farm-page text-fg">
      <AppBar
        right={
          <>
            <BarLink to="/reference">{tr("common.sources")}</BarLink>
            {EXPERT && <BarLink to="/expert/fields">{tr("common.expert")}</BarLink>}
            <LangSwitch inverted />
          </>
        }
      >
        <span className="text-sm text-farm-on-inverted-2">{tr("home.tagline")}</span>
      </AppBar>

      {selected ? (
        <PassportPanel f={selected} />
      ) : (
        <>
          {/* the poster: a living field under its own sky, the question on it */}
          <section className="relative overflow-hidden border-b border-subtle" aria-labelledby="home-h">
            <DndContext>
              <FieldScene
                plan={HERO_PLAN}
                deck={deck.data ?? []}
                q={undefined}
                week={HERO_WEEK}
                irrigation="furrow"
                terrain="mountains"
                sow={null}
                paused={false}
                dragging={false}
                names={{}}
                yearLabel={() => tr("home.title")}
                interactive={false}
                signs={false}
              />
            </DndContext>
            <div className="sm:absolute sm:inset-x-0 sm:top-0">
              <div className="mx-auto max-w-7xl sm:px-[var(--edge)] sm:pt-10">
                <div className="max-w-xl bg-[var(--paper-sheet)] p-4 sm:rounded-xl sm:p-6 sm:shadow-[var(--shadow-sheet)]">
                  <h1 id="home-h" className="font-head text-3xl font-semibold leading-tight sm:text-5xl">{tr("home.title")}</h1>
                  <p className="mt-2 text-fg-muted sm:text-lg">{tr("home.lead")}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="primary" onClick={() => document.getElementById("demo-h")?.scrollIntoView({ behavior: "smooth" })}>
                      {tr("home.pick_demo")}
                    </Button>
                    <Button variant="secondary" onClick={() => document.getElementById("own-h")?.scrollIntoView({ behavior: "smooth" })}>
                      <Pencil size={14} strokeWidth={1.5} /> {tr("home.own")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </section>

        <main className="mx-auto flex max-w-7xl flex-col gap-8 px-[var(--edge)] py-8">
          <section aria-labelledby="demo-h">
            <h2 id="demo-h" className="font-head text-3xl font-semibold">{tr("home.demo")}</h2>
            <p className="mt-1 text-fg-muted">{tr("home.demo_lead")}</p>
            <ul className="mt-5 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
              {demo.map((f, i) => (
                <li
                  key={f.id}
                  className={cn(
                    "group flex flex-col overflow-hidden rounded-xl bg-[var(--paper-sheet)] shadow-[var(--shadow-packet)] transition-[transform,box-shadow] duration-300 ease-[var(--ease-panel)] hover:-translate-y-1 hover:rotate-0 hover:shadow-[var(--shadow-lifted)]",
                    i % 2 ? "rotate-[0.8deg]" : "-rotate-[0.8deg]",
                  )}
                >
                  <button type="button" className="cursor-pointer" onClick={() => navigate(`/fields/${f.id}/plan`)} aria-label={`${tr("home.build")}: ${f.name}`}>
                    <Postcard fid={f.id} plan={f.current_plan ?? [["wheat", null], ["pea", null], ["maize", null], ["wheat", null]]} deck={deck.data ?? []} irrigation={f.irrigation_method} />
                  </button>
                  <div className="flex flex-1 flex-col gap-1 p-4">
                    <p className="font-head text-xl font-semibold leading-tight">{f.card_ru}</p>
                    <p className="text-sm text-fg-muted">
                      {f.name}, {f.region}
                    </p>
                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                      <Button variant="primary" size="sm" onClick={() => navigate(`/fields/${f.id}/plan`)}>
                        {tr("home.build")}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/fields/${f.id}`)}>
                        {tr("home.passport")}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="own-h" className="grid gap-4 rounded-xl border border-subtle bg-farm-card p-4 sm:p-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="flex flex-col gap-2">
            <h2 id="own-h" className="font-head text-3xl font-semibold">{tr("home.own")}</h2>
            <p className="text-fg-muted">{tr("home.own_lead")}</p>
            <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void search(); }}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("home.search_ph")} aria-label={tr("home.search")} className="h-10 min-w-0 flex-1 rounded-ctl border border-subtle bg-panel px-2 text-sm text-fg placeholder:text-fg-muted" />
              <Button variant="secondary" size="icon" type="submit" aria-label={tr("home.find")}><Search size={16} strokeWidth={1.5} /></Button>
            </form>
            </div>
            <div className="relative h-80 overflow-hidden rounded-lg border border-subtle lg:row-span-2 lg:h-[26rem]">
              <FieldMap fields={(fields.data ?? []) as never} selected={null} onSelect={(id) => navigate(`/fields/${id}`)} drawing={drawing} draft={draft} onDraftPoint={(p) => setDraft((d) => [...d, p])} overlay="none" flyTo={fly} />
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start">
              {!drawing ? (
                <Button variant="secondary" size="sm" onClick={() => { setDrawing(true); setDraft([]); }}>
                  <Pencil size={14} strokeWidth={1.5} /> {tr("home.draw")}
                </Button>
              ) : (
                <>
                  <Button variant="primary" size="sm" disabled={draft.length < 3} onClick={() => void save()}><Check size={14} strokeWidth={1.5} /> {tr("home.done")}</Button>
                  <Button variant="ghost" size="sm" onClick={() => { setDrawing(false); setDraft([]); }}><X size={14} strokeWidth={1.5} /> {tr("home.cancel")}</Button>
                  <span className="text-sm text-fg-muted">{tr("home.draw_hint", { n: draft.length })}</span>
                </>
              )}
            </div>
            {msg && <p className="text-sm text-caution">{msg}</p>}
          </section>
        </main>
        </>
      )}
    </div>
  );
}

const ICON: Record<string, IconName> = { sun: "sun", drop: "drop", soil: "shovel", frost: "snowflake", slope: "plough", satellite: "satellite" };
const LEVEL_TEXT: Record<string, string> = { good: "text-good", ok: "text-caution", bad: "text-risk" };

/** The field passport as a form on a field sheet (docs/DESIGN.md §7): rows with a rule between
 * them, the picture on the left, no cards. */
function PassportPanel({ f }: { f: FieldInfo }) {
  const { t: tr } = useTranslation();
  const deck = useDeck();
  const p = usePassport(f.id);
  const navigate = useNavigate();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!p.data) return;
    setShown(0);
    const t = setInterval(() => setShown((n) => (n >= p.data!.sources.length ? n : n + 1)), 250);
    return () => clearInterval(t);
  }, [p.data]);
  const sources: Passport["sources"] = p.data?.sources ?? [
    { icon: "sun", text: tr("home.src_weather"), ok: false },
    { icon: "soil", text: tr("home.src_soil"), ok: false },
    { icon: "slope", text: tr("home.src_slope"), ok: false },
    { icon: "satellite", text: tr("home.src_sat"), ok: false },
  ];
  const ready = !!p.data && shown >= p.data.sources.length;
  return (
    <main className="mx-auto max-w-7xl px-[var(--edge)] py-5">
      {/* the field's own landscape as the head of its passport */}
      <section className="relative overflow-hidden rounded-xl shadow-[var(--shadow-sheet)]">
        <Postcard fid={f.id} plan={f.current_plan ?? [["wheat", null], ["pea", null], ["maize", null], ["wheat", null]]} deck={deck.data ?? []} irrigation={f.irrigation_method} />
        <div className="absolute inset-x-3 top-3 flex flex-wrap items-start gap-3 sm:inset-x-6 sm:top-6">
          <div className="max-w-xl rounded-lg bg-[var(--paper-sheet)] px-4 py-3 shadow-[var(--shadow-sheet)]">
            <Link to="/fields" className="text-sm text-fg-muted underline-offset-2 hover:text-fg hover:underline">{tr("home.all_fields")}</Link>
            <h1 className="font-head text-3xl font-semibold leading-tight sm:text-4xl">{f.name}</h1>
            <p className="text-fg-muted">
              {f.region ?? tr("home.your_field")}
              {f.card_ru ? `. ${f.card_ru}` : ""}
            </p>
          </div>
          <Button variant="primary" className="ml-auto shadow-[var(--shadow-packet)]" onClick={() => navigate(`/fields/${f.id}/plan`)} disabled={!p.data}>
            {tr("home.what_sow")}
          </Button>
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 self-start rounded-pnl border border-subtle bg-farm-card p-4">
          <FieldImage fid={f.id} geometry={f.geometry} />
          <div>
            <p className="mb-1 text-sm font-medium">{tr("home.how_water")}</p>
            <IrrigationPills field={f} />
          </div>
        </div>

        <div className="min-w-0 rounded-pnl border border-subtle bg-farm-card p-4 sm:p-6">
          <h2 className="sr-only">{tr("home.passport")}</h2>
          <ul className="grid gap-x-6 text-sm sm:grid-cols-2" aria-label={tr("home.collecting")} aria-live="polite">
            {sources.map((x, i) => (
              <li key={x.icon} className="flex items-center gap-2 border-b border-subtle py-1.5">
                <Icon name={ICON[x.icon] ?? "sprout"} size={18} className="shrink-0 text-farm-icon" />
                <span className="min-w-0 flex-1">{x.text}</span>
                {p.data && i < shown ? <span className={x.ok ? "text-good" : "text-fg-muted"}>{x.ok ? tr("home.got") : tr("home.not_yet")}</span> : <span className="text-fg-muted">…</span>}
              </li>
            ))}
          </ul>

          {ready && p.data && (
            <>
              <dl className="mt-4 border-t border-subtle">
                {p.data.cards.map((c) => (
                  <div key={c.icon + c.title} className="grid gap-x-4 border-b border-subtle py-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
                    <dt className={cn("flex items-center gap-2 font-medium", LEVEL_TEXT[c.level])}>
                      <Icon name={ICON[c.icon] ?? "sprout"} size={18} className="shrink-0" />
                      {c.title}
                    </dt>
                    <dd className="text-fg">{c.text}</dd>
                  </div>
                ))}
              </dl>
              <h2 className="mt-5 font-head text-lg font-semibold">{tr("home.then_now")}</h2>
              <dl className="mt-1 border-t border-subtle">
                {p.data.trends.map((t) => (
                  <div key={t.label} className="grid gap-x-4 border-b border-subtle py-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
                    <dt className="font-medium">{t.label}</dt>
                    <dd className="tabular-nums">
                      {t.text.startsWith(`${t.label}: `) ? t.text.slice(t.label.length + 2) : t.text}
                      {t.changed && <span className="ml-2 text-caution">{tr("home.changed")}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      </div>
      {ready && p.data && <Calendar rows={p.data.calendar} />}
    </main>
  );
}

/** 20 years × 12 months as a plain grid (docs/DESIGN.md §7): cover from the satellite series,
 * heat as a red bar on top, drought as a dust raster, a downpour as a blue stroke — marks differ
 * by shape, so the table reads in black and white too. */
function Calendar({ rows }: { rows: Passport["calendar"] }) {
  const { t: tr } = useTranslation();
  const MONTHS = tr("common.months_letter", { returnObjects: true }) as string[];
  const [open, setOpen] = useState<number | null>(null);
  const hasCover = rows.some((r) => r.months.some((m) => m.cover));
  const row = rows.find((r) => r.year === open);
  const Swatch = ({ children }: { children: ReactNode }) => (
    <svg width="20" height="12" className="mr-1 inline-block align-[-1px]" aria-hidden>
      {children}
    </svg>
  );
  return (
    <section className="mt-4 rounded-pnl border border-subtle bg-farm-card p-4 sm:p-6" aria-labelledby="cal-h">
      <h2 id="cal-h" className="font-head text-lg font-semibold">{tr("home.cal_title", { n: rows.length })}</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="border-collapse text-xs tabular-nums">
          <thead>
            <tr>
              <th />
              {MONTHS.map((m, i) => (
                <th key={i} className="w-7 pb-0.5 font-normal text-fg-muted">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year}>
                <th className="pr-1.5 text-right font-normal">
                  <button type="button" onClick={() => setOpen(open === r.year ? null : r.year)} className={cn("cursor-pointer px-1 underline-offset-2 hover:underline", open === r.year && "font-semibold text-fg")}>
                    {r.year}
                  </button>
                </th>
                {r.months.map((m, i) => (
                  <td key={i} className="border border-[var(--paper)] p-0">
                    <svg viewBox="0 0 28 16" className="block h-4 w-7" role="img" aria-label={tr("home.cal_cell", { year: r.year, m: i + 1 }) + (m.heat ? tr("home.cal_heat", { n: m.heat }) : "") + (m.drought ? tr("home.cal_drought") : "") + (m.storm ? tr("home.cal_storm", { n: m.storm }) : "")}>
                      <title>{tr("home.cal_cell", { year: r.year, m: i + 1 }) + (m.heat ? tr("home.cal_heat", { n: m.heat }) : "") + (m.drought ? tr("home.cal_drought") : "") + (m.storm ? tr("home.cal_storm", { n: m.storm }) : "")}</title>
                      <rect width="28" height="16" fill={m.cover === "covered" ? "var(--crop-legume)" : m.cover === "bare" ? "var(--soil-2)" : "var(--paper-deep)"} fillOpacity={m.cover ? 0.55 : 1} />
                      {m.drought && <rect width="28" height="16" fill={PAT.bare} />}
                      {m.heat >= 3 && <rect width="28" height="3.5" fill="var(--risk)" />}
                      {m.storm > 0 && <rect x="12.5" y="5" width="3" height="11" fill="var(--water)" />}
                    </svg>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
        {hasCover ? (
          <>
            <span><Swatch><rect width="20" height="12" fill="var(--crop-legume)" fillOpacity="0.55" /></Swatch>{tr("home.covered")}</span>
            <span><Swatch><rect width="20" height="12" fill="var(--soil-2)" fillOpacity="0.55" /></Swatch>{tr("home.bare")}</span>
          </>
        ) : (
          <span>{tr("home.no_sat")}</span>
        )}
        <span><Swatch><rect width="20" height="12" fill="var(--paper-deep)" /><rect width="20" height="3" fill="var(--risk)" /></Swatch>{tr("home.heat")}</span>
        <span><Swatch><rect width="20" height="12" fill="var(--paper-deep)" /><rect width="20" height="12" fill={PAT.bare} /></Swatch>{tr("home.drought")}</span>
        <span><Swatch><rect width="20" height="12" fill="var(--paper-deep)" /><rect x="8.5" y="3" width="3" height="9" fill="var(--water)" /></Swatch>{tr("home.storm")}</span>
      </p>
      {row && (
        <p className="mt-2 max-w-[70ch] border-l-2 border-[var(--ink)] pl-2 text-sm" role="status">
          <b>{row.year}:</b> {row.notes.join("; ")}; {tr("home.precip", { n: row.precip_mm })}
        </p>
      )}
    </section>
  );
}
