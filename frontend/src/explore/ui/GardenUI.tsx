import { FileText } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/ui/primitives";
import { ToastStack } from "@/ui/time";
import { useCrops } from "../data";
import type { Panels } from "../ExploreApp";
import { CloseupPanel } from "../farm/Closeup";
import { EventDeck } from "../farm/EventDeck";
import { ChallengePanel } from "../farm/Challenges";
import { ExperimentBedPanel, ExperimentPanel, useExperiment } from "../farm/Experiment";
import { NaturePanel } from "../farm/NaturePanel";
import { PlantPanel } from "../farm/PlantPanel";
import { ReportDialog } from "../farm/ReportDialog";
import { SeasonTimeline, dayUnitFor } from "../farm/SeasonTimeline";
import { useCatalog, useFarmSession } from "../farm/session";
import { useFarm } from "../farm/store";
import { useExplore } from "../store";

/** Garden = farmer's control desk around the 3D beds (docs/SIMULATOR.md §5). */
export function useGardenPanels(planetId: string | undefined): Panels {
  const crops = useCrops();
  const catalog = useCatalog();
  const { world, state, trajectory, send } = useFarmSession(planetId, crops.data);
  const closeup = useExplore((s) => s.closeup);
  const mode = useFarm((s) => s.mode);
  const reportOpen = useFarm((s) => s.reportOpen);
  const experimentTraj = useExperiment((s) => s.trajectories[0]);
  const rdh = useFarm((s) => s.reportDayHours);
  const finished = useExplore((s) => s.maxDay > 0 && s.day >= s.maxDay - 0.01 && !s.playing);
  const sessionId = useFarm((s) => s.sessionId);

  // Season over → open the report once, only when the clock reaches the end of the season
  // (not when a fresh session replaces a finished one).
  const wasFinished = useRef(true);
  useEffect(() => {
    if (finished && !wasFinished.current && sessionId) useFarm.getState().setReportOpen(true);
    wasFinished.current = finished;
  }, [finished, sessionId]);

  // Space toggles ▶/⏸ (§11) unless typing; buttons still respond to Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [role=dialog], [data-modal]")) return;
      e.preventDefault();
      e.stopPropagation();
      send(useExplore.getState().playing ? "pause" : "play");
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [send]);

  if (!planetId || !crops.data) return {};
  const unit = dayUnitFor(world, rdh);
  const left =
    mode === "experiment"
      ? { label: "Эксперимент", content: <ExperimentPanel crops={crops.data} world={world} /> }
      : mode === "challenge"
        ? {
            label: "Испытания",
            content: (
              <div className="flex flex-col gap-3">
                <ChallengePanel planetId={planetId} />
                <NaturePanel crops={crops.data} state={state} worldId={world} />
              </div>
            ),
          }
        : { label: "Природа", content: <NaturePanel crops={crops.data} state={state} worldId={world} /> };
  return {
    left: closeup ? undefined : left,
    right: {
      label: closeup ? "Растение" : "Грядка",
      content:
        mode === "experiment" ? (
          <ExperimentBedPanel crops={crops.data} />
        ) : closeup ? (
          <CloseupPanel crops={crops.data} traj={trajectory} unit={unit} />
        ) : (
          <PlantPanel crops={crops.data} traj={trajectory} world={world} />
        ),
    },
    bottom: (
      <>
        <ReportDialog crops={crops.data} />
        {finished && sessionId && (
          <div className="mb-2 flex justify-center">
            <Button variant="primary" onClick={() => useFarm.getState().setReportOpen(true)}>
              <FileText size={16} strokeWidth={1.5} /> Отчёт за сезон
            </Button>
          </div>
        )}
        <SeasonTimeline traj={mode === "experiment" ? (experimentTraj ?? undefined) : trajectory} state={mode === "experiment" ? undefined : state} catalog={catalog.data} send={send} world={world} deck={mode !== "experiment" ? <EventDeck catalog={catalog.data} /> : undefined} />
      </>
    ),
    corner: (
      <div className="flex flex-col items-end gap-2">
        {/* Desktop: toasts sit at the top right of the scene, clear of the plant panel. */}
        <div className="sm:fixed sm:right-[calc(var(--edge)+332px)] sm:top-[calc(var(--edge)+64px)] sm:w-80">
          {!reportOpen && <ToastStack max={typeof window !== "undefined" && window.innerWidth <= 640 ? 1 : 2} />}
        </div>
      </div>
    ),
  };
}
