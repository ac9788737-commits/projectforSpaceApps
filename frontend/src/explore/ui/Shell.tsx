import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button, GlassPanel } from "@/ui/primitives";

export function useIsMobile(): boolean {
  const query = "(max-width: 640px)";
  const [mobile, setMobile] = useState(() => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}

/** Four floating zones around a free centre (docs/DESIGN.md §4). Edge = 24 px / 12 px. */
export function TopZone({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-[var(--edge)] top-[var(--edge)] z-20 flex items-start gap-2">{children}</div>
  );
}

export function SideZone({ side, children, className }: { side: "left" | "right"; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-[calc(var(--edge)+64px)] z-20 flex max-h-[calc(100dvh-var(--edge)*2-64px-120px)] w-80 flex-col gap-2 overflow-y-auto overscroll-contain max-[1399px]:max-h-[calc(100dvh-var(--edge)*2-64px-var(--bottom-zone-h,108px)-12px)]",
        // Below 1400 px the side panels and the bottom zone share columns, so panels stop above it.
        side === "left" ? "left-[var(--edge)] items-start" : "right-[var(--edge)] items-end",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BottomZone({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Publish the bottom zone height so side panels can end above it on narrow screens.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement.style;
    const ro = new ResizeObserver(() => root.setProperty("--bottom-zone-h", `${Math.round(el.offsetHeight)}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.removeProperty("--bottom-zone-h");
    };
  }, []);
  return (
    <div className={cn("pointer-events-none absolute inset-x-[var(--edge)] bottom-[var(--edge)] z-20 flex justify-center", className)}>
      <div ref={ref} className="pointer-events-auto w-full max-w-3xl min-[1400px]:max-w-[min(48rem,calc(100%-2*332px))]">{children}</div>
    </div>
  );
}

/** Mobile: side panels become one bottom sheet with tabs (§4). */
export function MobileSheet({
  tabs,
  footer,
}: {
  tabs: { id: string; label: string; content: ReactNode }[];
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 px-[var(--edge)] pb-[var(--edge)]">
      {footer && <div className="pointer-events-auto">{footer}</div>}
      {tabs.length > 0 && (
        <GlassPanel strong className="flex max-h-[55dvh] flex-col p-0">
          <div className="flex items-center gap-1 px-2 pt-1">
            {tabs.map((t) => (
              <Button
                key={t.id}
                variant="ghost"
                size="sm"
                pressed={open && active === t.id}
                onClick={() => {
                  if (open && active === t.id) setOpen(false);
                  else {
                    setActive(t.id);
                    setOpen(true);
                  }
                }}
              >
                {t.label}
              </Button>
            ))}
            <Button variant="ghost" size="icon" className="ml-auto" aria-label={open ? "Свернуть" : "Развернуть"} aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? <ChevronDown size={20} strokeWidth={1.5} /> : <ChevronUp size={20} strokeWidth={1.5} />}
            </Button>
          </div>
          {open && current && (
            <div key={current.id} className="overflow-y-auto overscroll-contain px-3 pb-3 pt-1">
              {current.content}
            </div>
          )}
        </GlassPanel>
      )}
    </div>
  );
}
