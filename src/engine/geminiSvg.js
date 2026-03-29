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

  // Strip markdown fences (complete or truncated)
  let cleaned = text;
  // Complete fence
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* */ }
    cleaned = fence[1].trim();
  } else {
    // Opening fence without closing (truncated)
    const openFence = cleaned.match(/```(?:json)?\s*([\s\S]*)/);
    if (openFence) {
      cleaned = openFence[1].trim();
    }
  }

  // Find outermost braces
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  const end = cleaned.lastIndexOf('}');
  if (end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* */ }
  }

  // Repair truncated JSON
  let json = cleaned.slice(start);
  // Clean up trailing partial values
  json = json.replace(/,\s*"[^"]*$/, '');       // trailing key without value
  json = json.replace(/,\s*$/, '');              // trailing comma
  json = json.replace(/:\s*"[^"]*$/, ': ""');    // cut mid-string value
  json = json.replace(/:\s*$/, ': null');         // cut after colon

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
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: maxTokens,
        // Limit thinking tokens so they don't eat the output budget
        thinkingConfig: { thinkingBudget: 2048 },
      },
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
  ], 65536);

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

  return `You are a Master Watercolorist and expert SVG engineer. Take this structural analysis and the original photograph and produce a layered SVG that looks like a watercolor painting study — organic, translucent, with visible brushwork character.

STRUCTURAL DATA:
${JSON.stringify(inventory, null, 2)}

VIEWBOX: "0 0 ${vbW} ${vbH}"
Coordinate conversion: x_px = percent/100 * ${vbW}, y_px = percent/100 * ${vbH}

Return ONLY valid JSON. No markdown fences.

{ "viewBox": "0 0 ${vbW} ${vbH}", "layers": [{ "id": "string", "name": "string", "description": "string", "paintingTip": "string", "elements": [{ "type": "rect|path|circle|ellipse|line|defs", "attrs": {} }] }] }

=== MANDATORY LAYER ORDER (light to dark, like real watercolor) ===

You MUST create exactly these layers in this order. This mirrors how a watercolorist builds a painting:

Layer 1: "Sky Wash" — The lightest, most dilute wash. A full-width gradient rect covering the sky zone. Use a linearGradient in a defs element. Opacity 0.4-0.6. This is the first brushstroke on wet paper.

Layer 2: "Cloud Volumes" — Semi-transparent organic shapes for clouds. MUST use <path> with Cubic Bezier (C/S) curves creating lumpy, billowing, irregular edges. Each cloud is its OWN path — not a rectangle, not an ellipse. Cloud shadows are separate darker paths underneath. Opacity 0.3-0.6.

Layer 3: "Midground Architecture" — Buildings, walls, structural masses. Use <path> elements with SLIGHTLY WOBBLY edges (offset straight lines by 1-2px to look hand-drawn). Windows are small dark <rect> elements. Add structural details: ledges, signs, shadows under overhangs. Opacity 0.6-0.85.

Layer 4: "Reflection Zone" — THIS IS CRITICAL if a reflection exists:
  The reflection is NOT a copy of the architecture. It must be:
  a) Positioned BELOW the horizon axis (or ABOVE if the image is inverted — look at the structural data's reflection.axis_y_percent)
  b) Vertically COMPRESSED: multiply height by 0.85. A building that is 50px tall in reality is only 42px in reflection.
  c) Colors DARKENED: multiply each RGB channel by 0.80-0.85. Water absorbs ~15-20% of light.
  d) Edges WOBBLED: vertical lines should use bezier curves with 2-4px horizontal displacement to simulate water ripple. A straight pole becomes a gently wavy line.
  e) Opacity REDUCED to 0.4-0.6 (the reflection is see-through to the water/sky beneath).
  f) The reflected sky/clouds should also appear, darker and slightly blurred (use larger, softer shapes).
  MATH: If real element is at y_real with height h_real, and horizon is at h_y:
    reflected_height = h_real * 0.85
    reflected_y = h_y - reflected_height (for above-horizon reflection)
    OR reflected_y = h_y (for below-horizon reflection)

Layer 5: "Ground Texture" — Concrete, asphalt, sand, wet surfaces. Use <path> elements with:
  fill="none", stroke=dark_color, strokeWidth="30-60", strokeDasharray="5, 15, 20, 10"
  This creates the dry-brush-on-cold-pressed-paper effect. 2-4 sweeping curved paths. Opacity 0.15-0.35.

Layer 6: "Dark Details" — The darkest, most concentrated pigment: poles, wires, birds, deep shadows, window recesses, signage text. These go LAST because in watercolor, darks are applied with the least water. Opacity 0.7-0.95. Poles are thin <line> or <rect> elements. Birds are small <path> v-shapes. Wires are thin <line> elements.

=== SVG TECHNIQUE RULES ===

CLOUDS: Each cloud MUST be a <path> with C (cubic bezier) commands. Example of a billowing cumulus:
  "M100,150 C120,100 180,80 220,120 S300,160 340,130 C380,100 400,130 420,140 S460,180 480,150 L480,200 C400,210 300,220 200,200 Z"
  The top edge billows (up-down-up curves). The bottom edge is flatter. NEVER use <rect> or <ellipse> for clouds.

GRADIENTS: Put gradient SVG markup as a string in a defs element's "content" field:
  { "type": "defs", "content": "<linearGradient id=\\"skyGrad\\" x1=\\"0\\" y1=\\"0\\" x2=\\"0\\" y2=\\"1\\"><stop offset=\\"0%\\" stop-color=\\"#82a0ba\\"/><stop offset=\\"100%\\" stop-color=\\"#d4a986\\"/></linearGradient>" }
  Then reference: { "type": "rect", "attrs": { "fill": "url(#skyGrad)", ... } }

ATTRS: ALL camelCase — strokeWidth, strokeDasharray, strokeLinecap, fillOpacity. Never hyphenated.

COLORS: Use ONLY hex codes from the palette in the structural data. You may darken (multiply by 0.7-0.9) or lighten (multiply by 1.1-1.3) for shadows/highlights, but base hues must come from the palette.

PAINTING TIPS: Each layer's paintingTip should name the specific pigments from the palette, the brush (size 12 flat, size 6 round, rigger), and technique (wet-on-wet, wet-on-dry, dry brush, lifting, charging).`;
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
