/**
 * Two-call AI SVG pipeline using Gemini BYOK.
 *
 * Call 1 (Scene Inventory): Gemini looks at the image with fresh eyes
 *   and produces a detailed element-by-element inventory with positions,
 *   colors, and descriptions. No hints from our algorithms.
 *
 * Call 2 (SVG Construction): Takes the inventory + image and produces
 *   the SVG composition JSON matching our SvgViewer schema.
 *
 * This separation means Call 1 can be cached independently (scene doesn't
 * change), and Call 2 is more reliable because the creative analysis
 * is already done.
 */

import { verifyComposition } from './verifyComposition.js';

// ── Utilities ──────────────────────────────────────────────────────

function resizeImageToBase64(imageSrc, maxDim = 1200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageSrc;
  });
}

function fnv1aHash(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 100) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function cacheRead(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v === 2) return parsed.data;
  } catch { /* ignore */ }
  return null;
}

function cacheWrite(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ v: 2, data })); }
  catch { /* full */ }
}

function extractJson(text) {
  // Direct parse
  try { return JSON.parse(text); } catch { /* */ }

  // Strip markdown fences
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* */ }
  }

  // Find outermost braces
  const start = text.indexOf('{');
  if (start < 0) return null;
  const end = text.lastIndexOf('}');
  if (end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* */ }
  }

  // Repair truncated JSON
  let json = text.slice(start);
  json = json.replace(/,\s*"[^"]*$/, '');
  json = json.replace(/,\s*$/, '');
  json = json.replace(/:\s*"[^"]*$/, ': ""');

  let braces = 0, brackets = 0, inStr = false, esc = false;
  for (const ch of json) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
  }
  for (let i = 0; i < brackets; i++) json += ']';
  for (let i = 0; i < braces; i++) json += '}';

  try {
    const result = JSON.parse(json);
    console.warn('[PaintWise] Repaired truncated JSON');
    return result;
  } catch { /* */ }

  return null;
}

// ── Gemini API caller ──────────────────────────────────────────────

