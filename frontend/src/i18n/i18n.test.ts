import { describe, expect, it } from "vitest";
import en from "./en.json";
import ru from "./ru.json";
import tg from "./tg.json";

type Tree = { [k: string]: unknown };
const keys = (d: Tree, p = ""): string[] =>
  Object.entries(d).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keys(v as Tree, `${p}${k}.`) : [`${p}${k}`]));
const vars = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort().join(",");
const get = (d: Tree, k: string) => k.split(".").reduce<unknown>((o, x) => (o as Tree)[x], d);

describe("i18n dictionaries", () => {
  it("every language has every key", () => {
    const base = keys(ru).sort();
    expect(keys(en).sort()).toEqual(base);
    expect(keys(tg).sort()).toEqual(base);
  });
  it("translations keep the placeholders and are not empty", () => {
    for (const k of keys(ru)) {
      const r = get(ru, k);
      for (const d of [en, tg]) {
        const v = get(d, k);
        if (typeof r === "string") {
          expect(typeof v, k).toBe("string");
          expect((v as string).length, k).toBeGreaterThan(0);
          expect(vars(v as string), k).toBe(vars(r));
        } else expect((v as unknown[]).length, k).toBe((r as unknown[]).length);
      }
    }
  });
  it("English has no Cyrillic", () => {
    for (const k of keys(en)) expect(JSON.stringify(get(en, k)), k).not.toMatch(/[А-Яа-яЁё]/);
  });
});
