import { Canvas } from "@react-three/fiber";
import { Gauge, Table2 } from "lucide-react";
import { Suspense, useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import * as THREE from "three";
import { Logo } from "@/ui/Logo";
import { Button, GlassPanel } from "@/ui/primitives";
import { AutoQuality, CameraRig, Effects } from "./Effects";
import { LabelCamera, LabelLayer } from "./labels";
import { GalaxyLevel } from "./levels/Galaxy";
import { GardenLevel } from "./levels/Garden";
import { PlanetLevel } from "./levels/Planet";
import { SystemLevel } from "./levels/System";
import { UniverseLevel } from "./levels/Universe";
import { parsePath, type ExploreRoute, type Level } from "./routes";
import { useExplore } from "./store";
import { useTravel } from "./travel";
import { Breadcrumbs } from "./ui/Breadcrumbs";
import { useGardenPanels } from "./ui/GardenUI";
import { Hints } from "./ui/Hints";
import { LandingOverlay } from "./ui/Landing";
import { useLevelPanels } from "./ui/LevelPanels";
import { SearchDialog } from "./ui/Search";
import { BottomZone, MobileSheet, SideZone, TopZone, useIsMobile } from "./ui/Shell";

function LevelScene({ route }: { route: ExploreRoute }) {
  switch (route.level) {
    case "galaxy":
      return <GalaxyLevel key={route.galaxyId} galaxyId={route.galaxyId!} />;
    case "system":
      return <SystemLevel key={route.starId} galaxyId={route.galaxyId!} starId={route.starId!} />;
    case "planet":
      return <PlanetLevel key={route.planetId} planetId={route.planetId!} />;
    case "garden":
      return <GardenLevel key={route.planetId} planetId={route.planetId!} />;
    default:
      return <UniverseLevel />;
  }
}

export interface Panels {
  left?: { label: string; content: ReactNode };
  right?: { label: string; content: ReactNode };
  bottom?: ReactNode;
  corner?: ReactNode; // bottom-right extras (toasts)
}

const PARENT: Record<Level, Level | null> = {
  universe: null,
  galaxy: "universe",
  system: "galaxy",
  planet: "system",
  garden: "planet",
};

function QualityToggle() {
  const quality = useExplore((s) => s.quality);
  const setQuality = useExplore((s) => s.setQuality);
  return (
    <Button
      variant="secondary"
      size="icon"
      onClick={() => setQuality(quality === "high" ? "low" : "high", true)}
      title={`Качество графики: ${quality === "high" ? "высокое" : "низкое"} (снижается само при низком FPS)`}
      aria-label={`Качество графики: ${quality === "high" ? "высокое" : "низкое"}`}
      pressed={quality === "low"}
    >
      <Gauge size={20} strokeWidth={1.5} />
    </Button>
  );
}

function Fade() {
  const fade = useExplore((s) => s.fade);
  const color = useExplore((s) => s.fadeColor);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-30 transition-opacity duration-300 ease-in-out motion-reduce:duration-200"
      style={{ opacity: fade, background: color }}
    />
  );
}

/** Keyboard: Esc — one level up (§11). Space in the garden is handled by the garden panels. */
function useKeyboard(route: ExploreRoute) {
  const travel = useTravel();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[data-modal]")) return;
      const s = useExplore.getState();
      if (s.landing) return;
      if (route.level === "garden" && s.closeup) {
        s.setCloseup(false);
        return;
      }
      const parent = PARENT[route.level];
      if (parent) travel({ ...route, level: parent });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [route, travel]);
}

/** The whole journey lives in one canvas; the URL selects the level. */
export default function ExploreApp() {
  const location = useLocation();
  const route = parsePath(location.pathname);
  const quality = useExplore((s) => s.quality);
  const mood = useExplore((s) => s.mood);
  const landing = useExplore((s) => s.landing);
  const isMobile = useIsMobile();
  useKeyboard(route);

  useEffect(() => {
    document.title = "AstroCrop — путешествие";
    return () => {
      document.body.style.cursor = "";
    };
  }, []);
  useEffect(() => {
    const s = useExplore.getState();
    if (route.level !== "garden") s.setCloseup(false);
    if (!s.landing) s.setMood(route.level === "garden" ? "garden" : "space");
  }, [route.level]);

  const levelPanels = useLevelPanels(route);
  const gardenPanels = useGardenPanels(route.level === "garden" ? route.planetId : undefined);
  const panels: Panels = route.level === "garden" ? gardenPanels : levelPanels;

  return (
    <div data-mood={mood} className="relative h-dvh w-full overflow-hidden bg-void">
      <Canvas
        dpr={quality === "high" ? [1, 2] : 1}
        shadows={quality === "high" ? "soft" : false}
        camera={{ position: [0, 20, 40], fov: 50, near: 0.005, far: 3000 }}
        gl={{ antialias: quality === "high", powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
        }}
        onPointerMissed={() => (document.body.style.cursor = "")}
        aria-label="3D-сцена; объекты продублированы списком в левой панели"
      >
        <CameraRig />
        <LabelCamera />
        <AutoQuality />
        <Suspense fallback={null}>
          <LevelScene route={route} />
        </Suspense>
        <Effects garden={route.level === "garden"} />
      </Canvas>
      <LabelLayer />
      <Fade />

      {!landing && (
        <>
          <TopZone>
            <GlassPanel className="flex h-12 min-w-0 items-center gap-2 pl-3 pr-1">
              <Link to="/universe" aria-label="AstroCrop — во Вселенную" className="shrink-0 rounded-ctl">
                <Logo compact={isMobile} />
              </Link>
              <span className="mx-1 hidden h-5 w-px bg-[var(--border-subtle)] sm:block" aria-hidden />
              <Breadcrumbs route={route} />
            </GlassPanel>
            <div className="pointer-events-auto ml-auto flex gap-2">
              <SearchDialog />
              <QualityToggle />
              <Link
                to="/planets"
                aria-label="Таблицы"
                className="inline-flex h-10 items-center gap-2 rounded-ctl border border-subtle bg-panel px-3 text-sm text-fg backdrop-blur-[16px] transition-colors duration-[120ms] hover:bg-hover"
              >
                <Table2 size={16} strokeWidth={1.5} aria-hidden />
                <span className="hidden lg:inline">Таблицы</span>
              </Link>
            </div>
          </TopZone>

          {isMobile ? (
            <MobileSheet
              tabs={[panels.right, panels.left].filter(Boolean).map((p) => ({ id: p!.label, label: p!.label, content: p!.content }))}
              footer={
                (panels.corner || panels.bottom) && (
                  <div className="flex flex-col items-end gap-2">
                    {panels.corner}
                    {panels.bottom}
                  </div>
                )
              }
            />
          ) : (
            <>
              {panels.left && <SideZone side="left">{panels.left.content}</SideZone>}
              {panels.right && <SideZone side="right">{panels.right.content}</SideZone>}
              {panels.corner && (
                <div className="pointer-events-none absolute bottom-[var(--edge)] right-[var(--edge)] z-30 flex w-80 max-w-[calc(100%-2*var(--edge))] justify-end">{panels.corner}</div>
              )}
              {panels.bottom && <BottomZone>{panels.bottom}</BottomZone>}
            </>
          )}
          <div className="pointer-events-none absolute bottom-[var(--edge)] left-1/2 z-20 w-[min(24rem,calc(100%-2*var(--edge)))] -translate-x-1/2 max-sm:bottom-auto max-sm:top-[calc(var(--edge)+64px)]">
            <Hints />
          </div>
        </>
      )}
      <LandingOverlay route={route} />
    </div>
  );
}
