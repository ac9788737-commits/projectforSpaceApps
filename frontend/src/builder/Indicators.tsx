import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n, { num } from "@/i18n";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/ui/icons";
import { CoinScale, RiskBarometer, SoilAuger, WaterGauge } from "./instruments/Instruments";
import type { Indicator, Quick } from "./api";
import { human } from "./rules";

const META: Record<Indicator["key"], { icon: IconName; title: string; better: "up" | "down" }> = {
  water: { icon: "drop", get title() { return i18n.t("ind.water"); }, better: "down" },
  money: { icon: "coin", get title() { return i18n.t("ind.money"); }, better: "up" },
  soil: { icon: "shovel", get title() { return i18n.t("ind.soil"); }, better: "up" },
  risk: { icon: "shield", get title() { return i18n.t("ind.risk"); }, better: "down" },
};
const LEVEL_CLS: Record<Indicator["level"], string> = { good: "text-good", ok: "text-caution", bad: "text-risk" };

/** Number that glides to its new value (no motion when the user asks for less motion). */
function useTween(target: number, ms = 450): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - (1 - k) ** 3;
      setV(a + (target - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, ms]);
  return v;
}

function valueText(ind: Indicator, v: number): string {
  if (ind.key === "money") return `≈ ${human(v, i18n.t("ind.usd_ha"))}`;
  if (ind.key === "water") return ind.irrigated ? `${human(v, i18n.t("ind.m3_ha"))}` : i18n.t("ind.pct_norm", { n: Math.round(v) });
  if (ind.key === "soil") return i18n.t("ind.of100", { n: Math.round(v) });
  return `${Math.round(v)} %`;
}

function Instrument({ ind, delta, soc }: { ind: Indicator; delta: number; soc: number }) {
  if (ind.key === "water") return <WaterGauge value={ind.value} irrigated={!!ind.irrigated} />;
  if (ind.key === "money") return <CoinScale value={ind.value} delta={delta} />;
  if (ind.key === "soil") return <SoilAuger score={ind.value} soc={soc} />;
  return <RiskBarometer value={ind.value} />;
}

function Big({ ind, prev, pending, open, onToggle, soc }: { ind: Indicator; prev?: Indicator; pending: boolean; open: boolean; onToggle: () => void; soc: number }) {
  const meta = META[ind.key];
  const v = useTween(ind.value);
  const delta = prev ? ind.value - prev.value : 0;
  const pct = prev && prev.value !== 0 ? (delta / Math.abs(prev.value)) * 100 : 0;
  const better = delta === 0 ? null : (delta < 0) === (meta.better === "down");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn("flex min-w-0 cursor-pointer items-center gap-3 border-subtle px-4 py-3 text-left transition-colors duration-300 hover:bg-hover max-sm:flex-col max-sm:items-start max-sm:[&:nth-child(odd)]:border-r sm:border-l sm:first:border-l-0", pending && "opacity-60")}
    >
      <Instrument ind={ind} delta={delta} soc={soc} />
      <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex items-center gap-1.5 text-sm text-fg-muted">
        <Icon name={meta.icon} size={18} className="shrink-0 text-farm-icon" /> {meta.title}
      </span>
      <span className="mt-1 font-sans text-xl font-semibold leading-tight tabular-nums [overflow-wrap:anywhere] [text-wrap:balance] sm:text-2xl">{pending ? "…" : valueText(ind, v)}</span>
      <span className={cn("mt-1 text-sm font-medium", LEVEL_CLS[ind.level])}>{i18n.t(`ind.level.${ind.key}.${ind.level}`)}</span>
      {prev && delta !== 0 && (
        <span className={cn("mt-0.5 text-xs", better ? "text-good" : "text-risk")}>
          {i18n.t("ind.was_now", { was: valueText(prev, prev.value), now: valueText(ind, ind.value) })}
          {ind.key !== "risk" && ind.key !== "soil" && prev.value !== 0 && Math.abs(pct) >= 1 ? ` (${delta > 0 ? "+" : "−"}${Math.abs(Math.round(pct))} %)` : ""}
        </span>
      )}
      {ind.key === "money" && ind.detail.start_cost_usd ? <span className="mt-0.5 text-xs text-fg-muted">{i18n.t("ind.start", { v: num(Number(ind.detail.start_cost_usd)) })}</span> : null}
      </span>
    </button>
  );
}

