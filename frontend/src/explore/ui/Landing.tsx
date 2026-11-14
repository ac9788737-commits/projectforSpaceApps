import { SkipForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/ui/primitives";
import { usePlanetScene } from "../data";
import { pathFor, type ExploreRoute } from "../routes";
import { prefersReducedMotion, useExplore } from "../store";
import { sleep } from "../travel";

/**
 * Landing, space → garden (docs/DESIGN.md §6.3), 3–4 s:
 * 1) the camera flies in until the planet fills the screen; 2) atmospheric entry — the screen
 * floods with the sky colour and dust/cloud particles (no atmosphere: just a fast dive);
 * 3) the UI mood warms over 600 ms; 4) the garden camera settles at ~35°.
 */
export function LandingOverlay({ route }: { route: ExploreRoute }) {
  const landing = useExplore((s) => s.landing);
  const scene = usePlanetScene(route.planetId);
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"idle" | "approach" | "entry" | "settle">("idle");
  const [showSkip, setShowSkip] = useState(false);
  const cancelled = useRef(false);
  const data = scene.data;
  const airless = !data || data.pressure_pa < 100;
  const sky = data?.sky_horizon;

  const finish = useMemo(
    () => async () => {
      const s = useExplore.getState();
      s.setMood("garden");
      if (route.level === "planet") navigate(pathFor({ ...route, level: "garden" }));
      await sleep(prefersReducedMotion() ? 200 : 900);
      setPhase("idle");
      useExplore.getState().setLanding(false);
    },
    [navigate, route],
  );

  useEffect(() => {
    if (!landing || route.level !== "planet" || !data) return;
    cancelled.current = false;
    setShowSkip(false);
    const skipTimer = setTimeout(() => setShowSkip(true), 500);
    const run = async () => {
      const { controls, setFade } = useExplore.getState();
      if (prefersReducedMotion() || !controls) {
        setFade(1, "var(--bg-void)");
        await sleep(300);
        await finish();
        return;
      }
      setPhase("approach");
      controls.minDistance = 0.01;
      await Promise.race([controls.setLookAt(-2.6, 1.0, 3.0, 0, 0, 0, true), sleep(1200)]);
      if (cancelled.current) return;
      setPhase("entry");
      await Promise.race([controls.setLookAt(-1.45, 0.6, 1.5, -1.0, 1.4, 0.4, true), sleep(1100)]);
      if (cancelled.current) return;
      useExplore.getState().setMood("garden");
      setPhase("settle");
      await sleep(350);
      if (cancelled.current) return;
      await finish();
    };
    run();
    return () => {
      cancelled.current = true;
      clearTimeout(skipTimer);
    };
  }, [landing, route.level, data, finish]);

  if (!landing) return null;
  const flood = phase === "entry" || phase === "settle";
  return (
    <div className="absolute inset-0 z-40" aria-live="polite">
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-[900ms] ease-in-out"
        style={{ background: airless ? "var(--bg-void)" : sky, opacity: phase === "settle" ? (route.level === "garden" ? 0 : 1) : flood ? 0.85 : 0 }}
      />
      {!airless && flood && route.level !== "garden" && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {Array.from({ length: 14 }, (_, i) => (
            <span
              key={i}
              className="absolute rounded-full opacity-60 blur-2xl animate-[cloud-rush_1.4s_ease-in_infinite] motion-reduce:hidden"
              style={{
                left: `${(i * 37) % 100}%`,
                top: `${(i * 53) % 100}%`,
                width: `${18 + ((i * 13) % 22)}vmax`,
                height: `${10 + ((i * 7) % 12)}vmax`,
                background: data?.sky_day,
                animationDelay: `${(i % 7) * 0.18}s`,
              }}
            />
          ))}
        </div>
      )}
      <p className="sr-only">Посадка на планету {data?.name}</p>
      {showSkip && (
        <div className="absolute bottom-[var(--edge)] right-[var(--edge)]">
          <Button
            variant="secondary"
            onClick={() => {
              cancelled.current = true;
              finish();
            }}
          >
            <SkipForward size={16} strokeWidth={1.5} /> Пропустить
          </Button>
        </div>
      )}
    </div>
  );
}
