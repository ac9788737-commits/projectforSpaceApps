import i18n from "@/i18n";
import { soilColor } from "@/ui/soilColor";

/**
 * Field instruments instead of numbers in boxes (docs/DESIGN_V3.md §2.4). Each draws one model
 * value and moves when it changes: water sloshes in a rain gauge, coins on a scale, the core of a
 * soil auger darkens and thickens, a barometer needle swings with a springy finish.
 */
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const SMOOTH = "cubic-bezier(0.22, 1, 0.36, 1)";
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const t = i18n.t.bind(i18n);

/** Rain gauge: water level = m³/ha (irrigated, 0…12 000) or % of need (rain-fed). */
export function WaterGauge({ value, irrigated }: { value: number; irrigated: boolean }) {
  const k = clamp(irrigated ? value / 12000 : value / 100, 0, 1);
  const top = 12 + (1 - k) * 84;
  return (
    <svg viewBox="0 0 56 110" className="h-24 w-12 shrink-0" role="img" aria-label={t("ind.water")}>
      <rect x="10" y="6" width="36" height="96" rx="8" fill="var(--paper-sheet)" stroke="var(--ink)" strokeWidth="1.5" />
      <g key={Math.round(value)} className="instrument-slosh">
        <rect x="12" y={top} width="32" height={100 - top} rx="6" fill="var(--water)" fillOpacity="0.75" style={{ transition: `y 600ms ${SMOOTH}, height 600ms ${SMOOTH}` }} />
        <path d={`M12 ${top + 2} q8 -4 16 0 t16 0`} stroke="var(--paper-sheet)" strokeOpacity="0.7" strokeWidth="1.5" fill="none" style={{ transition: `d 600ms ${SMOOTH}` }} />
      </g>
      {[0.25, 0.5, 0.75].map((m) => (
        <line key={m} x1="38" x2="46" y1={12 + (1 - m) * 84} y2={12 + (1 - m) * 84} stroke="var(--ink)" strokeWidth="1" />
      ))}
      <rect x="6" y="2" width="44" height="6" rx="3" fill="var(--ink)" />
    </svg>
  );
}

/** Coins on a balance: the stack is the margin ($/ha, 0…1 200), the beam tips with the change. */
export function CoinScale({ value, delta }: { value: number; delta: number }) {
  const coins = clamp(Math.round(value / 120), 0, 10);
  const tilt = clamp(-delta / 25, -10, 10);
  return (
    <svg viewBox="0 0 80 110" className="h-24 w-16 shrink-0" role="img" aria-label={t("ind.money")}>
      <path d="M40 104 V40 M24 104 h32" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <g style={{ transform: `rotate(${tilt}deg)`, transformOrigin: "40px 40px", transition: `transform 700ms ${SPRING}` }}>
        <line x1="8" y1="40" x2="72" y2="40" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="40" cy="40" r="3" fill="var(--ink)" />
        <path d="M10 40 v6 M70 40 v6" stroke="var(--ink)" strokeWidth="1" />
        <path d="M2 46 h18 l-3 4 h-12 z" fill="var(--ink)" />
        <path d="M60 46 h18 l-3 4 h-12 z" fill="var(--ink)" />
        {Array.from({ length: coins }, (_, i) => (
          <ellipse key={i} cx="69" cy={44 - i * 3.6} rx="7" ry="2.4" fill="var(--accent-400)" stroke="var(--accent-700)" strokeWidth="0.8" style={{ transition: `opacity 300ms ${SMOOTH}` }} />
        ))}
      </g>
    </svg>
  );
}

/** Soil auger: a clear tube with the core; the topsoil band thickens with the score (0…100) and
 * takes the Munsell colour of the organic carbon. */
export function SoilAuger({ score, soc }: { score: number; soc: number }) {
  const top = 10 + clamp(score, 0, 100) * 0.5;
  return (
    <svg viewBox="0 0 48 110" className="h-24 w-10 shrink-0" role="img" aria-label={t("ind.soil")}>
      <path d="M8 4 h32 M24 4 v4" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="12" y="8" width="24" height="96" rx="4" fill="var(--subsoil)" />
      <rect x="12" y="8" width="24" height={top} rx="4" fill={soilColor(soc)} style={{ transition: `height 600ms ${SMOOTH}, fill 600ms ${SMOOTH}` }} />
      <rect x="12" y={8 + top} width="24" height="3" fill="var(--soil-3)" style={{ transition: `y 600ms ${SMOOTH}` }} />
      <rect x="12" y="8" width="24" height="96" rx="4" fill="none" stroke="var(--ink)" strokeWidth="1.5" />
      <path d="M24 104 l-5 5 h10 z" fill="var(--ink)" />
    </svg>
  );
}

/** Barometer: the needle swings from «ясно» (0 % failed harvests) to «буря» (≥ 40 %). */
export function RiskBarometer({ value }: { value: number }) {
  const angle = -70 + clamp(value / 40, 0, 1) * 140;
  return (
    <svg viewBox="0 0 96 80" className="h-24 w-20 shrink-0" role="img" aria-label={t("ind.risk")}>
      <circle cx="48" cy="52" r="40" fill="var(--paper-sheet)" stroke="var(--ink)" strokeWidth="1.5" />
      <path d="M20 40 A30 30 0 0 1 36 25" stroke="var(--good)" strokeWidth="5" fill="none" />
      <path d="M40 23 A30 30 0 0 1 56 23" stroke="var(--caution)" strokeWidth="5" fill="none" />
      <path d="M60 25 A30 30 0 0 1 76 40" stroke="var(--risk)" strokeWidth="5" fill="none" />
      <text x="14" y="58" fontSize="9" fill="var(--ink-soft)">{t("instr.clear")}</text>
      <text x="82" y="58" fontSize="9" fill="var(--ink-soft)" textAnchor="end">{t("instr.storm")}</text>
      <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "48px 52px", transition: `transform 800ms ${SPRING}` }}>
        <path d="M48 52 L46 50 L48 18 L50 50 Z" fill="var(--ink)" />
      </g>
      <circle cx="48" cy="52" r="4" fill="var(--ink)" />
    </svg>
  );
}
