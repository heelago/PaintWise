# PaintWise — Handoff Document

## Current State (v-grid-overlay)

The app is functional with two rendering modes:
1. **Pointillist** — local canvas-based, 40K+ elliptical marks, instant, no API needed
2. **AI Composition** — Gemini 3 Flash single-call pipeline producing layered SVG

## Architecture

```
src/
  App.jsx                — State router (upload → painting)
  UploadPage.jsx         — Drag-drop upload + sample photo
  PaintingPage.jsx       — Results page (Pointillist | AI Composition tabs)
  SvgViewer.jsx          — SVG renderer with layers, controls, FX, save, grid overlay
  GridOverlay.jsx        — Grid lines, cell magnification, distance measurement

  engine/
    analyzeImage.js      — Generic photo analysis (Web Worker compatible)
    generateMarks.js     — 10-round pointillist mark generation
    worker.js            — Web Worker wrapper
    pigments.js          — 79 watercolor pigments, LAB matching
    instructions.js      — Template painting instructions per round
    geminiSvg.js         — Single-call Gemini pipeline (raw SVG → parsed layers)
    verifyComposition.js — Schema/color/proportion validation
    useImageUpload.js    — Upload hook

api/
  generate-svg.js        — Vercel serverless function (unused currently)

test-prompt.mjs          — CLI test script for prompt iteration
test-raw-svg.mjs         — CLI test for raw SVG output
test-painter-algo.mjs    — CLI test for painter's algorithm prompt

.env.local               — VITE_GEMINI_KEY (gitignored)
```

## AI SVG Pipeline (Current)

**Model:** `gemini-3-flash-preview` (Gemini 3 Flash)
**Temperature:** 0.8
**Max output tokens:** 65536
**Architecture:** Single API call, raw SVG output, DOMParser conversion

### How it works:

1. User uploads photo → local `analyzeImage.js` extracts palette, horizon, regions
2. Single Gemini call with image + conversational prompt asking for raw `<svg>` output
3. Gemini outputs SVG markup with `<g id="layer-name">` groups
4. `parseSvgToComposition()` uses browser DOMParser to convert raw SVG into `{ viewBox, layers: [{ id, name, elements }] }` format
5. SvgViewer renders the parsed composition with layer toggles

### The Prompt

Simple conversational tone — no system instruction, no structured schemas:

```
Hey buddy, can you help me deconstruct this [orientation] photo into a
buildable image made of svg layers of each color for a painting tutorial
app im working on? please first analyze the colors, perspective, and
proportions in the image and then recreate a sort of approximation from
shapes. it should be recognizable, with as many details as you can
recreate - but with simple svg shapes. Build it as 8-10 color layers
ordered back to front.

Output the result as a complete SVG element with viewBox="0 0 W H".
Wrap each color layer in a <g id="layer-name"> tag.
```

### Key Learnings (Prompt Engineering)

- **Simple > Complex**: The conversational prompt produces dramatically better results than structured prompts with bounding boxes, material ontologies, or CoT analysis blocks
- **Raw SVG > JSON**: Letting Gemini output raw SVG markup instead of JSON `{ type, attrs }` format removes overhead and produces more expressive paths
- **No thinking cap**: Removing `thinkingBudget` limits lets the model reason freely
- **Temperature 0.8**: Higher temperature gives more creative, expressive output
- **Image size**: Sending 2000px max (was 1200px) preserves more detail for the model
- **Gemini 3 Flash**: Significantly better multimodal understanding than 2.5 Flash

## Features

### SVG Viewer
- Layer toggle (show/hide individual layers)
- Step-through navigation (Previous/Next)
- Outline mode (wireframe view)
- Watercolor FX filters (feTurbulence, feGaussianBlur, feDisplacementMap)
- Save as PNG/JPG at 2x resolution
- Grid overlay with cell magnification
- Distance measurement tool (scaled to A5/A6 paper)

### Grid Overlay (NEW)
- Toggle grid on/off for both Pointillist and AI Composition views
- Configurable columns (3/4/6/8), rows auto-calculated from aspect ratio
- Cell labels (A1, A2, B1, B2...) at each cell corner
- Click a cell to open magnification overlay showing zoomed content + color swatches
- Measure mode: plot points, see distances in mm scaled to paper size (A5/A6)

### Pointillist
- 10-round mark generation with grid focus and zoom
- Photo overlay toggle
- Grid overlay with measurement (shared GridOverlay component)

## Git Tags (Prompt Evolution)

- `v-cubist-baroque` — Original two-call Draftsman/Painter with complex ontology
- `v-cot-spatial` — Single-call Chain of Thought with spatial data injection
- `v-two-call-analyst` — Two-call with Analyst bounding boxes → Painter
- `v-simple-natural` — Single-call conversational prompt (breakthrough)
- `v-convo-2step` — Conversational two-step multi-turn
- `v-bare-prompt` — Stripped to bare essentials (best balance)
- `v-single-recognizable` — Added "recognizable + details" phrasing
- `v-no-think-cap` — Removed thinking budget, raised temperature
- `v-orientation` — Added portrait/landscape hint
- `v-gemini3-flash` — Switched to gemini-3-flash-preview
- `v-raw-svg-parser` — Raw SVG output + DOMParser (current architecture)
- `v-grid-overlay` — Grid overlay, cell magnification, distance measurement

## Environment

- **Dev server:** `npx vite --port 5182` or use preview server
- **Gemini key:** `.env.local` with `VITE_GEMINI_KEY=AIza...`
- **Build:** `npx vite build`
- **CLI testing:** `node test-prompt.mjs --tag NAME [--image PATH]`
- **Deploy target:** Vercel (static + optional serverless)

## Known Issues / Next Steps

1. **Prompt consistency** — Output quality varies between runs (non-deterministic)
2. **Raw SVG parsing** — Some edge cases in the parser (nested groups, style attrs)
3. **Grid on Pointillist** — Grid lines render but cell magnification doesn't work (no composition object for canvas)
4. **Reflection detection** — `analyzeImage.js` still misses puddle reflections
5. **Test with diverse photos** — Flowers, portraits, landscapes without buildings
