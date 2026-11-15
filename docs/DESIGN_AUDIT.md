# Аудит визуального стиля перед дизайном v2 (docs/DESIGN.md §10.1)

Снимки «до»: [docs/screenshots/design/before/](screenshots/design/before/), все экраны на 1440×900 и 390×844:
- `1-fields` — поля;
- `1b-passport` — паспорт;
- `2-builder` — конструктор;
- `3-summary` — итог;
- `4-reference` — «Откуда цифры»;
- `5-expert` — режим эксперта;
- `6-devui` — витрина компонентов.

Область аудита — продукт про поле: `builder/`, `reference/`, `farm/` (режим эксперта), `ui/`, `map/`, `i18n/`, `pages/DevUi.tsx`, `main.tsx`, `index.css`, `styles/`. «Лаборатория» (`explore/`, `plants/`, `components/OrbitScene|PlanetPicker`, `pages/Catalog|Compare|PlanetCard|Simulator`) — отдельный раздел, ей можно оставаться тёмной (§7).

## Что найдено (по §0)

### 1. Стекло, свечение, градиенты
| Приём | Где |
|---|---|
| Полупрозрачные «стеклянные» панели `GlassPanel` (`bg-panel` = rgba(…, 0.86)) с размытием фона `backdrop-blur` | `ui/primitives.tsx` (`GlassPanel`), используется на всех экранах: `builder/FieldsHome`, `BuilderPage`, `Summary`, `Story`, `reference/ReferencePage`, `farm/FieldPage`, `ui/data|states|time`, `pages/DevUi` |
| Токен свечения `--accent-glow`, класс `bg-glow` (подсветка ячейки при перетаскивании, выбранный столбец справочника, чипы замены) | `styles/tokens.css`, `index.css` (`--color-glow`), `builder/Timeline.tsx`, `reference/ReferencePage.tsx`, `farm/CompareView.tsx`, `ui/data.tsx`, `ui/time.tsx` |
| Градиенты | `pages/DevUi.tsx` (образцы); в продукте — только в Лаборатории (`explore/garden/toon.ts`) |
| Плавная интерполяция «настроения» space/garden за 600 мс через `@property` | `styles/tokens.css` |

### 2. Тёмный «космический» фон с одним неоновым акцентом
| Приём | Где |
|---|---|
| Все экраны поля на `--bg-void #05070d` с одним оранжевым акцентом `#ffb86b` (`data-mood="garden"`) | `builder/FieldsHome`, `BuilderPage`, `Summary`, `reference/ReferencePage`, `farm/FieldPage` |
| Семантические цвета неоновые: `--ok #5be3a6`, `--lethal #ff6b6b`, `--stress #ffc857`, «данные» `#7cc4ff`, «оценка» `#c3a6ff`, «гипотеза» `#ff9ec7` | `styles/tokens.css` |
| Тёмная карта на весь экран под стеклянными панелями | `map/FieldMap.tsx` в `FieldsHome` и `farm/FieldPage` |
| Параллельно живёт вторая, «светлая» палитра (`--page`, `--accent #2a78d6` …) без связи с первой | `index.css` |

### 3. Одинаковые скруглённые карточки с мягкой тенью
| Приём | Где |
|---|---|
| Радиусы 16 px у панелей и 12 px у кнопок (garden) | `--radius-panel`, `--radius-control` |
| Тень панели `--shadow-panel: 0 8px 32px`, `shadow-lg` у титров, истории и «призрака» карточки | `styles/tokens.css`, `ui/primitives.tsx`, `builder/Captions.tsx`, `builder/Story.tsx`, `builder/BuilderPage.tsx` |
| Экран нарезан на одинаковые плитки: 4 карточки демо-полей, 4 плитки индикаторов, 4 карточки паспорта, 4 карточки «Ваш план», плитки колоды | `builder/FieldsHome`, `Indicators`, `Summary`, `Timeline` (`DeckCard`) |
| Пилюли `rounded-full` повсюду: чипы приоритетов, замены, полив, бейджи, точки, маячки | 19 файлов, напр. `builder/Timeline`, `IrrigationPills`, `Beacon`, `FieldsHome`, `ui/primitives`, `ui/data`, `ui/states`, `ui/time`, `farm/*` |

