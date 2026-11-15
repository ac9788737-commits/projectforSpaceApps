import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Outlet, Route, Routes } from "react-router-dom";
import "@fontsource/golos-text/400.css";
import "@fontsource/golos-text/500.css";
import "@fontsource/golos-text/600.css";
import "@fontsource/noto-serif/500.css";
import "@fontsource/noto-serif/600.css";
import "./index.css";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { EXPERT, SPACE_LAB } from "@/flags";
import { PatternDefs } from "@/ui/patterns";
import Catalog from "@/pages/Catalog";
import Compare from "@/pages/Compare";
import PlanetCard from "@/pages/PlanetCard";
import Simulator from "@/pages/Simulator";

const ExploreApp = lazy(() => import("@/explore/ExploreApp"));
const DevUi = lazy(() => import("@/pages/DevUi"));
const FieldPage = lazy(() => import("@/farm/FieldPage"));
const FieldsHome = lazy(() => import("@/builder/FieldsHome"));
const BuilderPage = lazy(() => import("@/builder/BuilderPage"));
const Summary = lazy(() => import("@/builder/Summary"));
const ReferencePage = lazy(() => import("@/reference/ReferencePage"));

/** The list of fields lives on the site's entry page (public/landing.html, served at «/»). */
function ToLanding() {
  useEffect(() => {
    window.location.replace("/");
  }, []);
  return null;
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="grid h-dvh place-items-center bg-black text-white">{i18n.t("common.loading")}</div>}>{children}</Suspense>;
}

function Explore() {
  return (
    <Suspense fallback={<div className="grid h-dvh place-items-center bg-black text-white">{i18n.t("common.loading3d")}</div>}>
      <ExploreApp />
    </Suspense>
  );
}


const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
});

const LINKS = [
  { to: "/fields", label: "nav.fields" },
  ...(SPACE_LAB ? [{ to: "/universe", label: "nav.lab" }] : []),
  { to: "/planets", label: "nav.catalog" },
  { to: "/simulator", label: "nav.simulator" },
  { to: "/compare", label: "nav.compare" },
];

function Layout() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-3">
          <span className="mr-4 w-full font-semibold sm:w-auto">WhatCropNext</span>
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
              {t(link.label)}
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
      <PatternDefs />
      <BrowserRouter>
        <Routes>
          <Route path="dev/ui" element={<Suspense fallback={null}><DevUi /></Suspense>} />
          <Route path="fields" element={<ToLanding />} />
          <Route path="fields/:fid" element={<Lazy><FieldsHome /></Lazy>} />
          <Route path="fields/:fid/plan" element={<Lazy><BuilderPage /></Lazy>} />
          <Route path="fields/:fid/summary" element={<Lazy><Summary /></Lazy>} />
          <Route path="reference" element={<Lazy><ReferencePage /></Lazy>} />
          {EXPERT && <Route path="expert/fields" element={<Lazy><FieldPage /></Lazy>} />}
          {EXPERT && <Route path="expert/fields/:fid" element={<Lazy><FieldPage /></Lazy>} />}
          {SPACE_LAB && <Route path="universe" element={<Explore />} />}
          {SPACE_LAB && <Route path="galaxy/*" element={<Explore />} />}
          <Route element={<Layout />}>
            <Route index element={<ToLanding />} />
            {SPACE_LAB && <Route path="planets" element={<Catalog />} />}
            {SPACE_LAB && <Route path="planets/:id" element={<PlanetCard />} />}
            {SPACE_LAB && <Route path="simulator" element={<Simulator />} />}
            {SPACE_LAB && <Route path="compare" element={<Compare />} />}
          </Route>
          {/* hidden or unknown pages lead back to the site's entry */}
          <Route path="*" element={<ToLanding />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
