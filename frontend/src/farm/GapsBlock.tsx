import { ClipboardCheck } from "lucide-react";
import { useGaps } from "./planner";

/** «Пробелы в данных и риски: что проверить агроному на месте» (docs/ROTATION.md §5.2). */
export function GapsBlock({ fid }: { fid: string }) {
  const g = useGaps(fid);
  if (!g.data) return null;
  return (
    <section aria-labelledby="gaps-h" className="rounded-ctl border border-[var(--stress)] p-3 text-xs">
      <h3 id="gaps-h" className="mb-2 flex items-center gap-2 font-head text-sm font-semibold">
        <ClipboardCheck size={16} strokeWidth={1.5} aria-hidden /> Пробелы в данных и риски: что проверить агроному на месте
      </h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="mb-1 font-medium">Данные</p>
          <ul className="list-disc space-y-0.5 pl-4 text-fg-muted">
            {g.data.data.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 font-medium">Модель</p>
          <ul className="list-disc space-y-0.5 pl-4 text-fg-muted">
            {g.data.model.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 font-medium">Чек-лист агронома</p>
          <ul className="space-y-0.5">
            {g.data.checklist.map((t, i) => (
              <li key={i} className="flex gap-1.5">
                <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" aria-label={t} />
                <span className="text-fg-muted">{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-2 font-medium">{g.data.disclaimer}</p>
    </section>
  );
}
