import type { Timeline } from "../data";

const FACTOR_RU: Record<string, string> = {
  temperature: "Температура",
  light: "Свет",
  photoperiod: "Фотопериод",
  spectrum: "Спектр",
  co2: "CO₂",
  o2: "O₂",
  pressure: "Давление",
  gravity: "Гравитация",
  uv: "Ультрафиолет",
  ionising: "Радиация",
  water: "Вода",
  soil: "Грунт",
};
export const factorRu = (key: string) => FACTOR_RU[key] ?? key;

export function dayLabel(timeline: Timeline | undefined, day: number, unitRu: string): string {
  const d = Math.floor(day);
  if (!timeline) return `${unitRu === "сол" ? "Сол" : "Сутки"} ${d}`;
  if (timeline.day_unit === "sol") return `Сол ${d}`;
  if (timeline.day_unit === "earth_day") return `День ${d} (земные сутки)`;
  return `Сутки ${d}`;
}

export const STAGE_RU: Record<string, string> = {
  seed: "семя",
  germination: "прорастание",
  vegetative: "рост листьев",
  flowering: "цветение",
  fruiting: "формирование урожая",
  mature: "урожай готов",
  dead: "погибло",
};
export const CONFIDENCE_RU = { high: "высокая", medium: "средняя", low: "низкая" } as const;
