import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Panel } from "@/ui/primitives";
import type { FieldInfo, Quick, Slot } from "./api";
import { useBuilder } from "./store";

const KEY = "astrocrop.story";
type Step = "intro" | "watch" | "try" | "done" | "off";

function wasShown(fid: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]).includes(fid);
  } catch {
    return false;
  }
}

function markShown(fid: string) {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
    localStorage.setItem(KEY, JSON.stringify([...new Set([...list, fid])]));
  } catch {
    /* no storage: the story may show again */
  }
}

/** 60-second first-visit story on the farmer's field (docs/UX.md §6). Skippable. */
export function Story({ field, quick, onPlay }: { field: FieldInfo; quick: Quick | undefined; onPlay: () => void }) {
  const { t } = useTranslation();
  const plan = useBuilder((s) => s.plan);
  const setPlan = useBuilder((s) => s.setPlan);
  const forced = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("story") === "1";
  const [step, setStep] = useState<Step>(() => (forced || !wasShown(field.id) ? "intro" : "off"));
  const before = useRef<number | null>(null);

  // remember the water of the farmer's own plan, then wait for the chickpea move
  useEffect(() => {
    if (step === "watch" && quick && JSON.stringify(quick.plan) === JSON.stringify(field.current_plan)) before.current = quick.indicators.water.value;
    if (step === "try" && plan[1]?.[0] === "chickpea" && quick && JSON.stringify(quick.plan) === JSON.stringify(plan)) setStep("done");
  }, [step, quick, plan, field.current_plan]);

  const close = () => {
    markShown(field.id);
    setStep("off");
  };
  if (step === "off") return null;
  const saved = before.current && quick ? Math.round((1 - quick.indicators.water.value / before.current) * 100) : null;

  const text: Record<Exclude<Step, "off">, string> = {
    intro: t("story.intro", { farmer: field.farmer, story: field.story_ru ?? "" }),
    watch: t("story.watch"),
    try: t("story.try"),
    done: saved !== null && saved > 0 ? t("story.saved", { n: saved }) : t("story.look"),
  };

  return (
    <div className={step === "intro" ? "fixed inset-0 z-40 grid place-items-center bg-[var(--scrim)] p-4" : "pointer-events-none fixed inset-x-0 top-2 z-40 flex justify-center px-4"} role="dialog" aria-modal={step === "intro"} aria-label={t("story.aria")}>
      <Panel className="pointer-events-auto max-w-lg border-[var(--ink)] p-4 text-sm">
        <p className="text-base">{text[step]}</p>
        <div className="mt-3 flex gap-2">
          {step === "intro" && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setPlan(field.current_plan!.map((p) => [...p] as Slot));
                setStep("watch");
                setTimeout(onPlay, 700);
              }}
            >
              {t("story.show")}
            </Button>
          )}
          {step === "watch" && (
            <Button variant="primary" size="sm" onClick={() => setStep("try")}>
              {t("story.change")}
            </Button>
          )}
          {step === "done" && (
            <Button variant="primary" size="sm" onClick={close}>
              {t("story.build")}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={close}>
            {t("story.skip")}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
