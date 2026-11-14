import { useQuery } from "@tanstack/react-query";
import { Component, lazy, Suspense, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api, unwrap } from "@/api/client";
import { SpectrumChart } from "@/components/charts";
import { Badge, Button, Card, CardTitle, Notice } from "@/components/ui";
import { fmt } from "@/lib/utils";

const OrbitScene = lazy(() => import("@/components/OrbitScene"));

type Provenance = { source: string; source_url: string; retrieved_at: string; estimate: boolean };

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Notice>3D-вид недоступен: браузер не поддерживает WebGL.</Notice>
    ) : (
      this.props.children
    );
  }
}

function SourceBadge({ info }: { info?: Provenance }) {
  if (!info) return <Badge title="Значение отсутствует в источнике">нет данных</Badge>;
  const title = `${info.source}${info.source_url ? ` (${info.source_url})` : ""}, загружено ${info.retrieved_at}`;
  return info.estimate ? (
    <Badge title={title}>оценка</Badge>
  ) : (
    <Badge tone="accent" title={title}>
      источник
    </Badge>
  );
}

const ROWS: { key: string; label: string; unit?: string }[] = [
  { key: "mass_earth", label: "Масса", unit: "M⊕" },
  { key: "radius_earth", label: "Радиус", unit: "R⊕" },
  { key: "semi_major_axis_au", label: "Большая полуось", unit: "а.е." },
  { key: "orbital_period_days", label: "Период обращения", unit: "сут" },
  { key: "eccentricity", label: "Эксцентриситет" },
  { key: "insolation_earth", label: "Освещённость", unit: "S⊕" },
  { key: "albedo", label: "Альбедо" },
  { key: "day_hours", label: "Солнечные сутки", unit: "ч" },
  { key: "surface_temp_k", label: "Температура поверхности", unit: "К" },
  { key: "surface_pressure_pa", label: "Давление", unit: "Па" },
  { key: "pco2_pa", label: "pCO₂", unit: "Па" },
  { key: "po2_pa", label: "pO₂", unit: "Па" },
];

export default function PlanetCard() {
  const { id = "" } = useParams();
  const { data, error, isLoading } = useQuery({
    queryKey: ["planet", id],
    queryFn: () =>
      unwrap(api.GET("/planets/{planet_id}", { params: { path: { planet_id: id } } })),
  });

  if (isLoading) return <Notice>Загрузка…</Notice>;
  if (error || !data) return <Notice tone="error">{(error as Error)?.message ?? "Нет данных"}</Notice>;

  const planet = data.planet as Record<string, unknown> & { provenance: Record<string, Provenance> };
  const env = data.environment;
  const title = String(planet.name_ru ?? planet.name);
  const zone = (data.habitable_zone_au ?? null) as [number, number] | null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-ink-2">
            Звезда: {data.star.name}
            {data.star.spectral_type ? `, ${data.star.spectral_type}` : ""}
            {data.star.teff_k ? `, ${fmt(data.star.teff_k, "К")}` : ""}
          </p>
        </div>
        <Link to={`/simulator?planet=${id}`}>
          <Button>Смоделировать урожай</Button>
        </Link>
      </div>

      {Boolean(planet.hypothetical) && (
        <Notice>Гипотетическая планета: все параметры сгенерированы и являются оценками.</Notice>
      )}
      {data.environment_error && <Notice tone="error">{data.environment_error}</Notice>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Параметры</CardTitle>
          <table className="w-full text-sm">
            <tbody className="tabular">
              {ROWS.map((row) => (
                <tr key={row.key} className="border-b border-line last:border-0">
                  <td className="py-1.5 text-ink-2">{row.label}</td>
                  <td className="py-1.5 text-right">{fmt(planet[row.key] as number | null, row.unit)}</td>
                  <td className="py-1.5 pl-3 text-right">
                    <SourceBadge info={planet.provenance[row.key]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardTitle>Рассчитанная среда</CardTitle>
          {env ? (
            <dl className="grid grid-cols-2 gap-3">
              {[
                ["Гравитация", fmt(env.gravity_g, "g")],
                ["Освещённость", fmt(env.toa_irradiance_w_m2, "Вт/м²")],
                ["Доля PAR", fmt(env.par_fraction * 100, "%")],
                ["PPFD днём", fmt(env.daytime_ppfd_umol_m2_s, "мкмоль/м²/с")],
                ["DLI", fmt(env.dli_mol_m2_d, "моль/м²/сут")],
                ["Дальний красный / PAR", fmt(env.far_red_to_par_ratio)],
                ["Температура", fmt(env.surface_temp_k, "К")],
                ["Суточный размах", fmt(env.diurnal_amplitude_k, "К")],
                ["УФ", fmt(env.uv_relative, "× Земля")],
                ["Излучение", fmt(env.ionising_msv_yr, "мЗв/год")],
                [
                  "Сутки",
                  env.tidally_locked ? "приливный захват" : fmt(env.day_hours, "ч"),
                ],
                ["Твёрдая поверхность", env.has_solid_surface ? "есть" : "нет"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-ink-2">{label}</dt>
                  <dd className="text-sm font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <Notice>Данных недостаточно для расчёта среды.</Notice>
          )}
          {data.assumptions.length > 0 && (
            <ul className="mt-4 list-disc space-y-1 pl-4 text-sm text-ink-2">
              {data.assumptions.map((item) => (
                <li key={item.code}>{item.text}</li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Спектр звезды и Солнца</CardTitle>
          <SpectrumChart spectrum={data.spectrum} starName={data.star.name} />
        </Card>

        <Card>
          <CardTitle>Схема системы</CardTitle>
          <div className="h-[300px] overflow-hidden rounded-md">
            <SceneBoundary>
              <Suspense fallback={<Notice>Загрузка 3D…</Notice>}>
                <OrbitScene
                  teffK={data.star.teff_k ?? 5772}
                  semiMajorAxisAu={(planet.semi_major_axis_au as number | null) ?? null}
                  habitableZoneAu={zone}
                  radiusEarth={(planet.radius_earth as number | null) ?? null}
                />
              </Suspense>
            </SceneBoundary>
          </div>
          <p className="mt-2 text-xs text-ink-3">
            Не в масштабе. Зелёные кольца показывают границы обитаемой зоны, серое кольцо показывает орбиту.
          </p>
        </Card>
      </div>
    </div>
  );
}
