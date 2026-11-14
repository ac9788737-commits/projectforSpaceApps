import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, unwrap, type PlanetSummary } from "@/api/client";
import { Input } from "@/components/ui";

export const planetLabel = (p: Pick<PlanetSummary, "name" | "name_ru">): string =>
  p.name_ru ?? p.name;

/** Search-as-you-type planet selector backed by GET /planets. */
export function PlanetPicker({
  onPick,
  placeholder = "Найти планету…",
  value,
}: {
  onPick: (planet: PlanetSummary) => void;
  placeholder?: string;
  value?: string;
}) {
  const [text, setText] = useState(value ?? "");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => setText(value ?? ""), [value]);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(text), 200);
    return () => clearTimeout(timer);
  }, [text]);

  const { data } = useQuery({
    queryKey: ["planet-search", term],
    enabled: open,
    placeholderData: (previous) => previous,
    queryFn: () =>
      unwrap(
        api.GET("/planets", { params: { query: { q: term || undefined, limit: 30 } } }),
      ),
  });

  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-expanded={open}
        aria-label={placeholder}
        value={text}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setTerm("");
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(event) => setText(event.target.value)}
      />
      {open && data && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg">
          {data.items.length === 0 && (
            <li className="px-3 py-2 text-sm text-ink-3">Ничего не найдено</li>
          )}
          {data.items.map((planet) => (
            <li key={planet.id}>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onPick(planet);
                  setText(planetLabel(planet));
                  setOpen(false);
                }}
              >
                <span className="truncate">{planetLabel(planet)}</span>
                <span className="shrink-0 text-xs text-ink-3">
                  {planet.star_type ? `класс ${planet.star_type}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
