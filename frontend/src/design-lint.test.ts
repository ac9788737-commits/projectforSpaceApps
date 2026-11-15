import { describe, expect, it } from "vitest";
// The linter is a Node script outside src (Node types are not part of the app's build), so it is
// loaded at run time and kept out of the type-checked program.
const SCRIPT = "../scripts/design-lint.ts";
const { lintFile } = (await import(/* @vite-ignore */ SCRIPT)) as { lintFile: (file: string, src: string) => string[] };

const lint = (file: string, src: string) => lintFile(file, src).map((x) => x.match(/\[(\w+)\]/)?.[1]);

describe("design-lint (docs/DESIGN.md §10.2)", () => {
  it("catches each AI-template pattern", () => {
    expect(lint("builder/X.tsx", '<div className="bg-gradient-to-r from-sky-500" />')).toContain("gradient");
    expect(lint("ui/X.css", "a { background: linear-gradient(red, blue); }")).toContain("gradient");
    expect(lint("ui/X.tsx", '<div className="backdrop-blur-md" />')).toContain("blur");
    expect(lint("ui/X.tsx", '<div className="shadow-xl" />')).toContain("shadow");
    expect(lint("ui/X.tsx", '<div className="shadow-[0_0_20px_rgb(255_0_0/0.8)]" />')).toContain("shadow");
    expect(lint("ui/X.tsx", '<p className="uppercase tracking-widest" />')).toContain("caps");
    expect(lint("ui/X.tsx", '<p className="font-mono" />')).toContain("mono");
    expect(lint("i18n/ru.json", '{ "a": "✨ Подобрать" }')).toContain("emoji");
    expect(lint("ui/X.tsx", "<b>Итог →</b>")).toContain("emoji");
    expect(lint("ui/X.tsx", "<EffectComposer><Bloom /></EffectComposer>")).toContain("bloom");
    expect(lint("ui/X.tsx", '<span className="rounded-full" />')).toContain("pill");
    expect(lint("ui/X.tsx", 'fill="#ff00aa"')).toContain("hex");
  });
  it("allows what the design allows", () => {
    expect(lint("builder/IrrigationPills.tsx", '<b className="rounded-full" />')).toEqual([]);
    expect(lint("styles/tokens.css", "--paper: #F5F6F1;")).toEqual([]);
    expect(lint("ui/X.tsx", "// a comment with → and ✨\nconst a = 1;")).toEqual([]);
    expect(lint("ui/X.tsx", '<div className="rounded-[4px] border border-rule text-ink" />')).toEqual([]);
    expect(lint("ui/X.tsx", '<div className="shadow-[var(--shadow-packet)]" />')).toEqual([]);
    expect(lint("builder/instruments/Gauge.tsx", '<circle className="rounded-full" />')).toEqual([]);
  });
});

// docs/DESIGN_V3.md §2.3: every shadow token is ink-coloured, opacity ≤ 0.35, blur ≤ 16 px
// read from disk: CSS imports are stubbed in tests (Node module name kept out of the typed program)
const FS = "node:fs";
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync: (p: URL, enc: string) => string };
const tokens = readFileSync(new URL("./styles/tokens.css", import.meta.url), "utf8");
describe("shadow tokens", () => {
  it("are physical, not glow", () => {
    const defs = [...tokens.matchAll(/--shadow-(?:packet|lifted|sheet):\s*([^;]+);/g)].map((m) => m[1]).filter((v) => v.trim() !== "none");
    expect(defs.length).toBeGreaterThanOrEqual(3);
    for (const d of defs)
      for (const part of d.split(/,(?![^(]*\))/)) {
        const m = part.trim().match(/^(-?\d+)(?:px)? (-?\d+)(?:px)? (\d+)(?:px)? rgb\(36 48 31 \/ (0?\.\d+)\)$/);
        expect(m, part).not.toBeNull();
        expect(Number(m![3])).toBeLessThanOrEqual(16);
        expect(Number(m![4])).toBeLessThanOrEqual(0.35);
      }
  });
});
