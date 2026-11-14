import { useQuery } from "@tanstack/react-query";
import { Filter, Gauge, Globe2, Orbit, Search, SlidersHorizontal, Sun, Thermometer, Weight, Wind } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { TimeSeriesChart } from "@/ui/charts";
import { CropCard, DataRow, FactorBar, ObjectCard, Verdict } from "@/ui/data";
import { Num } from "@/ui/format";
import { Logo, LogoMark } from "@/ui/Logo";
import { Breadcrumbs, Button, CollapsiblePanel, GlassPanel, ObjectTitle, SourceBadge, StatusTag } from "@/ui/primitives";
import { DeadPlantCard, LoadingLine, NoDataPanel, SourceNotice } from "@/ui/states";
import { TimeBar, ToastStack, useToasts, type EventType } from "@/ui/time";

type Mood = "space" | "garden";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="w-fit rounded-ctl bg-panel-strong px-2 py-1 text-xs uppercase tracking-[0.12em] text-fg-muted">{title}</h2>
      {children}
    </section>
  );
}

const chartData = Array.from({ length: 40 }, (_, i) => ({
  day: i * 3,
  biomass: 300 / (1 + Math.exp(-(i - 20) / 4)),
  yield: Math.max(0, 230 / (1 + Math.exp(-(i - 26) / 4)) - 10),
  height: 60 / (1 + Math.exp(-(i - 14) / 3)),
}));

function Showcase({ mood }: { mood: Mood }) {
  const [day, setDay] = useState(47);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 5 | 20>(1);
  const push = useToasts((s) => s.push);
  const space = mood === "space";
  return (
    <div className="flex flex-col gap-8">
      <Section title="Логотип и типографика">
        <GlassPanel className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-4">
            <Logo />
            <LogoMark size={16} className="text-fg" />
            <LogoMark size={24} className="text-fg" />
            <LogoMark size={40} className="text-accent" />
          </div>
          <ObjectTitle kicker={space ? "Планета · Солнечная система" : "Огород"}>{space ? "Марс" : "Огород на Марсе"}</ObjectTitle>
          <p className="font-head text-xl font-semibold">Солнечная система · TRAPPIST-1 e</p>
          <p className="text-base">Основной текст Inter 16: культура растёт под куполом, свет ограничивает урожай.</p>
          <p className="text-sm text-fg-muted">Вторичный текст 14 px: подписи и единицы.</p>
          <p className="flex flex-wrap gap-4 text-base">
            <Num value={-63} unit="°C" digits={0} />
            <Num value={0.38} unit="g" digits={2} />
            <Num value={636} unit="Па" digits={0} />
            <span className="font-num">Сол 47</span>
          </p>
        </GlassPanel>
      </Section>

      <Section title="Хлебные крошки">
        <GlassPanel className="px-2 py-1">
          <Breadcrumbs items={[{ label: "Вселенная", onClick: () => {} }, { label: "Млечный Путь", onClick: () => {} }, { label: "Солнце", onClick: () => {} }, { label: "Марс" }]} />
        </GlassPanel>
      </Section>

      <Section title="Кнопки">
        <GlassPanel className="flex flex-wrap gap-2 p-3">
          <Button variant="primary">
            <Orbit size={16} strokeWidth={1.5} /> Высадиться
          </Button>
          <Button variant="secondary">
            <Search size={16} strokeWidth={1.5} /> Поиск
          </Button>
          <Button variant="secondary" pressed>
            <Filter size={16} strokeWidth={1.5} /> Выбрано
          </Button>
          <Button variant="ghost">
            <SlidersHorizontal size={16} strokeWidth={1.5} /> Настройки
          </Button>
          <Button variant="secondary" size="icon" aria-label="Качество">
            <Gauge size={20} strokeWidth={1.5} />
          </Button>
          <Button variant="primary" disabled>
            Недоступно
          </Button>
        </GlassPanel>
      </Section>

      <Section title="Бейджи источника и статусы">
        <GlassPanel className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source="real" />
          <SourceBadge source="estimate" />
          <SourceBadge source="hypothetical" />
        </div>
        <div className="flex flex-wrap gap-4">
          <StatusTag status="ok" />
          <StatusTag status="stress" />
          <StatusTag status="lethal" />
        </div>
        </GlassPanel>
      </Section>

      <Section title="Data Row и Factor Bar">
        <GlassPanel className="flex flex-col gap-1 p-4">
          <DataRow icon={Thermometer} label="Температура" value={-63} unit="°C" digits={0} source="real" sourceDetail="NASA Planetary Fact Sheet, 2026-11-09" />
          <DataRow icon={Weight} label="Гравитация" value={0.38} unit="g" digits={2} source="real" sourceDetail="Расчёт по массе и радиусу" />
          <DataRow icon={Wind} label="Давление" value={0.64} unit="кПа" digits={2} source="real" />
          <DataRow icon={Sun} label="Свет в куполе" value={312} unit="мкмоль/м²/с" digits={0} source="estimate" sourceDetail="Модель чёрного тела, прозрачность купола 0,8" />
          <div className="mt-3 flex flex-col gap-4">
            <FactorBar icon={Weight} label="Гравитация" f={0.92} />
            <FactorBar icon={Sun} label="Свет" f={0.43} />
            <FactorBar icon={Thermometer} label="Температура" f={0} detail={<Num value={-63} unit="°C" digits={0} />} />
          </div>
        </GlassPanel>
      </Section>

      <Section title="Object Card">
        <ObjectCard
          title="Марс"
          type="Планета · Солнечная система"
          source="real"
          onFly={() => {}}
          verdict={<Verdict status="stress">Можно выращивать: под куполом, до 25 %</Verdict>}
        >
          <DataRow label="Температура" value={-65} unit="°C" digits={0} />
          <DataRow label="Гравитация" value={0.38} unit="g" digits={2} />
          <DataRow label="Освещённость" value={0.43} unit="× Земля" digits={2} />
        </ObjectCard>
      </Section>

      <Section title="Crop Card">
        <GlassPanel className="grid gap-2 p-3 sm:grid-cols-2">
          <CropCard id="potato" name="Картофель" optimum={[15, 20]} compatibility={0.25} selected />
          <CropCard id="lettuce" name="Салат" optimum={[15, 25]} compatibility={0.85} />
          <CropCard id="tomato" name="Томат" optimum={[20, 27]} compatibility={0} />
          <CropCard id="spirulina" name="Спирулина" optimum={[30, 37]} />
        </GlassPanel>
      </Section>

      <Section title="Time Bar и тосты">
        <TimeBar
          day={day}
          maxDay={120}
          playing={playing}
          speed={speed}
          unit="Сол"
          markers={[
            { day: 9, type: "frost", title: "Сол 9: ночной заморозок" },
            { day: 52, type: "dust_storm", title: "Сол 52: пылевая буря" },
            { day: 80, type: "flare", title: "Сол 80: вспышка" },
            { day: 118, type: "death", title: "Сол 118: гибель" },
          ]}
          onToggle={() => setPlaying((p) => !p)}
          onReset={() => setDay(0)}
          onSpeed={setSpeed}
          onSeek={setDay}
        />
        <div>
          <Button
            variant="secondary"
            onClick={() =>
              push([
                { id: `${mood}-${Date.now()}`, type: (["frost", "dust_storm", "flare", "harvest"] as EventType[])[Math.floor(Math.random() * 4)], text: "Ночной заморозок −92 °C — купол удержал +4 °C" },
              ])
            }
          >
            Показать тост
          </Button>
        </div>
      </Section>

      <Section title="График">
        <GlassPanel className="p-3">
          <TimeSeriesChart
            ariaLabel="Пример: биомасса, урожай и высота по дням"
            data={chartData}
            xKey="day"
            today={60}
            series={[
              { key: "biomass", name: "Биомасса", color: "var(--series-1)", unit: "г" },
              { key: "yield", name: "Урожай", color: "var(--series-2)", unit: "г" },
              { key: "height", name: "Высота", color: "var(--series-3)", unit: "см" },
            ]}
          />
        </GlassPanel>
      </Section>

      <Section title="Состояния">
        <LoadingLine text={space ? "Рассчитываем орбиты…" : "Готовим грядки…"} />
        <SourceNotice>Каталог NASA недоступен, показываем кешированные данные от 09.11.2026.</SourceNotice>
        <NoDataPanel
          question="Для этой планеты не известна атмосфера — выбери вариант:"
          options={[
            { id: "earth_like", label: "Как Земля" },
            { id: "mars_like", label: "Как Марс" },
            { id: "none", label: "Нет атмосферы" },
          ]}
          onPick={() => {}}
        />
        <GlassPanel className="p-3">
          <DeadPlantCard
            crop="Картофель"
            when="сол 1"
            cause="температура −47 °C"
            suggestions={[
              <>купол: <Num value={45} unit="°C" digits={0} /> к ночному минимуму</>,
              <>LED: <Num value={300} unit="мкмоль/м²/с" digits={0} /></>,
            ]}
            retryLabel="Попробовать снова с куполом"
            onRetry={() => {}}
          />
        </GlassPanel>
      </Section>

      <Section title="Сворачиваемая панель">
        <CollapsiblePanel title="Фильтры" icon={Filter}>
          <p className="text-sm text-fg-muted">Содержимое панели. Кнопка справа сворачивает её в иконку.</p>
        </CollapsiblePanel>
        <CollapsiblePanel title="Планета" icon={Globe2} defaultOpen={false}>
          <p>Скрыто</p>
        </CollapsiblePanel>
      </Section>
    </div>
  );
}

