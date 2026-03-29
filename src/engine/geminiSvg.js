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

// ── Call 1: Scene Inventory ────────────────────────────────────────

const INVENTORY_PROMPT = `You are a visual scene analyst. Study this photograph with extreme attention to detail and produce a complete inventory of everything visible.

Return ONLY valid JSON. No markdown fences. No explanation. Just the JSON object.

{
  "aspectRatio": "portrait" or "landscape",
  "horizon": {
    "present": true/false,
    "yPercent": number (0=top edge, 100=bottom edge),
    "description": "what forms the horizon line"
  },
  "reflection": {
    "present": true/false,
    "type": "puddle" | "water" | "glass" | "none",
    "description": "what is being reflected and how"
  },
  "zones": [
    {
      "name": "descriptive zone name",
      "yRange": [topPercent, bottomPercent],
      "colors": ["#hex1", "#hex2"],
      "description": "what's in this horizontal band"
    }
  ],
  "elements": [
    {
      "type": "building" | "pole" | "wire" | "tree" | "cloud" | "bird" | "vehicle" | "sign" | "window" | "light" | "texture" | "other",
      "position": {
        "xPercent": number or [leftPercent, rightPercent],
        "yPercent": number or [topPercent, bottomPercent]
      },
      "color": "#hex or description",
      "shape": "rectangle" | "circle" | "line" | "irregular" | "triangle" | "v-shape",
      "details": "specific visual description — windows, text, angles, etc."
    }
  ],
  "colorPalette": [
    { "hex": "#hexvalue", "name": "descriptive color name", "where": "where this color appears" }
  ],
  "lightSource": {
    "direction": "description of light direction and quality",
    "warmZone": "where warm light concentrates",
    "coolZone": "where cool shadows fall"
  },
  "texture": [
    { "where": "location description", "type": "concrete | asphalt | water | foliage | etc", "description": "visual quality" }
  ]
}

Be EXHAUSTIVE. List every distinct element you can identify: every building with its windows, every pole, every wire, every bird, every cloud mass, every texture variation. Use percentage-based coordinates (0=left/top edge, 100=right/bottom edge). Sample actual hex colors from the image — don't guess.`;

async function analyzeScene(apiKey, imageBase64, model) {
  console.log('[PaintWise] Call 1: Analyzing scene...');

  const text = await callGemini(apiKey, model, [
    { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
    { text: INVENTORY_PROMPT },
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

// ── Call 2: SVG Construction ───────────────────────────────────────

function buildSvgPrompt(inventory) {
  // Determine viewBox from aspect ratio
  let vbW = 800, vbH = 600;
  if (inventory.aspectRatio === 'portrait') {
    vbW = 533; vbH = 800;
  }

  return `You are an SVG engineer specializing in watercolor painting composition. You have a detailed scene inventory and the original photograph. Convert the inventory into a layered SVG composition.

SCENE INVENTORY:
${JSON.stringify(inventory, null, 2)}

VIEWBOX: ${vbW} x ${vbH} (use "0 0 ${vbW} ${vbH}")

Convert all percentage positions to pixel coordinates:
  x_pixel = xPercent / 100 * ${vbW}
  y_pixel = yPercent / 100 * ${vbH}

Return ONLY valid JSON. No markdown fences. No explanation.

{
  "viewBox": "0 0 ${vbW} ${vbH}",
  "layers": [
    {
      "id": "kebab-case-id",
      "name": "Layer Name",
      "description": "what this layer contains",
      "paintingTip": "beginner watercolor advice: brush type, technique, pigments",
      "elements": [
        { "type": "rect|circle|ellipse|path|line|defs", "attrs": { camelCase SVG attributes } }
      ]
    }
  ]
}

RULES:
1. Create 5-8 layers ordered back-to-front (sky washes first, fine details last).
2. Include EVERY element from the inventory. Don't skip anything.
3. For gradients: use a "defs" element with SVG gradient markup in its "content" field. Reference via url(#id).
4. Colors: use the hex values from the inventory's colorPalette. Match them to elements by the "where" field.
5. If reflection is present: reflect above-horizon elements below the horizon. Compress vertically by 0.85x. Darken colors ~20%.
6. For textures (concrete, asphalt): use path elements with strokeDasharray for dry-brush effects.
7. All SVG attrs must be camelCase: strokeWidth, strokeDasharray, fillOpacity, strokeLinecap.
8. Buildings should have their windows, signs, and structural details as separate elements.
9. Painting tips: mention specific brush (flat, round, rigger), technique (wet-on-wet, dry brush, lifting), and pigment names.
10. Use the actual shapes from the inventory: rectangles for buildings, lines for poles/wires, v-shapes for birds, bezier paths for clouds.`;
}

async function generateSvgFromInventory(apiKey, imageBase64, inventory, model) {
  console.log('[PaintWise] Call 2: Generating SVG from inventory...');

  const prompt = buildSvgPrompt(inventory);

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
    inventory = await analyzeScene(apiKey, imageBase64, model);
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
