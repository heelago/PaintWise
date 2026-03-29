# PaintWise AI SVG Pipeline — Full Prompts & Architecture

## Overview

Two-call pipeline using Gemini BYOK (Bring Your Own Key) from the browser:

1. **Call 1 "Draftsman"** — Computer Vision extraction: structural JSON inventory of the scene
2. **Call 2 "Painter"** — SVG construction: converts the inventory into layered SVG JSON

Between calls, our algorithmic analysis provides the **authoritative color palette** (k-means centroids from actual pixels).

---

## Pre-Processing (Local, Before API Calls)

Our `analyzeImage.js` runs in a Web Worker and produces:
- **k-means centroids** (14 dominant colors as [R,G,B] arrays)
- **horizonY** (edge-detection based)
- **hasHorizon** / **hasReflection** booleans
- **regionBounds**, **sceneAvgColor**

These are injected into the Draftsman prompt as "AUTHORITATIVE ALGORITHMIC DATA."

---

## Call 1: The "Draftsman" Prompt

**Model:** gemini-2.5-flash
**Max tokens:** 65536
**Thinking budget:** 2048

### System/User Prompt:

```
You are a precise Computer Vision API analyzing a photograph for watercolor painting deconstruction. Extract structure using a UNIVERSAL painter's ontology that works for ANY subject — landscapes, portraits, still life, urban, nature.

Output ONLY valid JSON. No markdown fences. No explanation.

=== UNIVERSAL EXTRACTION PROTOCOL ===

1. **Composition:** Aspect ratio, horizon/primary division Y-percent (0=top, 100=bottom).
2. **Reflection:** Look CAREFULLY for reflections (puddle, water, glass, mirror). If the image has ANY vertical symmetry across a horizontal axis, it IS a reflection.
3. **Light Source:** Direction, angle, warm zone, cool zone.

4. **AGNOSTIC LAYER HIERARCHY** — Categorize every element using these universal painter's categories:

   a) **"base_wash"** — The furthest unbroken gradients: skies, studio backdrops, distant blurry walls, water surfaces. Describe gradient direction and color stops.

   b) **"soft_volume"** — Organic, rounded forms with soft/blended edges: clouds, foliage, human faces/skin, flower petals, fabric folds, water reflections, smoke. For each: map the CORE (densest area) and the WISPS (feathered edges) separately. Each soft volume needs 3-5 sub-shapes for layered opacity stacking.

   c) **"hard_geometry"** — Sharp, distinct silhouettes with rigid forms: architecture, rocks, furniture, vehicles, sharp clothing edges, poles, railings. Map lit_face and shadow_face separately. Include the HORIZON SILHOUETTE — the jagged top edge where hard geometry meets the sky (not a straight line).

   d) **"focal_detail"** — Tiny, high-contrast anchors that give scale: birds, text, highlights in eyes, water droplets, lamp fixtures, antennas, cracks, wires. MUST map at least 5.

5. **Horizon Transition Zone:** The horizon is NOT a straight line. Map the actual SILHOUETTE — the jagged profile of buildings/trees/terrain meeting the sky. Provide an approximate path description.

{
  "aspectRatio": "portrait" or "landscape",
  "horizon_y_percent": number,
  "horizon_description": "string",
  "horizon_silhouette": "description of the jagged profile — e.g. flat then bump at x=20% for tree, spike at x=35% for pole, stepped blocks x=40-70% for buildings",
  "reflection": {
    "present": boolean,
    "type": "puddle" | "water" | "glass" | "none",
    "axis_y_percent": number,
    "description": "what is reflected and how"
  },
  "palette": [
    { "hex": "#from_authoritative_palette", "pigment": "Traditional Watercolor Name", "where": "description" }
  ],
  "light": {
    "direction": "string",
    "angle_degrees": number,
    "warm_zone": "string",
    "cool_zone": "string"
  },
  "layers": [
    {
      "name": "string",
      "category": "base_wash | soft_volume | hard_geometry | focal_detail",
      "z_index": number,
      "elements": [
        {
          "type": "gradient | volume_core | volume_wisp | lit_face | shadow_face | silhouette_edge | window | detail | texture",
          "bounds": { "x": percent, "y": percent, "w": percent, "h": percent },
          "color": "#hex",
          "opacity_hint": number,
          "edge_character": "sharp | soft | diffuse | jagged",
          "details": "string"
        }
      ]
    }
  ],
  "focal_details": [
    { "type": "string", "position": { "x": percent, "y": percent }, "size": "tiny | small | medium", "details": "string" }
  ],
  "textures": [
    { "where": "string", "type": "string", "bounds": { "x": 0, "y": 0, "w": 100, "h": 100 }, "character": "string" }
  ]
}

Be EXHAUSTIVE. Soft volumes need 3-5 sub-shapes each (core + wisps). Hard geometry needs lit + shadow faces. Map the horizon silhouette profile. List 5+ focal details.
```

