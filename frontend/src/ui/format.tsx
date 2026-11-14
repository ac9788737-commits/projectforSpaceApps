import { cn } from "@/lib/utils";

const NBSP = " ";
const MINUS = "−";

/** Russian number formatting with a real minus sign (§3). */
export function formatNumber(value: number, digits = 1): string {
  const abs = Math.abs(value);
  const text = abs.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return value < 0 && text !== "0" ? MINUS + text : text;
}

/** Value + unit for plain strings (aria labels, toasts). */
export function withUnit(value: number | null | undefined, unit = "", digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return unit ? `${formatNumber(value, digits)}${NBSP}${unit}` : formatNumber(value, digits);
}

/** Monospace number with the unit in the secondary colour: `−63 °C`. */
export function Num({
  value,
  unit,
  digits = 1,
  className,
}: {
  value: number | null | undefined;
  unit?: string;
  digits?: number;
  className?: string;
}) {
  if (value == null || !Number.isFinite(value)) return <span className={cn("font-num text-fg-muted", className)}>—</span>;
  return (
    <span className={cn("font-num whitespace-nowrap", className)}>
      {formatNumber(value, digits)}
      {unit && <span className="text-fg-muted">{NBSP + unit}</span>}
    </span>
  );
}

export const kelvinToC = (k: number | null | undefined) => (k == null ? null : k - 273.15);
