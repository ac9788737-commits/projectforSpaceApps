import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { api, unwrap } from "@/api/client";
import { useLang } from "@/i18n";
import { LangSwitch } from "@/i18n/LangSwitch";
import { AppBar, BarLink } from "@/ui/AppBar";
import { cn } from "@/lib/utils";
import { Button, Panel } from "@/ui/primitives";

type Param = { value: string | number | null; source: string | null };
export type RefRow = { id: string; name_ru: string; family_ru: string; is_cover: boolean; params: Record<string, Param> };

export const COLUMNS = ["kc", "stages", "topt", "heat", "nfix", "root", "ky", "ymax", "cost", "labour", "price"] as const;
export type Column = (typeof COLUMNS)[number];

/** Parameter value as text and the source line under it; «оценка» when there is no source. */
export function sourceText(p: Param, t: (k: string) => string): string {
  if (p.source === null) return t("common.estimate");
  if (p.source === "@not_legume") return t("ref.not_legume");
  return p.source;
}

/** CSV with one value and one source column per parameter (B13). */
export function toCsv(rows: RefRow[], t: (k: string) => string): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["id", t("ref.crop"), t("ref.family"), ...COLUMNS.flatMap((c) => [t(`ref.${c}`), `${t(`ref.${c}`)} — ${t("ref.source")}`])];
  const body = rows.map((r) => [r.id, r.name_ru, r.family_ru, ...COLUMNS.flatMap((c) => [r.params[c].value, sourceText(r.params[c], t)])]);
  return [head, ...body].map((line) => line.map(esc).join(",")).join("\n");
}

const num = (v: Param["value"]) => (typeof v === "number" ? v : v === null ? -Infinity : Number.parseFloat(String(v)));

/** «Откуда цифры»: every crop parameter with its source (docs/IMPROVEMENTS.md B13).
 * `?param=kc&crops=cotton,chickpea` highlights a column and the crops of a plan. */
export default function ReferencePage() {
  const { t } = useTranslation();
  const l = useLang();
  const [params] = useSearchParams();
  const focusParam = params.get("param") as Column | null;
  const planCrops = useMemo(() => new Set((params.get("crops") ?? "").split(",").filter(Boolean)), [params]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ col: Column | "name"; dir: 1 | -1 }>({ col: "name", dir: 1 });
  const q = useQuery({
    queryKey: ["reference", "crops", l],
    staleTime: Infinity,
    queryFn: () => unwrap(api.GET("/reference/crops", { params: { query: { lang: l } } })) as unknown as Promise<RefRow[]>,
  });

  const rows = useMemo(() => {
    const all = (q.data ?? []).filter((r) => `${r.name_ru} ${r.family_ru} ${r.id}`.toLowerCase().includes(query.trim().toLowerCase()));
    return [...all].sort((a, b) => {
      if (sort.col === "name") return a.name_ru.localeCompare(b.name_ru) * sort.dir;
      return (num(a.params[sort.col].value) - num(b.params[sort.col].value)) * sort.dir;
    });
  }, [q.data, query, sort]);

  // the link from an indicator lands on the first crop of the plan
  useEffect(() => {
    const first = rows.find((r) => planCrops.has(r.id));
    if (first) document.getElementById(`ref-${first.id}`)?.scrollIntoView({ block: "center" });
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = () => {
    const blob = new Blob(["﻿" + toCsv(rows, t)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "astrocrop-crops.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const header = (col: Column | "name", label: string) => (
    <th key={col} scope="col" className={cn("px-2 py-1.5 text-left font-medium", col === focusParam && "bg-glow")} aria-sort={sort.col === col ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="cursor-pointer hover:text-fg" onClick={() => setSort({ col, dir: sort.col === col ? ((-sort.dir) as 1 | -1) : 1 })} aria-label={t("ref.sort", { c: label })}>
        {label} {sort.col === col ? (sort.dir === 1 ? "▲" : "▼") : ""}
      </button>
    </th>
  );

  return (
    <div data-mood="field" className="min-h-dvh bg-farm-page text-fg">
      <AppBar
        right={
          <>
            <BarLink to="/fields">{t("ref.back")}</BarLink>
            <LangSwitch inverted />
          </>
        }
      />
      <div className="mx-auto flex max-w-[90rem] flex-col gap-3 px-[var(--edge)] py-[var(--edge)]">
        <Panel className="p-4">
          <h1 className="font-head text-3xl font-semibold">{t("ref.title")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">{t("ref.lead")}</p>
          {planCrops.size > 0 && <p className="mt-1 text-sm">{t("ref.highlight")}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex h-9 items-center gap-1 rounded-ctl border border-subtle bg-panel-strong px-2">
              <Search size={14} strokeWidth={1.5} aria-hidden />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("ref.search")} aria-label={t("ref.search")} className="h-8 w-48 bg-transparent text-sm outline-none" />
            </label>
            <span className="text-xs text-fg-muted">{t("ref.n", { n: rows.length })}</span>
            <Button variant="secondary" size="sm" className="ml-auto" onClick={download} disabled={!rows.length}>
              <Download size={14} strokeWidth={1.5} /> {t("ref.csv")}
            </Button>
          </div>
        </Panel>
        <Panel className="overflow-x-auto p-0">
          <table className="w-full min-w-[70rem] border-collapse text-xs">
            <thead className="sticky top-0 bg-farm-subtle text-fg-muted">
              <tr>
                {header("name", t("ref.crop"))}
                <th scope="col" className="px-2 py-1.5 text-left font-medium">{t("ref.family")}</th>
                {COLUMNS.map((c) => header(c, t(`ref.${c}`)))}
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="p-4 text-center text-fg-muted motion-safe:animate-pulse">{t("common.loading")}</td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} id={`ref-${r.id}`} className={cn("border-t border-subtle align-top", planCrops.has(r.id) && "bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]")}>
                  <th scope="row" className="px-2 py-1.5 text-left font-medium">
                    {r.name_ru}
                    {r.is_cover && <span className="ml-1 text-xs font-normal text-fg-muted">{t("ref.covers")}</span>}
                  </th>
                  <td className="px-2 py-1.5">{r.family_ru}</td>
                  {COLUMNS.map((c) => {
                    const p = r.params[c];
                    const est = p.source === null;
                    return (
                      <td key={c} className={cn("px-2 py-1.5", c === focusParam && "bg-glow")}>
                        <span className="font-num text-sm text-fg">{p.value ?? "—"}</span>
                        <span className={cn("mt-0.5 block max-w-[14rem] leading-snug", est ? "w-fit rounded-ctl border border-dashed border-[var(--ink-soft)] px-1 text-fg-muted" : "text-fg-muted")} title={sourceText(p, t)}>
                          {sourceText(p, t)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
