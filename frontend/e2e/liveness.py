"""Liveness check of screen 2 (docs/DESIGN_V3.md §3).

After a seed packet is thrown onto a strip of the field, within 700 ms:
  (a) the plants on that strip change,
  (b) the topsoil horizon of the soil profile changes,
  (c) at least one instrument moves.

Needs the app running (make dev-backend + make dev-frontend, or `make up` with E2E_URL).
Run: make e2e    (uv run --with playwright python frontend/e2e/liveness.py)
"""

from __future__ import annotations

import os
import sys

from playwright.sync_api import sync_playwright

URL = os.environ.get("E2E_URL", "http://localhost:5173")
EXE = os.environ.get("E2E_CHROMIUM")  # optional: a local headless shell

STATE = """() => {
  const strip = document.querySelector('svg polygon[aria-label="Год 2"]');
  const plants = strip ? strip.parentElement.innerHTML.length + ':' + strip.parentElement.querySelectorAll('g').length : '';
  const horizon = [...document.querySelectorAll('figure rect.soil-horizon')].map((r) => r.getAttribute('height') + r.getAttribute('fill')).join('|');
  const water = document.querySelector('svg[aria-label="Вода"] g rect')?.getAttribute('y') ?? '';
  const coins = document.querySelectorAll('svg[aria-label="Деньги"] ellipse').length;
  const needle = document.querySelector('svg[aria-label="Риск"] g')?.getAttribute('style') ?? '';
  const soil = document.querySelector('svg[aria-label="Здоровье почвы"] rect:nth-of-type(2)')?.getAttribute('height') ?? '';
  return { plants, horizon, instruments: [water, coins, needle, soil].join('#') };
}"""


def main() -> int:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=EXE) if EXE else p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        ctx.add_init_script("localStorage.setItem('astrocrop.lang','ru');localStorage.setItem('astrocrop.story','[\"tj-hissar\"]');")
        g = ctx.new_page()
        g.goto(f"{URL}/fields/tj-hissar/plan")
        g.wait_for_timeout(4000)
        g.locator("button", has_text="Как сажают сейчас").first.click()
        g.wait_for_timeout(4000)
        before = g.evaluate(STATE)
        src = g.locator("[aria-label^='Нут:']").first
        dst = g.locator('svg polygon[aria-label="Год 2"]').first
        src.scroll_into_view_if_needed()
        sb = src.bounding_box()
        g.mouse.move(sb["x"] + 30, sb["y"] + 40)
        g.mouse.down()
        g.mouse.move(sb["x"] + 50, sb["y"] + 20, steps=4)
        dst.scroll_into_view_if_needed()
        tb = dst.bounding_box()
        g.mouse.move(tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] / 2, steps=12)
        g.mouse.up()
        g.wait_for_timeout(700)
        after = g.evaluate(STATE)
        b.close()
    checks = {k: before[k] != after[k] for k in ("plants", "horizon", "instruments")}
    for k, ok in checks.items():
        print(f"{'ok ' if ok else 'FAIL'} {k} changed within 700 ms")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
