import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, HelpCircle, ThermometerSun } from "lucide-react";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { cn } from "@/lib/utils";
import { formatNumber, Num } from "@/ui/format";
import { Button } from "@/ui/primitives";
import { LoadingLine } from "@/ui/states";
import { GapsBlock } from "./GapsBlock";
import { FAMILY_COLOR, PRIORITIES, usePlan, usePlanner, type PlanResult, type Scheme } from "./planner";

const ROWS: { key: string; label: string; unit: string; digits: number; scale?: number }[] = [
  { key: "yield", label: "Урожай", unit: "% потенциала", digits: 0 },
  { key: "income", label: "Маржа", unit: "$/га в год", digits: 0 },
  { key: "water", label: "Полив", unit: "м³/га в год", digits: 0 },
  { key: "feed", label: "Кормовой белок", unit: "кг/га в год", digits: 0 },
  { key: "soil", label: "Органика, изменение", unit: "% C", digits: 3 },
  { key: "nitrogen", label: "Азот в конце", unit: "кг/га", digits: 0 },
  { key: "erosion", label: "Эрозия", unit: "т/га в год", digits: 1 },
  { key: "bare", label: "Голая почва", unit: "дней в год", digits: 0 },
  { key: "labour", label: "Труд", unit: "ч/га в год", digits: 0 },
];

const STRESS: { id: string; label: string }[] = [
  { id: "history", label: "Как в истории" },
  { id: "plus1", label: "+1 °C" },
  { id: "plus15_dry", label: "+1,5 °C и −15 % осадков" },
  { id: "dry_springs", label: "Сухие вёсны" },
  { id: "hot_days", label: "Больше дней > 35 °C" },
];

/** Step «Сравнение»: best schemes side by side, stress test, Pareto, gaps (§4.3, §5). */
export function CompareView({ fid }: { fid: string }) {
  const profile = usePlanner((s) => s.profile);
  const set = usePlanner((s) => s.set);
  const choose = usePlanner((s) => s.choose);
  const chosen = usePlanner((s) => s.chosen);
  const plan = usePlan(fid, profile, true);
  const base = usePlan(fid, { ...profile, scenario: "history", d_temp_c: null, d_precip: null, d_heat_c: null }, profile.scenario !== "history");
  const stressed = profile.scenario !== "history";

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="stress-h" className="rounded-ctl border border-subtle p-3">
        <h3 id="stress-h" className="mb-1 flex items-center gap-2 font-head text-sm font-semibold">
          <ThermometerSun size={16} strokeWidth={1.5} aria-hidden /> Стресс-тест климата
        </h3>
        <p className="mb-2 text-xs text-fg-muted">Это не прогноз, а проверка устойчивости схемы к возможным изменениям климата: изменения накладываются на реальные 20 лет погоды поля.</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Сценарий климата">
          {STRESS.map((s) => (
            <Button key={s.id} role="radio" aria-checked={profile.scenario === s.id} variant={profile.scenario === s.id ? "primary" : "secondary"} size="sm" onClick={() => set({ scenario: s.id, d_temp_c: null, d_precip: null, d_heat_c: null })}>
              {s.label}
            </Button>
          ))}
        </div>
      </section>

      {plan.isLoading && <LoadingLine text="Перебираю схемы и прогоняю каждую по 20 годам погоды… (10–20 с)" />}
      {plan.error && <p className="text-xs text-lethal">{String(plan.error)}</p>}
      {plan.data && plan.data.schemes.length === 0 && <p className="text-sm text-stress">{plan.data.message ?? "Нет схем под эти ограничения."}</p>}
      {plan.data && plan.data.schemes.length > 0 && (
        <>
          <p className="text-xs text-fg-muted">
            Перебрано <Num value={plan.data.n_candidates} digits={0} /> схем, лучшие прогнаны по <Num value={plan.data.n_weather_years} digits={0} /> годам погоды. Числа — медиана, под ней — диапазон в 8 годах из 10 (P10–P90).
            {stressed && <> Сценарий: {plan.data.scenario.name_ru}.</>}
          </p>
          <SchemeColumns res={plan.data} base={stressed ? base.data : undefined} chosen={chosen} onChoose={choose} />
          <div className="grid gap-4 lg:grid-cols-2">
            <ParetoChart res={plan.data} />
            <Timelines res={plan.data} />
          </div>
        </>
      )}
      <GapsBlock fid={fid} />
    </div>
  );
}

