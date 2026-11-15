import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { FieldInfo, Irrigation } from "./api";
import { IRRIGATION, useBuilder } from "./store";

export function useIrrigation(field: FieldInfo | undefined): Irrigation {
  const chosen = useBuilder((s) => (field ? s.irrigation[field.id] : undefined));
  return chosen ?? field?.irrigation_method ?? "none";
}

/** «Без полива / По бороздам / Капельный» (docs/IMPROVEMENTS.md B2). */
export function IrrigationPills({ field }: { field: FieldInfo }) {
  const value = useIrrigation(field);
  const set = useBuilder((s) => s.setIrrigation);
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("irrigation.aria")}>
      {IRRIGATION.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={value === m.id}
          onClick={() => set(field.id, m.id)}
          className={cn("h-8 cursor-pointer rounded-full border px-3 text-xs", value === m.id ? "border-accent bg-accent text-[var(--accent-ink)]" : "border-subtle text-fg hover:bg-hover")}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
