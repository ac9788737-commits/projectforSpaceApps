import * as THREE from "three";
import { fbm, hashString } from "./noise";

const cache = new Map<string, THREE.CanvasTexture>();

function rgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
}

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t);
}

/**
 * Procedural equirectangular globe texture from a palette (no image assets).
 * Gas giants get latitude bands, rocky worlds blotches, ice caps where the palette has white.
 */
export function planetTexture(id: string, palette: string[], surfaceType: string | null, size = 256): THREE.CanvasTexture {
  const key = `${id}|${palette.join(",")}|${surfaceType}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const width = size * 2, height = size;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(width, height);
  const colors = palette.map(rgb);
  const seed = hashString(id) % 1000;
  const gas = surfaceType === "gas";
  const ocean = surfaceType === "ocean";
  for (let y = 0; y < height; y++) {
    const lat = (y / height - 0.5) * Math.PI;
    for (let x = 0; x < width; x++) {
      const lon = (x / width) * Math.PI * 2;
      const px = Math.cos(lat) * Math.cos(lon), py = Math.sin(lat), pz = Math.cos(lat) * Math.sin(lon);
      let color: number[];
      if (gas) {
        const turb = fbm(px * 3, py * 3, pz * 3, 4, seed) * 0.6;
        const band = Math.sin(py * 18 + turb * 6) * 0.5 + 0.5;
        const idx = band * (colors.length - 1);
        const i0 = Math.floor(idx);
        color = mix(colors[i0], colors[Math.min(i0 + 1, colors.length - 1)], idx - i0);
      } else {
        const n = fbm(px * 2.2 + 5, py * 2.2, pz * 2.2, 5, seed);
        const detail = fbm(px * 9, py * 9, pz * 9, 3, seed + 3);
        if (ocean) {
          color = n > 0.55 ? mix(colors[1], colors[2] ?? colors[1], (n - 0.55) * 3) : mix(colors[0], colors[0].map((v) => v * 0.7), 0.55 - n);
          const clouds = fbm(px * 4, py * 4 + 9, pz * 4, 4, seed + 7);
          if (clouds > 0.58) color = mix(color, [245, 247, 250], Math.min(1, (clouds - 0.58) * 4));
        } else {
          color = mix(colors[0], colors[1], Math.min(1, Math.max(0, (n - 0.35) * 2.5)));
          color = mix(color, colors[2] ?? colors[0], Math.max(0, detail - 0.6) * 1.5);
        }
        if (colors[3] && !ocean) {
          const cap = THREE.MathUtils.smoothstep(Math.abs(py), 0.9 - n * 0.06, 0.94 - n * 0.06);
          color = mix(color, colors[3], cap);
        } else if (colors[3] && Math.abs(py) > 0.9 - n * 0.05) color = colors[3];
      }
      const o = (y * width + x) * 4;
      image.data[o] = color[0];
      image.data[o + 1] = color[1];
      image.data[o + 2] = color[2];
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  cache.set(key, texture);
  return texture;
}

let dotTexture: THREE.Texture | null = null;

/** Soft round sprite for particles. */
export function softDot(): THREE.Texture {
  if (dotTexture) return dotTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.7)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(canvas);
  return dotTexture;
}
