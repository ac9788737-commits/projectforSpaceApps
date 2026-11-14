import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export const api = createClient<paths>({ baseUrl: "/api" });

export type PlanetSummary = components["schemas"]["PlanetSummary"];
export type PlanetDetail = components["schemas"]["PlanetDetail"];
export type Crop = components["schemas"]["CropOut"];
export type Simulation = components["schemas"]["SimulationOut"];
export type SimulateRequest = components["schemas"]["SimulateRequest"];
export type Compare = components["schemas"]["CompareOut"];
export type AtmospherePreset = components["schemas"]["AtmospherePresetOut"];
export type GalaxyPreset = components["schemas"]["GalaxyPresetOut"];
export type Factor = components["schemas"]["FactorOut"];

export function errorText(error: unknown): string {
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((item) => (item as { msg?: string }).msg ?? "Ошибка").join("; ");
    }
  }
  return "Сервер недоступен. Проверьте, что бэкенд запущен.";
}

export async function unwrap<T>(
  request: Promise<{ data?: T; error?: unknown }>,
): Promise<T> {
  const { data, error } = await request;
  if (data === undefined) throw new Error(errorText(error));
  return data;
}
