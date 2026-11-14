import { useState } from "react";
import { Button, GlassPanel } from "@/ui/primitives";

const KEY = "astrocrop.hints.done";
const STEPS = [
  "Кликайте по галактикам, звёздам и планетам — камера полетит к ним. Колесо мыши приближает, перетаскивание вращает вид.",
  "Хлебные крошки вверху и клавиша Esc возвращают на уровень выше. Все объекты сцены есть списком в левой панели — по ним можно ходить клавишей Tab.",
  "Ctrl+K открывает поиск: введите «TRAPPIST-1 e» или «Марс», и вы окажетесь там.",
  "В огороде выберите грядку, культуру и тип укрытия, затем нажмите ▶ или пробел — растения растут по данным симуляции.",
];

function readDone(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function Hints() {
  const [step, setStep] = useState(() => (readDone() ? -1 : 0));
  if (step < 0) return null;
  const finish = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* storage unavailable: hints simply show again next time */
    }
    setStep(-1);
  };
  return (
    <GlassPanel strong className="p-4" role="dialog" aria-label="Подсказки">
      <p className="mb-1 font-num text-xs text-fg-muted">
        {step + 1} / {STEPS.length}
      </p>
      <p className="mb-3 text-sm leading-snug">{STEPS[step]}</p>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={finish}>
          Пропустить
        </Button>
        <Button variant="primary" onClick={() => (step + 1 < STEPS.length ? setStep(step + 1) : finish())}>
          {step + 1 < STEPS.length ? "Дальше" : "Понятно"}
        </Button>
      </div>
    </GlassPanel>
  );
}