/** Design-system showcase: every component in both moods (docs/DESIGN.md §5). */
export default function DevUi() {
  const mars = useQuery({
    queryKey: ["scene", "planet", "mars"],
    queryFn: async () => (await api.GET("/scene/planet/{planet_id}", { params: { path: { planet_id: "mars" } } })).data ?? null,
    staleTime: Infinity,
  });
  const sky = mars.data ? `linear-gradient(180deg, ${mars.data.sky_day} 0%, ${mars.data.sky_horizon} 60%, ${mars.data.ground} 100%)` : "var(--soil)";
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div data-mood="space" className="bg-void p-4 sm:p-6">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-[0.12em] text-fg-muted">/dev/ui · data-mood="space"</p>
          <h1 className="font-head text-[28px] font-semibold tracking-[var(--title-tracking)]">Космос</h1>
        </header>
        <Showcase mood="space" />
      </div>
      <div data-mood="garden" className={cn("p-4 sm:p-6")} style={{ background: sky }}>
        <header className="mb-6">
          <GlassPanel strong className="w-fit px-3 py-2">
            <p className="text-xs uppercase tracking-[0.12em] text-fg-muted">/dev/ui · data-mood="garden" · фон — небо Марса из API</p>
            <h1 className="font-head text-[28px] font-semibold text-fg">Огород</h1>
          </GlassPanel>
        </header>
        <Showcase mood="garden" />
        <div className="fixed bottom-6 right-6 z-40">
          <ToastStack />
        </div>
      </div>
    </div>
  );
}