function SchemeColumns({ res, base, chosen, onChoose }: { res: PlanResult; base?: PlanResult; chosen: string | null; onChoose: (id: string) => void }) {
  const schemes = res.schemes.slice(0, 4);
  const baseRank = (s: Scheme) => base?.schemes.findIndex((b) => JSON.stringify(b.plan.map((x) => [x.main, x.cover])) === JSON.stringify(s.plan.map((x) => [x.main, x.cover])));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] table-fixed border-separate border-spacing-x-2 text-xs">
        <thead>
          <tr>
            <th className="w-32" />
            {schemes.map((s) => {
              const br = baseRank(s);
              return (
                <th key={s.id} className="rounded-t-ctl bg-hover p-2 text-left align-top font-normal">
                  <div className="flex items-center gap-1.5">
                    <span className="font-head text-base font-semibold">№{s.rank}</span>
                    {s.pareto && <span className="rounded bg-glow px-1 text-xs text-fg">Парето</span>}
                    {base && br !== undefined && (
                      <span className="text-xs text-fg-muted">{br >= 0 ? `в истории №${br + 1}` : "в истории не в топе"}</span>
                    )}
                  </div>
                  <ol className="mt-1 flex flex-wrap gap-1">
                    {s.plan.map((p, i) => (
                      <li key={i} className="flex items-center gap-1 rounded border border-subtle px-1 py-0.5">
                        <span className="size-2 rounded-[1px]" style={{ background: FAMILY_COLOR[p.family ?? ""] ?? "var(--soil)" }} aria-hidden />
                        {p.main_ru}
                        {p.cover_ru && <span className="text-fg-muted">+ {p.cover_ru.replace(/\s*\(.*\)/, "")}</span>}
                      </li>
                    ))}
                  </ol>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th className="py-1 text-left font-normal text-fg-muted">Риск провала</th>
            {schemes.map((s) => (
              <td key={s.id} className="py-1">
                <div className="h-2 bg-hover">
                  <div className="h-2 bg-[var(--risk)]" style={{ width: `${Math.min(100, s.metrics.risk.p50 * 100 * 2)}%` }} />
                </div>
                <span className="font-num">{formatNumber(s.metrics.risk.p50 * 100, 0)} %</span> культуро-лет с урожаем &lt; ½ медианы
              </td>
            ))}
          </tr>
          {ROWS.map((r) => (
            <tr key={r.key}>
              <th className="border-t border-subtle py-1 text-left font-normal text-fg-muted">
                {r.label}
                <span className="block text-xs">{r.unit}</span>
              </th>
              {schemes.map((s) => {
                const d = s.metrics[r.key];
                const best = schemes.every((o) => (res.metrics[r.key].direction > 0 ? o.metrics[r.key].p50 <= d.p50 : o.metrics[r.key].p50 >= d.p50));
                return (
                  <td key={s.id} className="border-t border-subtle py-1">
                    <span className={cn("font-num text-sm", best && "text-ok")}>{formatNumber(d.p50, r.digits)}</span>
                    <span className="block font-num text-xs text-fg-muted">
                      {formatNumber(d.p10, r.digits)}…{formatNumber(d.p90, r.digits)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th />
            {schemes.map((s) => (
              <td key={s.id} className="pt-2 align-top">
                <Why scheme={s} baseline={res.schemes[s.rank === 1 ? 1 : 0] ?? s} />
                <Button variant={chosen === s.id ? "primary" : "secondary"} size="sm" className="mt-1 w-full" onClick={() => onChoose(s.id)}>
                  <CheckCircle2 size={14} strokeWidth={1.5} /> {chosen === s.id ? "Выбрана" : "Выбрать в план"}
                </Button>
                {s.rules.map((t, i) => (
                  <p key={i} className="mt-1 text-xs text-stress">{t}</p>
                ))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Why({ scheme, baseline }: { scheme: Scheme; baseline: Scheme }) {
  const [open, setOpen] = useState(false);
  const llm = useMutation({
    mutationFn: () => unwrap(api.POST("/explain", { body: { scheme, baseline } as never })) as unknown as Promise<{ text: string; source: string }>,
  });
  const contrib = Object.entries(scheme.contributions).sort((a, b) => b[1] - a[1]);
  const label = (k: string) => PRIORITIES.find((p) => p.id === k)?.label ?? ({ nitrogen: "Азот", bare: "Голая почва" } as Record<string, string>)[k] ?? k;
  return (
    <div>
      <Button variant="ghost" size="sm" className="w-full" onClick={() => { setOpen(!open); if (!open && !llm.data) llm.mutate(); }} aria-expanded={open}>
        <HelpCircle size={14} strokeWidth={1.5} /> Почему это место?
      </Button>
      {open && (
        <div className="mt-1 rounded-ctl bg-hover p-2 text-xs leading-snug">
          <p>{llm.data?.text ?? scheme.explanation}</p>
          <p className="mt-1 text-fg-muted">Вклад в итоговый балл ({formatNumber(scheme.score * 100, 0)} из 100):</p>
          <ul>
            {contrib.map(([k, v]) => (
              <li key={k} className="flex items-center gap-1">
                <span className="w-24 truncate">{label(k)}</span>
                <span className="h-1.5 bg-accent" style={{ width: `${v * 100}%` }} aria-hidden />
                <span className="font-num">{formatNumber(v * 100, 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const AXES = ["income", "water", "yield", "erosion", "soil", "feed", "risk", "bare"];

function ParetoChart({ res }: { res: PlanResult }) {
  const [x, setX] = useState("water");
  const [y, setY] = useState("income");
  const pts = res.all_points;
  const ext = (k: string) => {
    const v = pts.map((p) => p[k]);
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    return [lo, hi === lo ? lo + 1 : hi] as const;
  };
  const [x0, x1] = ext(x);
  const [y0, y1] = ext(y);
  const px = (v: number) => 30 + ((v - x0) / (x1 - x0)) * 260;
  const py = (v: number) => 170 - ((v - y0) / (y1 - y0)) * 150;
  const top = new Set(res.schemes.slice(0, 4).map((s) => s.id));
  return (
    <section aria-labelledby="pareto-h">
      <h3 id="pareto-h" className="mb-1 font-head text-base font-semibold text-fg">Компромиссы (фронт Парето)</h3>
      <div className="mb-1 flex gap-2 text-xs">
        <select value={x} onChange={(e) => setX(e.target.value)} aria-label="Ось X" className="h-7 rounded-ctl border border-subtle bg-panel-strong px-1 text-fg">
          {AXES.map((a) => (
            <option key={a} value={a}>{res.metrics[a]?.label ?? a}</option>
          ))}
        </select>
        <span className="self-center text-fg-muted">против</span>
        <select value={y} onChange={(e) => setY(e.target.value)} aria-label="Ось Y" className="h-7 rounded-ctl border border-subtle bg-panel-strong px-1 text-fg">
          {AXES.map((a) => (
            <option key={a} value={a}>{res.metrics[a]?.label ?? a}</option>
          ))}
        </select>
      </div>
      <svg viewBox="0 0 300 190" className="w-full" role="img" aria-label={`Схемы: ${res.metrics[x]?.label} против ${res.metrics[y]?.label}`}>
        <line x1="30" y1="170" x2="295" y2="170" stroke="var(--border-subtle)" />
        <line x1="30" y1="10" x2="30" y2="170" stroke="var(--border-subtle)" />
        <text x="295" y="184" textAnchor="end" fontSize="8" fill="var(--text-secondary)">{res.metrics[x]?.label}</text>
        <text x="4" y="10" fontSize="8" fill="var(--text-secondary)">{res.metrics[y]?.label}</text>
        {pts.map((p) => (
          <g key={p.id}>
            <circle cx={px(p[x])} cy={py(p[y])} r={top.has(p.id) ? 5 : 3} fill={res.pareto_ids.includes(p.id) ? "var(--accent)" : "var(--text-secondary)"} fillOpacity={top.has(p.id) ? 1 : 0.5} stroke="var(--bg-panel)" strokeWidth="1.5">
              <title>{`${p.id}: ${formatNumber(p[x], 1)} / ${formatNumber(p[y], 1)}`}</title>
            </circle>
            {top.has(p.id) && (
              <text x={px(p[x]) + 7} y={py(p[y]) + 3} fontSize="8" fill="var(--text-primary)">№{p.id.slice(1)}</text>
            )}
          </g>
        ))}
      </svg>
      <p className="text-xs text-fg-muted">Оранжевые — схемы, которые нельзя улучшить по одной цели, не ухудшив другую.</p>
    </section>
  );
}

function Timelines({ res }: { res: PlanResult }) {
  return (
    <section aria-labelledby="tl-h">
      <h3 id="tl-h" className="mb-1 font-head text-base font-semibold text-fg">Лента севооборота и почва по годам</h3>
      <ul className="flex flex-col gap-2">
        {res.schemes.slice(0, 4).map((s) => (
          <li key={s.id} className="text-xs">
            <div className="flex items-center gap-1">
              <span className="w-6 font-num text-fg-muted">№{s.rank}</span>
              {s.plan.map((p, i) => (
                <div key={i} className="flex flex-1 overflow-hidden rounded" title={`${i + 1}-й год: ${p.main_ru}${p.cover_ru ? " + " + p.cover_ru : ""}`}>
                  <span className="h-4 flex-[3]" style={{ background: FAMILY_COLOR[p.family ?? ""] ?? "var(--soil)" }} />
                  <span className="h-4 flex-1" style={{ background: p.cover ? "var(--leaf)" : "var(--soil)", opacity: p.cover ? 0.8 : 0.5 }} />
                </div>
              ))}
            </div>
            <p className="ml-7 text-xs text-fg-muted">
              C: {s.trajectory.soc_pct.map((v) => formatNumber(v, 2)).join(", ")} %; N: {s.trajectory.n_mineral.map((v) => formatNumber(v, 0)).join(", ")} кг/га; голых дней: {s.trajectory.bare_days.map((v) => formatNumber(v, 0)).join(" / ")}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-1 flex flex-wrap gap-2 text-xs text-fg-muted">
        {Object.entries({ poaceae: "злаковые", fabaceae: "бобовые", solanaceae: "паслёновые", asteraceae: "астровые", malvaceae: "мальвовые" }).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1"><span className="size-2 rounded-[1px]" style={{ background: FAMILY_COLOR[k] }} />{v}</span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-[1px] bg-[var(--leaf)]" />покровная</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-[1px] bg-[var(--soil)] opacity-50" />голое поле</span>
      </p>
    </section>
  );
}
