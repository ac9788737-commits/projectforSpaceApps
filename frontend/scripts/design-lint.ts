/**
 * «Нет AI-шаблонов» (docs/DESIGN.md §10.2). Fails when the product UI uses:
 * gradients, backdrop blur, glow shadows, caps labels, monospace, emoji and «→»,
 * Bloom / EffectComposer, pills (rounded-full) outside the irrigation toggle, and raw hex
 * colours outside the token files. The Lab (3D space and garden) is exempt (§7).
 *
 * Run: node scripts/design-lint.ts  (Node ≥ 23 runs TypeScript directly). Part of `make lint`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../src/", import.meta.url).pathname;

/** The Lab: the optional space mode, allowed to stay dark (docs/DESIGN.md §7). */
const LAB = [
  /^explore\//,
  /^plants\//,
  /^components\/(OrbitScene|PlanetPicker)\.tsx$/,
  /^pages\/(Catalog|Compare|PlanetCard|Simulator)\.tsx$/,
  // the Lab's own kit: imported only by explore/ and the Lab pages above
  /^ui\/(time|data|Logo|CropIcon)\.tsx$/,
  /^ui\/charts\//,
  /^components\/ui\//,
];
const SKIP = [/^api\/schema\.d\.ts$/, /\.test\.tsx?$/];
/** Where hex colours may be defined: the token files. */
const TOKEN_FILES = new Set(["styles/tokens.css", "index.css"]);
/** Round shapes with a physical meaning (docs/DESIGN_V3.md §3): the irrigation toggle, the
 * instruments, the scene (sun, dice) and the seed packets. */
const PILL_OK = (f: string) => f === "builder/IrrigationPills.tsx" || /^builder\/(scene|instruments|deck)\//.test(f);

interface Rule {
  id: string;
  re: RegExp;
  why: string;
  skip?: (file: string) => boolean;
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B06}\u{2B07}\u{1F004}-\u{1F0CF}]/u;

export const RULES: Rule[] = [
  { id: "gradient", re: /\b(linear|radial|conic)-gradient\(|<(linear|radial)Gradient\b|(?<![\w-])bg-(gradient|linear|radial|conic)-|(?<![\w:-])(from|via|to)-(\[|white\b|black\b|transparent\b|[a-z]+-\d)/, why: "градиенты запрещены (§2)" },
  { id: "blur", re: /backdrop-filter|backdrop-blur/, why: "стекло с размытием фона запрещено (§2)" },
  // v3 §2.3: shadows only where something lies on or is lifted from the table — through the
  // --shadow-* tokens (ink colour, opacity ≤ 0.35, blur ≤ 16 px); no glow, no coloured shadow
  { id: "shadow", re: /(?<![\w-])shadow-(sm|md|lg|xl|2xl|inner)\b|shadow-\[(?!var\(--shadow-)[^\]]*\]|drop-shadow-|box-shadow:(?!\s*(none|var\(--shadow-))/, why: "тени только токенами --shadow-* (DESIGN_V3 §2.3)", skip: (f) => TOKEN_FILES.has(f) },
  { id: "caps", re: /(?<![\w-])uppercase\b|text-transform:\s*uppercase|letter-spacing:\s*0?\.(0[3-9]|[1-9])|tracking-(wide|wider|widest|\[0?\.(0[3-9]|[1-9]))/, why: "подписи капсом и разрядка запрещены (§3)" },
  { id: "mono", re: /font-mono\b|font-family:[^;]*mono|ui-monospace|"[^"]*Mono"/, why: "моноширинный шрифт запрещён (§3)" },
  { id: "emoji", re: new RegExp(`${EMOJI.source}|✨|🚀|💡|→`, "u"), why: "эмодзи и «→» в интерфейсе запрещены (§3, §5)" },
  { id: "bloom", re: /\b(Bloom|EffectComposer)\b/, why: "Bloom / EffectComposer только в Лаборатории (§10.2)" },
  { id: "pill", re: /(?<![\w-])rounded-full\b|border-radius:\s*9999px/, why: "круглые формы только у приборов, сцены, пакетов и тумблера полива (DESIGN_V3 §3)", skip: PILL_OK },
  { id: "hex", re: /(?<![\w&])#[0-9a-fA-F]{6}\b|(?<![\w&])#[0-9a-fA-F]{3}\b(?!-)/, why: "цвет не из токенов (§2) — добавьте токен в styles/tokens.css", skip: (f) => TOKEN_FILES.has(f) },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Comments are not UI: strip them, keeping line numbers. */
export function stripComments(src: string, file: string): string {
  const keepLines = (m: string) => m.replace(/[^\n]/g, " ");
  let s = src.replace(/\/\*[\s\S]*?\*\//g, keepLines);
  if (!file.endsWith(".css") && !file.endsWith(".json")) s = s.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre: string) => pre + " ".repeat(m.length - pre.length));
  return s;
}

export function lintFile(file: string, src: string): string[] {
  const code = stripComments(src, file);
  const out: string[] = [];
  code.split("\n").forEach((line, i) => {
    for (const r of RULES) {
      if (r.skip?.(file)) continue;
      const m = line.match(r.re);
      if (m) out.push(`${file}:${i + 1}  [${r.id}] ${r.why}: «${m[0]}»`);
    }
  });
  return out;
}

export function targets(): string[] {
  return walk(ROOT)
    .map((p) => relative(ROOT, p))
    .filter((f) => /\.(tsx?|css|json)$/.test(f))
    .filter((f) => !LAB.some((re) => re.test(f)) && !SKIP.some((re) => re.test(f)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = targets().flatMap((f) => lintFile(f, readFileSync(join(ROOT, f), "utf8")));
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error(`\ndesign-lint: ${problems.length} нарушений docs/DESIGN.md §10.2`);
    process.exit(1);
  }
  console.log(`design-lint: чисто (${targets().length} файлов)`);
}
