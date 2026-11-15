import { cva, type VariantProps } from "class-variance-authority";
import { ChevronLeft, ChevronRight, CircleCheck, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";
import { useId, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------- Panel (docs/DESIGN.md §4): a sheet of paper — flat, a rule line, no shadow, no blur ----------

export function Panel({ className, strong, ...props }: HTMLAttributes<HTMLDivElement> & { strong?: boolean }) {
  return <div className={cn("pointer-events-auto rounded-pnl border border-subtle text-fg", strong ? "bg-panel-strong" : "bg-panel", className)} {...props} />;
}

/** The Lab still imports the old name; it is the same flat panel now. */
export const GlassPanel = Panel;

/** Side panel that folds into an icon button (§4). */
export function CollapsiblePanel({
  title,
  icon: Icon,
  children,
  className,
  defaultOpen,
  side = "left",
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  side?: "left" | "right";
}) {
  // Side panels start folded on narrow screens so the centre of the scene stays free (§4).
  // On phones the panel lives inside the bottom sheet and is always shown expanded there.
  const [open, setOpen] = useState(
    () => defaultOpen ?? (typeof window === "undefined" || window.innerWidth >= 1280 || window.innerWidth <= 640),
  );
  const id = useId();
  if (!open) {
    return (
      <Button variant="secondary" size="icon" className="pointer-events-auto" onClick={() => setOpen(true)} aria-label={`Открыть панель «${title}»`} aria-expanded={false} aria-controls={id}>
        <Icon size={20} strokeWidth={1.5} />
      </Button>
    );
  }
  return (
    <Panel id={id} className={cn("w-full p-4 sm:w-80", className)}>
      <div className="mb-3 flex items-center gap-2">
        <Icon size={16} strokeWidth={1.5} className="text-fg-muted" aria-hidden />
        <h2 className="font-head text-sm font-semibold tracking-[var(--title-tracking)] text-fg">{title}</h2>
        <Button variant="ghost" size="icon" className="ml-auto -mr-2 -my-2" onClick={() => setOpen(false)} aria-label={`Свернуть панель «${title}»`} aria-expanded aria-controls={id}>
          {side === "left" ? <ChevronLeft size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
        </Button>
      </div>
      {children}
    </Panel>
  );
}

// ---------- Buttons (§4): 40 px, radius 4 px, ink on paper, no glow ----------

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-ctl text-sm font-medium transition-[background-color,color,border-color] duration-300 ease-[var(--ease-panel)] disabled:cursor-not-allowed disabled:opacity-40 select-none",
  {
    variants: {
      variant: {
        primary: "border border-accent bg-accent text-[var(--accent-ink)] hover:bg-[color-mix(in_oklab,var(--accent)_88%,var(--bg-panel))]",
        secondary: "border border-subtle bg-panel text-fg hover:border-[var(--text-secondary)] hover:bg-hover",
        ghost: "text-fg-muted hover:bg-hover hover:text-fg",
        /* the wheat accent: one main action on the dark green bar */
        accent: "border border-farm-accent bg-farm-accent text-[var(--primary-900)] hover:bg-[var(--accent-300)]",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-10 px-3 text-xs",
        icon: "h-10 w-10 shrink-0",
      },
      pressed: { true: "", false: "" },
    },
    compoundVariants: [
      { variant: "secondary", pressed: true, className: "border-accent bg-hover text-fg" },
      { variant: "ghost", pressed: true, className: "bg-hover text-fg" },
    ],
    defaultVariants: { variant: "secondary", size: "default", pressed: false },
  },
);

export function Button({
  className,
  variant,
  size,
  pressed,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      type="button"
      aria-pressed={pressed == null ? undefined : !!pressed}
      className={cn(buttonVariants({ variant, size, pressed }), className)}
      {...props}
    />
  );
}

// ---------- Status (§2.3): colour + icon + text ----------

export type Status = "ok" | "stress" | "lethal";
export const STATUS_META: Record<Status, { label: string; Icon: LucideIcon; text: string; bg: string }> = {
  ok: { label: "норма", Icon: CircleCheck, text: "text-ok", bg: "bg-ok" },
  stress: { label: "стресс", Icon: TriangleAlert, text: "text-stress", bg: "bg-stress" },
  lethal: { label: "смертельно", Icon: CircleX, text: "text-lethal", bg: "bg-lethal" },
};

export function StatusTag({ status, label }: { status: Status; label?: string }) {
  const { Icon, text, label: fallback } = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", text)}>
      <Icon size={14} strokeWidth={1.75} aria-hidden />
      {label ?? fallback}
    </span>
  );
}

// ---------- Data source (§2.3, §5 Data Row) ----------

export type Source = "real" | "estimate" | "hypothetical";
/** §2.5: measured values are solid, model estimates dashed — the mark, not a colour, carries it. */
export const SOURCE_META: Record<Source, { label: string; dot: string; text: string; border: string }> = {
  real: { label: "реальные данные", dot: "bg-fg", text: "text-fg", border: "border-solid border-fg" },
  estimate: { label: "оценка / модель", dot: "border border-dashed border-fg-muted", text: "text-fg-muted", border: "border-dashed border-fg-muted" },
  hypothetical: { label: "гипотетический мир", dot: "border border-dotted border-fg-muted", text: "text-fg-muted", border: "border-dotted border-fg-muted" },
};

/** Small mark (solid = data, dashed = estimate); hover or focus shows where the number comes from. */
export function SourceDot({ source, detail }: { source: Source; detail?: string }) {
  const meta = SOURCE_META[source];
  const tip = useId();
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-describedby={tip}
        aria-label={meta.label}
        className="-m-2.5 inline-flex size-[30px] cursor-help items-center justify-center rounded-ctl"
      >
        <span className={cn("size-2 rounded-[1px]", meta.dot)} />
      </button>
      <span
        role="tooltip"
        id={tip}
        className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 hidden w-max max-w-60 rounded-ctl border border-subtle bg-panel px-2.5 py-1.5 text-xs text-fg group-focus-within:block group-hover:block"
      >
        <span className={cn("font-medium", meta.text)}>{meta.label}</span>
        {detail && <span className="mt-0.5 block text-fg-muted">{detail}</span>}
      </span>
    </span>
  );
}