### 4. Типографика «как у всех»
| Приём | Где |
|---|---|
| Моноширинный JetBrains Mono для всех цифр (`font-num`, `.font-data`) | `styles/tokens.css`, `index.css`, `builder/BuilderPage`, `LocalPrices`, `reference/ReferencePage`, `ui/format`, `ui/time`, `ui/charts`, `farm/*` |
| Space Grotesk для заголовков, Inter для текста — нет таджикских ғ ӣ қ ӯ ҳ ҷ в Space Grotesk; системный шрифт в `body` | `main.tsx`, `styles/tokens.css`, `index.css` |
| Подписи КАПСОМ с разрядкой (`uppercase tracking-…`) | `ui/primitives`, `ui/data`, `ui/states`, `ui/Logo`, `farm/FieldPage` («ДЕМО-ПОЛЯ», «ТАДЖИКИСТАН»), `farm/DataCard`, `farm/HistoryView`, `farm/CompareView`, `farm/RotationTry`, `pages/DevUi` |
| Строки «A · B · C» | шапка экрана 1 («WhatCropNext · планировщик … · режим эксперта · Откуда цифры»), подписи карточек колоды («вода: … · старт ≈ $»), шапка конструктора, плашка снимка, экран эксперта («14,5 га · 38.530°, 68.400°») |
| «→» в кнопках и ссылках | «Итог →», «Собрать план →», «Что сеять? →» (иконка `ArrowRight`), «← все поля», «← к полям» |

### 5. Эмодзи и «магия»
| Приём | Где |
|---|---|
| Эмодзи как иконки: 💧 💰 🌱 ⚠ 🛡 🌡 🏜 🔥 🎲 ☀ 🟫 ❄ ⛰ 🛰 🧂 ⏱ 🧪 🚰 🐛 🌾 🥀 и эмодзи культур в колоде | `builder/store.ts`, `Indicators`, `rules.ts` (`CROP_ICON`), `Timeline`, `Summary`, `FieldsHome`, `FieldView`, `SoilReserve`, `ui/time.tsx`, `i18n/*.json`; на сервере — подписи приоритетов «💧 Вода» (`backend/app/rotation/advice.py`) |
| «Магическая» кнопка «✨ Подобрать лучший план» с иконкой `Sparkles`, карточки «прилетают» | `builder/BuilderPage.tsx`, `i18n/*.json` |
| «Дышащие» маячки `animate-ping`, мерцание `animate-pulse` при загрузке, вход панелей со сдвигом `panel-in` | `builder/Beacon`, `FieldsHome`, `FieldImage`, `FieldView`, `Indicators`, `Captions`, `reference/ReferencePage`, `ui/primitives` |
| Неоновые цвета вместо hex-токенов: 126 hex-значений вне токенов | `index.css`, `styles/tokens.css` (сцена Лаборатории), `components/OrbitScene`, `explore/lib/tokens` |

### 6. Чего нет, хотя продукт про почву
- Почва на конструкторе — изометрический 2.5D-участок (`builder/FieldView.tsx`). Цвет почвы там — два произвольных тона (`--field-soil-rich/poor`), а не шкала. Разреза, горизонтов и корней нет.
- «Запас почвы» — отдельный мини-график (`builder/SoilReserve.tsx`), не связан с полем.
- Оценки отмечены цветными бейджами (`reference/ReferencePage`, `farm/*`), а не пунктиром или штриховкой.
- Итог — тёмная страница из плиток. Как распечатку агронома её читать нельзя. Печать в PDF перекрашивается через `print:` классы.

## План правок (§11)
1. Новые токены: бумага, чернила, Манселл 10YR, семенные цвета семейств, четыре сигнала. Шрифты Golos Text и Literata, проверка таджикских глифов. `scripts/design-lint.ts` в `make lint`.
2. Пиктограммы `ui/icons/` и базовые компоненты (панель-лист, кнопка 4 px, тумблер полива), `/dev/ui`.
3. План поля с почвенным разрезом — SVG вместо 2.5D-участка и мини-графика.
4. Экраны 1–3 и PDF; Лаборатория остаётся тёмной, но её не трогаем без нужды.
5. Тексты §9, прогон линтера, снимки «после», чек-лист §10.3.

Старый `DESIGN.md` уже заменён новым, копии v1 в репозитории нет, поэтому `docs/archive/DESIGN_v1.md` не создавался.