async function callGemini(apiKey, model, parts, maxTokens = 65536) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
    }),
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err?.error?.message || detail;
    } catch { /* */ }
    throw new Error(`Gemini API error: ${detail}`);
  }

  const result = await response.json();

  if (result?.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${result.promptFeedback.blockReason}`);
  }

  const candidate = result?.candidates?.[0];
  if (!candidate) {
    console.error('[PaintWise] Full response:', JSON.stringify(result).slice(0, 2000));
    throw new Error('Gemini returned no candidates');
  }

  if (candidate.finishReason === 'SAFETY') {
    throw new Error('Gemini blocked the response (safety filter)');
  }
  if (candidate.finishReason === 'MAX_TOKENS') {
    console.warn('[PaintWise] Response truncated — will attempt repair');
  }

  let text = '';
  for (const part of (candidate.content?.parts || [])) {
    if (part.text) text += part.text;
  }

  if (!text) throw new Error('Gemini returned empty response');

  console.log(`[PaintWise] Response: ${text.length} chars, finish: ${candidate.finishReason}`);
  return text;
}

// ── Call 1: The "Draftsman" — Structural Analysis ─────────────────
//
// Precise Computer Vision extraction: geometric bounding boxes,
// z-index layering, color palette, horizon, micro-details.
// No artistic interpretation — just raw spatial and chromatic data.

const DRAFTSMAN_PROMPT = `You are a precise Computer Vision API. Your task is to analyze the provided image and extract its geometric structure, Z-index layering, and core color palette into a structured JSON format.

Do NOT generate code or artistic interpretation. Output ONLY valid JSON. No markdown fences.

Follow this strict extraction protocol:

1. **Aspect Ratio & Dimensions:** Is it portrait or landscape? What approximate ratio?
2. **Horizon & Composition:** Identify the primary horizon line as a Y-axis percentage (0=top, 100=bottom). Describe what forms the horizon.
3. **Reflection:** Is there a reflection? What type (puddle, lake, glass)? What is reflected?
4. **Color Palette:** Extract 6-10 dominant colors. Return them as hex codes with traditional watercolor pigment names (e.g., "French Ultramarine", "Burnt Sienna", "Naples Yellow").
5. **Z-Index Layer Mapping:** Break the image into 5-8 logical background-to-foreground layers. Each layer gets a descriptive name, z-index number, and a list of elements.
6. **Geometric Bounding Boxes:** For EVERY architectural element, provide X, Y, Width, and Height as percentages (0-100). Be precise — measure carefully.
7. **Micro-Details:** Identify tiny elements (birds, streetlamps, text/signage, wires, texture patches) with their approximate coordinates and descriptions.

{
  "aspectRatio": "portrait" or "landscape",
  "horizon_y_percent": number,
  "horizon_description": "what forms the horizon line",
  "reflection": {
    "present": boolean,
    "type": "puddle" | "water" | "glass" | "none",
    "axis_y_percent": number,
    "description": "what is reflected and how"
  },
  "palette": [
    { "hex": "#hexvalue", "pigment": "traditional watercolor pigment name", "where": "where this color dominates" }
  ],
  "light": {
    "direction": "description",
    "warm_zone": "where warm light is strongest",
    "cool_zone": "where cool shadows fall"
  },
  "layers": [
    {
      "name": "Layer Name",
      "z_index": 1,
      "description": "what this layer contains",
      "elements": [
        {
          "type": "gradient_box" | "building" | "window" | "cloud" | "pole" | "wire" | "bird" | "sign" | "texture" | "shadow" | "reflection_element",
          "bounds": { "x": percent, "y": percent, "w": percent, "h": percent },
          "color": "#hex or description",
          "details": "specific visual details — shape, text, angles, material"
        }
      ]
    }
  ],
  "textures": [
    { "where": "location", "type": "concrete | asphalt | water-ripple | paper-grain", "bounds": { "x": 0, "y": 0, "w": 100, "h": 50 } }
  ]
}

Be EXHAUSTIVE and PRECISE. Measure every bounding box carefully. List every window, every bird, every wire, every sign. Use actual hex colors sampled from the image.`;

function buildDraftsmanContext(metadata) {
  if (!metadata) return '';

  const parts = ['\n\n### AUTHORITATIVE ALGORITHMIC DATA\nDo not guess the color palette. You MUST use the following data provided by our local algorithmic analysis as your ground truth.'];

  // Feed centroids as authoritative palette — strict dropdown, no invention
  if (metadata.centroids?.length) {
    const hexList = metadata.centroids.map(c =>
      '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
    );
    parts.push(`\n**Authoritative Palette** (k-means clustered from actual pixels): ${JSON.stringify(hexList)}`);
    parts.push('Assign ONLY these exact hex codes to the elements you map. Do NOT invent new hex codes. For each hex, provide the closest traditional watercolor pigment name.');
  }

  // Horizon
  if (metadata.hasHorizon && metadata.horizonY != null) {
    const pct = Math.round((metadata.horizonY / metadata.height) * 100);
    parts.push(`\n**Horizon Detected:** Strong horizontal contrast line at ~${pct}% from the top. Verify and refine this position.`);
  }

  // Reflection — strong hint to look carefully
  const reflDetected = metadata.hasReflection;
  parts.push(`\n**Structural Hint — Reflection:** Our analysis ${reflDetected ? 'detected horizontal symmetry suggesting a reflection' : 'did NOT detect a reflection, BUT look carefully anyway'}. Puddle reflections and water mirrors are common in urban golden-hour photography. If you see ANY symmetry across the horizon (even partial), set has_reflection to true and map the reflection axis.`);

  // Dimensions
  parts.push(`\n**Image:** ${metadata.width} x ${metadata.height} pixels (${metadata.width > metadata.height ? 'landscape' : 'portrait'})`);

  return parts.join('\n');
}

async function analyzeScene(apiKey, imageBase64, model, metadata) {
  console.log('[PaintWise] Call 1 (Draftsman): Extracting structure...');

  const context = buildDraftsmanContext(metadata);
  const fullPrompt = DRAFTSMAN_PROMPT + context;

  const text = await callGemini(apiKey, model, [
    { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
    { text: fullPrompt },
  ], 32768);

  const inventory = extractJson(text);
  if (!inventory) {
    console.error('[PaintWise] Inventory parse failed. Raw:', text.slice(0, 3000));
    throw new Error('Failed to parse scene inventory from AI');
  }

  console.log('[PaintWise] Scene inventory:', {
    zones: inventory.zones?.length,
    elements: inventory.elements?.length,
    colors: inventory.colorPalette?.length,
    horizon: inventory.horizon,
    reflection: inventory.reflection,
  });

  return inventory;
}

// ── Call 2: The "Painter" — Organic SVG Rendering ─────────────────
//
// Takes the rigid geometric data from the Draftsman and applies
// watercolor physics: translucency, organic bezier shapes, dry brush
// texture, reflection distortion, and intentional imperfection.

function buildPainterPrompt(inventory) {
  let vbW = 800, vbH = 600;
  if (inventory.aspectRatio === 'portrait') {
    vbW = 533; vbH = 800;
  }

  return `You are a Master Watercolorist and expert SVG engineer. I will provide you with a structured JSON map of an image's geometry and color palette extracted by computer vision.

Your task is to translate this rigid geometric data into a beautiful, ORGANIC SVG composition that looks like a watercolor painting study — not a transit map.

STRUCTURAL DATA FROM DRAFTSMAN:
${JSON.stringify(inventory, null, 2)}

VIEWBOX: "0 0 ${vbW} ${vbH}"

Convert percentage coordinates to pixels: x_px = percent/100 * ${vbW}, y_px = percent/100 * ${vbH}

Return ONLY valid JSON. No markdown fences. No explanation.

{
  "viewBox": "0 0 ${vbW} ${vbH}",
  "layers": [
    {
      "id": "kebab-case-id",
      "name": "Layer Name",
      "description": "what this layer contains",
      "paintingTip": "beginner watercolor advice: brush, technique, pigments",
      "elements": [
        { "type": "rect|circle|ellipse|path|line|defs", "attrs": { camelCase SVG attributes } }
      ]
    }
  ]
}

CRITICAL WATERCOLOR SVG TECHNIQUES — you MUST apply these:

1. **FLUID TRANSLUCENCY:** NEVER use opacity 1.0 for background or midground fills. Use 0.3-0.85. Overlapping cloud and water layers should feel like wet pigment combining. Background washes at 0.3-0.5, midground at 0.5-0.7, foreground at 0.7-0.9.

2. **ORGANIC SHAPES — NO RIGID RECTS for natural forms:** Convert cloud bounding boxes into SVG <path> elements using Cubic (C) and Smooth (S) Bezier curves. Clouds must have lumpy, irregular, billowing edges — NOT rectangles or perfect ellipses. For buildings, introduce a 1-2 pixel wobble to straight lines so they look hand-painted, not CAD-drawn.

3. **DRY BRUSH TEXTURE:** For concrete, ground, asphalt, or rough surfaces, use thick <path> strokes with fill="none" and random-looking strokeDasharray patterns like "5, 15, 20, 10" or "8, 12, 3, 18". Use strokeWidth 30-60 and low opacity (0.2-0.4). This emulates cold-pressed paper catching dry pigment.

4. **WATER REFLECTION DISTORTION:** If there's a reflection, the reflected elements must be:
   - Vertically compressed by 0.85x
   - Colors darkened ~15-20%
   - Vertical edges given slight bezier wobble (water ripple)
   - Slightly lower opacity than the real elements

5. **GRADIENTS:** Put linearGradient/radialGradient SVG markup in a "defs" element's "content" field (as a raw SVG string). Reference via url(#gradientId) in fill attrs. Sky gradients should have 4-5 stops sampled from the palette.

6. **SVG PATH SYNTAX FOR CLOUDS:** Use paths like:
   "M50,200 C80,150 150,130 200,180 S300,220 350,190 C400,160 420,200 450,210 S500,250 520,200 L520,280 L50,280 Z"
   NOT rectangles. The control points create the organic, billowing shape.

7. **ALL ATTRS MUST BE camelCase:** strokeWidth, strokeDasharray, strokeLinecap, fillOpacity. NOT hyphenated.

8. **INCLUDE EVERY ELEMENT** from the structural data. Every building, window, bird, pole, wire, sign, texture patch.

9. **PAINTING TIPS** should name specific pigments (Burnt Sienna, French Ultramarine, Naples Yellow), brush types (size 12 flat, size 6 round, rigger), and techniques (wet-on-wet, dry brush, lifting, charging).

10. **LAYER ORDER:** 5-8 layers, strictly back-to-front:
    - Background sky gradient wash
    - Cloud volumes (organic bezier paths, translucent)
    - Architecture (buildings with wobble, windows as dark rects)
    - Foreground details (poles, wires, birds)
    - Texture overlays (dry brush dasharray paths)

11. **COLOR DISCIPLINE:** Use ONLY the hex codes from the structural data's palette. Do NOT invent new colors. You may darken or lighten these hex codes for shadows/highlights (multiply RGB by 0.7-0.9 for shadows, 1.1-1.3 for highlights), but the base hues must come from the palette.`;
}

