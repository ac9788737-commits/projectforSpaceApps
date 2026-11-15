import en from "@/i18n/en.json";
import ru from "@/i18n/ru.json";
import { describe, expect, it } from "vitest";
import type { Card, Quick } from "./api";
import { repriced } from "./LocalPrices";
import { clashes, human } from "./rules";
import { decodePlan, encodePlan } from "./store";
import i18n from "@/i18n";

// the rule texts below are checked in Russian; the site itself opens in English
await i18n.changeLanguage("ru");

const card = (id: string, family: string, extra: Partial<Card> = {}): Card => ({
  id, name_ru: id, family, family_ru: family, is_cover: false, is_legume: family === "fabaceae", min_break_years: 1,
  allow_consecutive: false, water: "средне", hint: "", hints: [], estimate: true, root_depth_m: 1, start_cost_usd: 300, labour_days: 1, expensive: false, ...extra,
});
const DECK = [card("cotton", "malvaceae"), card("chickpea", "fabaceae", { min_break_years: 3 }), card("pea", "fabaceae", { min_break_years: 4 }), card("wheat", "poaceae"), card("vetch", "fabaceae", { is_cover: true, min_break_years: 0 }), card("alfalfa", "fabaceae", { allow_consecutive: true, min_break_years: 3 }), card("tomato", "solanaceae", { min_break_years: 3 }), card("potato", "solanaceae", { min_break_years: 3 })];

describe("instant rules on cards", () => {
  it("flags a repeated family and legume after legume", () => {
    expect(clashes([["cotton", null], ["cotton", null]], DECK)).toHaveLength(1);
    expect(clashes([["tomato", null], ["potato", null]], DECK)[0].text).toMatch(/вредител/);
    expect(clashes([["wheat", null], ["cotton", null], ["wheat", null]], DECK)).toHaveLength(0);
    expect(clashes([["alfalfa", null], ["alfalfa", null]], DECK)).toHaveLength(0);
    expect(clashes([["chickpea", "vetch"], ["wheat", null]], DECK).some((c) => c.slot === 1)).toBe(true);
  });
  it("rounds like a person", () => {
    expect(human(417.83, "$/га")).toBe("420 $/га");
    expect(human(-17.83, "%")).toBe("−18 %");
  });
  it("encodes a plan for a share link", () => {
    const plan: [string | null, string | null][] = [["cotton", null], ["chickpea", "vetch"]];
    expect(decodePlan(encodePlan(plan))).toEqual(plan);
  });
});

// docs/UX.md §5, §10: no jargon on the main screens (expert mode is exempt).
const FORBIDDEN = [/NDVI/, /RUSLE/, /P10/, /P90/, /\bSPI\b/, /SPEI/, /эвапотранспирац/i, /\bKc\b/, /Парето/i];
describe("plain language on the main screens", () => {
  const sources = import.meta.glob("./*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  for (const [f, src] of Object.entries(sources)) {
    it(`${f} has no jargon in visible text`, () => {
      // visible text: JSX text and string literals (comments excluded)
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const strings = [...code.matchAll(/"([^"\n]*)"|`([^`]*)`|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3]);
      for (const re of FORBIDDEN) expect(strings.filter((x) => re.test(x)), String(re)).toEqual([]);
    });
  }
  it("checks every main-screen file", () => expect(Object.keys(sources).length).toBeGreaterThanOrEqual(8));
  it("dictionaries of the main screens have no jargon (the reference table is exempt)", () => {
    const flat = (d: unknown): string[] => (typeof d === "string" ? [d] : Array.isArray(d) ? d.flatMap(flat) : Object.values(d as object).flatMap(flat));
    for (const d of [ru, en]) {
      const { ref: _ref, ...main } = d;
      for (const re of FORBIDDEN) expect(flat(main).filter((x) => re.test(x)), String(re)).toEqual([]);
    }
  });
});

// docs/IMPROVEMENTS.md B12: no text is hard-coded in the components, all of it is in src/i18n
describe("no hard-coded Russian in the farmer screens", () => {
  const sources = import.meta.glob(["./*.tsx", "./rules.ts", "./store.ts", "../i18n/*.tsx", "../reference/*.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  for (const [f, src] of Object.entries(sources)) {
    it(`${f} keeps its text in the dictionaries`, () => {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
      expect(code.split("\n").filter((l) => /[А-Яа-яЁё]/.test(l))).toEqual([]);
    });
  }
});

// docs/IMPROVEMENTS.md B10: the margin follows local prices without a request
describe("local prices", () => {
  const q = {
    indicators: { money: { value: 790 } },
    economy: { years: 4, tonnes: { cotton: 8, chickpea: 4 }, n_kg: 400, water_m3: 30000, prices: { cotton: 690, chickpea: 750 }, world_prices: { cotton: 690, chickpea: 750 }, n_usd_kg: 0.75, water_usd_m3: 0.02, world_n_usd_kg: 0.75, world_water_usd_m3: 0.02 },
  } as unknown as Quick;
  it("at the server's prices the margin is the server's", () => expect(repriced(q, {})).toBe(790));
  it("+$100/t cotton over 8 t in 4 years adds $200/ha a year", () => expect(repriced(q, { cotton: 790 })).toBeCloseTo(990));
  it("dearer nitrogen and water lower the margin", () => expect(repriced(q, { _n: 1.75, _water: 0.03 })).toBeCloseTo(790 - 100 - 75));
});
