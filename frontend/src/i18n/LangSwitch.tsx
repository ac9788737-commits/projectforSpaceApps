import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { LANGS, setLang, useLang } from "./index";

/** RU / EN / TG; `inverted` for the dark green app bar. */
export function LangSwitch({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  const { t } = useTranslation();
  const cur = useLang();
  return (
    <div role="radiogroup" aria-label={t("common.lang")} className={cn("flex gap-0.5 rounded-ctl border p-0.5 text-xs", inverted ? "border-[var(--primary-600)]" : "border-subtle", className)}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          role="radio"
          aria-checked={cur === l.id}
          onClick={() => setLang(l.id)}
          className={cn(
            "h-6 cursor-pointer rounded-md px-1.5 transition-colors duration-300 ease-[var(--ease-panel)]",
            inverted
              ? cur === l.id
                ? "bg-farm-accent text-[var(--primary-900)]"
                : "text-farm-on-inverted-2 hover:text-farm-on-inverted"
              : cur === l.id
                ? "bg-accent text-[var(--accent-ink)]"
                : "text-fg-muted hover:text-fg",
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