async function generateSvgFromInventory(apiKey, imageBase64, inventory, model) {
  console.log('[PaintWise] Call 2 (Painter): Rendering organic SVG...');

  const prompt = buildPainterPrompt(inventory);

  const text = await callGemini(apiKey, model, [
    { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
    { text: prompt },
  ], 65536);

  const composition = extractJson(text);
  if (!composition) {
    console.error('[PaintWise] SVG parse failed. Raw:', text.slice(0, 3000));
    throw new Error('Failed to parse SVG composition from AI');
  }

  console.log('[PaintWise] Composition:', {
    viewBox: composition.viewBox,
    layers: composition.layers?.length,
    names: composition.layers?.map(l => l.name),
    totalElements: composition.layers?.reduce((s, l) => s + (l.elements?.length || 0), 0),
  });

  return composition;
}

// ── Main Export ─────────────────────────────────────────────────────

/**
 * Generate SVG composition via two-call Gemini pipeline.
 *
 * @param {string} apiKey - Gemini API key
 * @param {string} imageSrc - Image data URI
 * @param {object} analysisMetadata - For verification only (not sent to AI)
 * @param {object} options - { force, model, onProgress }
 * @returns {Promise<{ composition, warnings, inventory }>}
 */
export async function generateGeminiSvg(apiKey, imageSrc, analysisMetadata, options = {}) {
  if (!apiKey) throw new Error('Please enter your Gemini API key');

  const hash = fnv1aHash(imageSrc);
  const model = options.model || 'gemini-2.5-flash';
  const onProgress = options.onProgress || (() => {});

  // Check composition cache (skip if force)
  if (!options.force) {
    const cached = cacheRead(`pw-comp-${hash}`);
    if (cached) {
      const v = verifyComposition(cached, analysisMetadata);
      if (v.valid) {
        const inv = cacheRead(`pw-inv-${hash}`);
        return { composition: cached, warnings: v.warnings, inventory: inv };
      }
    }
  }

  // Resize image once for both calls
  onProgress({ step: 0, label: 'Preparing image...' });
  const imageBase64 = await resizeImageToBase64(imageSrc);

  // Call 1: Scene Inventory (check inventory cache first)
  onProgress({ step: 1, label: 'Analyzing your photo...' });
  let inventory = options.force ? null : cacheRead(`pw-inv-${hash}`);
  if (!inventory) {
    inventory = await analyzeScene(apiKey, imageBase64, model, analysisMetadata);
    cacheWrite(`pw-inv-${hash}`, inventory);
  } else {
    console.log('[PaintWise] Using cached scene inventory');
  }

  // Call 2: SVG Construction
  onProgress({ step: 2, label: 'Building SVG composition...' });
  const composition = await generateSvgFromInventory(apiKey, imageBase64, inventory, model);

  // Verify
  const verification = verifyComposition(composition, analysisMetadata);
  if (!verification.valid) {
    console.error('[PaintWise] Verification failed:', verification.errors);
    throw new Error(`Invalid composition: ${verification.errors.join('; ')}`);
  }

  // Cache composition
  cacheWrite(`pw-comp-${hash}`, composition);

  return { composition, warnings: verification.warnings, inventory };
}

export function clearSvgCache() {
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('pw-inv-') || key?.startsWith('pw-comp-') || key?.startsWith('paintwise-')) {
      toRemove.push(key);
    }
  }
  toRemove.forEach(k => localStorage.removeItem(k));
}