### Appended Context (Dynamic):

```
### AUTHORITATIVE ALGORITHMIC DATA
Do not guess the color palette. You MUST use the following data provided by our local algorithmic analysis as your ground truth.

**Authoritative Palette** (k-means clustered from actual pixels): ["#hex1", "#hex2", ...]
Assign ONLY these exact hex codes to the elements you map. Do NOT invent new hex codes. For each hex, provide the closest traditional watercolor pigment name.

**Horizon Detected:** Strong horizontal contrast line at ~XX% from the top. Verify and refine this position.

**Structural Hint — Reflection:** Our analysis [detected/did NOT detect] a reflection. Look carefully anyway.

**Image:** WxH pixels (portrait/landscape)
```

---

## Call 2: The "Painter" Prompt

**Model:** gemini-2.5-flash
**Max tokens:** 65536
**Thinking budget:** 2048

**Input:** The Draftsman's JSON inventory + the original image again

### Prompt:

```
You are an SVG engineer creating a watercolor painting study. Use clean geometric forms for architecture, procedural layered opacity for clouds, and mathematical transforms for reflections.

STRUCTURAL DATA:
{...inventory JSON...}

VIEWBOX: "0 0 {vbW} {vbH}"
HORIZON Y: {hY}px ({hPercent}% from top)
HAS REFLECTION: {true/false}
Coords: x_px = percent/100 * {vbW}, y_px = percent/100 * {vbH}

Return ONLY valid JSON. No markdown fences.
{ "viewBox": "0 0 {vbW} {vbH}", "layers": [{ "id": "string", "name": "string", "description": "string", "paintingTip": "string", "elements": [{ "type": "rect|path|circle|ellipse|line|defs", "attrs": {} }] }] }

=== LAYER STRUCTURE ===

Layer 1: "Base Washes"
  TWO separate gradient rects — one for each side of the horizon.
  The "real" side is brighter. The "reflected/puddle" side uses the same hues darkened 15-20%.
  Gradients go in defs elements with "content" string.
  Example defs: {"type":"defs","content":"<linearGradient id=\"skyA\" x1=\"0%\" y1=\"0%\" x2=\"0%\" y2=\"100%\"><stop offset=\"0%\" stop-color=\"#5d85a6\"/><stop offset=\"100%\" stop-color=\"#d69c7a\"/></linearGradient>"}
  Example rect: {"type":"rect","attrs":{"x":0,"y":{hY},"width":{vbW},"height":{vbH-hY},"fill":"url(#skyA)"}}

Layer 2: "Soft Volumes" (clouds, foliage, organic forms)
  === PROCEDURAL CLOUD STACKING ===
  Do NOT draw one giant path per cloud. Each cloud mass must be built by stacking
  5-10 SMALLER overlapping <path> elements with VARYING opacities:
    - 2-3 large shadow shapes (cool dark color, opacity 0.2-0.4)
    - 2-3 midtone shapes (warm color, opacity 0.4-0.6)
    - 2-3 highlight shapes (near-white, opacity 0.6-0.9)
    - 1-2 <circle> elements for the brightest puffy highlights (opacity 0.8-0.9)
  Use Cubic Bezier (C/S) curves with LUMPY, CAULIFLOWER-LIKE edges:
    "M100,200 C130,150 180,140 220,170 S290,200 320,180 C350,160 380,190 400,200 L400,250 C300,260 200,255 100,250 Z"
  This stacking creates the wet-on-wet watercolor bleed effect.
  If reflection exists: include reflected cloud shapes (darker, lower opacity) on the other side of the horizon.

Layer 3: "Hard Geometry" (architecture, rigid forms)
  a) ONE dark shadow <rect> spanning the entire horizon band as a depth base.
  b) Individual building faces as CLEAN <rect> elements on top.
     Buildings sit on the horizon line, extending away from it.
  c) Windows as small dark <rect> elements — NOT a uniform grid.
     Vary widths by 1-4px, skip some (glare), darken some (recessed).
  d) Shadow polygons under overhangs (dark translucent trapezoid <path>).

  === JAGGED HORIZON SILHOUETTE ===
  Do NOT use a single straight <line> or thin <rect> for the horizon.
  The horizon MUST be a <path> that follows the actual jagged silhouette
  of buildings/trees/terrain meeting the sky. Use the horizon_silhouette
  description from the structural data to build this path.
  Example: "M0,{hY} L80,{hY} L80,{hY-5} L120,{hY-5} L120,{hY-40} L125,{hY-40} L125,{hY} L200,{hY} ..."
  Fill this path with a dark color (the shadow base extends through it).

[IF REFLECTION EXISTS:]
Layer 4: "Reflection"
  === USE-TAG REFLECTION TECHNIQUE ===
  Do NOT manually redraw every reflected element. Instead:
  1. All "real" hard geometry elements from Layer 3 should work as the source.
  2. Create a COPY of each real building rect, but with:
     - reflected_height = real_height × 0.85
     - reflected_y = horizon_y - reflected_height (for puddle above) or horizon_y + offset (for water below)
     - Color darkened by multiplying RGB by 0.80
     - Opacity reduced by 0.15 from the real element
  3. The reflected clouds from Layer 2 should already be included there.
  4. THEN overlay the "Surface Texture" layer ON TOP of the reflection to
     ground it as a puddle/water surface.

Layer N: "Surface Texture"
  For textured surfaces (concrete, asphalt, wet ground), use:
  a) A dark <path> wash over the puddle/ground zone (opacity 0.4-0.6)
  b) 2-4 sweeping <path> strokes: fill="none", stroke=dark_color,
     strokeWidth=40-60, strokeDasharray="5,15,20,10", opacity 0.2-0.4
  c) 5-10 small <circle> grit dots (r=1-3, scattered, mixed dark/light)
  This texture OVERLAYS the reflection, making it look like a real surface.

Layer N+1: "Focal Details"
  The darkest, most concentrated marks (last in watercolor — least water).
  - Poles: thin <rect> width=2-4px, straight. Include reflected version if reflection exists.
  - Lamp fixtures: geometric <path> trapezoids + small <rect> elements.
  - Birds: <path> v-shapes. Example: "M220,250 Q225,255 230,250 Q225,252 220,250 Z"
  - Include BOTH real and reflected versions of every detail element.
  - Wires, antennas, cracks, signage — everything from focal_details in the data.

=== ATMOSPHERIC PERSPECTIVE ===
Background (base washes, distant clouds): opacity 0.2-0.5, large shapes.
Midground (architecture, main clouds): opacity 0.5-0.8.
Foreground (texture, details, poles): opacity 0.7-0.95, sharp edges.

=== TECHNIQUE RULES ===
ALL ATTRS camelCase: strokeWidth, strokeDasharray, strokeLinecap.
COLORS: ONLY from palette. May darken (×0.80) or lighten (×1.15).
PAINTING TIPS: Name pigments, brush sizes, techniques.
```

