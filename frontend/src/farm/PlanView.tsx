import { Download, Printer } from "lucide-react";
import { formatNumber } from "@/ui/format";
import { Button } from "@/ui/primitives";
import type { FieldRec } from "./api";
import { GapsBlock } from "./GapsBlock";
import { FAMILY_COLOR, usePlan, usePlanner } from "./planner";

/** Step «План»: the chosen rotation with dates, expected ranges, risks and the agronomist list. */
export function PlanView({ f }: { f: FieldRec }) {
  const profile = usePlanner((s) => s.profile);
  const chosen = usePlanner((s) => s.chosen);
  const plan = usePlan(f.id, profile, true);
  const s = plan.data?.schemes.find((x) => x.id === chosen) ?? plan.data?.schemes[0];
  if (!s || !plan.data) return <p className="text-sm text-fg-muted">Сначала подберите схемы на шаге «Сравнение».</p>;

  const download = () => {
    const body = {
      field: { id: f.id, name: f.name, area_ha: f.area_ha, centroid: f.centroid },
      scenario: plan.data!.scenario,
      profile,
      scheme: s,
      weather_notes: plan.data!.weather_notes,
      generated: new Date().toISOString().slice(0, 10),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `plan-${f.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-head text-xl font-semibold">План севооборота: схема №{s.rank}</h3>
        <div className="ml-auto flex gap-2 print:hidden">
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer size={14} strokeWidth={1.5} /> Печать / PDF
          </Button>
          <Button variant="primary" size="sm" onClick={download}>
            <Download size={14} strokeWidth={1.5} /> Скачать план
          </Button>
        </div>
      </div>
      <p className="text-sm">{s.explanation}</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-fg-muted">
          <tr>
            <th className="py-1 font-normal">Год</th>
            <th className="py-1 font-normal">Основная культура, сев</th>
            <th className="py-1 font-normal">После уборки</th>
            <th className="py-1 text-right font-normal">Урожай, т/га (P10…P90)</th>
          </tr>
        </thead>
        <tbody>
          {s.plan.map((p, i) => {
            const y = p.main ? s.crop_yields[p.main] : undefined;
            return (
              <tr key={i} className="border-t border-subtle">
                <td className="py-1.5 font-num">{i + 1}-й</td>
                <td className="py-1.5">
                  <span className="mr-1.5 inline-block size-2.5 rounded-[1px]" style={{ background: FAMILY_COLOR[p.family ?? ""] ?? "var(--soil)" }} aria-hidden />
                  {p.main_ru} <span className="font-num text-fg-muted">{p.sow ?? ""}</span>
                </td>
                <td className="py-1.5">{p.cover_ru ?? <span className="text-fg-muted">голое поле — подумайте о покровной</span>}</td>
                <td className="py-1.5 text-right font-num">
                  {y ? <>{formatNumber(y.p50, 1)} <span className="text-xs text-fg-muted">({formatNumber(y.p10, 1)}…{formatNumber(y.p90, 1)})</span></> : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <dt className="text-fg-muted">Маржа</dt>
        <dd className="font-num">{formatNumber(s.metrics.income.p50, 0)} $/га в год</dd>
        <dt className="text-fg-muted">Полив</dt>
        <dd className="font-num">{formatNumber(s.metrics.water.p50, 0)} м³/га в год</dd>
        <dt className="text-fg-muted">Эрозия</dt>
        <dd className="font-num">{formatNumber(s.metrics.erosion.p50, 1)} т/га в год</dd>
        <dt className="text-fg-muted">Риск провала</dt>
        <dd className="font-num">{formatNumber(s.metrics.risk.p50 * 100, 0)} %</dd>
      </dl>
      {s.rules.length > 0 && (
        <ul className="text-xs text-stress">
          {s.rules.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-fg-muted">
        Сценарий климата: {plan.data.scenario.name_ru}. {plan.data.weather_notes.join(" ")} Цены: {plan.data.economics_refs.length ? "World Bank Pink Sheet 2024 и оценки" : "оценки"}.
      </p>
      <GapsBlock fid={f.id} />
    </div>
  );
}
