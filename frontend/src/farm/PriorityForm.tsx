import { ArrowRight, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives";
import { useRotationCrops } from "./api";
import { MACHINERY, PRESETS, PRIORITIES, useEconomics, usePlanner } from "./planner";

type Sub = "priorities" | "limits" | "money";
const SUBS: { id: Sub; label: string }[] = [
  { id: "priorities", label: "Приоритеты" },
  { id: "limits", label: "Ограничения" },
  { id: "money", label: "Цены" },
];
type CropMode = "can" | "must" | "no";

/** Farmer questionnaire in three steps (docs/ROTATION.md §4.1). */
export function PriorityForm({ onDone }: { onDone: () => void }) {
  const [sub, setSub] = useState<Sub>("priorities");
  const p = usePlanner((s) => s.profile);
  const set = usePlanner((s) => s.set);
  const crops = useRotationCrops();
  const econ = useEconomics();
  const mains = crops.data?.filter((c) => !c.is_cover) ?? [];

  const modeOf = (id: string): CropMode => (p.required.includes(id) ? "must" : p.forbidden.includes(id) ? "no" : "can");
  const setMode = (id: string, m: CropMode) =>
    set({
      required: m === "must" ? [...new Set([...p.required, id])] : p.required.filter((x) => x !== id),
      forbidden: m === "no" ? [...new Set([...p.forbidden, id])] : p.forbidden.filter((x) => x !== id),
    });

  return (
    <div>
      <div className="mb-3 flex gap-1 text-xs" role="tablist" aria-label="Шаги анкеты">
        {SUBS.map((s, i) => (
          <Button key={s.id} role="tab" aria-selected={sub === s.id} variant="ghost" size="sm" pressed={sub === s.id} onClick={() => setSub(s.id)} className="h-8 flex-1 px-1 text-xs">
            {i + 1}. {s.label}
          </Button>
        ))}
      </div>

      {sub === "priorities" && (
        <div>
          <p className="mb-1.5 text-xs text-fg-muted">Готовые профили:</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {PRESETS.map((pr) => (
              <Button key={pr.id} variant="secondary" size="sm" onClick={() => set({ weights: pr.weights })}>
                <Sparkles size={14} strokeWidth={1.5} /> {pr.label}
              </Button>
            ))}
          </div>
          <ul className="flex flex-col gap-2">
            {PRIORITIES.map((pr) => {
              const v = p.weights[pr.id] ?? 0;
              return (
                <li key={pr.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="w-36 shrink-0">
                      {pr.label}
                      <span className="block text-xs text-fg-muted">{pr.hint}</span>
                    </span>
                    <input type="range" min={0} max={5} step={1} value={v} onChange={(e) => set({ weights: { ...p.weights, [pr.id]: Number(e.target.value) } })} className="min-w-0 flex-1 accent-[var(--accent)]" aria-valuetext={`${v} из 5`} />
                    <span className="w-4 text-right font-num">{v}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {sub === "limits" && (
        <div className="flex flex-col gap-3 text-sm">
          <fieldset>
            <legend className="mb-1 text-xs text-fg-muted">Культуры: можно / обязательно / нельзя</legend>
            <ul className="flex flex-col gap-1">
              {mains.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{c.name_ru}</span>
                  <div className="flex gap-0.5 rounded-ctl bg-hover p-0.5" role="radiogroup" aria-label={c.name_ru}>
                    {(["can", "must", "no"] as CropMode[]).map((m) => (
                      <button key={m} type="button" role="radio" aria-checked={modeOf(c.id) === m} onClick={() => setMode(c.id, m)} className={cn("h-7 cursor-pointer rounded px-2 text-xs", modeOf(c.id) === m ? (m === "no" ? "bg-[var(--lethal)] text-[var(--accent-ink)]" : "bg-accent text-[var(--accent-ink)]") : "text-fg-muted hover:text-fg")}>
                        {m === "can" ? "можно" : m === "must" ? "надо" : "нельзя"}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs text-fg-muted">Техника</legend>
            {MACHINERY.map((m) => (
              <label key={m.id} className="flex items-center gap-2 py-0.5 text-xs">
                <input type="checkbox" className="accent-[var(--accent)]" checked={p.machinery.includes(m.id)} onChange={(e) => set({ machinery: e.target.checked ? [...p.machinery, m.id] : p.machinery.filter((x) => x !== m.id) })} />
                {m.label}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs text-fg-muted">Вода, деньги, горизонт</legend>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" className="accent-[var(--accent)]" checked={p.irrigated} onChange={(e) => set({ irrigated: e.target.checked, water_limit_m3_ha: e.target.checked ? p.water_limit_m3_ha || 5000 : 0 })} />
              Есть орошение, лимит
              <input type="number" min={0} step={500} disabled={!p.irrigated} value={p.water_limit_m3_ha} onChange={(e) => set({ water_limit_m3_ha: Number(e.target.value) })} className="h-8 w-24 rounded-ctl border border-subtle bg-panel-strong px-2 font-num text-fg disabled:opacity-40" aria-label="Лимит воды, м³ на гектар в год" />
              м³/га в год
            </label>
            <label className="flex items-center gap-2 text-xs">
              Бюджет на семена, удобрения и работы до
              <input type="number" min={0} step={50} value={p.budget_usd_ha ?? ""} placeholder="без лимита" onChange={(e) => set({ budget_usd_ha: e.target.value ? Number(e.target.value) : null })} className="h-8 w-24 rounded-ctl border border-subtle bg-panel-strong px-2 font-num text-fg" aria-label="Бюджет, $ на гектар в год" />
              $/га в год
            </label>
            <label className="flex items-center gap-2 text-xs">
              Севооборот на
              <select value={p.years} onChange={(e) => set({ years: Number(e.target.value) })} className="h-8 rounded-ctl border border-subtle bg-panel-strong px-1 text-fg" aria-label="Длина севооборота">
                {[3, 4, 5].map((y) => (
                  <option key={y} value={y}>
                    {y} года
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs text-fg-muted">Что можно продать (остальное — для своего хозяйства)</legend>
            <div className="flex flex-wrap gap-1">
              {mains.map((c) => {
                const on = p.sellable === null || p.sellable.includes(c.id);
                return (
                  <button key={c.id} type="button" aria-pressed={on} onClick={() => {
                    const all = mains.map((x) => x.id);
                    const cur = p.sellable ?? all;
                    const next = on ? cur.filter((x) => x !== c.id) : [...cur, c.id];
                    set({ sellable: next.length === all.length ? null : next });
                  }} className={cn("h-7 cursor-pointer rounded-ctl border px-2 text-xs", on ? "border-accent text-fg" : "border-subtle text-fg-muted line-through")}>
                    {c.name_ru}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      )}

      {sub === "money" && econ.data && (
        <div className="text-xs">
          <p className="mb-2 text-fg-muted">Цены по умолчанию — мировые 2024 года (World Bank Pink Sheet) или оценки. Поменяйте на свои: рейтинг пересчитается.</p>
          <table className="w-full">
            <thead className="text-left text-fg-muted">
              <tr>
                <th className="py-1 font-normal">Культура</th>
                <th className="py-1 text-right font-normal">$/т</th>
                <th className="py-1 pl-2 font-normal">источник</th>
              </tr>
            </thead>
            <tbody>
              {mains.map((c) => {
                const e = econ.data.crops[c.id];
                if (!e) return null;
                return (
                  <tr key={c.id} className="border-t border-subtle">
                    <td className="py-1">{c.name_ru}</td>
                    <td className="py-1 text-right">
                      <input type="number" min={0} step={10} value={p.prices[c.id] ?? e.price_usd_t} onChange={(ev) => set({ prices: { ...p.prices, [c.id]: Number(ev.target.value) } })} className="h-7 w-20 rounded-ctl border border-subtle bg-panel-strong px-1 text-right font-num text-fg" aria-label={`Цена: ${c.name_ru}, $ за тонну`} />
                    </td>
                    <td className="py-1 pl-2 text-fg-muted">{p.prices[c.id] != null ? "ваша цена" : e.estimate ? "оценка" : "Pink Sheet 2024"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-fg-muted">
            Азот: <span className="font-num">{econ.data.n_usd_kg.toFixed(2)}</span> $/кг (мочевина, Pink Sheet 2024); вода: <span className="font-num">{econ.data.water_usd_m3}</span> $/м³ (оценка).
          </p>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {sub !== "money" ? (
          <Button variant="secondary" size="sm" onClick={() => setSub(sub === "priorities" ? "limits" : "money")}>
            Дальше <ArrowRight size={14} strokeWidth={1.5} />
          </Button>
        ) : null}
        <Button variant="primary" size="sm" className="ml-auto" onClick={onDone}>
          Подобрать схемы <ArrowRight size={14} strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  );
}
