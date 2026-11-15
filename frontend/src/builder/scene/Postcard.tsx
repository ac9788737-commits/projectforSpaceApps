import { DndContext } from "@dnd-kit/core";
import type { Card, Irrigation, Quick, Slot, Week } from "../api";
import { TERRAIN } from "./Backdrop";
import { FieldScene } from "./FieldScene";

/** The climate of a demo field as a postcard sky (docs/DESIGN_V3.md §2.7). */
const CLIMATE: Record<string, Partial<Week>> = {
  "tj-hissar": { month: 6, heat: true },
  "in-punjab": { month: 5, heat: true },
  "us-iowa": { month: 6 },
  "ke-nakuru": { month: 3, rain: 8 },
};

const stillWeek = (fid: string, month = 6): Week => ({
  year: -1,
  month,
  crop: null,
  is_cover: false,
  stage: "mid",
  canopy: 0.8,
  soil_cover: 0.8,
  water: 0.6,
  soc_pct: 1.4,
  n_mineral: 60,
  erosion_cum: 0,
  rain: 0,
  storm: false,
  tmax: 28,
  heat: false,
  frost: false,
  pest: 0,
  ...CLIMATE[fid],
});

/** A small still picture of a field: its sky, hills and the crops of a plan (no drag, no motion
 * beyond the quiet life, which is paused). */
export function Postcard({
  fid,
  plan,
  deck,
  q,
  week,
  irrigation = "none",
  names = {},
}: {
  fid: string;
  plan: Slot[];
  deck: Card[];
  q?: Quick;
  week?: Week | null;
  irrigation?: Irrigation;
  names?: Record<string, string>;
}) {
  return (
    <DndContext>
      <FieldScene plan={plan} deck={deck} q={q} week={week ?? stillWeek(fid)} irrigation={irrigation} terrain={TERRAIN[fid] ?? "hills"} sow={null} paused dragging={false} names={names} yearLabel={(y) => (y < 0 ? fid : String(y + 1))} interactive={false} compact />
    </DndContext>
  );
}
