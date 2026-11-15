import { describe, expect, it } from "vitest";
import { COLUMNS, sourceText, toCsv, type RefRow } from "./ReferencePage";

const t = (k: string) => ({ "common.estimate": "оценка", "ref.not_legume": "не бобовая" })[k] ?? k;
const params = Object.fromEntries(COLUMNS.map((c) => [c, { value: 1, source: null }]));
const row: RefRow = { id: "cotton", name_ru: "Хлопчатник", family_ru: "мальвовые", is_cover: false, params: { ...params, kc: { value: "0.35 / 1.2 / 0.6", source: "FAO-56, Table 12" } } };

describe("reference «Откуда цифры»", () => {
  it("a parameter without a source reads «оценка»", () => {
    expect(sourceText({ value: 38, source: null }, t)).toBe("оценка");
    expect(sourceText({ value: 0, source: "@not_legume" }, t)).toBe("не бобовая");
    expect(sourceText({ value: 1, source: "FAO-56" }, t)).toBe("FAO-56");
  });
  it("CSV has a value and a source column for every parameter, quoted where needed", () => {
    const [head, line] = toCsv([row], t).split("\n");
    expect(head.split(",")).toHaveLength(3 + COLUMNS.length * 2);
    expect(line).toContain('"FAO-56, Table 12"');
    expect(line).toContain("оценка");
  });
});
