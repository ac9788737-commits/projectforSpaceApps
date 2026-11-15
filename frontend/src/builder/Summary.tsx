import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Share2 } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n, { locale, num, useLang } from "@/i18n";
import { LangSwitch } from "@/i18n/LangSwitch";
import { AppBar } from "@/ui/AppBar";
import { useGaps } from "@/farm/planner";
import { cropColor } from "@/ui/crops";
import { CropGlyph, Icon } from "@/ui/icons";
import { Button } from "@/ui/primitives";
import { fetchQuick, useDeck, useField, type Irrigation, type Link as PlanLink, type Slot } from "./api";
import { Indicators } from "./Indicators";
import { LocalPrices } from "./LocalPrices";
import { Postcard } from "./scene/Postcard";
import { SoilProfile } from "./SoilProfile";
import { WorkCalendar } from "./WorkCalendar";
import { decodePlan, IRRIGATION, STRESS, useBuilder } from "./store";

/** Three main conclusions in one line each: the strongest benefits first, then the main risk. */
function conclusions(links: PlanLink[], failYears: number, n: number): { text: string; good: boolean }[] {
  const out = links.filter((l) => l.good).slice(0, 2).map((l) => ({ text: l.text, good: true }));
  const bad = links.find((l) => !l.good)?.text;
  if (bad) out.push({ text: bad, good: false });
  else if (failYears) out.push({ text: i18n.t("summary.risk_fail", { f: failYears, n }), good: false });
  else out.push({ text: i18n.t("summary.no_fail", { n }), good: true });
  return out.slice(0, 3);
}

