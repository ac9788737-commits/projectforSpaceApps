/**
 * Field textures as SVG patterns (docs/DESIGN.md §4): diagonal hatch = cover crop, dot raster =
 * bare soil ("dust"), dashed = model estimate, root hairs. Rendered once at the app root; any
 * inline SVG on the page fills with url(#pat-…).
 */
export const PAT = {
  cover: "url(#pat-cover)",
  bare: "url(#pat-bare)",
  bareDark: "url(#pat-bare-dark)",
  estimate: "url(#pat-estimate)",
  salt: "url(#pat-salt)",
} as const;

export function PatternDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <defs>
        {/* §2.3: cover crops — frequent diagonal hatch, ink at 15 % over the family colour */}
        <pattern id="pat-cover" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--ink)" strokeOpacity="0.35" strokeWidth="1.6" />
        </pattern>
        {/* §2.3: bare soil — dot raster «dust» */}
        <pattern id="pat-bare" width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="0.75" fill="var(--ink)" fillOpacity="0.45" />
          <circle cx="4" cy="4" r="0.6" fill="var(--ink)" fillOpacity="0.3" />
        </pattern>
        <pattern id="pat-bare-dark" width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="0.75" fill="var(--paper)" fillOpacity="0.55" />
          <circle cx="4" cy="4" r="0.6" fill="var(--paper)" fillOpacity="0.4" />
        </pattern>
        {/* §2.5: estimate — sparse hatch the other way */}
        <pattern id="pat-estimate" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-soft)" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="2 2" />
        </pattern>
        {/* salinity crust: small paper-white crystals */}
        <pattern id="pat-salt" width="9" height="7" patternUnits="userSpaceOnUse">
          <path d="M2 2h2M3 1v2M6.5 5h2M7.5 4v2" stroke="var(--paper)" strokeWidth="1" />
        </pattern>
      </defs>
    </svg>
  );
}
