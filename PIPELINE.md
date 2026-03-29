# PaintWise AI SVG Pipeline

## Overview

Single-call pipeline using Gemini 3 Flash BYOK (Bring Your Own Key) from the browser. The model receives the photo + a conversational prompt and outputs raw SVG markup, which is parsed into a layered composition using DOMParser.

## Pipeline Flow

```
User Photo → resize to 2000px → base64 JPEG
    ↓
Gemini 3 Flash API (single call, raw SVG output)
    ↓
Raw <svg> with <g id="layer-name"> groups
    ↓
DOMParser → parseSvgToComposition()
    ↓
{ viewBox, layers: [{ id, name, elements: [{ type, attrs }] }] }
    ↓
SvgViewer renders with layer toggles, grid, FX
```

## API Configuration

- **Model:** `gemini-3-flash-preview`
- **Temperature:** 0.8
- **Max output tokens:** 65536
- **No thinking budget cap** (removed — lets model reason freely)
- **No system instruction** (conversational prompt only)
- **Image:** JPEG, max 2000px dimension

## The Prompt

```
Hey buddy, can you help me deconstruct this [portrait/landscape] photo
into a buildable image made of svg layers of each color for a painting
tutorial app im working on? please first analyze the colors, perspective,
and proportions in the image and then recreate a sort of approximation
from shapes. it should be recognizable, with as many details as you can
recreate - but with simple svg shapes. Build it as 8-10 color layers
ordered back to front.

Output the result as a complete SVG element with viewBox="0 0 W H".
Wrap each color layer in a <g id="layer-name"> tag. No markdown fences
around the SVG, no extra text after it.
```

The viewBox dimensions are calculated from the image's aspect ratio:
`vbW = 1000, vbH = Math.round(1000 / (width / height))`

## SVG Parser

`parseSvgToComposition(svgText)` in `geminiSvg.js`:

1. Extracts `<svg>...</svg>` from the API response text
2. Strips any markdown fences
3. Parses with `DOMParser` (browser built-in)
4. Reads `viewBox` attribute
5. Each `<g>` with an `id` becomes a layer
6. Child elements converted to `{ type, attrs }` format
7. SVG attributes auto-camelCased (stroke-width → strokeWidth)
8. `<defs>` content preserved as raw HTML string
9. Top-level shapes (not in groups) collected into an "ungrouped" layer

Supported element types: rect, circle, ellipse, path, line, polygon, polyline, text, use, g, defs

## Verification

`verifyComposition.js` checks:
1. Schema: viewBox format, layers array, element types
2. ViewBox aspect ratio vs image dimensions (warn if >10% off)
3. Color accuracy: hex colors within RGB distance 150 of k-means centroids
4. Element count sanity (<500 elements, no empty layers)
5. Layer count (2-12)

## Caching

- Composition cached in localStorage as `pw-comp-{hash}` (version 4)
- Hash is FNV-1a over sampled image data URL characters
- Force regenerate bypasses cache

## CLI Testing

```bash
# Default test (reference sunset image)
node test-prompt.mjs --tag my-test

# Test specific image
node test-prompt.mjs --tag kayak --image test-images/kayak.jpg

# Raw SVG output test
node test-raw-svg.mjs --tag my-test --image test-images/photo.jpg
```

Results saved to `test-results/<tag>-<timestamp>.json` + `.svg`