function Block({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`break-inside-avoid border-t border-subtle pt-3 ${className ?? ""}`}>
      <h2 className="mb-2 font-head text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Screen 3 «Ваш план» (docs/UX.md §7) as an agronomist's printout (docs/DESIGN.md §7): one sheet
 * with a letterhead, the table by years, the soil profile, the work calendar and a checklist with
 * boxes to tick. The screen and the PDF are the same page. */
export default function Summary() {
  const { fid } = useParams();
  const [params] = useSearchParams();
  const field = useField(fid);
  const deck = useDeck();
  const gaps = useGaps(fid ?? "");
  const storePlan = useBuilder((s) => s.plan);
  const plan: Slot[] = decodePlan(params.get("p")) ?? storePlan;
  const scenario = params.get("s") ?? "history";
  const irrigation = (params.get("i") ?? field.data?.irrigation_method ?? "none") as Irrigation;
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();
  const l = useLang();
  const [margin, setMargin] = useState<number | null>(null);
  const onMargin = useCallback((m: number) => setMargin(m), []);
  const q = useQuery({
    queryKey: ["rotation", "summary", fid, plan, scenario, irrigation, l],
    enabled: !!field.data,
    staleTime: Infinity,
    queryFn: () => fetchQuick(field.data!, plan, scenario, irrigation),
  });
  const names = Object.fromEntries((deck.data ?? []).map((c) => [c.id, c.name_ru]));
  if (!field.data || !q.data) return <div data-mood="field" className="grid h-dvh place-items-center bg-panel text-fg">{t("summary.collecting")}</div>;
  const d = q.data;
  const f = field.data;
  const [lon, lat] = f.centroid;
  const today = new Date().toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" });

  return (
    <div data-mood="field" className="min-h-dvh bg-farm-page text-fg print:bg-panel">
      <div className="print:hidden">
        <AppBar
          right={
            <>
              <LangSwitch inverted />
              <Button variant="secondary" size="sm" onClick={() => window.print()}>
                <Download size={14} strokeWidth={1.5} /> {t("summary.pdf")}
              </Button>
              <Button variant="accent" size="sm" onClick={() => void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true))}>
                <Share2 size={14} strokeWidth={1.5} /> {copied ? t("summary.copied") : t("summary.share")}
              </Button>
            </>
          }
        >
          <Link to={`/fields/${fid}/plan`} className="inline-flex items-center gap-1 text-sm text-farm-on-inverted-2 transition-colors duration-300 hover:text-farm-on-inverted">
            <ArrowLeft size={14} strokeWidth={1.5} /> {t("summary.back")}
          </Link>
        </AppBar>
      </div>
      <div className="px-[var(--edge)] py-[var(--edge)] print:p-0">
      <article className="mx-auto flex max-w-4xl flex-col gap-5 rounded-pnl border border-subtle bg-farm-card p-5 sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0">
        {/* letterhead */}
        <header className="grid gap-3 border-b-2 border-[var(--primary-600)] pb-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <p className="text-sm text-fg-muted">{t("summary.sheet")}</p>
            <h1 className="font-head text-3xl font-semibold">{t("summary.title")}</h1>
            <p className="font-head text-lg">{f.name}</p>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-3 text-sm tabular-nums sm:text-right">
            <dt className="text-fg-muted">{t("summary.region")}</dt>
            <dd>{f.region ?? "—"}</dd>
            <dt className="text-fg-muted">{t("summary.coords")}</dt>
            <dd>
              {num(Number(lat.toFixed(3)))}, {num(Number(lon.toFixed(3)))}
            </dd>
            <dt className="text-fg-muted">{t("summary.area")}</dt>
            <dd>{t("summary.ha", { n: num(f.area_ha) })}</dd>
            <dt className="text-fg-muted">{t("summary.water")}</dt>
            <dd>{IRRIGATION.find((x) => x.id === irrigation)?.label}</dd>
            {scenario !== "history" && (
              <>
                <dt className="text-fg-muted">{t("summary.climate")}</dt>
                <dd>{STRESS.find((x) => x.id === scenario)?.label}</dd>
              </>
            )}
            <dt className="text-fg-muted">{t("summary.date")}</dt>
            <dd>{today}</dd>
          </dl>
        </header>

        {/* the field in the last year of the plan (docs/DESIGN_V3.md §2.7) */}
        <figure className="m-0 overflow-hidden rounded-lg border border-subtle print:break-inside-avoid">
          <Postcard
            fid={f.id}
            plan={plan}
            deck={deck.data ?? []}
            q={d}
            week={d.playback.weeks.find((w) => w.year === plan.length - 1 && w.month === 6) ?? null}
            irrigation={irrigation}
            names={names}
          />
        </figure>

        {/* the plan by years */}
        <section className="break-inside-avoid">
          <table className="w-full border-collapse text-sm">
            <thead className="text-left text-fg-muted">
              <tr className="border-b border-subtle">
                <th className="py-1 pr-2 font-normal">{t("summary.col_year")}</th>
                <th className="py-1 pr-2 font-normal">{t("summary.col_summer")}</th>
                <th className="py-1 pr-2 font-normal">{t("summary.col_winter")}</th>
                <th className="py-1 pr-2 text-right font-normal">{t("summary.col_yield")}</th>
                <th className="py-1 text-right font-normal">{t("summary.col_sow")}</th>
              </tr>
            </thead>
            <tbody>
              {plan.map(([m, c], i) => (
                <tr key={i} className="border-b border-subtle align-top">
                  <td className="py-2 pr-2 font-head font-semibold">{i + 1}</td>
                  <td className="py-2 pr-2">
                    <span className="inline-flex items-center gap-1.5 border-l-4 pl-1.5" style={{ borderColor: m ? cropColor(m) : "var(--rule)" }}>
                      {m && <CropGlyph crop={m} size={18} className="shrink-0" />}
                      {m ? names[m] : t("summary.bare_field")}
                    </span>
                  </td>
                  <td className="py-2 pr-2">
                    <span className="inline-flex items-center gap-1.5 border-l-4 border-dashed pl-1.5" style={{ borderColor: c ? cropColor(c) : "var(--rule)" }}>
                      {c && <CropGlyph crop={c} size={16} className="shrink-0" />}
                      {c ? names[c] : t("summary.winter_bare")}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{d.years[i]?.crop ? t("summary.t_ha", { y: num(d.years[i].yield_t_ha) }) : "—"}</td>
                  <td className="py-2 text-right tabular-nums">{d.years[i]?.sow?.split("-").reverse().join(".") ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.cover_notes.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5 text-sm">
              {d.cover_notes.map((n) => (
                <li key={n.year} className="flex gap-1.5">
                  <Icon name="calendar" size={16} className="mt-0.5 shrink-0" />
                  <span>
                    {t("summary.year", { n: n.year + 1 })}: {n.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Block title={t("plan.profile")}>
          <SoilProfile q={d} plan={plan} deck={deck.data ?? []} />
        </Block>

        <section className="break-inside-avoid">
          <Indicators q={margin === null ? d : { ...d, indicators: { ...d.indicators, money: { ...d.indicators.money, value: Math.round(margin / 10) * 10 } } }} prev={undefined} pending={false} />
        </section>

        <Block title={t("summary.main")}>
          <ul className="flex flex-col gap-1.5">
            {conclusions(d.links, d.summary.fail_years, d.summary.n_years).map((c, i) => (
              <li key={i} className="flex gap-2">
                <b className={c.good ? "font-medium text-good" : "font-medium text-risk"}>{t(c.good ? "plan.plus" : "plan.risk")}:</b>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-fg-muted">{t("summary.years", { good: d.summary.good_years, n: d.summary.n_years, fail: d.summary.fail_years })}</p>
        </Block>

        <Block title={t("calendar.title")}>
          <WorkCalendar items={d.work_calendar} />
        </Block>

        <Block title={t("summary.prices")}>
          <p className="mb-2 max-w-[70ch] text-sm text-fg-muted">{t("summary.prices_lead")}</p>
          <LocalPrices fid={fid ?? ""} q={d} onChange={onMargin} />
        </Block>

        <Block title={t("summary.check")}>
          {d.salinity.risk && (
            <p className="mb-2 flex max-w-[70ch] gap-1.5 text-sm">
              <Icon name="salt" size={18} className="mt-0.5 shrink-0 text-caution" />
              <span>
                <b className="font-semibold">{d.salinity.text}.</b> {t("summary.why")} {d.salinity.reasons.join(", ")}.
              </span>
            </p>
          )}
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {(gaps.data?.checklist ?? []).map((item, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]" aria-label={item} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-subtle pt-2 text-sm font-medium">{t("summary.disclaimer")}</p>
        </Block>
      </article>
      </div>
    </div>
  );
}
