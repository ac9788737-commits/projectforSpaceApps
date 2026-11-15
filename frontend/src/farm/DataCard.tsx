import { AlertTriangle, CircleCheck, CircleSlash, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { Num } from "@/ui/format";
import type { DataLayer } from "./api";

const STATUS: Record<DataLayer["status"], { label: string; cls: string; Icon: typeof CircleCheck }> = {
  ok: { label: "загружено", cls: "text-ok", Icon: CircleCheck },
  cached: { label: "из кеша", cls: "text-ok", Icon: CircleCheck },
  missing: { label: "нет в кеше", cls: "text-stress", Icon: AlertTriangle },
  failed: { label: "ошибка загрузки", cls: "text-lethal", Icon: AlertTriangle },
  no_access: { label: "нет доступа", cls: "text-fg-muted", Icon: CircleSlash },
  not_loaded: { label: "не загружено", cls: "text-fg-muted", Icon: CircleSlash },
};

/** Data card of a field: every layer with source, resolution, coverage and problems (§2.3). */
export function DataCard({ layers }: { layers: DataLayer[] }) {
  return (
    <section aria-labelledby="data-card-h">
      <h3 id="data-card-h" className="mb-2 flex items-center gap-2 font-head text-base font-semibold text-fg">
        <Database size={14} strokeWidth={1.5} aria-hidden /> Карточка данных
      </h3>
      <ul className="flex flex-col gap-2">
        {layers.map((l) => {
          const s = STATUS[l.status];
          return (
            <li key={l.id} className="rounded-ctl border border-subtle p-2 text-xs">
              <div className="flex items-center gap-1.5">
                <s.Icon size={14} strokeWidth={1.75} className={cn("shrink-0", s.cls)} aria-hidden />
                <span className="font-medium text-fg">{l.source}</span>
                <span className={cn("ml-auto shrink-0", s.cls)}>{s.label}</span>
              </div>
              <p className="mt-0.5 text-fg-muted">{l.what}</p>
              <p className="mt-0.5 text-fg-muted">
                {l.space}, {l.time}
                {l.coverage && <>, {l.coverage}</>}
              </p>
              {(l.coarse || l.missing_share > 0.001) && l.status !== "no_access" && (
                <p className="mt-1 flex flex-wrap gap-x-3 text-stress">
                  {l.coarse && (
                    <span>
                      пиксель больше поля{l.pixel_to_field ? <> в <Num value={l.pixel_to_field} digits={0} /> раз</> : null}
                    </span>
                  )}
                  {l.missing_share > 0.001 && (
                    <span>
                      пропуски <Num value={l.missing_share * 100} unit="%" digits={1} />
                    </span>
                  )}
                </p>
              )}
              {l.notes.map((n, i) => (
                <p key={i} className="mt-0.5 text-fg-muted">
                  {n}
                </p>
              ))}
              {l.retrieved_at && <p className="mt-0.5 text-xs text-fg-muted">дата загрузки: {l.retrieved_at}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
