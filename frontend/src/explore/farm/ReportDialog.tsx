import { useQuery } from "@tanstack/react-query";
import { Copy, FileText, Repeat, Save, X } from "lucide-react";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { TimeSeriesChart } from "@/ui/charts";
import { Num } from "@/ui/format";
import { Button, GlassPanel } from "@/ui/primitives";
import { LoadingLine } from "@/ui/states";
import { useExplore } from "../store";
import { useFarm } from "./store";

interface PlotReport {
  crop_id: string;
  protection: string;
  alive: boolean;
  yield_g: number;
  yield_rel_earth: number;
  norm_yield_g: number;
  yield_vs_norm: number;
  water_used_mm: number;
  health: number[];
  harms: { type: string; label_ru: string; during_ru: string; loss_g: number; loss_rel_norm: number | null; start_day: number }[];
  helps: { type: string; name_ru: string; day: number; gain_g: number }[];
  headline_ru: string;
}
interface Report {
  plots: Record<string, PlotReport>;
  days: number;
  scenario: Record<string, unknown>;
}

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];

/** End-of-season report (§5): yield, health, what harmed most, what helped. */
export function ReportDialog({ crops }: { crops: { id: string; name_ru: string }[] }) {
  const open = useFarm((s) => s.reportOpen);
  const setOpen = useFarm((s) => s.setReportOpen);
  const sessionId = useFarm((s) => s.sessionId);
  const version = useFarm((s) => s.version);
  const [shareId, setShareId] = useState<string | null>(null);
  const report = useQuery({
    queryKey: ["farm", sessionId, "report", version],
    enabled: open && !!sessionId,
    staleTime: Infinity,
    queryFn: () => unwrap(api.GET("/sim/sessions/{sid}/report", { params: { path: { sid: sessionId! } } })) as unknown as Promise<Report>,
  });
  if (!open) return null;
  const r = report.data;
  const name = (id: string) => crops.find((c) => c.id === id)?.name_ru ?? id;
  const plots = Object.entries(r?.plots ?? {});
  const health = plots.length
    ? Array.from({ length: Math.max(...plots.map(([, p]) => p.health.length)) }, (_, d) => ({ day: d, ...Object.fromEntries(plots.map(([pid, p]) => [pid, (p.health[d] ?? 0) * 100])) }))
    : [];
  const repeat = () => {
    if (!r) return;
    // Same scenario including everything done live, from day 0: tweak and play again.
    const sc = r.scenario as { events?: Record<string, unknown>[]; live_overrides?: { from_hour: number; values: Record<string, number | string> }[]; overrides?: Record<string, number | string> };
    useFarm.getState().setScheduled((sc.events ?? []) as Record<string, unknown>[]);
    const merged = { ...(sc.overrides ?? {}) };
    for (const c of sc.live_overrides ?? []) Object.assign(merged, c.values);
    useFarm.setState({ pendingOverrides: merged });
    // Rewind the old session too, so its last frames do not put the clock back at the end.
    if (sessionId) void api.POST("/sim/sessions/{sid}/control", { params: { path: { sid: sessionId } }, body: { action: "seek", value: 0 } });
    useExplore.getState().setDay(0);
    setOpen(false);
  };
  const save = async () => {
    if (!r) return;
    const { data } = await api.POST("/sim/scenarios", { body: r.scenario as never });
    if (data) setShareId(data.id);
  };
  const link = shareId ? `${location.origin}${location.pathname}?scenario=${shareId}` : null;
  return (
    <div data-modal className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-[var(--edge)]" onClick={() => setOpen(false)}>
      <GlassPanel strong className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto p-5" role="dialog" aria-modal aria-label="Итоговый отчёт сезона" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <FileText size={20} strokeWidth={1.5} className="text-accent" aria-hidden />
          <h2 className="font-head text-2xl font-semibold">Итог сезона</h2>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setOpen(false)} aria-label="Закрыть">
            <X size={20} strokeWidth={1.5} />
          </Button>
        </div>
        {!r ? (
          <LoadingLine text="Считаем, что повлияло на урожай…" />
        ) : (
          <div className="flex flex-col gap-4">
            {plots.map(([pid, p]) => (
              <section key={pid} className="rounded-pnl border border-subtle p-3">
                <p className="text-xs uppercase tracking-[0.08em] text-fg-muted">
                  Грядка {pid} · {name(p.crop_id)}
                </p>
                <p className="mt-1 font-head text-lg font-semibold leading-snug">{p.headline_ru}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <dt className="text-fg-muted">Урожай</dt>
                  <dd><Num value={p.yield_g} unit="г/раст." /></dd>
                  <dt className="text-fg-muted">От нормы</dt>
                  <dd><Num value={p.yield_vs_norm * 100} unit="%" digits={0} /></dd>
                  <dt className="text-fg-muted">От земного</dt>
                  <dd><Num value={p.yield_rel_earth * 100} unit="%" digits={0} /></dd>
                  <dt className="text-fg-muted">Вода полива</dt>
                  <dd><Num value={p.water_used_mm} unit="мм" digits={0} /></dd>
                </dl>
                {p.harms.length > 0 && (
                  <>
                    <h3 className="mt-3 text-xs uppercase tracking-[0.08em] text-fg-muted">Что навредило</h3>
                    <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                      {p.harms.map((h, i) => (
                        <li key={i}>
                          <span className="text-lethal">{(h.loss_rel_norm ?? 0) < 0.005 ? <span className="font-num">−&lt;1 %</span> : <>−<Num value={(h.loss_rel_norm ?? 0) * 100} unit="%" digits={0} /></>}</span> {h.label_ru} во время {h.during_ru} (с {Math.round(h.start_day)}-х суток)
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {p.helps.length > 0 && (
                  <>
                    <h3 className="mt-3 text-xs uppercase tracking-[0.08em] text-fg-muted">Что помогло</h3>
                    <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                      {p.helps.map((h, i) => (
                        <li key={i}>
                          <span className="text-ok">+<Num value={h.gain_g} unit="г" /></span> {h.name_ru}, {Math.round(h.day)}-е сутки
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            ))}
            {health.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs uppercase tracking-[0.08em] text-fg-muted">Здоровье по дням</h3>
                <TimeSeriesChart
                  ariaLabel="Здоровье растений по дням сезона"
                  data={health}
                  xKey="day"
                  yDomain={[0, 100]}
                  zones
                  series={plots.map(([pid, p], i) => ({ key: pid, name: `${pid} · ${name(p.crop_id)}`, color: SERIES[i % SERIES.length], unit: "%" }))}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={repeat}>
                <Repeat size={16} strokeWidth={1.5} /> Повторить с изменениями
              </Button>
              <Button variant="secondary" onClick={save}>
                <Save size={16} strokeWidth={1.5} /> Сохранить сценарий
              </Button>
            </div>
            {link && (
              <div className="flex items-center gap-2 rounded-ctl border border-subtle bg-hover p-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-num">{link}</span>
                <Button variant="ghost" size="sm" onClick={() => navigator.clipboard?.writeText(link)} aria-label="Скопировать ссылку">
                  <Copy size={16} strokeWidth={1.5} /> Копировать
                </Button>
              </div>
            )}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
