# WhatCropNext

**What to plant next** — a crop rotation planner for a real field, built on NASA data.

Pick a field on the map and the system pulls 20 years of NASA POWER weather, SoilGrids soil data, terrain and MODIS imagery. It shows the vulnerable periods (bare soil, heat, drought, frost) and compares 3–5-year crop rotation schemes against your priorities — with uncertainty ranges, a climate stress test and an honest list of data gaps. It is a decision-support tool, not a replacement for an agronomist.

NASA Space Apps Challenge 2026 · Dushanbe · Challenge: **Field Shift — Adapting Farms with NASA Data**
Team **GoAndWin**: Saifiddinzoda Amirhamza · Khushdil Saidov · Mukhamedzhanov Ismat

Live demo: https://frontend-production-ca7a5d62.up.railway.app/
Русская версия: [README.ru.md](README.ru.md)

## Run

Requires `uv`, Node.js and `make`.

```bash
make install
make ingest        # download NASA and PHL catalogs (offline: cache and snapshot are used)
make dev-backend   # API at http://localhost:8000, docs at /docs
make dev-frontend  # UI at http://localhost:5173
```

With Docker: `make up`, the UI opens at http://localhost:8080.

## What you can do

The site opens with a **landing page** (`/`, [docs/LANDING.md](docs/LANDING.md)): choose one of four fields or draw your own on a satellite map. Next comes the **"What to sow?" builder**: a living field where you drop seed packets onto strips; plants, the soil profile and four gauges (water, money, soil health, risk) update instantly. There are "Suggest a plan", "Live through 4 years", a weather die, "20 years of weather", a month-by-month time machine and "What if…" scenarios for a harsher climate. The result is **"Your plan"** with key findings and what to check on site. On the first visit to the Hissar field a short story of farmer Karim is shown (`?story=1` to show it again).

The **field passport** shows a **Sentinel-2 image** (fresh if the field is cloud-free, otherwise a cloudless mosaic or a saved image — the screen works without internet) and "Then and now": how heat, rainfall and frost changed over 20 years. The builder includes irrigation type, budget and labor, a year-by-year **"Soil reserve"**, "What to swap?" for bad combinations, a salinization warning and live captions during playback; the final plan supports your own market price and a work calendar.

The interface is in **three languages — RU / EN / TG** (switch in the header; Tajik is partial). **"ⓘ Where the numbers come from"** (`/reference`) lists every crop parameter with its source or an "estimate" label, with search and CSV export.

A 5–7-minute demo script: [docs/DEMO.md](docs/DEMO.md).

**Hidden sections.** "Expert mode" (tables, charts and terms, `/expert/fields`) and the "Lab" (plants on other planets: 3D journey, garden, planet catalog, simulator, comparison) are hidden on the public site; the code remains and is enabled at build time with `VITE_FEATURE_EXPERT=true`, `VITE_FEATURE_SPACE_LAB=true` (see `frontend/src/flags.ts`).

Design: the living field ([docs/DESIGN_V3.md](docs/DESIGN_V3.md)); recordings — [drag and drop](docs/screenshots/design/v3/drag.gif), ["Live through 4 years"](docs/screenshots/design/v3/live-4-years.gif). Screenshots: [stage 9 in three languages](docs/screenshots/stage9/), [fields and rotation](docs/screenshots/rotation/), [simulator](docs/screenshots/simulator/), [design](docs/screenshots/design/). The visual style is a "field journal" ([docs/DESIGN.md](docs/DESIGN.md)): paper and ink, soil color on the Munsell scale, a field plan with a soil profile; components at `/dev/ui`, `node scripts/design-lint.ts` runs as part of `make lint`. Audit and before/after pairs: [docs/DESIGN_AUDIT.md](docs/DESIGN_AUDIT.md).

Optional: `EARTHDATA_TOKEN` in `.env` for NASA Earthdata layers (not connected yet, see `docs/BLOCKERS.md`); `ANTHROPIC_API_KEY` for plan explanations written by Claude instead of templates (the numbers in them are still checked).

## Commands

| Command | What it does |
|---|---|
| `make test` | backend and frontend tests |
| `make lint` | ruff, mypy, frontend type check |
| `make openapi` | regenerate API client types |
| `make e2e` | browser "liveness" check of screen 2 (servers must be running) |
| `make precompute` | save images and advice for demo fields (offline demo) |
| `make snapshot` | refresh the offline snapshot of real planets in `data/seed` |

## How to read the results

- **Yield** in tables is a percentage of the yield under good conditions on Earth and never exceeds 100%. The garden report also has "% of normal" — relative to the same season without events or farmer actions; irrigation above the norm can give more than 100%.
- **Confidence** decreases with every assumption. The list of assumptions is shown next to the result.
- **Estimates.** Crop physiology parameters are currently expert estimates (`estimate=true`), so results are suitable for comparing options, not for exact forecasts.

Details: [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md), [docs/DECISIONS.md](docs/DECISIONS.md), [docs/PROGRESS.md](docs/PROGRESS.md), [docs/INTERACTIVE.md](docs/INTERACTIVE.md), [docs/SIMULATOR.md](docs/SIMULATOR.md), [docs/ROTATION.md](docs/ROTATION.md), [docs/CREDITS.md](docs/CREDITS.md).

Updating data through the API requires the `ASTROCROP_ADMIN_TOKEN` variable and the `X-Admin-Token` header.

## AI Use Disclosure

This project was built with the help of Super Intelligence (SI) tools, as allowed by the NASA Space Apps Challenge rules.

- **Code:** Most of the source code (Python/FastAPI backend, React/TypeScript frontend, SVG graphics, Docker setup) was generated with **Claude (Anthropic)** from prompts written by our team. The team designed the concept, wrote the prompts, reviewed, tested and adjusted the generated code, and chose all data sources and model logic.
- **SI inside the product:** if `ANTHROPIC_API_KEY` is set, plan explanations are written by Claude instead of templates; the numbers in them are checked against the model.
- **Text:** UI texts, documentation and translations (English, Russian, Tajik) were drafted and edited with Claude.
- **Presentation:** slides and illustrations were created with AI assistance (Claude) and are marked as such on every slide.
- **Data:** all numbers come from the open datasets listed below, not from AI. Parameters without a published source are labeled "estimate" in the app.

No NASA logos, flags, mission identifiers or other NASA branding were generated or modified with SI tools.

## Data Sources & Attribution

Full list: [docs/CREDITS.md](docs/CREDITS.md).

- **NASA POWER** — 20 years of daily weather (https://power.larc.nasa.gov/)
- **MODIS MOD13Q1 NDVI** and **NASA GIBS** MODIS layers
- **Sentinel-2** imagery — contains modified Copernicus Sentinel data 2026 (ESA / Copernicus)
- **Sentinel-2 cloudless** — https://s2maps.eu by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024)
- **SoilGrids** — ISRIC World Soil Information
- **AWS Terrain Tiles** — elevation and slope
- **FAO-56** (Irrigation and Drainage Paper 56) and **FAO EcoCrop**
- **World Bank** Commodity Price Data
- Lab mode only (hidden on the public site): NASA Exoplanet Archive, NASA Planetary Fact Sheet, NASA JPL Solar System Dynamics, PHL Habitable Worlds Catalog, Solar System Scope textures (CC BY 4.0)
