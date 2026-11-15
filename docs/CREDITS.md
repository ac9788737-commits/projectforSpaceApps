# Источники ассетов

## Текстуры планет
Карты Меркурия, Венеры (облака), Земли, Луны, Марса, Юпитера, Сатурна (и колец), Урана и Нептуна: **Solar System Scope** — https://www.solarsystemscope.com/textures/ — лицензия **CC BY 4.0** (Attribution 4.0 International), основаны на данных NASA. Файлы: `frontend/public/textures/2k_*.jpg`, `2k_saturn_ring_alpha.png`.

Титан, Европа, Энцелад, экзопланеты и гипотетические миры — процедурные текстуры из палитр (`frontend/src/explore/lib/planetTexture.ts`).

## Шрифты (SIL Open Font License 1.1, через @fontsource)
- **Golos Text** — текст, интерфейс и цифры, таблички на грядках Лаборатории. © The Golos Text Project Authors (Paratype).
- **Noto Serif** — заголовки экранов и название поля. © Google LLC / The Noto Project Authors.

## Прочее
- Галактики, звёздное небо, грунт, декор огорода и растения генерируются кодом; фон звёзд — компонент `Stars` из `@react-three/drei` (MIT).
- Иконки интерфейса — `lucide-react` (ISC); пиктограммы культур, погоды и работ — свой набор «штампов полевого журнала» (`frontend/src/ui/icons/`); логотип — `frontend/src/ui/Logo.tsx`.

## Спутниковые снимки (этап 9)
- **Sentinel-2 L2A** через Earth Search (Element 84) — «Contains modified Copernicus Sentinel data <год>», подпись выводится под снимком.
- **Sentinel-2 cloudless 2024** от EOX IT Services GmbH — лицензия CC BY-NC-SA 4.0 (некоммерческое использование); атрибуция «Sentinel-2 cloudless — https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)».
- **NASA GIBS** (MODIS Terra Corrected Reflectance) — запасная мозаика, данные NASA EOSDIS.
- `i18next` и `react-i18next` — MIT.

## Дизайн
- Структура цветовой системы (два слоя: палитры и роли), правила радиусов, движения и рамок — **elayadesign/ai-design-skills** (MIT), https://github.com/elayadesign/ai-design-skills. Сами зелёные палитры подобраны для WhatCropNext.
