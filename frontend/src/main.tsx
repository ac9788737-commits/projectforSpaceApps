import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "./index.css";
import { cn } from "@/lib/utils";
import Catalog from "@/pages/Catalog";
import Compare from "@/pages/Compare";
import PlanetCard from "@/pages/PlanetCard";
import Simulator from "@/pages/Simulator";

const ExploreApp = lazy(() => import("@/explore/ExploreApp"));
const DevUi = lazy(() => import("@/pages/DevUi"));

function Explore() {
  return (
    <Suspense fallback={<div className="grid h-dvh place-items-center bg-black text-white">Загружаю 3D-режим…</div>}>
      <ExploreApp />
    </Suspense>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
});

const LINKS = [
  { to: "/universe", label: "3D-путешествие" },
  { to: "/planets", label: "Каталог" },
  { to: "/simulator", label: "Симулятор" },
  { to: "/compare", label: "Сравнение" },
];

function Layout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-3">
          <span className="mr-4 w-full font-semibold sm:w-auto">AstroCrop</span>
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-1.5 text-sm",
                  isActive ? "bg-surface-2 font-medium" : "text-ink-2 hover:bg-surface-2",
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="dev/ui" element={<Suspense fallback={null}><DevUi /></Suspense>} />
          <Route path="universe" element={<Explore />} />
          <Route path="galaxy/*" element={<Explore />} />
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/universe" replace />} />
            <Route path="planets" element={<Catalog />} />
            <Route path="planets/:id" element={<PlanetCard />} />
            <Route path="simulator" element={<Simulator />} />
            <Route path="compare" element={<Compare />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