---

## Output JSON Schema (What SvgViewer Consumes)

```json
{
  "viewBox": "0 0 533 800",
  "layers": [
    {
      "id": "base-washes",
      "name": "Base Washes",
      "description": "Initial broad washes...",
      "paintingTip": "Wet the sky area and...",
      "elements": [
        { "type": "defs", "content": "<linearGradient .../>..." },
        { "type": "rect", "attrs": { "x": 0, "y": 400, "width": 533, "height": 400, "fill": "url(#skyA)" } },
        { "type": "path", "attrs": { "d": "M...", "fill": "#hex", "opacity": 0.5 } },
        { "type": "circle", "attrs": { "cx": 200, "cy": 300, "r": 80, "fill": "#fff", "opacity": 0.8 } }
      ]
    }
  ]
}
```

---

## Verification (Post-Generation)

`verifyComposition.js` checks:
1. Schema: viewBox format, layers array, element types (rect/path/circle/ellipse/line/defs/text/g)
2. ViewBox aspect ratio vs image dimensions (warn if >10% off)
3. Color accuracy: hex colors within RGB distance 150 of centroids
4. Element count sanity (<500 elements, no empty layers)
5. Layer count (2-12)

---

## Caching

- Inventory cached in localStorage as `pw-inv-{hash}`
- Composition cached as `pw-comp-{hash}`
- Hash is FNV-1a over sampled image data URL characters
- Cache version: 2
- Regenerate bypasses cache, but reuses cached inventory (skip Call 1)

---

## Known Issues / Areas for Improvement

1. **Reflection quality** — mirrored buildings often come out as a uniform dark band instead of individual mirrored rects
2. **Cloud depth** — procedural stacking instruction works sometimes but Gemini often falls back to 1-2 large paths
3. **Horizon uniformity** — the area around the horizon tends to be too uniform/flat
4. **Our algorithmic analysis misses reflections** — user must manually check the reflection checkbox