export function SourceBadge({ source, className }: { source: Source; className?: string }) {
  const meta = SOURCE_META[source];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-ctl border px-1.5 py-0.5 text-xs leading-4 whitespace-nowrap", meta.text, meta.border, className)}>
      {meta.label}
    </span>
  );
}

// ---------- Breadcrumbs (§5) ----------

export interface Crumb {
  label: string;
  onClick?: () => void;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  const last = items.length - 1;
  const back = items[last - 1];
  return (
    <nav aria-label="Уровни путешествия" className={cn("flex min-w-0 items-center", className)}>
      {/* Mobile: «← Марс» */}
      {back && (
        <button type="button" onClick={back.onClick} className="flex h-10 min-w-0 cursor-pointer items-center gap-1 rounded-ctl px-2 text-sm text-fg sm:hidden">
          <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
          <span className="truncate font-medium">{items[last].label}</span>
        </button>
      )}
      <ol className={cn("min-w-0 flex-wrap items-center text-sm", back ? "hidden sm:flex" : "flex")}>
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center">
            {i > 0 && <span className="px-1 text-fg-muted" aria-hidden>›</span>}
            {i === last || !item.onClick ? (
              <span aria-current={i === last ? "page" : undefined} className={cn("px-1.5", i === last ? "font-semibold text-fg" : "text-fg-muted")}>
                {item.label}
              </span>
            ) : (
              <button type="button" onClick={item.onClick} className="cursor-pointer rounded-ctl px-1.5 py-2 text-fg-muted transition-colors duration-[120ms] hover:text-fg">
                {item.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Title of the current object: 40–64 px, wide tracking in space (§3). */
export function ObjectTitle({ children, kicker, className }: { children: ReactNode; kicker?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      {kicker && <p className="mb-1 text-xs text-fg-muted">{kicker}</p>}
      <h1 className="font-head text-[28px] font-semibold leading-[1.05] tracking-[var(--title-tracking)] text-fg [overflow-wrap:anywhere] sm:text-[40px]">{children}</h1>
    </div>
  );
}
