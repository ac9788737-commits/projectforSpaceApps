import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";

export interface Caption {
  week: number;
  year: number;
  month: number;
  weight: number;
  text: string;
}

const GAP_MS = 1500;

/** Live captions over the field while a season plays (docs/IMPROVEMENTS.md B5).
 * At most one caption per 1.5 s, the important ones larger; a click pauses the playback. */
export function LiveCaptions({ captions, week, playing, onPause }: { captions: Caption[]; week: number | null; playing: boolean; onPause: () => void }) {
  const [shown, setShown] = useState<Caption | null>(null);
  const queue = useRef<Caption[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const last = useRef(0);

  useEffect(() => {
    if (week === null) {
      seen.current = new Set();
      queue.current = [];
      setShown(null);
      return;
    }
    for (const c of captions) {
      const k = `${c.week}|${c.text}`;
      if (c.week <= week && !seen.current.has(k)) {
        seen.current.add(k);
        queue.current.push(c);
      }
    }
    queue.current.sort((a, b) => b.weight - a.weight || a.week - b.week);
  }, [week, captions]);

  useEffect(() => {
    const t = setInterval(() => {
      const now = performance.now();
      if (queue.current.length && now - last.current >= GAP_MS) {
        setShown(queue.current.shift()!);
        last.current = now;
      } else if (!playing && now - last.current > 4000) {
        setShown(null);
      }
    }, 200);
    return () => clearInterval(t);
  }, [playing]);

  if (!shown) return null;
  return (
    <button
      type="button"
      onClick={onPause}
      className={cn(
        "pointer-events-auto absolute left-1/2 top-3 max-w-[90%] -translate-x-1/2 cursor-pointer rounded-ctl border border-[var(--ink)] bg-panel px-3 py-1.5 text-left",
        shown.weight >= 3 ? "text-base font-medium" : "text-sm",
      )}
      aria-live="polite"
      title={i18n.t("captions.pause")}
    >
      {shown.text}
    </button>
  );
}

/** After the playback: every caption in a folded journal. */
export function CaptionJournal({ captions }: { captions: Caption[] }) {
  if (!captions.length) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-fg-muted">{i18n.t("captions.journal", { n: captions.length })}</summary>
      <ol className="mt-1 flex flex-col gap-0.5">
        {captions.map((c, i) => (
          <li key={i} className={c.weight >= 3 ? "font-medium" : ""}>
            {c.text}
          </li>
        ))}
      </ol>
    </details>
  );
}
