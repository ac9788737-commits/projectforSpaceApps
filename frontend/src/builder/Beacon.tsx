import { useEffect, useState } from "react";

const KEY = "astrocrop.beacons";

function seen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Pulsing dot on a key control at the first visit; disappears after the first click anywhere on it. */
export function Beacon({ id }: { id: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(!seen().includes(id)), [id]);
  useEffect(() => {
    if (!show) return;
    const off = () => {
      setShow(false);
      try {
        localStorage.setItem(KEY, JSON.stringify([...new Set([...seen(), id])]));
      } catch {
        /* without storage the hint simply shows again next time */
      }
    };
    const t = setTimeout(() => window.addEventListener("pointerdown", off, { once: true }), 1500);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", off);
    };
  }, [show, id]);
  if (!show) return null;
  return (
    // a still ink corner mark, like a pencil tick on a form; no pulsing (docs/DESIGN.md §8)
    <span className="pointer-events-none absolute -right-1 -top-1 size-2.5 border-2 border-[var(--paper)] bg-[var(--caution)]" aria-hidden />
  );
}
