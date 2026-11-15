import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent, type DropAnimation, pointerWithin, rectIntersection, MeasuringStrategy, useDndContext, type CollisionDetection } from "@dnd-kit/core";
import { EXPERT } from "@/flags";
import { Columns2, Grid3x3, Pause, Play, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { LangSwitch } from "@/i18n/LangSwitch";
import { AppBar, BarLink } from "@/ui/AppBar";
import { cn } from "@/lib/utils";
import { Icon } from "@/ui/icons";
import { Button } from "@/ui/primitives";
import { fetchAdvice, fetchFix, fetchQuick, useDeck, useField, usePassport, useQuick, type Quick, type Slot, type Week } from "./api";
import { Beacon } from "./Beacon";
import { loadPrices } from "./LocalPrices";
import { CaptionJournal, LiveCaptions } from "./Captions";
import { PacketInHand, PaperGrainDefs, SeedPacket } from "./deck/SeedPacket";
import { FieldImage } from "./FieldImage";
import { TERRAIN } from "./scene/Backdrop";
import { FieldScene, type Sow } from "./scene/FieldScene";
import { IrrigationPills, useIrrigation } from "./IrrigationPills";
import { Indicators } from "./Indicators";
import { clashes as findClashes, overBudget } from "./rules";
import { SoilProfile } from "./SoilProfile";
import { encodePlan, PRIORITY_CHIPS, STRESS, useBuilder } from "./store";
import { Story } from "./Story";
import { Timeline } from "./Timeline";

const PLAY_MS = 15000;

/** The week that best shows a slot: the main crop at full canopy, or the cover crop in winter. */
function focusWeek(weeks: Week[], year: number, slot: 0 | 1): Week | null {
  const inYear = weeks.filter((w) => w.year === year || (slot === 1 && w.year === year + 1 && w.month < 3));
  if (!inYear.length) return weeks[weeks.length - 1] ?? null;
  const pool = slot === 0 ? inYear.filter((w) => w.crop && !w.is_cover) : inYear.filter((w) => w.is_cover);
  if (!pool.length) return slot === 0 ? inYear[Math.floor(inYear.length / 2)] : inYear[inYear.length - 1];
  return pool.reduce((a, b) => (b.canopy > a.canopy ? b : a));
}

function points(q: Quick, other: Quick, priorities: string[]): number {
  const map: Record<string, { key: "water" | "money" | "soil" | "risk"; lower: boolean }> = {
    water: { key: "water", lower: true },
    income: { key: "money", lower: false },
    soil: { key: "soil", lower: false },
    risk: { key: "risk", lower: true },
  };
  const per = 100 / Math.max(1, priorities.length);
  return Math.round(
    priorities.reduce((sum, p) => {
      const m = map[p];
      const a = q.indicators[m.key].value;
      const b = other.indicators[m.key].value;
      const best = m.lower ? Math.min(a, b) : Math.max(a, b);
      const worst = m.lower ? Math.max(a, b) : Math.min(a, b);
      const k = best === worst ? 1 : m.lower ? (worst - a) / (worst - best) : (a - worst) / (best - worst);
      return sum + per * (0.5 + 0.5 * k);
    }, 0),
  );
}

export default function BuilderPage() {
  const { t } = useTranslation();
  const { fid } = useParams();
  const navigate = useNavigate();
  const field = useField(fid);
  const deck = useDeck(fid);
  const irrigation = useIrrigation(field.data);
  const passport = usePassport(fid);
  const s = useBuilder();
  const prices = useMemo(() => (fid ? loadPrices(fid) : {}), [fid]);
  const quick = useQuick(field.data, s.plan, s.scenario, s.startYear, irrigation, prices);
  const prevRef = useRef<Quick | undefined>(undefined);
  const [prev, setPrev] = useState<Quick | undefined>(undefined);
  const [dragging, setDragging] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ year: number; slot: 0 | 1 } | null>(null);
  const [playIdx, setPlayIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [compare, setCompare] = useState<{ q: Quick } | null>(null);
  const [showYears, setShowYears] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [sow, setSow] = useState<Sow | null>(null);
  const [paused, setPaused] = useState(() => {
    try {
      return localStorage.getItem("astrocrop.world-paused") === "1";
    } catch {
      return false;
    }
  });
  const [showPhoto, setShowPhoto] = useState(false);
  const [rolling, setRolling] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem("astrocrop.world-paused", paused ? "1" : "0");
    } catch {
      /* the choice lives until the page closes */
    }
  }, [paused]);
  useEffect(() => {
    if (!sow) return;
    const tm = setTimeout(() => setSow(null), 1300);
    return () => clearTimeout(tm);
  }, [sow]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));

  useEffect(() => {
    if (fid && s.fid !== fid) s.reset(fid);
  }, [fid]); // eslint-disable-line react-hooks/exhaustive-deps

  // «было → стало»: remember the previous answer whenever a new one arrives
  useEffect(() => {
    if (quick.data && !quick.isPlaceholderData) {
      if (prevRef.current && JSON.stringify(prevRef.current.plan) !== JSON.stringify(quick.data.plan)) setPrev(prevRef.current);
      prevRef.current = quick.data;
    }
  }, [quick.data, quick.isPlaceholderData]);

  // keyboard: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).closest("input,textarea,select")) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) {
        e.preventDefault();
        s.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s]);

  // playback through the weekly series of the chosen year (no requests while playing)
  const weeks = quick.data?.playback.weeks ?? [];
  useEffect(() => {
    if (!playing || !weeks.length) return;
    const step = PLAY_MS / weeks.length;
    const t = setInterval(() => {
      setPlayIdx((i) => {
        const n = (i ?? -1) + 1;
        if (n >= weeks.length) {
          setPlaying(false);
          return weeks.length - 1;
        }
        return n;
      });
    }, step);
    return () => clearInterval(t);
  }, [playing, weeks.length]);

  const [fixes, setFixes] = useState<Record<string, { options: { crop: string; name_ru: string }[] | null; loading: boolean }>>({});
  const sameQ = quick.data && JSON.stringify(quick.data.plan) === JSON.stringify(s.plan) ? quick.data : undefined;
  const clashes = useMemo(
    () => [...(deck.data ? findClashes(s.plan, deck.data) : []), ...(sameQ ? overBudget(sameQ.costs, s.budget, s.labour) : [])],
    [s.plan, deck.data, sameQ, s.budget, s.labour],
  );
  const names = useMemo(() => Object.fromEntries((deck.data ?? []).map((c) => [c.id, c.name_ru])), [deck.data]);

  if (!field.data || !deck.data) return <div className="grid h-dvh place-items-center bg-[var(--bg-void)] text-fg">{t("builder.loading")}</div>;
  const f = field.data;
  const q = quick.data;
  const pending = quick.isFetching;
  const week = playIdx !== null ? weeks[playIdx] ?? null : focus ? focusWeek(weeks, focus.year, focus.slot) : weeks.length ? focusWeek(weeks, s.plan.length - 1, 0) : null;
  const empty = !s.plan.some(([m, c]) => m || c);

  const drop = (crop: string, year: number, slot: 0 | 1, from?: { year: number; slot: 0 | 1 }) => {
    const card = deck.data!.find((c) => c.id === crop);
    if (!card) return;
    const target: 0 | 1 = card.is_cover ? 1 : 0;
    if (target !== slot) slot = target; // a cover card always goes to winter, a main crop to summer
    const plan = s.plan.map((p) => [...p] as Slot);
    if (from) plan[from.year][from.slot] = null;
    plan[year][slot] = crop;
    s.setPlan(plan);
    setSow({ year, crop, key: Date.now() });
    setFocus({ year, slot });
    setPlayIdx(null);
    setCompare(null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const over = e.over?.data.current as { year: number; slot: 0 | 1 } | undefined;
    const data = e.active.data.current as { crop: string; fromYear?: number; fromSlot?: 0 | 1 } | undefined;
    if (!data?.crop) return;
    if (!over) {
      if (data.fromYear !== undefined) s.put(data.fromYear, data.fromSlot!, null); // dragged out → remove
      return;
    }
    drop(data.crop, over.year, over.slot, data.fromYear !== undefined ? { year: data.fromYear, slot: data.fromSlot! } : undefined);
  };

  const placeByClick = (crop: string) => {
    const card = deck.data!.find((c) => c.id === crop)!;
    const slot: 0 | 1 = card.is_cover ? 1 : 0;
    const year = s.plan.findIndex((p) => !p[slot]);
    drop(crop, year === -1 ? s.plan.length - 1 : year, slot);
  };

  const best = async () => {
    setBusy("advice");
    try {
      const a = await fetchAdvice(f, s.priorities, s.plan.length, irrigation, s.budget, s.labour);
      s.setAdvice(a);
      if (!a.plan.length) {
        setCaption(t("builder.over_limits", { label: a.label }));
        return;
      }
      // cards «fly in» one by one
      let plan = s.plan.map(() => [null, null] as Slot);
      s.setPlan(plan);
      for (let y = 0; y < a.plan.length; y++) {
        for (const slot of [0, 1] as const) {
          if (!a.plan[y][slot]) continue;
          await new Promise((r) => setTimeout(r, 220));
          plan = plan.map((p) => [...p] as Slot);
          plan[y][slot] = a.plan[y][slot];
          s.setPlan(plan, false);
          setFocus({ year: y, slot });
        }
      }
      setCaption(a.label);
    } finally {
      setBusy(null);
    }
  };

  const vsAdvice = async () => {
    setBusy("compare");
    try {
      const a = s.advice ?? (await fetchAdvice(f, s.priorities, s.plan.length, irrigation, s.budget, s.labour));
      s.setAdvice(a);
      setCompare({ q: await fetchQuick(f, a.plan, s.scenario, irrigation) });
    } finally {
      setBusy(null);
    }
  };

  const rollDice = () => {
    if (!q || rolling) return;
    setRolling(true);
    setTimeout(() => {
      setRolling(false);
      dice();
    }, 650);
  };

  const dice = () => {
    if (!q) return;
    const years = q.outcomes.map((o) => o.start_year);
    const y = years[Math.floor(Math.random() * years.length)];
    s.setStartYear(y);
    const notes = passport.data?.calendar.find((r) => r.year === y)?.notes ?? [];
    const o = q.outcomes.find((x) => x.start_year === y);
    setCaption(t("builder.dice", { y, note: notes[0] ?? t("builder.ordinary_year") }) + (o?.class === "fail" ? t("builder.dice_fail") : o?.class === "good" ? t("builder.dice_good") : ""));
    setPlayIdx(0);
    setPlaying(true);
  };

  const play = () => {
    if (playing) return setPlaying(false);
    setPlayIdx((i) => (i === null || i >= weeks.length - 1 ? 0 : i));
    setPlaying(true);
  };

  const yearsGrid = q && showYears && (
    <div>
      <p className="mb-1 text-sm">
        <Trans i18nKey="builder.years_summary" values={{ good: q.summary.good_years, n: q.summary.n_years, fail: q.summary.fail_years }} components={{ b: <b /> }} />
      </p>
      <div className="grid grid-cols-5 gap-[2px] sm:grid-cols-10">
        {q.outcomes.map((o) => (
          <button
            key={o.start_year}
            type="button"
            onClick={() => {
              s.setStartYear(o.start_year);
              setPlayIdx(0);
              setPlaying(true);
            }}
            className={cn(
              "relative flex h-12 cursor-pointer flex-col items-center justify-center text-xs",
              o.class === "good" ? "bg-[color-mix(in_oklab,var(--good)_22%,var(--paper))]" : o.class === "fail" ? "border-2 border-[var(--risk)] text-risk" : "bg-hover",
            )}
            aria-label={`${o.start_year}: ${t(o.class === "good" ? "builder.cls_good" : o.class === "fail" ? "builder.cls_fail" : "builder.cls_ok")}`}
          >
            <span className="font-medium tabular-nums">{o.start_year}</span>
            <span>{t(o.class === "good" ? "builder.cls_good_short" : o.class === "fail" ? "builder.cls_fail" : "builder.cls_ok")}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const toSummary = () => navigate(`/fields/${f.id}/summary?p=${encodePlan(s.plan)}&s=${s.scenario}&i=${irrigation}`);
  const months = t("common.months", { returnObjects: true }) as string[];
  const sliderIdx = playIdx ?? Math.max(0, week ? weeks.indexOf(week) : 0);
  const dragCard = dragging ? deck.data.find((c) => c.id === dragging) : undefined;

  return (
    <DndContext sensors={sensors} collisionDetection={whereThePointerIs} measuring={MEASURE} onDragStart={(e: DragStartEvent) => setDragging((e.active.data.current as { crop: string }).crop)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <PaperGrainDefs />
      <RemeasureOnScroll />
      <div data-mood="field" className="min-h-dvh bg-farm-page text-fg">
        <AppBar
          right={
            <>
              <LangSwitch inverted />
              <BarLink to="/reference">{t("common.sources")}</BarLink>
              {EXPERT && <BarLink to={`/expert/fields/${f.id}`}>{t("common.expert")}</BarLink>}
              <Button variant="accent" size="sm" disabled={empty} onClick={toSummary}>
                {t("builder.summary")}
              </Button>
            </>
          }
        />

        <main className="mx-auto flex max-w-7xl flex-col gap-4 px-[var(--edge)] py-4">
          {/* the living field: landscape, time slider, soil profile (docs/DESIGN_V3.md §2.2) */}
          <section aria-labelledby="scene-h" className="overflow-hidden rounded-pnl border border-subtle bg-farm-card shadow-[var(--shadow-sheet)]">
            <div className="relative">
              <FieldScene
                plan={s.plan}
                deck={deck.data}
                q={sameQ ?? q}
                week={week}
                irrigation={irrigation}
                terrain={TERRAIN[f.id] ?? "hills"}
                sow={sow}
                paused={paused}
                dragging={!!dragging}
                names={names}
                yearLabel={(y) => (y < 0 ? t("scene.aria") : t("timeline.year", { y: y + 1 }))}
                overlay={
                  <>
                    <div className="pointer-events-none absolute left-2 top-2 max-w-[55%] rounded-md bg-[var(--paper-sheet)] px-2.5 py-1.5 shadow-[var(--shadow-sheet)] sm:left-5 sm:top-5 sm:px-4 sm:py-3">
                      <h1 id="scene-h" className="font-head text-xl font-semibold leading-none sm:text-4xl lg:text-5xl">{t("builder.title")}</h1>
                      <p className="mt-1 text-xs text-fg-muted sm:text-base">
                        {f.name}
                        {f.region ? `, ${f.region}` : ""}
                      </p>
                    </div>
                    <div className="absolute right-2 top-2 flex flex-col items-end gap-1.5 sm:right-5 sm:top-5 sm:gap-2">
                      <Button variant="secondary" size="sm" pressed={paused} onClick={() => setPaused(!paused)} className="shadow-[var(--shadow-packet)]">
                        {paused ? <Play size={14} strokeWidth={1.5} /> : <Pause size={14} strokeWidth={1.5} />} {t(paused ? "scene.resume" : "scene.pause")}
                      </Button>
                      <Button variant="secondary" size="sm" pressed={showPhoto} onClick={() => setShowPhoto(!showPhoto)} className="shadow-[var(--shadow-packet)]">
                        <Icon name="satellite" size={16} /> {t("scene.photo")}
                      </Button>
                      {showPhoto && (
                        <div className="w-64 rounded-md bg-[var(--paper-sheet)] p-2 shadow-[var(--shadow-sheet)]">
                          <FieldImage fid={f.id} geometry={f.geometry} />
                        </div>
                      )}
                    </div>
                    {playIdx !== null && <LiveCaptions captions={q?.playback.captions ?? []} week={playIdx} playing={playing} onPause={() => setPlaying(false)} />}
                  </>
                }
              />
            </div>
            {/* the time machine: drag through the months of the plan */}
            <div className="border-t border-subtle px-4 pb-3 pt-2 sm:px-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{t("scene.time")}</span>
                <span className="tabular-nums text-fg-muted">{week ? t("builder.play_label", { y: week.year + 1, m: months[week.month], w: q?.playback.weather_years[week.year] ?? "" }) : t("scene.no_time")}</span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, weeks.length - 1)}
                value={sliderIdx}
                disabled={!weeks.length}
                onChange={(e) => {
                  setPlaying(false);
                  setPlayIdx(Number(e.target.value));
                }}
                aria-label={t("builder.scrub")}
                className="mt-1 h-6 w-full cursor-grab accent-[var(--primary-600)] active:cursor-grabbing"
              />
              <div className="grid text-xs text-fg-muted" style={{ gridTemplateColumns: `repeat(${s.plan.length}, minmax(0, 1fr))` }}>
                {s.plan.map((_, y) => (
                  <span key={y} className="border-l border-subtle pl-1 first:border-l-0">
                    {t("timeline.year", { y: y + 1 })}
                  </span>
                ))}
              </div>
              {playIdx !== null && !playing && <CaptionJournal captions={q?.playback.captions ?? []} />}
            </div>
            <div className="border-t border-subtle px-4 pb-4 pt-3 sm:px-6">
              <h2 className="mb-1 font-head text-lg font-semibold">{t("plan.profile")}</h2>
              <SoilProfile q={sameQ ?? q} plan={s.plan} deck={deck.data} playWeek={playIdx !== null ? week : null} />
            </div>
          </section>

          {/* the deck: seed packets to throw onto the field — right under it, one row */}
          <section className="relative rounded-pnl border border-subtle bg-farm-card px-4 pb-2 pt-3 sm:px-6" aria-labelledby="deck-h">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 id="deck-h" className="font-head text-2xl font-semibold">{t("builder.deck")}</h2>
              <p className="text-sm text-fg-muted">{t("scene.deck_hint")}</p>
              {q && <p className="ml-auto text-xs text-fg-muted">{q.estimate_note}</p>}
            </div>
            <Beacon id="deck" />
            <div className="-mx-1 flex items-end gap-3 overflow-x-auto px-1 pb-3 pt-2">
              {deck.data.filter((c) => !c.is_cover).map((c) => (
                <div key={c.id} onClick={() => placeByClick(c.id)} onKeyDown={(e) => e.key === "Enter" && placeByClick(c.id)}>
                  <SeedPacket card={c} />
                </div>
              ))}
              <span className="mx-1 self-stretch border-l border-dashed border-subtle" aria-hidden />
              <span className="sr-only">{t("builder.covers")}</span>
              {deck.data.filter((c) => c.is_cover).map((c) => (
                <div key={c.id} onClick={() => placeByClick(c.id)} onKeyDown={(e) => e.key === "Enter" && placeByClick(c.id)}>
                  <SeedPacket card={c} />
                </div>
              ))}
            </div>
          </section>


          <Indicators q={q} prev={prev} pending={pending && !!q} />

          {/* what matters, money and hands, water */}
          <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-pnl border border-subtle bg-farm-card p-4">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("builder.priorities")}>
              <span className="text-sm">{t("builder.priorities")}</span>
              {PRIORITY_CHIPS.map((c) => (
                <Button key={c.id} variant="secondary" pressed={s.priorities.includes(c.id)} size="sm" onClick={() => s.togglePriority(c.id)}>
                  <Icon name={c.icon} size={16} /> {c.label}
                </Button>
              ))}
              <span className="text-xs text-fg-muted">{t("builder.pick12")}</span>
            </div>
            <label className="flex items-center gap-1.5 text-sm text-fg-muted">
              {t("builder.budget")}
              <input type="number" min={0} step={50} value={s.budget ?? ""} placeholder="—" onChange={(e) => s.setLimits(e.target.value ? Number(e.target.value) : null, s.labour)} className="h-9 w-20 rounded-ctl border border-subtle bg-panel px-1.5 text-right tabular-nums text-fg" aria-label={t("builder.budget_aria")} />
              {t("builder.per_ha")}
            </label>
            <label className="flex items-center gap-1.5 text-sm text-fg-muted">
              {t("builder.hands")}
              <input type="number" min={0} step={5} value={s.labour ?? ""} placeholder="—" onChange={(e) => s.setLimits(s.budget, e.target.value ? Number(e.target.value) : null)} className="h-9 w-16 rounded-ctl border border-subtle bg-panel px-1.5 text-right tabular-nums text-fg" aria-label={t("builder.labour_aria")} />
              {t("builder.labour_unit")}
            </label>
            <IrrigationPills field={f} />
          </section>

          {/* the plan, year by year, with its links and notes */}
          <section aria-labelledby="plan-h" className="flex flex-col gap-3 rounded-pnl border border-subtle bg-farm-card p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 id="plan-h" className="mr-2 font-head text-lg font-semibold">{t("plan.title")}</h2>
              <span className="relative">
                <Button variant="primary" size="sm" onClick={best} disabled={!!busy}>
                  {busy === "advice" ? t("builder.picking") : t("builder.advise")}
                </Button>
                <Beacon id="advice" />
              </span>
              <span className="relative">
                <Button variant="secondary" size="sm" onClick={play} disabled={!q}>
                  {playing ? <Pause size={14} strokeWidth={1.5} /> : <Play size={14} strokeWidth={1.5} />} {t(s.plan.length >= 5 ? "builder.live5" : "builder.live", { n: s.plan.length })}
                </Button>
                <Beacon id="play" />
              </span>
              <Button variant="secondary" size="sm" onClick={rollDice} disabled={!q || rolling}>
                <DiceFace rolling={rolling} /> {t("builder.dice_btn")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowYears(!showYears)} disabled={!q} pressed={showYears}>
                <Grid3x3 size={14} strokeWidth={1.5} /> {t("builder.twenty")}
              </Button>
              <Button variant="secondary" size="sm" onClick={vsAdvice} disabled={!q || !!busy}>
                <Columns2 size={14} strokeWidth={1.5} /> {t("builder.duel")}
              </Button>
              <span className="ml-auto flex items-center gap-1">
                {f.current_plan && (
                  <Button variant="ghost" size="sm" onClick={() => { s.setPlan(f.current_plan!.map((p) => [...p] as Slot)); setCaption(t("builder.now_caption")); }}>
                    {t("builder.now_btn")}
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={s.undo} disabled={!s.past.length} aria-label={t("builder.undo")}><Undo2 size={16} strokeWidth={1.5} /></Button>
                <Button variant="ghost" size="icon" onClick={s.redo} disabled={!s.future.length} aria-label={t("builder.redo")}><Redo2 size={16} strokeWidth={1.5} /></Button>
                <Button variant="ghost" size="icon" onClick={() => s.setPlan(s.plan.map(() => [null, null] as Slot))} aria-label={t("builder.clear")}><RotateCcw size={16} strokeWidth={1.5} /></Button>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("builder.whatif_aria")}>
              <span className="text-sm text-fg-muted">{t("builder.whatif")}</span>
              {STRESS.map((x) => (
                <Button key={x.id} variant="secondary" pressed={s.scenario === x.id} size="sm" onClick={() => s.setScenario(s.scenario === x.id ? "history" : x.id)}>
                  <Icon name={x.icon} size={16} /> {x.label}
                </Button>
              ))}
              {s.scenario !== "history" && <span className="text-sm text-caution">{t("builder.not_forecast")}</span>}
            </div>
            {q?.salinity.risk && (
              <p className="flex max-w-[70ch] gap-1.5 rounded-ctl border border-[var(--yellow-300)] bg-farm-warning-subtle px-3 py-2 text-sm">
                <Icon name="salt" size={18} className="mt-0.5 shrink-0 text-caution" />
                <span>
                  <b className="font-semibold">{q.salinity.text}.</b> {t("builder.why")} {q.salinity.reasons.join(", ")}.
                </span>
              </p>
            )}
            {caption && <p className="text-sm font-medium">{caption}</p>}

            <Timeline
              plan={s.plan}
              deck={deck.data}
              clashes={clashes}
              links={q && JSON.stringify(q.plan) === JSON.stringify(s.plan) ? q.links : []}
              reasons={s.advice && JSON.stringify(s.advice.plan) === JSON.stringify(s.plan) ? s.advice.reasons : undefined}
              coverNotes={sameQ?.cover_notes}
              focus={focus}
              onClear={(y, slot) => s.put(y, slot, null)}
              fixFor={(y, slot) => {
                const k = `${JSON.stringify(s.plan)}|${y}|${slot}`;
                const st = fixes[k] ?? { options: null, loading: false };
                return {
                  ...st,
                  open: async () => {
                    setFixes((x) => ({ ...x, [k]: { options: null, loading: true } }));
                    const options = await fetchFix(f, s.plan, y, slot, s.priorities, irrigation, s.budget);
                    setFixes((x) => ({ ...x, [k]: { options, loading: false } }));
                  },
                  pick: (crop: string) => drop(crop, y, slot),
                };
              }}
              weatherYears={playIdx !== null ? q?.playback.weather_years : undefined}
            />
            {yearsGrid && <div className="border-t border-subtle pt-3">{yearsGrid}</div>}
          </section>

          {compare && q && (
            <section className="rounded-pnl border border-subtle bg-farm-card p-4 sm:p-6">
              <h2 className="mb-2 font-head text-lg font-semibold">{t("builder.duel")}</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {[{ who: t("builder.yours"), x: q, o: compare.q }, { who: t("builder.advice"), x: compare.q, o: q }].map(({ who, x, o }) => (
                  <div key={who} className="flex flex-col gap-2">
                    <p className="flex items-baseline justify-between">
                      <b className="font-head text-lg">{who}</b> <span className="text-lg tabular-nums">{t("builder.points", { n: points(x, o, s.priorities) })}</span>
                    </p>
                    <div className="overflow-hidden rounded-lg border border-subtle">
                      <FieldScene plan={x.plan} deck={deck.data} q={x} week={null} irrigation={irrigation} sow={null} paused dragging={false} names={names} yearLabel={(y) => (y < 0 ? t("scene.aria") : t("timeline.year", { y: y + 1 }))} interactive={false} compact />
                    </div>
                    <SoilProfile q={x} plan={x.plan} deck={deck.data} compact />
                    <Indicators q={x} prev={undefined} pending={false} />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-sm">{t("builder.beat", { p: s.priorities.map((p) => PRIORITY_CHIPS.find((c) => c.id === p)?.label).join(" + ") })}</p>
            </section>
          )}
        </main>
      </div>
      <DragOverlay dropAnimation={POUR}>{dragCard ? <PacketInHand card={dragCard} /> : null}</DragOverlay>
      {f.farmer && f.current_plan && <Story field={f} quick={q} onPlay={() => { setPlayIdx(0); setPlaying(true); }} />}
    </DndContext>
  );
}

/** The page scrolls while a packet is carried from the deck up to the field: measure the strips
 * all the time, not once at the start. */
const MEASURE = { droppable: { strategy: MeasuringStrategy.Always } };

/** While a packet is in the hand, re-measure the drop targets whenever the page scrolls (the
 * deck sits below the field, so carrying a packet up scrolls the page). */
function RemeasureOnScroll() {
  const { active, droppableContainers, measureDroppableContainers } = useDndContext();
  useEffect(() => {
    if (!active) return;
    const ids = () => [...droppableContainers.values()].map((c) => c.id);
    const onScroll = () => measureDroppableContainers(ids());
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, [active, droppableContainers, measureDroppableContainers]);
  return null;
}

/** A packet lands where the hand points (a strip of the field or a cell of the plan); with the
 * keyboard, where it overlaps most. */
const whereThePointerIs: CollisionDetection = (args) => {
  const hit = pointerWithin(args);
  return hit.length ? hit : rectIntersection(args);
};

/** The packet is opened over the field: it tips, shrinks and empties (docs/DESIGN_V3.md §2.5). */
const POUR: DropAnimation = {
  duration: 450,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  keyframes: ({ transform }) => [
    { transform: `translate3d(${transform.initial.x}px, ${transform.initial.y}px, 0) rotate(4deg)`, opacity: 1 },
    { transform: `translate3d(${transform.initial.x}px, ${transform.initial.y + 20}px, 0) rotate(-40deg) scale(0.7)`, opacity: 0.9 },
    { transform: `translate3d(${transform.initial.x}px, ${transform.initial.y + 40}px, 0) rotate(-70deg) scale(0.3)`, opacity: 0 },
  ],
};

/** A die that really rolls before the weather year is drawn. */
function DiceFace({ rolling }: { rolling: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" className={rolling ? "dice-rolling" : ""} aria-hidden>
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5" cy="5" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="11" cy="11" r="1.2" fill="currentColor" />
    </svg>
  );
}
