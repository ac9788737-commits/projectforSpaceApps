import type * as GeoJSON from "geojson";
/** Read a field outline from an uploaded GeoJSON or KML file (first polygon). Pure. */
export function parseFieldFile(name: string, text: string): GeoJSON.Polygon {
  if (/\.kml$/i.test(name) || text.trimStart().startsWith("<")) return fromKml(text);
  const data = JSON.parse(text) as GeoJSON.GeoJSON;
  const poly = firstPolygon(data);
  if (!poly) throw new Error("В файле нет полигона");
  return poly;
}

function firstPolygon(g: GeoJSON.GeoJSON): GeoJSON.Polygon | null {
  switch (g.type) {
    case "Polygon":
      return g;
    case "MultiPolygon":
      return { type: "Polygon", coordinates: g.coordinates[0] };
    case "Feature":
      return g.geometry ? firstPolygon(g.geometry) : null;
    case "FeatureCollection":
      for (const f of g.features) {
        const p = firstPolygon(f);
        if (p) return p;
      }
      return null;
    case "GeometryCollection":
      for (const x of g.geometries) {
        const p = firstPolygon(x);
        if (p) return p;
      }
      return null;
    default:
      return null;
  }
}

function fromKml(text: string): GeoJSON.Polygon {
  const m = text.match(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i) ?? text.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
  if (!m) throw new Error("В KML нет координат полигона");
  const ring = m[1]
    .trim()
    .split(/\s+/)
    .map((t) => t.split(",").map(Number))
    .filter((p) => p.length >= 2 && p.every((v) => Number.isFinite(v)))
    .map((p) => [p[0], p[1]] as [number, number]);
  if (ring.length < 3) throw new Error("В контуре меньше трёх точек");
  const [a, b] = [ring[0], ring[ring.length - 1]];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push(a);
  return { type: "Polygon", coordinates: [ring] };
}
