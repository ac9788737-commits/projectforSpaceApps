import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/primitives";
import type { Quick } from "./api";

const KEY = "astrocrop.prices";

/** Prices saved per field in this browser; also sent with the builder's requests. */
export function loadPrices(fid: string): Record<string, number> {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Record<string, number>>)[fid] ?? {};
  } catch {
    return {};
  }
}

function savePrices(fid: string, prices: Record<string, number>) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Record<string, number>>;
    all[fid] = prices;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* without storage the prices live until the page closes */
  }
}

/** Margin for other prices, in the browser (docs/IMPROVEMENTS.md B10): the server margin plus
 * Σ Δprice · amount over the plan, per year. Exact at the server's prices, linear otherwise. */
export function repriced(q: Quick, prices: Record<string, number>): number {
  const e = q.economy;
  let delta = 0;
  for (const [c, t] of Object.entries(e.tonnes)) delta += ((prices[c] ?? e.prices[c]) - e.prices[c]) * t;
  delta -= ((prices._n ?? e.n_usd_kg) - e.n_usd_kg) * e.n_kg;
  delta -= ((prices._water ?? e.water_usd_m3) - e.water_usd_m3) * e.water_m3;
  return q.indicators.money.value + delta / e.years;
}

export function LocalPrices({ fid, q, onChange }: { fid: string; q: Quick; onChange: (margin: number) => void }) {
  const [prices, setPrices] = useState<Record<string, number>>(() => loadPrices(fid));
  const e = q.economy;
  const { t } = useTranslation();
  useEffect(() => {
    onChange(repriced(q, prices));
    savePrices(fid, prices);
  }, [prices, q, fid, onChange]);
  const rows: { id: string; label: string; unit: string; world: number; step: number }[] = [
    ...Object.keys(e.tonnes).map((c) => ({ id: c, label: q.names[c] ?? c, unit: t("prices.usd_t"), world: e.world_prices[c], step: 10 })),
    { id: "_n", label: t("prices.n"), unit: t("prices.usd_kg_n"), world: e.world_n_usd_kg, step: 0.05 },
    ...(e.water_m3 > 0 ? [{ id: "_water", label: t("prices.water"), unit: t("prices.usd_m3"), world: e.world_water_usd_m3, step: 0.01 }] : []),
  ];
  return (
    <div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => {
          const v = prices[r.id] ?? r.world;
          return (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1">{r.label}</span>
              <input
                type="number"
                min={0}
                step={r.step}
                value={v}
                onChange={(ev) => setPrices({ ...prices, [r.id]: Number(ev.target.value) })}
                aria-label={t("prices.aria", { label: r.label, unit: r.unit })}
                className="h-8 w-24 rounded-ctl border border-subtle bg-panel-strong px-2 text-right font-num text-fg"
              />
              <span className="w-12 text-xs text-fg-muted">{r.unit}</span>
            </li>
          );
        })}
      </ul>
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => setPrices({})}>
        {t("prices.reset")}
      </Button>
    </div>
  );
}
