import { cn } from "@/lib/utils";

/** Sprout of two leaves inside an orbit ring. Monochrome (currentColor), legible at 16 px. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden fill="none">
      <ellipse cx="12" cy="13" rx="10.5" ry="5" stroke="currentColor" strokeWidth="1.5" transform="rotate(-18 12 13)" />
      <path d="M12 20V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 12.5C9.2 12.6 7 10.6 6.8 7.4 9.9 7.3 12 9.4 12 12.5Z" fill="currentColor" />
      <path d="M12 10.8C12.1 7.6 14.4 5.3 17.6 5.2 17.6 8.4 15.3 10.7 12 10.8Z" fill="currentColor" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-fg", className)}>
      <LogoMark size={22} className="text-accent" />
      {!compact && <span className="font-head text-base font-semibold tracking-[0.02em]">AstroCrop</span>}
    </span>
  );
}
