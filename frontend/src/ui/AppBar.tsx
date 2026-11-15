import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/ui/icons";

/** The farm sign: a dark green bar across the top of every product screen. Left — the name and
 * whatever the screen puts there; right — links, language, the main action. */
export function AppBar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <header className="bg-farm-inverted text-farm-on-inverted">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-[var(--edge)] py-3">
        <Link to="/fields" className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Icon name="sprout" size={22} className="text-farm-accent" />
          WhatCropNext
        </Link>
        {children}
        {right && <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">{right}</div>}
      </div>
    </header>
  );
}

/** A link on the dark bar. */
export function BarLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-farm-on-inverted-2 underline-offset-2 transition-colors duration-300 hover:text-farm-on-inverted hover:underline">
      {children}
    </Link>
  );
}
