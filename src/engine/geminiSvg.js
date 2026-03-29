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
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    // Remove opening fence
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
    // Remove closing fence
    cleaned = cleaned.replace(/\n?```\s*$/, '');
  }

  // Evaluate math expressions in numeric JSON values
  // e.g. "y2": 372 + (270 - (230 + 1)) * 0.85 → "y2": 405.15
  cleaned = cleaned.replace(/:\s*(\d[\d\s+\-*/().]*\d)\s*([,\n\r\}])/g, (match, expr, after) => {
    try {
      const val = Function('"use strict"; return (' + expr + ')')();
      if (typeof val === 'number' && isFinite(val)) {
        return ': ' + Math.round(val * 100) / 100 + after;
      }
    } catch { /* leave as is */ }
    return match;
  });

  // Try parsing the cleaned text
  try { return JSON.parse(cleaned); } catch { /* */ }

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

const DRAFTSMAN_PROMPT = `You are a precise Computer Vision API analyzing a photograph for watercolor painting deconstruction. Extract structure using a UNIVERSAL painter's ontology that works for ANY subject — landscapes, portraits, still life, urban, nature.

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

Be EXHAUSTIVE. Soft volumes need 3-5 sub-shapes each (core + wisps). Hard geometry needs lit + shadow faces. Map the horizon silhouette profile. List 5+ focal details.`;

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

// ── Call 2: The "Painter" — SVG with Watercolor Physics ─────────────
//
// BEST VERSION (tagged v-best-painter). Produces the highest quality output.
// Uses specific SVG technique instructions with examples.
// Procedural cloud stacking, jagged horizon, reflection math.

function buildPainterPrompt(inventory) {
  let vbW = 800, vbH = 600;
  if (inventory.aspectRatio === 'portrait') {
    vbW = 533; vbH = 800;
  }

  const hPercent = inventory.horizon_y_percent || 50;
  const hY = Math.round(hPercent / 100 * vbH);
  const hasRefl = inventory.reflection?.present === true;

  return `You are an SVG engineer creating a watercolor painting study. Study the structural data and the photograph. Render EVERY element the Draftsman identified using clean geometric forms, procedural layered opacity for organic shapes, and mathematical transforms for reflections.

STRUCTURAL DATA:
${JSON.stringify(inventory, null, 2)}

VIEWBOX: "0 0 ${vbW} ${vbH}"
HORIZON Y: ${hY}px (${hPercent}% from top)
HAS REFLECTION: ${hasRefl}
Coords: x_px = percent/100 * ${vbW}, y_px = percent/100 * ${vbH}

Return ONLY valid JSON. No markdown fences. All numeric values must be COMPUTED NUMBERS, not math expressions.
{ "viewBox": "0 0 ${vbW} ${vbH}", "layers": [{ "id": "string", "name": "string", "description": "string", "paintingTip": "string", "elements": [{ "type": "rect|path|circle|ellipse|line|defs", "attrs": {} }] }] }

=== LAYER STRUCTURE (4-7 layers, lightest to darkest) ===

Layer 1: "Base Washes"
  Gradient rects for the major color zones identified in the structural data.
  If there's a horizon, use SEPARATE gradient rects for each zone.
  Gradients go in defs elements with "content" string.
  Example defs: {"type":"defs","content":"<linearGradient id=\\"skyA\\" x1=\\"0%\\" y1=\\"0%\\" x2=\\"0%\\" y2=\\"100%\\"><stop offset=\\"0%\\" stop-color=\\"#5d85a6\\"/><stop offset=\\"100%\\" stop-color=\\"#d69c7a\\"/></linearGradient>"}
  Example rect: {"type":"rect","attrs":{"x":0,"y":${hY},"width":${vbW},"height":${vbH - hY},"fill":"url(#skyA)"}}

Layer 2: "Soft Volumes" (clouds, water ripples, foliage, organic forms — whatever the Draftsman found)
  === PROCEDURAL STACKING ===
  Do NOT draw one giant path per volume. Each mass must be built by stacking
  5-10 SMALLER overlapping <path> elements with VARYING opacities:
    - 2-3 large shadow shapes (cool dark color, opacity 0.2-0.4)
    - 2-3 midtone shapes (warm color, opacity 0.4-0.6)
    - 2-3 highlight shapes (near-white, opacity 0.6-0.9)
    - 1-2 <circle> elements for the brightest highlights (opacity 0.8-0.9)
  Use Cubic Bezier (C/S) curves with LUMPY edges:
    "M100,200 C130,150 180,140 220,170 S290,200 320,180 C350,160 380,190 400,200 L400,250 C300,260 200,255 100,250 Z"
  This stacking creates the wet-on-wet watercolor bleed effect.
  If reflection exists: include reflected versions (darker, lower opacity) on the other side.

Layer 3: "Hard Geometry" (architecture, vehicles, objects — whatever rigid forms the Draftsman found)
  a) ONE dark shadow <rect> behind the group as a depth base.
  b) Individual elements as CLEAN <rect> elements on top, positioned from the inventory bounds.
  c) Sub-details (windows, markings) as small dark <rect> elements.
  d) If a horizon_silhouette was identified, render it as a jagged <path>.

${hasRefl ? `Layer 4: "Reflection"
  For EVERY element above the horizon, create a mirrored copy:
  - reflected_height = real_height × 0.85
  - reflected_y = horizon_y ± (distance from horizon × 0.85)
  - Color darkened by multiplying RGB by 0.80
  - Opacity reduced by 0.15 from the real element
  Overlay "Surface Texture" ON TOP of the reflection.

` : ''}Layer ${hasRefl ? 5 : 4}: "Surface Texture"
  For textured surfaces identified by the Draftsman:
  a) Dark <path> wash (opacity 0.4-0.6)
  b) 2-4 sweeping <path> strokes: fill="none", stroke=dark_color,
     strokeWidth=40-60, strokeDasharray="5,15,20,10", opacity 0.2-0.4
  c) 5-10 small <circle> grit dots (r=1-3)

Layer ${hasRefl ? 6 : 5}: "Focal Details"
  The darkest marks (last in watercolor — least water).
  Render EVERY focal_detail from the inventory using appropriate primitives.
  Opacity 0.7-0.95.
${hasRefl ? `  Include reflected versions of each detail.` : ''}

=== RULES ===
1. RENDER EVERY ELEMENT from the structural data. Do not skip anything.
2. ALL attrs camelCase: strokeWidth, strokeDasharray, strokeLinecap.
3. COLORS: ONLY from palette. May darken (×0.80) or lighten (×1.15).
4. ATMOSPHERIC DEPTH: far=low opacity (0.3-0.5), near=high opacity (0.7-0.95).
5. PAINTING TIPS: Name pigments, brush sizes, techniques.
6. All numeric values must be COMPUTED NUMBERS (e.g. 372, not "372 + 50 * 0.85").`;
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
    console.error('[PaintWise] SVG parse failed. First 200 chars:', JSON.stringify(text.slice(0, 200)));
    console.error('[PaintWise] Last 200 chars:', JSON.stringify(text.slice(-200)));
    // Try direct parse to get the actual error message
    try { JSON.parse(text); } catch (e) {
      console.error('[PaintWise] JSON.parse error:', e.message);
    }
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
