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

const DRAFTSMAN_PROMPT = `You are a precise Computer Vision API analyzing a photograph for watercolor painting deconstruction. Extract geometric structure, 3D volume, lighting, and micro-details into structured JSON.

Output ONLY valid JSON. No markdown fences. No explanation.

=== EXTRACTION PROTOCOL ===

1. **Composition:** Aspect ratio, horizon Y-percent (0=top, 100=bottom).
2. **Reflection:** Look CAREFULLY for puddle/water/glass reflections — even subtle ones. If the image has ANY vertical symmetry across the horizon, it's a reflection.
3. **Light Source Analysis:** Identify the light direction. For EVERY architectural element, determine which face is LIT (catching light) and which face is in SHADOW. This creates 3D volume.
4. **Architectural Volumes (NOT flat rectangles):** Each building is a 3D VOLUME with:
   - A "lit_face" (the sun-facing surface — warmer, brighter color)
   - A "shadow_face" (the side away from light — cooler, darker color)
   - These are TWO separate bounding boxes sharing an edge, creating a sense of depth.
5. **Scale Anchors (MANDATORY):** You MUST identify at least 5 micro-details that break up empty space and give human scale: birds in flight, antennas, streetlamp fixtures, signage text, railings, puddle edge debris, cracks, wires. Map each with precise coordinates.
6. **Cloud Topology:** Each cloud mass needs its own bounding box with shape description: "large cumulus, flat base at Y=15%, billowing top reaching Y=5%, left edge at X=10%, right edge X=40%". Describe the edge character (sharp, diffuse, wispy).
7. **Window Irregularity:** Do NOT map windows as a uniform grid. In real buildings, windows have varying sizes, some are recessed in shadow, some catch light glare, some are partially obscured. Describe which windows are dark/recessed, which are bright/reflective.

{
  "aspectRatio": "portrait" or "landscape",
  "horizon_y_percent": number,
  "horizon_description": "string",
  "reflection": {
    "present": boolean,
    "type": "puddle" | "water" | "glass" | "none",
    "axis_y_percent": number,
    "description": "what is reflected, how sharp/distorted, what surface creates it"
  },
  "palette": [
    { "hex": "#from_authoritative_palette", "pigment": "Traditional Watercolor Name", "where": "where this color dominates" }
  ],
  "light": {
    "direction": "e.g. low angle from upper-right, golden hour",
    "angle_degrees": number (0=directly above, 90=horizon level),
    "warm_zone": "which areas catch warm light",
    "cool_zone": "which areas are in cool shadow"
  },
  "layers": [
    {
      "name": "Layer Name",
      "z_index": 1,
      "description": "what this layer contains",
      "elements": [
        {
          "type": "gradient_box | building_lit | building_shadow | window_dark | window_bright | cloud | pole | wire | bird | sign | texture | shadow_cast | reflection_element | scale_anchor",
          "bounds": { "x": percent, "y": percent, "w": percent, "h": percent },
          "color": "#hex",
          "opacity_hint": number (0.3 for distant/faint, 0.9 for close/dark),
          "edge_character": "sharp | soft | wobbly | diffuse",
          "details": "specific description"
        }
      ]
    }
  ],
  "scale_anchors": [
    { "type": "bird | antenna | lamp_fixture | crack | wire | debris | railing | sign_text",
      "position": { "x": percent, "y": percent },
      "size": "tiny | small | medium",
      "details": "v-shape bird in flight" }
  ],
  "textures": [
    { "where": "location", "type": "wet_concrete | dry_asphalt | water_ripple | rough_wall",
      "bounds": { "x": 0, "y": 0, "w": 100, "h": 50 },
      "character": "heavy grit | subtle grain | smooth | cracked" }
  ]
}

Be EXHAUSTIVE. Every building gets BOTH a lit_face AND shadow_face element. Every cloud gets its own bounding box with edge description. You MUST list at least 5 scale_anchors.`;

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

  return `You are a Master Watercolorist and expert SVG engineer. Transform this structural analysis into an SVG that has DEPTH, ATMOSPHERE, and the ORGANIC IMPERFECTION of real watercolor — not flat design vectors.

STRUCTURAL DATA:
${JSON.stringify(inventory, null, 2)}

VIEWBOX: "0 0 ${vbW} ${vbH}"
Coords: x_px = percent/100 * ${vbW}, y_px = percent/100 * ${vbH}

Return ONLY valid JSON. No markdown fences.
{ "viewBox": "0 0 ${vbW} ${vbH}", "layers": [{ "id": "string", "name": "string", "description": "string", "paintingTip": "string", "elements": [{ "type": "rect|path|circle|ellipse|line|defs", "attrs": {} }] }] }

=== MANDATORY LAYERS (light → dark, like real watercolor) ===

Layer 1: "Sky Wash" — Lightest wash. Full-width gradient rect. Use linearGradient in defs "content" field. Opacity 0.4-0.6.

Layer 2: "Cloud Volumes" — ORGANIC bezier paths (C/S curves). Each cloud gets:
  - A LIGHT path (the sunlit billowing top, warm color, opacity 0.5-0.7)
  - A SHADOW path underneath (darker, cooler, opacity 0.3-0.5)
  Top edge: lumpy billowing curves. Bottom edge: flatter. Example:
  "M100,150 C120,100 180,80 220,120 S300,160 340,130 C380,100 400,130 420,140 L420,200 C300,210 200,195 100,200 Z"
  NEVER rectangles or ellipses for clouds.

Layer 3: "Architecture" — Buildings with 3D VOLUME:
  - Each building gets TWO overlapping shapes: a LIT FACE (warm, brighter) and a SHADOW FACE (cool, darker, slightly offset). This creates depth.
  - Edges have 1-3px wobble (not perfectly straight — hand-painted feel).
  - Windows: NEVER a perfect uniform grid. Vary width by 1-4px, vary spacing, skip some windows (glare), darken some (recessed). Group irregularly.
  - Add shadow polygons UNDER overhangs and ledges (darker, translucent trapezoids).
  - Opacity 0.65-0.9.

Layer 4: "Reflection" — CRITICAL if reflection exists in structural data:
  MATH: horizon at h_y (from structural data). For each real element at y_real with height h:
    reflected_h = h * 0.85 (vertical compression — perspective foreshortening)
    reflected_y = h_y + (h_y - y_real - h) * 0.85 (mirror across horizon, compressed)
  VISUAL:
    - Colors: multiply RGB by 0.80 (water absorbs light)
    - Edges: add 2-5px bezier wobble to ALL vertical lines (water ripple distortion)
    - Opacity: 0.35-0.55 (lower than real elements — see-through to water)
    - Reflected clouds: larger, softer, more diffuse shapes
    - Reflected buildings: same wobbled edges + slight horizontal smear
  If reflection.type is "puddle", the reflecting surface itself may have dark edges and grit texture.

Layer 5: "Ground Texture" — Dry brush effect. Use <path> with:
  fill="none", stroke=dark_hex, strokeWidth=30-60, strokeDasharray="5,15,20,10"
  2-4 sweeping curved paths. Opacity 0.15-0.3.

Layer 6: "Dark Details" — Darkest, most concentrated pigment (last in watercolor).
  Poles: thin <rect> or <line>, width 2-4px. Slight lean or bend — not perfectly vertical.
  Birds: <path> v-shapes with slight asymmetry. Each bird DIFFERENT size.
  Wires: thin <line> elements, opacity 0.5-0.7.
  Window recesses, signage, railings, cracks — all the scale_anchors from the data.
  Opacity 0.75-0.95.

=== ATMOSPHERIC PERSPECTIVE (MANDATORY) ===

Background elements (distant sky, far clouds): LOW opacity (0.3-0.5), SOFT edges.
Midground elements (buildings, main clouds): MEDIUM opacity (0.5-0.75).
Foreground elements (texture, poles, birds): HIGH opacity (0.75-0.95), SHARP edges.
This gradient of opacity creates the illusion of depth and atmosphere.

=== TECHNIQUE RULES ===

GRADIENTS: Defs element with "content" string containing SVG gradient markup.
  { "type": "defs", "content": "<linearGradient id=\\"sg\\" x1=\\"0\\" y1=\\"0\\" x2=\\"0\\" y2=\\"1\\"><stop offset=\\"0%\\" stop-color=\\"#82a0ba\\"/><stop offset=\\"100%\\" stop-color=\\"#d4a986\\"/></linearGradient>" }

ALL ATTRS camelCase: strokeWidth, strokeDasharray, strokeLinecap, fillOpacity.

COLORS: Use ONLY hex codes from the structural data palette. May darken (×0.7-0.9) or lighten (×1.1-1.3) for shadows/highlights.

PAINTING TIPS: Name specific pigments, brush sizes (size 12 flat, size 6 round, rigger), techniques (wet-on-wet, wet-on-dry, dry brush, lifting, charging).

NO FLAT DESIGN. Every shape should have variation, overlap, transparency. The SVG should look like a painting study, not an infographic.`;
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
