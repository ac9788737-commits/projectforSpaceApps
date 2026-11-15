/**
 * Optional parts of the site, decided at build time.
 * Both are hidden by default: the site is the field planner (landing → field → plan → summary).
 *   VITE_FEATURE_SPACE_LAB=true — «Лаборатория»: planets, domes, exoplanets, the planet catalog,
 *                                 simulator and comparison (docs/INTERACTIVE.md, docs/SIMULATOR.md)
 *   VITE_FEATURE_EXPERT=true    — «Режим эксперта»: tables, charts and terms (/expert/fields)
 */
export const SPACE_LAB = import.meta.env.VITE_FEATURE_SPACE_LAB === "true";
export const EXPERT = import.meta.env.VITE_FEATURE_EXPERT === "true";
