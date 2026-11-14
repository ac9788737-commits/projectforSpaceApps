import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { cropById, useCrops, usePlanetScene, type PlantStateOut } from "../data";
import { EXPERIMENT_BEDS, useExperiment } from "../farm/Experiment";
import { useFarmTrajectory, type Trajectory } from "../farm/session";
import { PLOT_IDS, useFarm } from "../farm/store";
import { BED_TOP, BedView, bedPosition, hasUndergroundOrgan, Interior, INTERIOR_Y, SoilSection, type BedTimeline } from "../garden/Beds";
import { Decor } from "../garden/Decor";
import { Butterflies, CloudDeck, DustDevils, Fog, Sky, Terrain, Weather } from "../garden/Environment";
import { WeatherLayer } from "../garden/Weather3D";
import { VoidBackground } from "../lib/tokens";
import { effectiveBed, NO_WHAT_IF, prefersReducedMotion, useExplore, type Bed, type Scenario } from "../store";
import { useLevelIntro } from "../travel";

const NO_CLIP: THREE.Plane[] = [];
const GARDEN_VIEW: [number, number, number] = [3.2, 10.5, 15.0];

/** Daily plant states of one plot of a trajectory, in the shape the beds draw. */
export function bedTimeline(traj: Trajectory | undefined, plot: string): BedTimeline | undefined {
  const days = traj?.plots[plot];
  const summary = traj?.summary[plot] as { alive: boolean; yield_rel: number } | undefined;
  const morph = traj?.morphology?.[plot] as { harvest_organ: string; biomass_max_g: number } | undefined;
  if (!days || !summary || !morph) return undefined;
  return {
    days: days as unknown as PlantStateOut[],
    morphology: { harvest_organ: morph.harvest_organ, biomass_max_g: morph.biomass_max_g },
    summary: { survival: summary.alive, yield_rel: summary.yield_rel },
  };
}

const SCENARIO_OF: Record<string, Scenario> = { open: "open_surface", greenhouse: "greenhouse", closed: "closed_farm" };

