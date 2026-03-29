# PaintWise — Handoff Document

## Current State (commit after this doc)

The app is functional with two rendering modes:
1. **Pointillist** — local canvas-based, 40K+ elliptical marks, instant, no API needed
2. **AI Composition** — Gemini 2.5 Flash two-call pipeline producing layered SVG

## What Works Well

- **Upload flow** — drag-drop, resize to 2000px, JPEG/PNG/WebP
- **Algorithmic analysis** — k-means palette (14 centroids), horizon detection, region maps, all in Web Worker
- **Pointillist canvas** — 10-round mark generation, grid focus with zoom, photo overlay
- **AI two-call pipeline** — Draftsman (scene inventory) → Painter (SVG JSON)
- **Color fidelity** — k-means centroids passed as authoritative palette to Gemini
- **SvgViewer** — layer toggle, step-through, outline mode, watercolor FX filter, save PNG/JPG
- **Reflection checkbox** — user manually flags reflections when algorithm misses them
- **Caching** — inventory and composition cached in localStorage by image hash
- **Math expression repair** — handles Gemini's `372 + 50 * 0.85` outputs
- **Markdown fence stripping** — handles Gemini wrapping JSON in ```json blocks

## Known Issues / What Needs Work

### SVG Quality Inconsistency
The AI composition output varies significantly between runs and between different photos. The puddle reflection photo sometimes produces excellent results and sometimes mediocre ones. The kayak photo produced nearly blank output. This is the #1 issue.

**Root cause:** Gemini's output is non-deterministic. The same prompt can produce wildly different SVG quality. The prompt is also long and complex, which means Gemini sometimes focuses on easy parts (gradients) and runs out of steam on hard parts (individual building rects, detailed reflections).

**Possible solutions to explore:**
- Split Painter into 2 calls (base composition + detail pass)
- Use `gemini-2.5-pro` instead of `flash` for higher quality (costs more)
- Add few-shot examples of good SVG output in the prompt
- Reduce prompt length to give Gemini more token budget for actual SVG

### Reflection Detection
Our `analyzeImage.js` fails to detect puddle reflections (like the inverted puddle photo). The user must manually check the "reflection" checkbox. The algorithm looks for mirrored luminance patterns across the horizon, but buildings in the middle break the heuristic.

### Generalizability
The Draftsman prompt uses agnostic ontology (base_wash/soft_volume/hard_geometry/focal_detail) which should work for any subject. But the Painter prompt still has some landscape-biased examples. Photos without horizons or buildings (like the kayak) produce thin results.

## Architecture

```
src/
  App.jsx                — State router (upload → painting)
  UploadPage.jsx         — Drag-drop upload + sample photo
  PaintingPage.jsx       — Results page (Pointillist | AI Composition tabs)
  SvgViewer.jsx          — SVG renderer with layers, controls, FX, save

  engine/
    analyzeImage.js      — Generic photo analysis (Web Worker compatible)
    generateMarks.js     — 10-round pointillist mark generation
    worker.js            — Web Worker wrapper
    pigments.js          — 79 watercolor pigments, LAB matching
    instructions.js      — Template painting instructions per round
    geminiSvg.js         — Two-call Gemini pipeline (Draftsman + Painter)
    claudeSvg.js         — Claude API caller (unused, kept for future)
    verifyComposition.js — Schema/color/proportion validation
    svgBuilder.js        — Algorithmic SVG builder (unused, kept for reference)
    useImageUpload.js    — Upload hook

api/
  generate-svg.js        — Vercel serverless function for Claude API (unused currently)

.env.local               — VITE_GEMINI_KEY (gitignored)
PIPELINE.md              — Full prompt documentation
```

## Key Files for Prompt Iteration

**`src/engine/geminiSvg.js`** — Contains both prompts:
- `DRAFTSMAN_PROMPT` (lines ~188-255) — Scene inventory extraction
- `buildPainterPrompt()` (lines ~330-420) — SVG construction
- `buildDraftsmanContext()` (lines ~257-284) — Injects k-means palette + hints
- `extractJson()` (lines ~66-125) — JSON parsing with fence stripping + math eval + truncation repair

**`src/SvgViewer.jsx`** — SVG renderer:
- Renders composition JSON as React SVG elements
- Handles defs/gradients via dangerouslySetInnerHTML
- Watercolor FX filters (feTurbulence, feGaussianBlur, feDisplacementMap)
- Save as PNG/JPG at 2x resolution

## Git Tags

- `v-best-puddle-result` — The commit that produced the best puddle reflection output

## Environment

- **Dev server:** `npx vite --port 5182` or use preview server
- **Gemini key:** `.env.local` with `VITE_GEMINI_KEY=AIza...`
- **Build:** `npx vite build` (clean, ~26 modules, ~80KB gzipped)
- **Deploy target:** Vercel (static + optional serverless for Claude API)

## Next Steps (Suggested Priority)

1. **Stabilize SVG quality** — the biggest bang-for-buck improvement
2. **Test with diverse photos** — portraits, still life, landscapes without buildings
3. **Consider gemini-2.5-pro** for higher quality at higher cost
4. **Improve reflection detection** in analyzeImage.js
5. **Add more example photos** to the upload page for testing
