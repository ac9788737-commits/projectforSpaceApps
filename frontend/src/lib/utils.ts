import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const number = new Intl.NumberFormat("ru-RU", { maximumSignificantDigits: 3 });
const fixed = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

export function fmt(value: number | null | undefined, unit = ""): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "нет данных";
  const magnitude = Math.abs(value);
  const text =
    magnitude >= 1e6
      ? value.toExponential(1).replace(".", ",")
      : magnitude >= 1000
        ? fixed.format(value)
        : number.format(value);
  return unit ? `${text} ${unit}` : text;
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "нет данных";
  return `${fixed.format(value * 100)} %`;
}

export const SCENARIOS = [
  { id: "open_surface", label: "Открытая поверхность", hint: "Среда как есть" },
  { id: "greenhouse", label: "Теплица", hint: "Купол и естественный свет" },
  { id: "closed_farm", label: "Закрытая ферма", hint: "Полный контроль и LED" },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]["id"];

export const CONFIDENCE_LABELS: Record<string, string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
};

export const ENGINEERING_LABELS: Record<string, { label: string; unit?: string }> = {
  feasible: { label: "Конструкция осуществима" },
  site_temp_k: { label: "Температура участка", unit: "К" },
  pressure_delta_kpa: { label: "Перепад давлений", unit: "кПа" },
  inside_temp_k: { label: "Температура внутри", unit: "К" },
  external_temp_k: { label: "Температура снаружи", unit: "К" },
  heat_loss_w_m2: { label: "Теплопотери", unit: "Вт/м²" },
  led_ppfd_umol_m2_s: { label: "PPFD светодиодов", unit: "мкмоль/м²/с" },
  energy_kwh_m2_day: { label: "Энергия", unit: "кВт·ч/м²/сут" },
  energy_kwh_per_kg: { label: "Энергия на кг урожая", unit: "кВт·ч/кг" },
};
