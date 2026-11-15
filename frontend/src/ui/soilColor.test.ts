import { describe, expect, it } from "vitest";
import { CROP_FAMILY, FAMILY_COLOR } from "./crops";
import { soilColor, soilPosition, soilStep } from "./soilColor";

describe("Munsell soil colour (docs/DESIGN.md §2.2)", () => {
  it("more organic carbon is never lighter", () => {
    let prev = -1;
    for (let c = 0; c <= 4; c += 0.05) {
      const p = soilPosition(c);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
  it("reads the chart at its anchors", () => {
    expect(soilStep(0.3)).toBe(1);
    expect(soilStep(1.5)).toBe(3);
    expect(soilStep(2.2)).toBe(4);
    expect(soilStep(3.5)).toBe(5);
    expect(soilColor(1.3)).toBe("var(--soil-3)");
    expect(soilColor(5)).toBe("var(--soil-5)");
  });
  it("a small change in carbon still moves the colour (Hissar 1.51 → 1.43 %)", () => {
    expect(soilColor(1.51)).not.toBe(soilColor(1.43));
    expect(soilColor(1.51)).toMatch(/color-mix\(in oklab, var\(--soil-4\) \d+%, var\(--soil-3\)\)/);
  });
  it("every crop has a seed-packet colour", () => {
    for (const fam of Object.values(CROP_FAMILY)) expect(FAMILY_COLOR[fam]).toMatch(/^var\(--crop-/);
  });
});
