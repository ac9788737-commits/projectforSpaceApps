import { CircleDot, Clock, Filter, Gauge, Globe2, List, Orbit, PlaneLanding, Ruler, Sun, Thermometer, Weight, Wind } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { DataRow, Verdict } from "@/ui/data";
import { kelvinToC } from "@/ui/format";
import { Button, CollapsiblePanel, GlassPanel, ObjectTitle, SourceBadge, StatusTag, type Source, type Status } from "@/ui/primitives";
import { LoadingLine, SourceNotice } from "@/ui/states";
import { useGalaxy, usePlanetScene, useSystem, useUniverse, type GalaxyStar, type SystemPlanet } from "../data";
import type { Panels } from "../ExploreApp";
import { passesFilters } from "../levels/Galaxy";
import type { ExploreRoute } from "../routes";
import { useExplore } from "../store";
import { useTravel } from "../travel";

const SCENARIO_RU = { open_surface: "в открытом грунте", greenhouse: "под куполом", closed_farm: "в закрытой ферме" } as const;

export function verdictStatus(planet: SystemPlanet): Status | "none" {
  const v = planet.verdict;
  if (!v) return "none";
  if (v.best_scenario === "open_surface") return "ok";
  if (v.best_scenario) return "stress";
  return "lethal";
}

export function verdictShort(planet: SystemPlanet): string {
  const v = planet.verdict;
  if (!v) return planet.error ? "нет данных" : "считаем…";
  if (!v.best_scenario) return "Вырастить нельзя";
  const best = v.scenarios.find((s) => s.scenario === v.best_scenario)!;
  const crop = best.best_crop_name ? `${best.best_crop_name.toLowerCase()} — ` : "";
  return `Можно выращивать ${SCENARIO_RU[v.best_scenario]}: ${crop}до ${Math.round(best.yield_rel * 100)} %`;
}

