import { describe, expect, it } from "vitest";
import { parseFieldFile } from "./fieldFile";

describe("parseFieldFile", () => {
  it("reads the first polygon of a FeatureCollection", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} },
        { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: {} },
      ],
    };
    expect(parseFieldFile("a.geojson", JSON.stringify(fc)).coordinates[0]).toHaveLength(4);
  });
  it("reads KML and closes the ring", () => {
    const kml = "<kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>68.4,38.5,0 68.41,38.5,0 68.41,38.51,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>";
    const p = parseFieldFile("f.kml", kml);
    expect(p.coordinates[0]).toHaveLength(4);
    expect(p.coordinates[0][3]).toEqual([68.4, 38.5]);
  });
  it("rejects files without a polygon", () => {
    expect(() => parseFieldFile("x.json", JSON.stringify({ type: "Point", coordinates: [0, 0] }))).toThrow();
  });
});
