import * as THREE from "three";

/**
 * Colour of a black body at `teffK` (Tanner Helland's fit to CIE data), used for stars:
 * the Sun is a warm white, M dwarfs orange-red, hot stars blue-white (docs/DESIGN.md §2.4).
 */
export function blackbodyColor(teffK: number | null | undefined): THREE.Color {
  const t = Math.min(Math.max(teffK ?? 5772, 1000), 40000) / 100;
  const clamp = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  const r = t <= 66 ? 1 : clamp(329.698727446 * (t - 60) ** -0.1332047592);
  const g = t <= 66 ? clamp(99.4708025861 * Math.log(t) - 161.1195681661) : clamp(288.1221695283 * (t - 60) ** -0.0755148492);
  const b = t >= 66 ? 1 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
}
