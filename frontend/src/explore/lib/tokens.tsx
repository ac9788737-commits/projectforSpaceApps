import { useEffect, useState } from "react";
import * as THREE from "three";
import { useExplore } from "../store";

/**
 * Scene colours come from the CSS design tokens (docs/DESIGN.md §2), never from literals.
 * Values are read from the element carrying data-mood, so they follow space/garden.
 */
const NAMES = [
  "--accent",
  "--accent-glow",
  "--border-subtle",
  "--habitable",
  "--bg-void",
  "--leaf",
  "--soil",
  "--ok",
  "--stress",
  "--lethal",
  "--text-primary",
  "--text-secondary",
  "--scene-wood",
  "--scene-wood-dark",
  "--scene-metal",
  "--scene-glass",
  "--scene-led-pink",
  "--scene-led-violet",
  "--scene-room",
  "--scene-rover",
  "--scene-sign",
] as const;
export type TokenName = (typeof NAMES)[number];

export interface SceneToken {
  color: THREE.Color;
  opacity: number;
  css: string;
}

function parse(css: string): SceneToken {
  const value = css.trim();
  const rgba = value.match(/rgba?\(([^)]+)\)/);
  if (rgba) {
    const [r, g, b, a = "1"] = rgba[1].split(",").map((x) => x.trim());
    return {
      color: new THREE.Color().setRGB(+r / 255, +g / 255, +b / 255, THREE.SRGBColorSpace),
      opacity: +a,
      css: value,
    };
  }
  return { color: new THREE.Color(value || "#ffffff"), opacity: 1, css: value };
}

export function readTokens(): Record<TokenName, SceneToken> {
  const el = document.querySelector<HTMLElement>("[data-mood]") ?? document.documentElement;
  const style = getComputedStyle(el);
  return Object.fromEntries(NAMES.map((n) => [n, parse(style.getPropertyValue(n))])) as Record<TokenName, SceneToken>;
}

/** Tokens for 3D materials; refreshed after a mood change has finished animating. */
export function useSceneTokens(): Record<TokenName, SceneToken> {
  const mood = useExplore((s) => s.mood);
  const [tokens, setTokens] = useState(readTokens);
  useEffect(() => {
    setTokens(readTokens());
    const t = setTimeout(() => setTokens(readTokens()), 650);
    return () => clearTimeout(t);
  }, [mood]);
  return tokens;
}

/** Scene background from --bg-void. */
export function VoidBackground() {
  const tokens = useSceneTokens();
  return <color attach="background" args={[tokens["--bg-void"].color]} />;
}

/**
 * With post-processing (high quality) transparent overlays blend in linear light and come out
 * much brighter after the sRGB conversion; this keeps faint lines and rings equally faint.
 */
export function useSceneAlpha(): (alpha: number) => number {
  const quality = useExplore((s) => s.quality);
  return (alpha: number) => (quality === "high" ? alpha ** 2.2 : alpha);
}
