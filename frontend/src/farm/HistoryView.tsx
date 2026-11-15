import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CloudSun, Droplets, Flame, Leaf, Snowflake } from "lucide-react";
import type { ReactNode } from "react";
import { api, unwrap } from "@/api/client";
import { Num } from "@/ui/format";
import { LoadingLine } from "@/ui/states";
import { Bars, IndexGrid } from "./charts";

export interface History {
  n_years: number;
  years: number[];
  headline: string[];
  sowing: Record<string, string>;
  bare_soil:
    | { available: false; reason: string }
    | { available: true; threshold: number; mean_bare_days: number; years: { year: number; bare_days: number }[]; erosive_rain_days_in_bare_by_month: number[]; risk_months: string[] };
  heat: { p90_summer_c: number; mean_waves: number; waves_by_month: number[]; days_above_35_mean: number; years: { year: number; waves: number; days: number; max_c: number }[] };
  drought: { years: number[]; spei3: (number | null)[][]; dry_months_per_year: number[]; annual_precip_mm: number[]; annual_et0_mm: number[] };
  frost: { years_with_frost: number; n_years: number; last_spring: (string | null)[]; last_spring_median: string | null; last_spring_p90: string | null; frost_free_days_median: number | null };
  vulnerability: { crop: string; name_ru: string; sow: string; stage_ru: string; stage_from: string | null; heat_c: number; heat_years: number; frost_years: number; dry_years: number; n_years: number }[];
}

export function useHistory(fid: string) {
  return useQuery({
    queryKey: ["fields", fid, "history"],
    staleTime: Infinity,
    queryFn: () => unwrap(api.GET("/fields/{fid}/history", { params: { path: { fid } } })) as unknown as Promise<History>,
  });
}

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function Block({ icon: Icon, title, children }: { icon: typeof Flame; title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 flex items-center gap-2 font-head text-base font-semibold text-fg">
        <Icon size={14} strokeWidth={1.5} aria-hidden /> {title}
      </h3>
      {children}
    </section>
  );
}

/** Step «Анализ истории»: what 10–20 years of NASA data say about this field (§3.1). */
export function HistoryView({ fid }: { fid: string }) {
  const h = useHistory(fid);
  if (h.isLoading) return <LoadingLine text="Анализирую 20 лет погоды и спутниковых данных…" />;
  if (h.error || !h.data) return <p className="text-xs text-lethal">{String(h.error ?? "нет данных")}</p>;
  const d = h.data;
  return (
    <div>
      <ul className="flex flex-col gap-1 text-sm">
        {d.headline.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 bg-accent" aria-hidden />
            {t}
          </li>
        ))}
      </ul>

      <Block icon={Leaf} title="Голая почва (NDVI MODIS)">
        {d.bare_soil.available ? (
          <>
            <Bars labels={d.bare_soil.years.map((y) => String(y.year))} values={d.bare_soil.years.map((y) => y.bare_days)} unit="дн." label="Дней голой почвы по годам" color="var(--soil)" />
            <p className="mt-1 text-xs text-fg-muted">
              Порог NDVI <Num value={d.bare_soil.threshold} digits={2} /> подобран по полю (5-й процентиль + 0,1). Эрозионные ливни на голой почве по месяцам:
            </p>
            <Bars labels={MONTHS} values={d.bare_soil.erosive_rain_days_in_bare_by_month} unit="дн./год" label="Эрозионные ливни на голой почве по месяцам" color="var(--stress)" height={64} />
          </>
        ) : (
          <p className="text-xs text-fg-muted">Нет ряда NDVI: {d.bare_soil.reason}. Голая почва в плане оценивается моделью севооборота.</p>
        )}
      </Block>

      <Block icon={Flame} title="Жара">
        <p className="text-xs text-fg-muted">
          Волна жары — 3 дня подряд выше 90-го процентиля для этого времени года (летом это <Num value={d.heat.p90_summer_c} unit="°C" digits={0} />). В среднем <Num value={d.heat.mean_waves} digits={1} /> волны в год.
        </p>
        <Bars labels={MONTHS} values={d.heat.waves_by_month} unit="волн/год" label="Волны жары по месяцам" color="var(--lethal)" height={64} />
      </Block>

      <Block icon={Droplets} title="Засуха (SPEI-3)">
        <IndexGrid years={d.drought.years} values={d.drought.spei3} label="SPEI за 3 месяца по годам и месяцам" />
        <p className="mt-1 text-xs text-fg-muted">
          Осадки <Num value={d.drought.annual_precip_mm.reduce((a, b) => a + b, 0) / d.drought.annual_precip_mm.length} unit="мм/год" digits={0} />, эталонное испарение{" "}
          <Num value={d.drought.annual_et0_mm.reduce((a, b) => a + b, 0) / d.drought.annual_et0_mm.length} unit="мм/год" digits={0} />.
        </p>
      </Block>

      <Block icon={Snowflake} title="Заморозки">
        {d.frost.last_spring_median ? (
          <p className="text-xs">
            Заморозки были в <Num value={d.frost.years_with_frost} digits={0} /> из <Num value={d.frost.n_years} digits={0} /> лет. Последний весенний — в среднем{" "}
            <span className="font-num">{d.frost.last_spring_median}</span>, в 1 году из 10 позже <span className="font-num">{d.frost.last_spring_p90}</span>
            {d.frost.frost_free_days_median != null && (
              <>
                ; безморозный период ≈ <Num value={d.frost.frost_free_days_median} unit="дн." digits={0} />
              </>
            )}
            .
          </p>
        ) : (
          <p className="text-xs text-fg-muted">За {d.n_years} лет заморозков (T мин ≤ 0 °C) не было.</p>
        )}
      </Block>

      <Block icon={CalendarClock} title="Окна уязвимости культур">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Сколько лет из {d.n_years} опасное явление пришлось на культуру</caption>
            <thead className="text-left text-fg-muted">
              <tr>
                <th className="py-1 pr-2 font-normal">Культура, сев</th>
                <th className="py-1 pr-2 font-normal">Чувствительно</th>
                <th className="py-1 pr-2 text-right font-normal">жара</th>
                <th className="py-1 pr-2 text-right font-normal">мороз</th>
                <th className="py-1 text-right font-normal">засуха</th>
              </tr>
            </thead>
            <tbody>
              {d.vulnerability.map((v) => (
                <tr key={v.crop} className="border-t border-subtle">
                  <td className="py-1 pr-2">
                    {v.name_ru} <span className="font-num text-fg-muted">{v.sow}</span>
                  </td>
                  <td className="py-1 pr-2 text-fg-muted">
                    {v.stage_ru} с <span className="font-num">{v.stage_from ?? "—"}</span>
                  </td>
                  <td className="py-1 pr-2 text-right font-num">{v.heat_years}</td>
                  <td className="py-1 pr-2 text-right font-num">{v.frost_years}</td>
                  <td className="py-1 text-right font-num">{v.dry_years}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          Числа — сколько лет из {d.n_years}: жара выше порога культуры на чувствительной стадии, мороз ниже порога гибели, засуха (SPEI-3 ≤ −1) в сезон. Даты сева подстроены под поздний весенний заморозок.
        </p>
      </Block>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-muted">
        <CloudSun size={12} strokeWidth={1.5} aria-hidden /> Погода NASA POWER, ячейка ≈ 50 км — это климат района, а не микроклимат поля.
      </p>
    </div>
  );
}
