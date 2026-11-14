import { cn } from "@/lib/utils";

const v = (name: string) => `var(--ill-${name})`;

/** Procedural crop glyphs drawn in code (no emoji, no image assets), coloured from tokens. */
export function CropGlyph({ id, className = "size-7" }: { id: string; className?: string }) {
  const shapes: Record<string, React.ReactNode> = {
    potato: (
      <>
        <ellipse cx="16" cy="20" rx="9" ry="6.5" fill={v("tuber")} />
        <circle cx="12" cy="19" r="0.9" fill={v("tuber-eye")} />
        <circle cx="18" cy="22" r="0.9" fill={v("tuber-eye")} />
        <path d="M16 13 C14 8 10 7 9 8 C11 10 13 11 16 13 Z M16 13 C18 8 22 7 23 8 C21 10 19 11 16 13 Z" fill={v("leaf")} />
      </>
    ),
    lettuce: (
      <>
        <circle cx="16" cy="18" r="9" fill={v("leaf")} />
        <path d="M9 17 Q16 9 23 17 Q16 13 9 17Z" fill={v("leaf-light")} />
        <circle cx="16" cy="19" r="4" fill={v("leaf-light")} />
      </>
    ),
    spinach: (
      <>
        <ellipse cx="11" cy="16" rx="4" ry="8" fill={v("leaf-dark")} transform="rotate(-25 11 16)" />
        <ellipse cx="21" cy="16" rx="4" ry="8" fill={v("leaf-dark")} transform="rotate(25 21 16)" />
        <ellipse cx="16" cy="14" rx="4" ry="9" fill={v("leaf")} />
      </>
    ),
    wheat: (
      <>
        <path d="M16 28 V8" stroke={v("stalk")} strokeWidth="1.5" />
        {[9, 12, 15, 18].map((y) => (
          <g key={y}>
            <ellipse cx="14" cy={y} rx="2" ry="1.4" fill={v("grain")} />
            <ellipse cx="18" cy={y} rx="2" ry="1.4" fill={v("grain")} />
          </g>
        ))}
      </>
    ),
    rice: (
      <>
        <path d="M14 28 Q15 12 22 8" stroke={v("pod")} strokeWidth="1.5" fill="none" />
        {[10, 13, 16, 19].map((y, i) => (
          <ellipse key={y} cx={20 - i * 1.2} cy={y} rx="1.4" ry="2" fill={v("bean")} />
        ))}
      </>
    ),
    tomato: (
      <>
        <circle cx="16" cy="18" r="9" fill={v("tomato")} />
        <path d="M11 11 L16 13 L21 11 L18 14 L16 12 L14 14 Z" fill={v("leaf-dark")} />
      </>
    ),
    soybean: (
      <>
        <path d="M8 22 Q16 6 24 12 Q18 22 8 22Z" fill={v("pod")} />
        <circle cx="13" cy="18" r="2" fill={v("bean")} />
        <circle cx="17" cy="15.5" r="2" fill={v("bean")} />
      </>
    ),
    pea: (
      <>
        <path d="M6 20 Q16 8 26 14 Q16 24 6 20Z" fill={v("leaf")} />
        {[11, 15, 19].map((x) => (
          <circle key={x} cx={x} cy={17 - (x - 11) * 0.3} r="1.9" fill={v("leaf-light")} />
        ))}
      </>
    ),
    radish: (
      <>
        <circle cx="16" cy="20" r="6.5" fill={v("root")} />
        <path d="M16 26.5 L16 30" stroke={v("root-tip")} strokeWidth="1.2" />
        <path d="M16 13 C13 7 9 7 9 9 C11 11 13 12 16 13 Z M16 13 C19 7 23 7 23 9 C21 11 19 12 16 13Z" fill={v("leaf")} />
      </>
    ),
    spirulina: (
      <>
        <rect x="6" y="10" width="20" height="16" rx="3" fill={v("algae")} />
        <path d="M9 18 q2 -3 4 0 t4 0 t4 0 t4 0" stroke={v("algae-light")} strokeWidth="1.3" fill="none" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 32 32" className={cn(className)} aria-hidden>
      {shapes[id] ?? <circle cx="16" cy="16" r="9" fill={v("leaf")} />}
    </svg>
  );
}