export function GardenLevel({ planetId }: { planetId: string }) {
  const scene = usePlanetScene(planetId);
  const crops = useCrops();
  const storeBeds = useExplore((s) => s.beds);
  const selectedBed = useExplore((s) => s.selectedBed);
  const closeup = useExplore((s) => s.closeup);
  const quality = useExplore((s) => s.quality);
  const controls = useExplore((s) => s.controls);
  const setGardenPlanet = useExplore((s) => s.setGardenPlanet);
  const mode = useFarm((s) => s.mode);
  const rdh = useFarm((s) => s.reportDayHours);
  const traj = useFarmTrajectory().data;
  const experiment = useExperiment();
  const data = scene.data;
  const perSide = quality === "high" ? 5 : 3;

  useEffect(() => setGardenPlanet(planetId), [planetId, setGardenPlanet]);

  // Beds and their plant timelines: the live session, or one bed per experiment variant.
  const { beds, timelines, signs } = useMemo(() => {
    if (mode !== "experiment") {
      return { beds: storeBeds, timelines: storeBeds.map((_, i) => bedTimeline(traj, PLOT_IDS[i])), signs: [] as (string | undefined)[] };
    }
    const b: Bed[] = storeBeds.map(() => ({ crop: null, scenario: "open_surface" as Scenario, whatIf: NO_WHAT_IF }));
    const t: (BedTimeline | undefined)[] = storeBeds.map(() => undefined);
    const s: (string | undefined)[] = storeBeds.map(() => undefined);
    experiment.variants.forEach((v, i) => {
      const idx = EXPERIMENT_BEDS[i];
      b[idx] = { crop: experiment.crop, scenario: SCENARIO_OF[experiment.protection], whatIf: NO_WHAT_IF };
      t[idx] = bedTimeline(experiment.trajectories[i] ?? undefined, "A1");
      s[idx] = v.label;
    });
    return { beds: b, timelines: t, signs: s };
  }, [mode, storeBeds, traj, experiment.variants, experiment.trajectories, experiment.crop, experiment.protection]);

  useLevelIntro(
    // Cosy ~35° view down onto the garden (§6.3, step 4).
    data ? { from: [0, 2.2, 4], to: GARDEN_VIEW, target: [0, 0.3, 0], minDistance: 0.4, maxDistance: 45 } : null,
    [planetId, !!data],
  );

  const selected = beds[selectedBed];
  const selectedTimeline = timelines[selectedBed];
  const selectedScenario = effectiveBed(selected).scenario;
  const indoor = closeup && selectedScenario === "closed_farm" && !!selected.crop;
  const section = closeup && !indoor && hasUndergroundOrgan(selectedTimeline);
  const [bx, , bz] = bedPosition(selectedBed);
  const clip = useMemo(() => (section ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), bz)] : NO_CLIP), [section, bz]);

  // Camera for close-up and back.
  useEffect(() => {
    if (!controls || !data) return;
    if (!closeup) {
      controls.minDistance = 0.4;
      controls.setLookAt(...GARDEN_VIEW, 0, 0.3, 0, true);
      useExplore.getState().setFocus(null);
      return;
    }
    controls.minDistance = 0.1;
    const setFocus = useExplore.getState().setFocus;
    if (indoor) {
      controls.setLookAt(0.4, INTERIOR_Y + 1.5, 4.0, 0, INTERIOR_Y + 1.1, 0, true);
      setFocus([0, INTERIOR_Y + 1.1, 0]);
    } else if (section) {
      controls.setLookAt(bx + 0.25, BED_TOP + 0.35, bz + 1.6, bx, BED_TOP - 0.08, bz, true);
      setFocus([bx, BED_TOP, bz]);
    } else {
      const h = selectedTimeline ? Math.max(...selectedTimeline.days.map((d) => d.heightM)) : 0.5;
      controls.setLookAt(bx + 1.0, BED_TOP + 0.6 + h * 0.9, bz + 1.9, bx, BED_TOP + h * 0.45, bz, true);
      setFocus([bx, BED_TOP + h * 0.45, bz]);
    }
  }, [controls, closeup, indoor, section, bx, bz, data, selectedTimeline]);

  // Close-up: the plant slowly turns in front of the camera (§6.5), never the cut view.
  useFrame((_, delta) => {
    if (!controls || !closeup || section || indoor || prefersReducedMotion() || controls.active) return;
    controls.azimuthAngle += delta * 0.08;
  });

  // Clock: extrapolate between server frames (live session) or run locally (experiment).
  useFrame((_, delta) => {
    const ex = useExplore.getState();
    const farm = useFarm.getState();
    if (farm.mode === "experiment") {
      if (!ex.playing) return;
      const next = Math.min(ex.day + Math.min(delta, 0.1) * ex.speed, ex.maxDay);
      ex.setDay(next);
      if (next >= ex.maxDay) ex.setPlaying(false);
      return;
    }
    if (!ex.playing || !farm.sessionId) return;
    const hour = Math.min(farm.endHour, farm.serverHour + ((performance.now() - farm.serverAt) / 1000) * ex.speed * 24);
    farm.setHour(hour);
    ex.setDay(hour / farm.reportDayHours);
  });

  const open = beds.some((b) => b.crop && effectiveBed(b).scenario !== "closed_farm");
  if (!data) return <VoidBackground />;
  return (
    <>
      <Sky scene={data} stepHours={rdh} />
      <Fog scene={data} />
      {data.has_solid_surface ? <Terrain scene={data} clip={clip} /> : <CloudDeck scene={data} />}
      <Weather scene={data} />
      <WeatherLayer open={open || mode === "sandbox" || mode === "scenario" || mode === "challenge"} />
      <DustDevils scene={data} />
      <Butterflies scene={data} />
      {data.has_solid_surface && <Decor groundColor={data.ground} />}
      {beds.map((bed, i) => (
        <BedView
          key={i}
          index={i}
          bed={bed}
          crop={cropById(crops.data, bed.crop)}
          timeline={timelines[i]}
          scene={data}
          selected={i === selectedBed}
          perSide={perSide}
          soilClip={section && i === selectedBed ? clip : NO_CLIP}
          signText={signs[i]}
        />
      ))}
      {section && <SoilSection z={bz} />}
      {indoor && <Interior crop={cropById(crops.data, selected.crop)} timeline={selectedTimeline} scene={data} perSide={perSide} />}
    </>
  );
}
