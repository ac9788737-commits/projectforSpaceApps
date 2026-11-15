import type { SVGProps } from "react";

/**
 * Field-journal stamps (docs/DESIGN.md §5): 24 px grid, 1.5 px stroke, round ends, no fill,
 * drawn in currentColor. Crops, signals and work. Generic UI glyphs (close, undo) stay lucide.
 */
const PATHS = {
  // crops
  ear: "M12 22V4M12 2v2M12 8c-2.6-.3-3.6-2.2-3.4-4 2.3.2 3.4 2 3.4 4M12 8c2.6-.3 3.6-2.2 3.4-4-2.3.2-3.4 2-3.4 4M12 12.5c-2.6-.3-3.6-2.2-3.4-4 2.3.2 3.4 2 3.4 4M12 12.5c2.6-.3 3.6-2.2 3.4-4-2.3.2-3.4 2-3.4 4M12 17c-2.6-.3-3.6-2.2-3.4-4 2.3.2 3.4 2 3.4 4M12 17c2.6-.3 3.6-2.2 3.4-4-2.3.2-3.4 2-3.4 4",
  cob: "M12 3c2.6 0 3.8 4.4 3.8 8.6S14.3 20 12 20s-3.8-4.2-3.8-8.4S9.4 3 12 3ZM8.6 9h6.8M8.3 12.5h7.4M8.8 16h6.4M12 3.5v16M8.3 13c-2 2.4-2.4 6 .7 8.5M15.7 13c2 2.4 2.4 6-.7 8.5",
  pod: "M4 18c0-7 6.2-12.5 15-12.5 0 7-6.2 12.5-15 12.5ZM19 5.5 21 3M8.6 14.2a1.4 1.4 0 1 0 0-.01M12 11.6a1.4 1.4 0 1 0 0-.01M15.3 8.9a1.4 1.4 0 1 0 0-.01",
  trefoil: "M12 10.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM9.2 14.6a3 3 0 1 1-2.4-5.5 3 3 0 0 1 2.4 5.5ZM14.8 14.6a3 3 0 1 0 2.4-5.5 3 3 0 0 0-2.4 5.5ZM12 12c.4 3.4-.4 6.6-2 9.5",
  boll: "M12 13.5a3.3 3.3 0 0 1-3.4-5.4A3.3 3.3 0 0 1 12 4a3.3 3.3 0 0 1 3.4 4.1 3.3 3.3 0 0 1-3.4 5.4ZM8.6 8.1a3.4 3.4 0 0 0-1.8 6.4M15.4 8.1a3.4 3.4 0 0 1 1.8 6.4M6.5 14.5 12 18l5.5-3.5M12 18v4",
  tuber: "M6.2 9.2C6 5.3 10.6 4 14.8 4.8c4 .8 5.6 5.5 3.6 9.6-2 4.3-8.8 5.8-11.3 2.6-1.4-1.8-.8-4.3-.9-7.8ZM10.5 9.5h.01M14.5 8.5h.01M13.5 13.5h.01M9.5 14.5h.01",
  tomato: "M12 21a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM12 7V4M8.5 6.5 12 8.6l3.5-2.1M9.6 4.8 12 7l2.4-2.2",
  sunflower: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 9V3.5M12 15v5.5M9 12H3.5M15 12h5.5M9.9 9.9 6 6M14.1 14.1 18 18M14.1 9.9 18 6M9.9 14.1 6 18",
  mustard: "M12 9.5a2.4 2.4 0 1 1 0-4.8 2.4 2.4 0 0 1 0 4.8ZM12 14.3a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8ZM9.6 12a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0ZM14.4 12a2.4 2.4 0 1 0 4.8 0 2.4 2.4 0 0 0-4.8 0Z",
  phacelia: "M6 21c0-8 4-12.5 9-12.5 3 0 4.2 2.8 2.4 4.3-1.6 1.3-3.4 0-2.6-1.6M15.5 6a1.3 1.3 0 1 0 0-.01M10 9.5a1.3 1.3 0 1 0 0-.01M7.3 14a1.3 1.3 0 1 0 0-.01M19.5 9.5a1.3 1.3 0 1 0 0-.01",
  sprout: "M12 21v-9M12 14c0-4-3-6.5-7-6.5 0 4 3 6.5 7 6.5ZM12 12c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5ZM5 21h14",
  // signals and resources
  drop: "M12 3S6 10 6 14a6 6 0 0 0 12 0c0-4-6-11-6-11Z",
  coin: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM14.5 9.3c-.5-.8-1.4-1.3-2.5-1.3-1.5 0-2.6.8-2.6 2s1.1 1.6 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.1 0-2-.5-2.5-1.3M12 6.5V8M12 16v1.5",
  shovel: "M12 2v11M9.5 2h5M8 13h8v3a4 4 0 0 1-8 0v-3ZM3 21.5h3M18 21.5h3",
  shield: "M12 3 19 6v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3ZM12 8v5M12 16v.01",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8",
  snowflake: "M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5M3.9 10.2l3.4.8-1 3.4M20.1 13.8l-3.4-.8 1-3.4M6.3 9.6 7.3 13M17.7 14.4 16.7 11",
  rain: "M7 15a4 4 0 0 1 .4-8A5 5 0 0 1 17 8.5a3.3 3.3 0 0 1 0 6.5H7ZM8.5 18l-1 3M12.5 18l-1 3M16.5 18l-1 3",
  tap: "M3 8h9a4 4 0 0 1 4 4v2M8 8V5M5.5 5h5M16 17.5c0 .9-.6 1.5-1.2 1.5s-1.3-.6-1.3-1.5c0-1 1.3-2.5 1.3-2.5s1.2 1.5 1.2 2.5ZM3 11h9",
  tractor: "M8 21a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM18 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM4.5 13.5V7h6l2.2 6M12.7 13H20v4.5M7 7V4h3",
  person: "M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM12 10v6M7.5 12.5h9M12 16l-3 6M12 16l3 6",
  salt: "M12 3 19 7v8l-7 4-7-4V7l7-4ZM5 7l7 4 7-4M12 11v8",
  thermometer: "M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0ZM12 16.5V9",
  calendar: "M4 6h16v15H4V6ZM4 10h16M8 3v5M16 3v5",
  satellite: "M9 9 15 15M5.5 12.5l7-7 3 3-7 7-3-3ZM12.5 5.5l2-2M5.5 12.5l-2 2M15 15l2.5 2.5M15.5 21a5.5 5.5 0 0 0 5.5-5.5",
  plough: "M3 6h8l3 7H5M14 13l3.5 5.5H21M3 21h18",
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Which stamp stands for each crop of the deck (§5: crops are drawn, never emoji). */
export const CROP_GLYPH: Record<string, IconName> = {
  wheat: "ear",
  winter_wheat: "ear",
  barley: "ear",
  rye_cover: "ear",
  maize: "cob",
  pea: "pod",
  chickpea: "pod",
  soybean: "pod",
  vetch: "pod",
  alfalfa: "trefoil",
  clover: "trefoil",
  cotton: "boll",
  potato: "tuber",
  tomato: "tomato",
  sunflower: "sunflower",
  mustard: "mustard",
  phacelia: "phacelia",
};

export function CropGlyph({ crop, size = 20, className }: { crop: string; size?: number; className?: string }) {
  return <Icon name={CROP_GLYPH[crop] ?? "sprout"} size={size} className={className} />;
}
