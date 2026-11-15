import type * as GeoJSON from "geojson";
import maplibregl, { type GeoJSONSource, type Map as MlMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { FieldRec } from "@/farm/api";

export type Overlay = "none" | "truecolor" | "ndvi";

// NASA GIBS WMTS (open, no login). The 8-day NDVI product is served from 2025-02 onwards
// (WMTS capabilities), so one mid-summer 2025 date is used for both layers.
const GIBS_DATE = "2025-07-15";
const GIBS = {
  truecolor: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${GIBS_DATE}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
  ndvi: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default/${GIBS_DATE}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`,
};

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

function style(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© участники OpenStreetMap",
      },
      truecolor: { type: "raster", tiles: [GIBS.truecolor], tileSize: 256, maxzoom: 9, attribution: "NASA GIBS / EOSDIS — MODIS Terra" },
      ndvi: { type: "raster", tiles: [GIBS.ndvi], tileSize: 256, maxzoom: 9, attribution: "NASA GIBS / EOSDIS — MODIS NDVI 8 дней" },
    },
    layers: [
      { id: "osm", type: "raster", source: "osm" },
      { id: "truecolor", type: "raster", source: "truecolor", layout: { visibility: "none" }, paint: { "raster-opacity": 0.85 } },
      { id: "ndvi", type: "raster", source: "ndvi", layout: { visibility: "none" }, paint: { "raster-opacity": 0.7 } },
    ],
  };
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Map of fields: OSM base, optional NASA GIBS overlays, field polygons, and a drawing layer.
 * Colours come from design tokens (read once from CSS).
 */
export function FieldMap({
  fields,
  selected,
  onSelect,
  drawing,
  draft,
  onDraftPoint,
  overlay,
  flyTo,
}: {
  fields: FieldRec[];
  selected: string | null;
  onSelect: (id: string) => void;
  drawing: boolean;
  draft: [number, number][];
  onDraftPoint: (p: [number, number]) => void;
  overlay: Overlay;
  flyTo: { center: [number, number]; zoom: number } | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const handlers = useRef({ onSelect, onDraftPoint, drawing });
  handlers.current = { onSelect, onDraftPoint, drawing };

  useEffect(() => {
    if (!box.current) return;
    // Tokens live on the [data-mood] ancestor of the map.
    const accent = cssVar(box.current, "--accent");
    const ok = cssVar(box.current, "--ok");
    const m = new maplibregl.Map({ container: box.current, style: style(), center: [40, 25], zoom: 1.6, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    m.on("load", () => {
      m.addSource("fields", { type: "geojson", data: EMPTY });
      m.addLayer({ id: "fields-fill", type: "fill", source: "fields", paint: { "fill-color": ["case", ["get", "selected"], accent, ok], "fill-opacity": 0.25 } });
      m.addLayer({ id: "fields-line", type: "line", source: "fields", paint: { "line-color": ["case", ["get", "selected"], accent, ok], "line-width": ["case", ["get", "selected"], 3, 2] } });
      m.addLayer({ id: "fields-dot", type: "circle", source: "fields", maxzoom: 10, paint: { "circle-color": accent, "circle-radius": 6, "circle-stroke-width": 2, "circle-stroke-color": ok } });
      m.addSource("draft", { type: "geojson", data: EMPTY });
      m.addLayer({ id: "draft-line", type: "line", source: "draft", paint: { "line-color": accent, "line-width": 2, "line-dasharray": [2, 1] } });
      m.addLayer({ id: "draft-pts", type: "circle", source: "draft", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": accent, "circle-radius": 5 } });
      m.on("click", "fields-fill", (e) => {
        if (handlers.current.drawing) return;
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) handlers.current.onSelect(id);
      });
      m.on("click", "fields-dot", (e) => {
        if (handlers.current.drawing) return;
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) handlers.current.onSelect(id);
      });
      m.on("click", (e) => {
        if (handlers.current.drawing) handlers.current.onDraftPoint([e.lngLat.lng, e.lngLat.lat]);
      });
      m.on("mouseenter", "fields-fill", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "fields-fill", () => (m.getCanvas().style.cursor = ""));
      m.fire("data-ready");
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Field polygons (and centroid dots for small zooms).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const src = m.getSource("fields") as GeoJSONSource | undefined;
      if (!src) return;
      src.setData({
        type: "FeatureCollection",
        features: fields.flatMap((f) => [
          { type: "Feature", geometry: f.geometry, properties: { id: f.id, selected: f.id === selected } },
          { type: "Feature", geometry: { type: "Point", coordinates: f.centroid }, properties: { id: f.id, selected: f.id === selected } },
        ]),
      });
    };
    if (m.isStyleLoaded() && m.getSource("fields")) apply();
    else m.once("data-ready", apply);
  }, [fields, selected]);

  // Drawing draft.
  useEffect(() => {
    const m = map.current;
    const src = m?.getSource("draft") as GeoJSONSource | undefined;
    if (!m || !src) return;
    const ring = draft.length >= 3 ? [...draft, draft[0]] : draft;
    src.setData({
      type: "FeatureCollection",
      features: [
        ...(ring.length >= 2 ? [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: ring }, properties: {} }] : []),
        ...draft.map((p) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: p }, properties: {} })),
      ],
    });
    m.getCanvas().style.cursor = drawing ? "crosshair" : "";
  }, [draft, drawing]);

  // Overlays.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      for (const id of ["truecolor", "ndvi"] as const) {
        if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", overlay === id ? "visible" : "none");
      }
    };
    if (m.isStyleLoaded()) apply();
    else m.once("load", apply);
  }, [overlay]);

  useEffect(() => {
    if (flyTo && map.current) map.current.flyTo({ center: flyTo.center, zoom: flyTo.zoom, duration: 1200, essential: true });
  }, [flyTo]);

  // MapLibre sets `position: relative` on its container, so the container fills a positioned wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={box} className="h-full w-full" role="application" aria-label="Карта полей" />
    </div>
  );
}
