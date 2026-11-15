import { Undo2, X } from "lucide-react";
import type { ReactNode } from "react";
import type { FieldInfo } from "@/builder/api";
import { IrrigationPills } from "@/builder/IrrigationPills";
import { CROP_FAMILY, FAMILY_COLOR } from "@/ui/crops";
import { CROP_GLYPH, Icon, ICON_NAMES } from "@/ui/icons";
import { PAT } from "@/ui/patterns";
import { Button, SourceBadge, SourceDot, StatusTag } from "@/ui/primitives";
import { SOIL_STEPS, soilColor } from "@/ui/soilColor";
import { LoadingLine, SourceNotice } from "@/ui/states";

/** /dev/ui — the field-journal kit of docs/DESIGN.md v2 on one sheet. */

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="border-t border-subtle pt-4">
      <h2 className="font-head text-lg font-semibold">{title}</h2>
      {note && <p className="mt-0.5 max-w-[70ch] text-sm text-fg-muted">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Chip({ name, token, label }: { name: string; token: string; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="size-8 shrink-0 rounded-ctl border border-subtle" style={{ background: `var(${token})` }} aria-hidden />
      <span>
        <span className="block font-medium">{name}</span>
        <span className="block text-xs text-fg-muted">{label}</span>
      </span>
    </li>
  );
}

const FAMILIES: [string, string, string][] = [
  ["Злаковые", "--crop-cereal", "солома"],
  ["Бобовые", "--crop-legume", "гороховый"],
  ["Мальвовые", "--crop-malva", "марена"],
  ["Паслёновые", "--crop-solan", "фиолетовый клубень"],
  ["Капустные", "--crop-brassica", "горчичный"],
  ["Астровые", "--crop-aster", "тёмная солома"],
  ["Бурачниковые", "--crop-borage", "сизый"],
];
const SIGNALS: [string, string, string][] = [
  ["Вода", "--water", "полив, осадки"],
  ["Риск", "--risk", "провал, запрет"],
  ["Внимание", "--caution", "предупреждение"],
  ["Улучшение", "--good", "лучше, чем было"],
];
const SHADES = ["00", "50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1000"];
const CORE: [string, string[], string][] = [
  ["Primary", SHADES, "поле, листва"],
  ["Secondary", SHADES, "земля, пашня"],
  ["Accent", SHADES, "спелая пшеница"],
  ["Grayscale", ["00", "50", "100", "200", "300", "400", "500", "600", "700", "750", "800", "1000"], "солома, нейтральные"],
];
const ROLES: [string, string, string][] = [
  ["Фон страницы", "--cs-surface-page", "Primary 00"],
  ["Карточка", "--cs-surface-card", "Grayscale 00"],
  ["Выбрано", "--cs-surface-selected", "Primary 100"],
  ["Вывеска", "--cs-surface-inverted", "Primary 800"],
  ["Текст", "--cs-text-primary", "Primary 900"],
  ["Текст второй", "--cs-text-secondary", "Grayscale 600"],
  ["Действие", "--cs-action-primary", "Primary 600"],
  ["Акцент", "--cs-action-accent", "Accent 400"],
];
const TAJIK = "Ғалла, нахӯд, қаламфур, ҳосил, ҷӯйбор, ӣ";
const demoField = { id: "dev-ui", irrigation_method: "furrow" } as unknown as FieldInfo;

export default function DevUi() {
  return (
    <div data-mood="field" className="min-h-dvh bg-farm-page px-[var(--edge)] py-[var(--edge)] text-fg">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header>
          <p className="text-sm text-fg-muted">/dev/ui · docs/DESIGN.md v2</p>
          <h1 className="font-head text-3xl font-semibold">Полевой журнал: элементы интерфейса</h1>
        </header>

        <Section title="Палитра фермы: базовые цвета" note="Слой 1 — сырые палитры с оттенками от 00 (почти белый) до 1000 (почти чёрный), 500 — основной тон. Структура — по elayadesign/ai-design-skills.">
          <div className="flex flex-col gap-2">
            {CORE.map(([name, steps, label]) => (
              <div key={name} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
                <span>
                  <span className="block font-medium">{name}</span>
                  <span className="block text-xs text-fg-muted">{label}</span>
                </span>
                <ol className="flex overflow-hidden rounded-lg border border-subtle">
                  {steps.map((st) => (
                    <li key={st} className="h-9 flex-1" style={{ background: `var(--${name.toLowerCase()}-${st})` }} title={`--${name.toLowerCase()}-${st}`} />
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Палитра фермы: роли" note="Слой 2 — токены по ролям; компоненты берут только их. Смена бренда меняет только слой 1.">
          <ul className="grid gap-3 sm:grid-cols-4">
            {ROLES.map(([n, t, l]) => (
              <Chip key={t} name={n} token={t} label={l} />
            ))}
          </ul>
        </Section>

        <Section title="Почва: шкала Манселла 10YR" note="Цвет почвы — это данные: чем темнее, тем больше органического углерода. Между ступенями цвет смешивается.">
          <ol className="flex flex-wrap gap-0">
            {SOIL_STEPS.map((s) => (
              <li key={s.step} className="w-28">
                <span className="block h-14" style={{ background: s.token }} aria-hidden />
                <span className="mt-1 block text-sm font-medium">{s.munsell}</span>
                <span className="block text-xs text-fg-muted">≈ {s.soc.toLocaleString("ru-RU")} % C</span>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex h-6 w-full max-w-xl" aria-label="Непрерывная шкала от 0,4 до 3 % органического углерода">
            {Array.from({ length: 40 }, (_, i) => (
              <span key={i} className="flex-1" style={{ background: soilColor(0.4 + (i / 39) * 2.6) }} />
            ))}
          </div>
        </Section>

        <Section title="Культуры: цвета семенных пакетов" note="Плоские цвета по семействам; покровные — штриховка поверх цвета, голая почва — точечный растр.">
          <ul className="grid gap-3 sm:grid-cols-4">
            {FAMILIES.map(([n, t, l]) => (
              <Chip key={t} name={n} token={t} label={l} />
            ))}
          </ul>
        </Section>

        <Section title="Сигналы" note="Статус никогда не передаётся только цветом: всегда слово или знак.">
          <ul className="grid gap-3 sm:grid-cols-4">
            {SIGNALS.map(([n, t, l]) => (
              <Chip key={t} name={n} token={t} label={l} />
            ))}
          </ul>
          <p className="mt-3 flex flex-wrap gap-4">
            <StatusTag status="ok" label="лучше" />
            <StatusTag status="stress" label="внимание" />
            <StatusTag status="lethal" label="риск" />
          </p>
        </Section>

        <Section title="Шрифты" note="Golos Text — текст и цифры (табличные), Noto Serif — заголовки. У Literata нет таджикских ӣ ӯ ҳ ҷ, поэтому антиква — Noto Serif.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-fg-muted">Noto Serif 500 / 600</p>
              <p className="font-head text-2xl font-medium">{TAJIK}</p>
              <p className="font-head text-2xl font-semibold">Гиссарская долина</p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">Golos Text 400 / 500 / 600</p>
              <p className="text-lg">{TAJIK}</p>
              <p className="text-lg font-medium">Хлопчатник после нута: урожай +5 %</p>
              <p className="text-lg font-semibold tabular-nums">было 1 200, стало 980 м³/га; азот 0,735 $/кг</p>
            </div>
          </div>
          <ol className="mt-3 flex flex-wrap items-baseline gap-4">
            {[13, 15, 17, 21, 28, 37].map((px) => (
              <li key={px} style={{ fontSize: px }} className="font-head">
                {px}
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Пиктограммы" note="Штамп полевого журнала: сетка 24, обводка 1,5, без заливки.">
          <ul className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {ICON_NAMES.map((n) => (
              <li key={n} className="flex flex-col items-center gap-1 text-xs text-fg-muted">
                <Icon name={n} size={28} className="text-fg" />
                {n}
              </li>
            ))}
          </ul>
          <ul className="mt-4 flex flex-wrap gap-2">
            {Object.entries(CROP_GLYPH).map(([crop, glyph]) => (
              <li key={crop} className="flex w-32 items-center gap-2 rounded-ctl border border-subtle bg-panel px-2 py-1.5 text-sm" style={{ borderTop: `4px solid ${FAMILY_COLOR[CROP_FAMILY[crop]]}` }}>
                <Icon name={glyph} size={22} className="shrink-0" />
                {crop}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Кнопки и поля" note="Радиус 4 px. Главная кнопка — чернила на бумаге, без свечения и стрелок.">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">Предложить план</Button>
            <Button>Прожить 4 года</Button>
            <Button pressed>Вода</Button>
            <Button variant="ghost">Режим эксперта</Button>
            <Button variant="ghost" size="icon" aria-label="Отменить"><Undo2 size={18} strokeWidth={1.5} /></Button>
            <Button variant="ghost" size="icon" aria-label="Закрыть"><X size={18} strokeWidth={1.5} /></Button>
            <Button disabled>Недоступно</Button>
          </div>
          <label className="mt-3 flex max-w-xs items-center gap-2 text-sm">
            Бюджет на сезон
            <input type="number" defaultValue={300} className="h-10 w-24 rounded-ctl border border-subtle bg-panel px-2 text-right tabular-nums" />
            $/га
          </label>
          <div className="mt-3">
            <p className="mb-1 text-sm">Тумблер полива — единственная «пилюля»</p>
            <IrrigationPills field={demoField} />
          </div>
        </Section>

        <Section title="Фактуры и источники" note="Измерение — сплошная линия, оценка модели — пунктир или штриховка и слово «оценка».">
          <svg viewBox="0 0 520 70" className="w-full max-w-2xl" role="img" aria-label="Фактуры: покровная, голая почва, оценка, засоление">
            <rect x="0" y="0" width="120" height="50" fill="var(--crop-legume)" />
            <rect x="0" y="0" width="120" height="50" fill={PAT.cover} />
            <rect x="130" y="0" width="120" height="50" fill="var(--soil-2)" />
            <rect x="130" y="0" width="120" height="50" fill={PAT.bare} />
            <rect x="260" y="0" width="120" height="50" fill="none" stroke="var(--ink-soft)" strokeDasharray="4 3" />
            <rect x="260" y="0" width="120" height="50" fill={PAT.estimate} />
            <rect x="390" y="0" width="120" height="50" fill="var(--soil-3)" />
            <rect x="390" y="0" width="120" height="50" fill={PAT.salt} />
            {["покровная", "голая почва", "оценка", "засоление"].map((t, i) => (
              <text key={t} x={i * 130 + 2} y="66" fontSize="13" fill="var(--ink)">
                {t}
              </text>
            ))}
          </svg>
          <p className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <SourceBadge source="real" /> <SourceBadge source="estimate" /> <span className="inline-flex items-center gap-1">Kc 1,15 <SourceDot source="real" detail="FAO-56, табл. 12" /></span>
            <span className="inline-flex items-center gap-1">порог жары 38 °C <SourceDot source="estimate" detail="оценка" /></span>
          </p>
        </Section>

        <Section title="Состояния">
          <div className="flex max-w-xl flex-col gap-2">
            <LoadingLine text="Собираю паспорт поля" />
            <SourceNotice>Снимок за последние 60 дней закрыт облаками. Показываем мозаику за 2024 год.</SourceNotice>
          </div>
        </Section>
      </div>
    </div>
  );
}
