import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, unwrap } from "@/api/client";
import { planetLabel } from "@/components/PlanetPicker";
import { Badge, Button, Card, Field, Input, Notice, Select } from "@/components/ui";
import { cn, fmt } from "@/lib/utils";

const SCOPES = [
  { id: "real", label: "Реальные" },
  { id: "hypothetical", label: "Гипотетические" },
  { id: "other_galaxies", label: "Другие галактики" },
] as const;
const PAGE_SIZE = 50;

const optionalNumber = (text: string): number | undefined =>
  text.trim() === "" || Number.isNaN(Number(text)) ? undefined : Number(text);

export default function Catalog() {
  const [scope, setScope] = useState<(typeof SCOPES)[number]["id"]>("real");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [starType, setStarType] = useState("");
  const [zoneOnly, setZoneOnly] = useState(false);
  const [habitableOnly, setHabitableOnly] = useState(false);
  const [minInsolation, setMinInsolation] = useState("");
  const [maxInsolation, setMaxInsolation] = useState("");
  const [minMass, setMinMass] = useState("");
  const [maxMass, setMaxMass] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(
    () => setPage(0),
    [scope, term, starType, zoneOnly, habitableOnly, minInsolation, maxInsolation, minMass, maxMass],
  );

  const query = {
    scope,
    q: term || undefined,
    star_type: starType || undefined,
    in_habitable_zone: zoneOnly ? true : undefined,
    habitable: habitableOnly ? true : undefined,
    min_insolation: optionalNumber(minInsolation),
    max_insolation: optionalNumber(maxInsolation),
    min_mass: optionalNumber(minMass),
    max_mass: optionalNumber(maxMass),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
  const { data, error, isPlaceholderData } = useQuery({
    queryKey: ["planets", query],
    placeholderData: keepPreviousData,
    queryFn: () => unwrap(api.GET("/planets", { params: { query } })),
  });

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Каталог планет</h1>
      <div className="inline-flex rounded-md border border-line bg-surface p-1" role="tablist">
        {SCOPES.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={scope === item.id}
            className={cn(
              "cursor-pointer rounded px-3 py-1.5 text-sm",
              scope === item.id ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-surface-2",
            )}
            onClick={() => setScope(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {scope !== "real" && (
        <Notice>
          Подтверждённых планет за пределами Млечного Пути практически нет. Эти миры
          сгенерированы по параметрам пресетов и полностью гипотетичны.
        </Notice>
      )}

      <Card className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <div className="col-span-2">
          <Field label="Поиск">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="TRAPPIST, Марс…" />
          </Field>
        </div>
        <Field label="Класс звезды">
          <Select value={starType} onChange={(e) => setStarType(e.target.value)}>
            <option value="">Любой</option>
            {["O", "B", "A", "F", "G", "K", "M"].map((letter) => (
              <option key={letter}>{letter}</option>
            ))}
          </Select>
        </Field>
        <Field label="Освещённость от, S⊕">
          <Input inputMode="decimal" value={minInsolation} onChange={(e) => setMinInsolation(e.target.value)} />
        </Field>
        <Field label="Освещённость до, S⊕">
          <Input inputMode="decimal" value={maxInsolation} onChange={(e) => setMaxInsolation(e.target.value)} />
        </Field>
        <Field label="Масса от, M⊕">
          <Input inputMode="decimal" value={minMass} onChange={(e) => setMinMass(e.target.value)} />
        </Field>
        <Field label="Масса до, M⊕">
          <Input inputMode="decimal" value={maxMass} onChange={(e) => setMaxMass(e.target.value)} />
        </Field>
        <div className="col-span-2 flex flex-wrap gap-4 md:col-span-4 lg:col-span-7">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={zoneOnly} onChange={(e) => setZoneOnly(e.target.checked)} />
            В обитаемой зоне
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={habitableOnly} onChange={(e) => setHabitableOnly(e.target.checked)} />
            Потенциально обитаемая (PHL)
          </label>
        </div>
      </Card>

      {error && <Notice tone="error">{(error as Error).message}</Notice>}

      <Card className={cn("overflow-x-auto p-0", isPlaceholderData && "opacity-60")}>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-2">
              <th className="px-4 py-2 font-medium">Планета</th>
              <th className="px-4 py-2 font-medium">Звезда</th>
              <th className="px-4 py-2 text-right font-medium">Масса, M⊕</th>
              <th className="px-4 py-2 text-right font-medium">Радиус, R⊕</th>
              <th className="px-4 py-2 text-right font-medium">Освещённость, S⊕</th>
              <th className="px-4 py-2 font-medium">Метки</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {data?.items.map((planet) => (
              <tr key={planet.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                <td className="px-4 py-2">
                  <Link className="font-medium text-accent hover:underline" to={`/planets/${planet.id}`}>
                    {planetLabel(planet)}
                  </Link>
                </td>
                <td className="px-4 py-2 text-ink-2">
                  {planet.star_type ? `${planet.star_type}, ${fmt(planet.star_teff_k, "К")}` : "нет данных"}
                </td>
                <td className="px-4 py-2 text-right">{fmt(planet.mass_earth)}</td>
                <td className="px-4 py-2 text-right">{fmt(planet.radius_earth)}</td>
                <td className="px-4 py-2 text-right">{fmt(planet.insolation_earth)}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {planet.hypothetical && <Badge>гипотетическая</Badge>}
                    {planet.potentially_habitable && <Badge tone="accent">обитаемая</Badge>}
                    {planet.in_habitable_zone && <Badge>зона обитаемости</Badge>}
                  </div>
                </td>
              </tr>
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-3">
                  По этим условиям планет нет. Ослабьте фильтры.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between text-sm text-ink-2">
        <span>Всего: {data ? data.total.toLocaleString("ru-RU") : "…"}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Назад
          </Button>
          <span className="tabular">
            {page + 1} из {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Вперёд
          </Button>
        </div>
      </div>
    </div>
  );
}
