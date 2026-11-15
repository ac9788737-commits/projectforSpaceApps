import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import i18n, { useLang } from "@/i18n";

interface Imagery {
  url: string;
  bounds: [number, number, number, number]; // lon/lat box the picture covers

  kind: "truecolor" | "ndvi";
  date: string | null;
  level: 1 | 2 | 3;
  cloud_pct: number | null;
  source: string;
  attribution: string;
  note: string;
  pending: boolean;
}

const dateRu = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  const months = i18n.t("common.months_gen", { returnObjects: true }) as string[];
  return i18n.language === "en" ? `${months[m - 1]} ${day}, ${y}` : `${day} ${months[m - 1]} ${y}`;
};

function useImagery(fid: string, kind: "truecolor" | "ndvi") {
  const l = useLang();
  return useQuery({
    queryKey: ["fields", fid, "imagery", kind, l],
    staleTime: 60_000,
    // the fresh scene arrives in the background: ask again while the answer says «pending»
    refetchInterval: (q) => ((q.state.data as Imagery | undefined)?.pending ? 3000 : false),
    queryFn: () => unwrap(api.GET("/fields/{fid}/imagery", { params: { path: { fid }, query: { kind, lang: l } } })) as unknown as Promise<Imagery>,
  });
}

type Ring = [number, number][];
/** Outer rings of a GeoJSON polygon or multipolygon. */
function rings(geometry: unknown): Ring[] {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g?.coordinates) return [];
  if (g.type === "Polygon") return [(g.coordinates as Ring[])[0]];
  if (g.type === "MultiPolygon") return (g.coordinates as Ring[][]).map((p) => p[0]);
  return [];
}

/** Satellite picture of the field (docs/IMPROVEMENTS.md A.3): slightly desaturated, with the
 * field outline drawn over it in ink, «Фото / Зелень» and an honest plaque (docs/DESIGN.md §7). */
export function FieldImage({ fid, geometry }: { fid: string; geometry?: unknown }) {
  const [kind, setKind] = useState<"truecolor" | "ndvi">("truecolor");
  const q = useImagery(fid, kind);
  const [loaded, setLoaded] = useState<string | null>(null);
  const d = q.data;
  const { t } = useTranslation();
  const outline = d?.bounds
    ? rings(geometry).map((r) => {
        const [x0, y0, x1, y1] = d.bounds;
        return r.map(([x, y]) => `${((x - x0) / (x1 - x0)) * 100},${((y1 - y) / (y1 - y0)) * 100}`).join(" ");
      })
    : [];
  return (
    <figure className="m-0">
      <div className="relative min-h-40 overflow-hidden rounded-lg border border-subtle bg-hover transition-[box-shadow,transform] duration-300 ease-[var(--ease-panel)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lifted)]">
        {d && (
          <img
            key={d.url}
            src={`/api${d.url}`}
            alt={t(kind === "ndvi" ? "image.alt_ndvi" : "image.alt_photo")}
            onLoad={() => setLoaded(d.url)}
            className={cn("block h-auto w-full transition-opacity duration-200 [filter:saturate(0.85)]", loaded === d.url ? "opacity-100" : "opacity-0")}
          />
        )}
        {d && loaded === d.url && outline.length > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {outline.map((pts, i) => (
              <polygon key={i} points={pts} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}
        {!d && <div className="absolute inset-0 grid place-items-center text-sm text-fg-muted">{t("image.searching")}</div>}
        <div className="absolute left-2 top-2 flex gap-0.5 rounded-ctl border border-subtle bg-panel p-0.5 text-xs" role="radiogroup" aria-label={t("image.view")}>
          {(["truecolor", "ndvi"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn("h-7 cursor-pointer rounded-ctl px-2", kind === k ? "bg-accent text-[var(--accent-ink)]" : "text-fg-muted hover:text-fg")}>
              {t(k === "truecolor" ? "image.photo" : "image.green")}
            </button>
          ))}
        </div>
      </div>
      {d && (
        <p className="mt-1 text-sm">
          {d.note}
          {d.date ? `, ${dateRu(d.date)}` : ""}
          {d.pending ? t("image.pending") : ""}
        </p>
      )}
      <figcaption className="mt-0.5 text-xs leading-snug text-fg-muted">
        {kind === "ndvi" && d?.kind === "ndvi" && d.level === 1 && <>{t("image.ndvi_hint")}</>}
        {d?.date && d.level === 1 && <>{t("image.taken", { d: dateRu(d.date) })}{d.cloud_pct != null ? t("image.clouds", { n: Math.round(d.cloud_pct) }) : ""}. </>}
        {d?.attribution}
      </figcaption>
    </figure>
  );
}
