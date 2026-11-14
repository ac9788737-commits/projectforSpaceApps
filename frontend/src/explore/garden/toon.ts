import * as THREE from "three";

let gradient: THREE.DataTexture | null = null;

/** Three light steps for cel shading (docs/DESIGN.md §6.4). */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export interface ToonOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  side?: THREE.Side;
  rimColor?: THREE.ColorRepresentation;
  rimStrength?: number;
  /** Shared uniforms for wind sway of instanced plants. */
  wind?: { time: { value: number }; strength: { value: number } };
  transparent?: boolean;
  opacity?: number;
}

/** Cel-shaded material with a soft rim light, optionally swaying in the wind. */
export function makeToon(o: ToonOptions = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color: o.color ?? 0xffffff,
    vertexColors: o.vertexColors ?? false,
    side: o.side ?? THREE.FrontSide,
    gradientMap: toonGradient(),
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
  });
  const rim = {
    uRimColor: { value: new THREE.Color(o.rimColor ?? 0xffffff) },
    uRimStrength: { value: o.rimStrength ?? 0.22 },
  };
  m.userData.rim = rim;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, rim);
    if (o.wind) {
      shader.uniforms.uTime = o.wind.time;
      shader.uniforms.uWind = o.wind.strength;
      shader.vertexShader =
        "uniform float uTime;\nuniform float uWind;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float hgt = max(position.y, 0.0);
            float sway = sin(uTime * 1.7 + instanceMatrix[3].x * 2.3 + instanceMatrix[3].z * 1.9) * uWind * hgt * hgt * 2.5;
            transformed.x += sway;
            transformed.z += sway * 0.6;
          #endif`,
        );
    }
    shader.fragmentShader =
      "uniform vec3 uRimColor;\nuniform float uRimStrength;\n" +
      shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        outgoingLight += uRimColor * rimF * uRimStrength;
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `toon-${o.wind ? "wind" : "still"}`;
  return m;
}

export function setRim(material: THREE.Material, color: THREE.ColorRepresentation, strength: number) {
  const rim = material.userData.rim as { uRimColor: { value: THREE.Color }; uRimStrength: { value: number } } | undefined;
  if (!rim) return;
  rim.uRimColor.value.set(color);
  rim.uRimStrength.value = strength;
}
