import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api, unwrap } from "@/api/client";
import { cn } from "@/lib/utils";
import { Button, GlassPanel } from "@/ui/primitives";
import { useTravel } from "../travel";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Ctrl+K: type a planet name and fly straight there. */
export function SearchDialog() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const travel = useTravel();
  const q = useDebounced(text.trim(), 200);

  const results = useQuery({
    queryKey: ["search", q],
    enabled: open && q.length >= 2,
    queryFn: () => unwrap(api.GET("/planets", { params: { query: { q, limit: 8 } } })),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setError(null);
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const items = results.data?.items ?? [];

  async function go(planetId: string) {
    const { data } = await api.GET("/scene/planet/{planet_id}", { params: { path: { planet_id: planetId } } });
    if (!data) {
      setError("Для этой планеты не хватает данных, чтобы построить сцену.");
      return;
    }
    setOpen(false);
    setText("");
    travel({ level: "planet", galaxyId: data.galaxy_id, starId: data.star_id, planetId });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-label="Поиск планеты (Ctrl+K)" className="px-3">
        <SearchIcon size={16} strokeWidth={1.5} aria-hidden />
        <span className="hidden md:inline">Поиск</span>
        <kbd className="hidden rounded border border-subtle px-1 font-num text-[11px] text-fg-muted md:inline">Ctrl K</kbd>
      </Button>
      {open && (
        <div data-modal className="fixed inset-0 z-50 flex items-start justify-center bg-scrim px-[var(--edge)] pt-[12vh]" onClick={() => setOpen(false)}>
          <GlassPanel strong className="w-full max-w-lg p-0" role="dialog" aria-modal aria-label="Поиск планеты" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, items.length - 1));
                if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
                if (e.key === "Enter" && items[active]) go(items[active].id);
              }}
              placeholder="Например, TRAPPIST-1 e или Марс"
              aria-label="Название планеты"
              className="h-14 w-full rounded-t-pnl border-b border-subtle bg-transparent px-4 text-base text-fg outline-none placeholder:text-fg-muted"
            />
            <ul className="max-h-80 overflow-y-auto p-1" role="listbox" aria-label="Результаты">
              {q.length < 2 && <li className="px-3 py-2 text-sm text-fg-muted">Введите хотя бы два символа.</li>}
              {q.length >= 2 && results.isFetching && <li className="px-3 py-2 text-sm text-fg-muted">Ищу…</li>}
              {q.length >= 2 && !results.isFetching && items.length === 0 && <li className="px-3 py-2 text-sm text-fg-muted">Ничего не найдено.</li>}
              {items.map((item, i) => (
                <li key={item.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    className={cn("flex min-h-10 w-full cursor-pointer items-center justify-between gap-3 rounded-ctl px-3 text-left text-sm", i === active ? "bg-hover" : "hover:bg-hover")}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(item.id)}
                  >
                    <span className="text-fg">{item.name_ru ?? item.name}</span>
                    <span className="text-xs text-fg-muted">
                      {item.hypothetical ? "гипотетическая" : item.kind === "solar_system" ? "Солнечная система" : "экзопланета"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {error && <p className="px-4 pb-3 text-sm text-stress">{error}</p>}
          </GlassPanel>
        </div>
      )}
    </>
  );
}
