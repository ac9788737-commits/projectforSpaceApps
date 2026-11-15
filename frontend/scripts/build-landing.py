"""Build the site's entry page from the designer's bundle (docs/LANDING.md).

The landing page was designed elsewhere and exported as one self-unpacking HTML file
(«index (5).html»). Its design is taken as is; this script only wires its buttons into the app:

  «Собрать план»      → /fields/<id>/plan
  «паспорт поля»      → /fields/<id>
  «Откуда цифры»      → /reference
  «Режим эксперта»    → /expert/fields
  «Готово» on the map → POST /api/fields with the drawn polygon → /fields/<new id>/plan
  language            → shared with the app (localStorage «astrocrop.lang»), English by default

Run: python frontend/scripts/build-landing.py "index (5).html"
Writes: frontend/public/landing.html (served at «/» by Vite and nginx).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "index (5).html"
OUT = ROOT / "frontend" / "public" / "landing.html"
IDS = ["tj-hissar", "us-iowa", "in-punjab", "ke-nakuru"]  # order of FIELDS in the design


def sub(text: str, old: str, new: str) -> str:
    if old not in text:
        raise SystemExit(f"design changed, cannot find: {old[:70]!r}")
    return text.replace(old, new, 1)


def wire(tpl: str) -> str:
    # data sources: our own reference page, in the same tab
    tpl = sub(tpl, '<a href="https://power.larc.nasa.gov/" target="_blank" rel="noopener" style=', '<a href="/reference" style=')
    # the language: read the app's key too, and write both
    tpl = sub(tpl, "const v = localStorage.getItem('astrocrop-lang');", "const v = localStorage.getItem('astrocrop.lang') || localStorage.getItem('astrocrop-lang');")
    tpl = sub(tpl, "try { localStorage.setItem('astrocrop-lang', L); } catch (e) {}", "try { localStorage.setItem('astrocrop-lang', L); localStorage.setItem('astrocrop.lang', L); } catch (e) {}")
    # demo field cards → the app
    tpl = sub(tpl, "flip: () => this.setState(s => ({ open: { ...s.open, [i]: !s.open[i] } })),", f"flip: () => {{ location.href = '/fields/' + {json.dumps(IDS)}[i]; }},")
    tpl = sub(tpl, "build: () => this.showToast(T.plan.replace('{x}', title)),", f"build: () => {{ location.href = '/fields/' + {json.dumps(IDS)}[i] + '/plan'; }},")
    # expert mode is a separate screen of the app
    tpl = sub(tpl, "toggleExpert: () => this.setState(s => ({ expert: !s.expert })),", "toggleExpert: () => { location.href = '/expert/fields'; },")
    # a drawn field is saved by the API and opened in the planner
    tpl = sub(
        tpl,
        "buildOwn: () => this.showToast(T.planOwn.replace('{x}', area < 10 ? area.toFixed(2) : area.toFixed(1))),",
        "buildOwn: async () => {"
        " const ring = this.pts.map(p => [p.lng, p.lat]); if (ring.length < 3) return; ring.push(ring[0]);"
        " const name = ({ ru: 'Моё поле', en: 'My field', tg: 'Майдони ман' })[lang] || 'Моё поле';"
        " try { const r = await fetch('/api/fields', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, geometry: { type: 'Polygon', coordinates: [ring] } }) });"
        " const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.detail || ('HTTP ' + r.status)); location.href = '/fields/' + j.id + '/plan'; }"
        " catch (e) { this.showToast(String(e.message || e)); } },",
    )
    # English first: a visitor who has not chosen a language sees the site in English
    tpl = sub(tpl, "} catch (e) {} return 'ru'; })(),", "} catch (e) {} return 'en'; })(),")
    tpl = sub(tpl, "<title>AstroCrop · Планировщик севооборота по данным NASA</title>", "<title>WhatCropNext · Crop rotation planner on NASA data</title>")
    # Leaflet race: a circleMarker added before its SVG renderer has measured the map throws
    # «Cannot read properties of undefined (reading 'x')» on every later pan, zoom and resize.
    # The corner points become plain DOM markers (same look), which need no renderer.
    tpl = sub(
        tpl,
        "this.pts.forEach(p => L.circleMarker(p, { radius: 5, color: '#000', weight: 2, fillColor: acc, fillOpacity: 1 }).addTo(this.vtx));",
        "this.pts.forEach(p => L.marker(p, { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7],"
        " html: '<span style=\"display:block;width:14px;height:14px;border-radius:50%;background:' + acc + ';border:2px solid #000;box-sizing:border-box\"></span>' }) }).addTo(this.vtx));",
    )
    # expert mode is hidden on the site (frontend/src/flags.ts): no toggle in the bar
    tpl = sub(tpl, '<button sc-camel-on-click="{{ toggleExpert }}" aria-pressed="{{ expert }}" style="all:unset;cursor:pointer;display:flex;', '<button sc-camel-on-click="{{ toggleExpert }}" aria-pressed="{{ expert }}" hidden style="all:unset;cursor:pointer;display:none;')
    # the project's name; the preloader animates it in two halves, the second in the accent colour
    tpl = tpl.replace("AstroCrop", "WhatCropNext")
    tpl = sub(tpl, 'transform:translateY(110%)">Astro</span>', 'transform:translateY(110%)">WhatCrop</span>')
    tpl = sub(tpl, 'transform:translateY(110%);color:var(--acc,#c8f560)">Crop</span>', 'transform:translateY(110%);color:var(--acc,#c8f560)">Next</span>')
    return tpl


def main() -> None:
    lines = SRC.read_text(encoding="utf-8").split("\n")
    idx = next(i for i, ln in enumerate(lines) if ln.strip() == '<script type="__bundler/template">') + 1
    tpl = json.loads(lines[idx])
    lines[idx] = json.dumps(wire(tpl), ensure_ascii=False).replace("/", "\\u002F")
    page = "\n".join(lines)
    # the bundle's own shell shows a title while it unpacks: English too
    page = page.replace("<title>AstroCrop · Планировщик севооборота по данным NASA</title>", "<title>WhatCropNext · Crop rotation planner on NASA data</title>", 1)
    OUT.write_text(page, encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
