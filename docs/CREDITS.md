# Источники ассетов

## Текстуры планет
Карты Меркурия, Венеры (облака), Земли, Луны, Марса, Юпитера, Сатурна (и колец), Урана и Нептуна: **Solar System Scope** — https://www.solarsystemscope.com/textures/ — лицензия **CC BY 4.0** (Attribution 4.0 International), основаны на данных NASA. Файлы: `frontend/public/textures/2k_*.jpg`, `2k_saturn_ring_alpha.png`.

Титан, Европа, Энцелад, экзопланеты и гипотетические миры — процедурные текстуры из палитр (`frontend/src/explore/lib/planetTexture.ts`).

## Шрифты (SIL Open Font License 1.1, через @fontsource)
- **Space Grotesk** — заголовки (латиница). © The Space Grotesk Project Authors.
- **Manrope** — кириллица в заголовках. © The Manrope Project Authors.
- **Inter** — интерфейс и таблички на грядках. © The Inter Project Authors.
- **JetBrains Mono** — цифры и данные. © The JetBrains Mono Project Authors.

## Прочее
- Галактики, звёздное небо, грунт, декор огорода и растения генерируются кодом; фон звёзд — компонент `Stars` из `@react-three/drei` (MIT).
- Иконки интерфейса — `lucide-react` (ISC); иконки культур — SVG, нарисованные в коде (`frontend/src/ui/CropIcon.tsx`); логотип — `frontend/src/ui/Logo.tsx`.