/** Keyboard-accessible duplicate of the objects in the scene (§11). */
function ObjectList<T>({
  items,
  label,
  render,
  onPick,
  idOf,
}: {
  items: T[];
  label: string;
  render: (item: T) => React.ReactNode;
  onPick: (item: T) => void;
  idOf: (item: T) => string;
}) {
  const setHighlight = useExplore((s) => s.setHighlight);
  const highlight = useExplore((s) => s.highlight);
  return (
    <ul className="-mx-1 flex flex-col" aria-label={label}>
      {items.map((item) => {
        const id = idOf(item);
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => onPick(item)}
              onMouseEnter={() => setHighlight(id)}
              onMouseLeave={() => setHighlight(null)}
              onFocus={() => setHighlight(id)}
              onBlur={() => setHighlight(null)}
              className={cn(
                "flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-ctl px-2 text-left text-sm transition-colors duration-[120ms]",
                highlight === id ? "bg-hover text-fg" : "text-fg hover:bg-hover",
              )}
            >
              {render(item)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Universe ----------

function useUniversePanels(): Panels {
  const universe = useUniverse();
  const travel = useTravel();
  const galaxies = universe.data?.galaxies ?? [];
  return {
    left: {
      label: "Галактики",
      content: (
        <CollapsiblePanel title="Галактики" icon={List}>
          {!universe.data ? (
            <LoadingLine text="Рассчитываем орбиты…" />
          ) : (
            <ObjectList
              label="Галактики"
              items={galaxies}
              idOf={(g) => g.id}
              onPick={(g) => travel({ level: "galaxy", galaxyId: g.id })}
              render={(g) => (
                <>
                  <span className="min-w-0 flex-1 truncate">{g.name_ru}</span>
                  <span className={cn("size-2 rounded-full", g.real ? "bg-real" : "bg-hypo")} aria-label={g.real ? "реальная" : "гипотетическая"} />
                </>
              )}
            />
          )}
        </CollapsiblePanel>
      ),
    },
    right: {
      label: "О карте",
      content: (
        <GlassPanel className="w-80 p-4">
          <ObjectTitle kicker="Карта">Вселенная</ObjectTitle>
          <p className="mt-3 text-sm leading-snug text-fg-muted">{universe.data?.note_ru}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <SourceBadge source="real" />
            <SourceBadge source="hypothetical" />
          </div>
        </GlassPanel>
      ),
    },
  };
}

// ---------- Galaxy ----------

const CLASSES = ["", "O", "B", "A", "F", "G", "K", "M"];

function useGalaxyPanels(galaxyId: string | undefined): Panels {
  const scene = useGalaxy(galaxyId);
  const filters = useExplore((s) => s.filters);
  const setFilters = useExplore((s) => s.setFilters);
  const travel = useTravel();
  const g = scene.data?.galaxy;
  const stars = scene.data?.stars ?? [];
  const real = stars.filter((s) => !s.hypothetical && s.id !== "sun").length;
  const hyp = stars.filter((s) => s.hypothetical).length;
  const phlCoords = stars.some((s) => s.coords_source?.startsWith("PHL"));
  const listed = useMemo(() => {
    const sun = stars.filter((s) => s.id === "sun");
    const near = stars
      .filter((s) => !s.hypothetical && s.id !== "sun" && s.habitable && passesFilters(s, filters))
      .sort((a, b) => (a.distance_pc ?? 1e9) - (b.distance_pc ?? 1e9))
      .slice(0, 12);
    const hypo = stars.filter((s) => s.hypothetical && passesFilters(s, filters)).slice(0, 12);
    return [...sun, ...near, ...hypo];
  }, [stars, filters]);

  const pick = (s: GalaxyStar) => travel({ level: "system", galaxyId: galaxyId!, starId: s.id });
  return {
    left: {
      label: "Звёзды",
      content: (
        <CollapsiblePanel title="Фильтры и звёзды" icon={Filter}>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="sr-only">Фильтры</legend>
            <label className="flex min-h-10 cursor-pointer items-center gap-2">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={filters.hzOnly} onChange={(e) => setFilters({ hzOnly: e.target.checked })} />
              Только с планетами в обитаемой зоне
            </label>
            <label className="flex items-center gap-2">
              <span className="flex-1 text-fg-muted">Класс звезды</span>
              <select
                value={filters.starClass}
                onChange={(e) => setFilters({ starClass: e.target.value })}
                className="h-10 rounded-ctl border border-subtle bg-panel-strong px-2 text-fg"
              >
                {CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c || "любой"}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="flex justify-between text-fg-muted">
                Расстояние до
                <span className="font-num text-fg">
                  {filters.maxDistancePc.toLocaleString("ru-RU")}
                  <span className="text-fg-muted">&nbsp;пк</span>
                </span>
              </span>
              <input
                type="range"
                min={1}
                max={4}
                step={0.1}
                value={Math.log10(filters.maxDistancePc)}
                onChange={(e) => setFilters({ maxDistancePc: Math.round(10 ** Number(e.target.value)) })}
                aria-label="Максимальное расстояние, парсек"
                className="h-10 accent-[var(--accent)]"
              />
            </label>
          </fieldset>
          <h3 className="mb-1 mt-3 text-xs uppercase tracking-[0.08em] text-fg-muted">Системы</h3>
          <ObjectList
            label="Звёздные системы"
            items={listed}
            idOf={(s) => s.id}
            onPick={pick}
            render={(s) => (
              <>
                <span className={cn("size-2 shrink-0 rounded-full", s.hypothetical ? "bg-hypo" : s.habitable ? "bg-habitable" : "bg-real")} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{s.id === "sun" ? "Солнце" : s.name}</span>
                {s.distance_pc != null && s.id !== "sun" && (
                  <span className="font-num text-xs text-fg-muted">{Math.round(s.distance_pc)}&nbsp;пк</span>
                )}
              </>
            )}
          />
        </CollapsiblePanel>
      ),
    },
    right: {
      label: "Галактика",
      content: !g ? (
        <LoadingLine text="Загружаем звёзды…" />
      ) : (
        <>
          <GlassPanel className="w-80 p-4">
            <ObjectTitle kicker={g.real ? "Галактика" : "Гипотетическая галактика"}>{g.name_ru}</ObjectTitle>
            <p className="mt-3 text-sm leading-snug text-fg-muted">{g.description_ru}</p>
            <div className="mt-3 flex flex-col">
              {g.distance_kpc != null && g.distance_kpc > 0 && (
                <DataRow icon={Ruler} label="Расстояние" value={g.distance_kpc} unit="кпк" digits={2} source="real" sourceDetail={g.distance_reference ?? undefined} />
              )}
              <DataRow icon={CircleDot} label="Подтверждённых планет" value={g.confirmed_planets} digits={0} source="real" sourceDetail="NASA Exoplanet Archive" />
              {real > 0 && <DataRow icon={Sun} label="Звёзд на карте" value={real} digits={0} source="real" sourceDetail="координаты каталогов" />}
              <DataRow icon={Globe2} label="Гипотетических систем" value={hyp} digits={0} source="hypothetical" sourceDetail="генератор по пресету галактики" />
            </div>
            {galaxyId === "milky_way" && (
              <p className="mt-3 text-xs leading-snug text-fg-muted">
                Все известные экзопланеты — рядом с Солнцем. Нажмите на Солнце: в «пузыре» звёзд расстояния даны в логарифмическом масштабе.
              </p>
            )}
          </GlassPanel>
          {phlCoords && (
            <div className="w-80">
              <SourceNotice>Каталог NASA был недоступен при загрузке: координаты звёзд — из каталога PHL (09.11.2026).</SourceNotice>
            </div>
          )}
        </>
      ),
    },
  };
}

// ---------- System ----------


function useSystemPanels(route: ExploreRoute): Panels {
  const scene = useSystem(route.starId);
  const travel = useTravel();
  const real = useExplore((s) => s.realScale);
  const setReal = useExplore((s) => s.setRealScale);
  const data = scene.data;
  const planets = (data?.planets ?? []).filter((p) => p.semi_major_axis_au != null);
  const hidden = (data?.planets ?? []).length - planets.length;
  const hz = data?.habitable_zone_au;
  const hypothetical = data?.planets.some((p) => p.hypothetical);
  return {
    left: {
      label: "Объекты",
      content: (
        <CollapsiblePanel title="Объекты системы" icon={List}>
          {!data ? (
            <LoadingLine text="Рассчитываем орбиты…" />
          ) : (
            <ObjectList
              label="Планеты и спутники"
              items={planets}
              idOf={(p) => p.id}
              onPick={(p) => travel({ ...route, level: "planet", planetId: p.id })}
              render={(p) => {
                const s = verdictStatus(p);
                return (
                  <>
                    <span className="size-3 shrink-0 rounded-full" style={{ background: p.palette[0] }} aria-hidden />
                    <span className={cn("min-w-0 flex-1 truncate", p.parent_id && "pl-3 text-fg-muted")}>{p.name}</span>
                    {s !== "none" && <StatusTag status={s} label={s === "ok" ? "грунт" : s === "stress" ? "укрытие" : "нельзя"} />}
                  </>
                );
              }}
            />
          )}
          {hidden > 0 && <p className="mt-2 text-xs text-fg-muted">Без известной орбиты не показано: {hidden}.</p>}
        </CollapsiblePanel>
      ),
    },
    right: {
      label: "Звезда",
      content: !data ? (
        <LoadingLine text="Рассчитываем орбиты…" />
      ) : (
        <GlassPanel className="w-80 p-4">
          <ObjectTitle kicker={route.starId === "sun" ? "Звёздная система · Млечный Путь" : "Звёздная система"}>
            {route.starId === "sun" ? "Солнечная система" : data.star.name}
          </ObjectTitle>
          <div className="mt-3 flex flex-col">
            <DataRow icon={Sun} label="Класс звезды" source={hypothetical ? "hypothetical" : "real"}>
              <span className="font-num">{data.star.spectral_type ?? "—"}</span>
            </DataRow>
            <DataRow icon={Thermometer} label="Температура звезды" value={data.star.teff_k} unit="К" digits={0} source={hypothetical ? "hypothetical" : "real"} />
            <DataRow icon={Gauge} label="Светимость" value={data.star.luminosity_lsun} unit="L☉" digits={3} source={hypothetical ? "hypothetical" : "real"} />
            {data.star.distance_pc != null && data.star.distance_pc > 0 && <DataRow icon={Ruler} label="Расстояние" value={data.star.distance_pc} unit="пк" digits={1} source="real" />}
            {hz && (
              <DataRow icon={Orbit} label="Обитаемая зона" source="estimate" sourceDetail="Kopparapu et al. 2013, doi:10.1088/0004-637X/765/2/131">
                <span className="font-num">
                  {hz[0].toLocaleString("ru-RU", { maximumFractionDigits: 2 })}–{hz[1].toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
                  <span className="text-fg-muted">&nbsp;а.&nbsp;е.</span>
                </span>
              </DataRow>
            )}
          </div>
          <p className="mt-3 text-xs leading-snug text-fg-muted">{data.note_ru}</p>
          <label className="mt-2 flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={real} onChange={(e) => setReal(e.target.checked)} />
            Реальный масштаб
          </label>
        </GlassPanel>
      ),
    },
  };
}

// ---------- Planet ----------

function usePlanetPanels(route: ExploreRoute): Panels {
  const scene = usePlanetScene(route.planetId);
  const system = useSystem(route.starId);
  const setLanding = useExplore((s) => s.setLanding);
  const data = scene.data;
  const sp = system.data?.planets.find((p) => p.id === route.planetId);
  const src: Source = data?.hypothetical ? "hypothetical" : "real";
  const tempSrc: Source = data?.hypothetical ? "hypothetical" : data?.kind === "solar_system" ? "real" : "estimate";
  return {
    right: {
      label: "Планета",
      content: !data ? (
        scene.error ? (
          <SourceNotice>{String((scene.error as Error).message)}</SourceNotice>
        ) : (
          <LoadingLine text="Готовим планету…" />
        )
      ) : (
        <GlassPanel className="w-80 p-4">
          <ObjectTitle kicker={data.kind === "solar_system" ? "Солнечная система" : data.hypothetical ? "Гипотетический мир" : "Экзопланета"}>
            {data.name}
          </ObjectTitle>
          <div className="mt-3 flex flex-col">
            <DataRow icon={Thermometer} label="Температура" value={kelvinToC(data.surface_temp_k)} unit="°C" digits={0} source={tempSrc} sourceDetail={tempSrc === "estimate" ? "расчёт: равновесная температура + парниковый эффект" : undefined} />
            <DataRow icon={Weight} label="Гравитация" value={data.gravity_g} unit="g" digits={2} source={src} />
            <DataRow icon={Wind} label="Давление" value={data.pressure_pa / 1000} unit="кПа" digits={data.pressure_pa < 1000 ? 3 : 1} source={data.kind === "solar_system" ? "real" : "estimate"} sourceDetail={data.kind === "solar_system" ? undefined : "атмосфера неизвестна: пресет «как Земля»"} />
            {data.tidally_locked ? (
              <DataRow icon={Clock} label="Сутки" source="estimate" sourceDetail="эвристика приливного захвата">
                <span>приливный захват</span>
              </DataRow>
            ) : (
              <DataRow icon={Clock} label="Сутки" value={data.day_hours} unit="ч" digits={1} source={src} />
            )}
            {sp?.insolation_earth != null && <DataRow icon={Sun} label="Освещённость" value={sp.insolation_earth} unit="× Земля" digits={2} source={src} />}
          </div>
          {sp?.verdict && (
            <div className="mt-3 border-t border-subtle pt-3">
              <Verdict status={verdictStatus(sp)}>{verdictShort(sp)}</Verdict>
              <ul className="mt-2 flex flex-col gap-1 text-xs">
                {sp.verdict.scenarios.map((s) => {
                  const st: Status = !s.survival || !s.feasible ? "lethal" : s.yield_rel >= 0.8 ? "ok" : "stress";
                  return (
                    <li key={s.scenario} className="flex items-center gap-2">
                      <span className="flex-1 text-fg-muted">{SCENARIO_RU[s.scenario]}</span>
                      <StatusTag status={st} label={!s.feasible ? "невозможно" : s.survival ? `${Math.round(s.yield_rel * 100)} %` : "гибель"} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {!data.has_solid_surface && <p className="mt-2 text-xs text-stress">Твёрдой поверхности нет: огород будет на плавучей платформе (гипотетически).</p>}
        </GlassPanel>
      ),
    },
    bottom: data && (
      <div className="flex justify-center">
        <Button variant="primary" className="h-12 px-6 text-base shadow-[var(--shadow-panel)]" onClick={() => setLanding(true)}>
          <PlaneLanding size={20} strokeWidth={1.5} /> Высадиться
        </Button>
      </div>
    ),
  };
}

export function useLevelPanels(route: ExploreRoute): Panels {
  const universe = useUniversePanels();
  const galaxy = useGalaxyPanels(route.level === "galaxy" ? route.galaxyId : undefined);
  const system = useSystemPanels(route);
  const planet = usePlanetPanels(route);
  switch (route.level) {
    case "universe":
      return universe;
    case "galaxy":
      return galaxy;
    case "system":
      return system;
    case "planet":
      return planet;
    default:
      return {};
  }
}