const SOURCE_PARAM = { water: "kc", money: "price", soil: "nfix", risk: "heat" } as const;

/** «Откуда цифры» → the reference row of this plan's crops, with the indicator's column lit. */
function Sources({ q, k }: { q: Quick; k: keyof typeof SOURCE_PARAM }) {
  const crops = [...new Set(q.plan.flat().filter(Boolean))].join(",");
  return (
    <Link to={`/reference?param=${SOURCE_PARAM[k]}&crops=${crops}`} className="mt-1 block text-xs text-fg-muted underline underline-offset-2 hover:text-fg">
      {i18n.t("common.sources")}
    </Link>
  );
}

function Details({ q }: { q: Quick }) {
  const s = q.indicators.soil.detail as unknown as { organic_change_pct: number; erosion_t_ha: number; bare_days: number; nitrogen_kg_ha: number };
  const w = q.indicators.water;
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 rounded-pnl border border-subtle bg-farm-card p-4 text-sm sm:grid-cols-4">
      <p>
        <b>{t("ind.water_h")}</b>{" "}
        {w.irrigated
          ? t("ind.water_irr", { v: human(Number(w.detail.irrigation_m3), t("ind.m3")), p: w.detail.demand_met_pct })
          : t("ind.water_rain", { p: w.detail.demand_met_pct })}
        <Sources q={q} k="water" />
      </p>
      <p>
        <b>{t("ind.money_h")}</b> {t("ind.money_text", { h: human(Number(q.indicators.money.detail.labour_h), t("ind.h_ha")) })}
        <Sources q={q} k="money" />
      </p>
      <p>
        <b>{t("ind.soil_h")}</b>{" "}
        {t("ind.soil_text", {
          dir: t(s.organic_change_pct >= 0 ? "ind.grows" : "ind.falls"),
          pct: `${s.organic_change_pct > 0 ? "+" : ""}${num(Number(s.organic_change_pct.toFixed(2)), 2)}`,
          e: num(s.erosion_t_ha),
          b: s.bare_days,
        })}
        <Sources q={q} k="soil" />
      </p>
      <p>
        <b>{t("ind.risk_h")}</b> {t("ind.risk_text", { good: q.summary.good_years, n: q.summary.n_years, fail: q.summary.fail_years })}
        <Sources q={q} k="risk" />
      </p>
    </div>
  );
}

export function Indicators({ q, prev, pending }: { q: Quick | undefined; prev: Quick | undefined; pending: boolean }) {
  const [open, setOpen] = useState(false);
  useTranslation(); // re-render on language change
  if (!q) {
    return (
      <div className="grid grid-cols-2 overflow-hidden rounded-pnl border border-subtle bg-farm-card sm:grid-cols-4">
        {(Object.keys(META) as Indicator["key"][]).map((k) => (
          <div key={k} className="border-subtle px-3 py-2 text-sm text-fg-muted max-sm:[&:nth-child(odd)]:border-r sm:border-l sm:first:border-l-0">
            <span className="flex items-center gap-1.5">
              <Icon name={META[k].icon} size={18} /> {META[k].title}
            </span>
            <span className="mt-1 block font-head text-2xl">—</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 overflow-hidden rounded-pnl border border-subtle bg-farm-card sm:grid-cols-4" aria-live="polite">
        {(Object.keys(META) as Indicator["key"][]).map((k) => (
          <Big key={k} ind={q.indicators[k]} prev={prev?.indicators[k]} pending={pending} open={open} onToggle={() => setOpen(!open)} soc={q.soil_reserve[q.soil_reserve.length - 1]?.soc_pct ?? 1.3} />
        ))}
      </div>
      {open && <Details q={q} />}
    </div>
  );
}
