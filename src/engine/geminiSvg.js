/**
 * Single-call Chain-of-Thought SVG pipeline using Gemini BYOK.
 *
 * The model first outputs an <Analysis> block (composition grid,
 * perspective notes, color extraction), then generates the layered
 * SVG JSON. This CoT approach forces spatial reasoning before code
 * generation, dramatically improving proportion and perspective.
 *
 * System instruction sets the art-teacher persona and rules.
 * User prompt includes image + palette + asks for Analysis then JSON.
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
    if (parsed?.v === 3) return parsed.data;
  } catch { /* ignore */ }
  return null;
}

function cacheWrite(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ v: 3, data })); }
  catch { /* full */ }
}

function extractJson(text) {
  // Direct parse
  try { return JSON.parse(text); } catch { /* */ }

  // Strip markdown fences (complete or truncated)
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
    cleaned = cleaned.replace(/\n?```\s*$/, '');
  }

  // Evaluate math expressions in numeric JSON values
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
  json = json.replace(/,\s*"[^"]*$/, '');
  json = json.replace(/,\s*$/, '');
  json = json.replace(/:\s*"[^"]*$/, ': ""');
  json = json.replace(/:\s*$/, ': null');

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

// ── Gemini API caller with system instruction support ─────────────

async function callGemini(apiKey, model, parts, { maxTokens = 65536, systemInstruction = null } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: maxTokens,
      thinkingConfig: { thinkingBudget: 1024 },
    },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

// ── System Instruction ────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `You are an expert technical artist and SVG engineer. Your job is to transform user-uploaded photos into stylized, layered SVG illustrations for a "Painting Tutorial App."

THE AESTHETIC STYLE:
- Stylized Vector Painting: Do not attempt photorealism. Reinterpret the image using bold, simplified geometric shapes (<ellipse>, <rect>, <path>, <polygon>). Think of a modern gouache painting or a flat-vector editorial illustration.
- Abstracted but Accurate: While the shapes are simple, their placement, rotation, and relative sizes must perfectly capture the proportions and perspective of the original photo.
- Layered Construction: The image must be built from back to front in 8 to 12 distinct color layers (e.g., Background Base → Midground Details → Foreground Subjects → Brightest Highlights).

CRITICAL RULES FOR ACCURACY (PROPORTION & PERSPECTIVE):
- Before writing any SVG data, you must create a detailed <Analysis> block.
- Bounding Boxes: In your analysis, you must define strict bounding boxes (X, Y, Width, Height) for the main focal points.
- Perspective & Foreshortening: Explicitly calculate foreshortening. If an object is angled toward the viewer, the SVG paths closest to the foreground must be mathematically scaled larger than the distant parts.
- Overlap & Occlusion: Objects closer to the camera overlap and hide parts of objects further away.

SVG TECHNICAL RULES:
- No external assets. Self-contained SVG using paths, rects, circles, ellipses, and gradients in defs.
- ALL SVG attribute names must be camelCase: strokeWidth, strokeDasharray, strokeLinecap.
- All numeric values must be COMPUTED NUMBERS (e.g. 372, not "372 + 50 * 0.85").
- Use transform="rotate(angle cx cy)" for objects tilted in perspective.`;

// ── Build the user prompt ─────────────────────────────────────────

function buildUserPrompt(metadata) {
  const isPortrait = metadata.width < metadata.height;
  const ratio = metadata.width / metadata.height;
  const vbW = 1000;
  const vbH = Math.round(1000 / ratio);
  const scale = (pct) => Math.round(pct / 100 * vbH);

  // Build authoritative palette
  let paletteStr = '';
  if (metadata.centroids?.length) {
    const hexList = metadata.centroids.map(c =>
      '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
    );
    paletteStr = `\nAUTHORITATIVE COLOR PALETTE (k-means from actual pixels — use ONLY these hex codes):
${JSON.stringify(hexList)}`;
  }

  // Build pre-computed spatial data from our local analysis
  const spatialData = [];

  if (metadata.hasHorizon && metadata.horizonY != null) {
    const hPct = Math.round((metadata.horizonY / metadata.height) * 100);
    spatialData.push(`Horizon Line: Y=${scale(hPct)} (${hPct}% from top) — VERIFIED by edge detection`);
  }

  if (metadata.hasReflection) {
    spatialData.push(`Reflection: CONFIRMED — horizontal symmetry detected below horizon. You MUST include mirrored/reflected elements in the lower half.`);
  }

  if (metadata.regionBounds) {
    const rb = metadata.regionBounds;
    const toVB = (top, bot) => `Y=${Math.round(top / metadata.height * vbH)}-${Math.round(bot / metadata.height * vbH)}`;
    if (rb.sky) spatialData.push(`Sky zone: ${toVB(rb.sky.top, rb.sky.bot)}`);
    if (rb.midground) spatialData.push(`Midground zone: ${toVB(rb.midground.top, rb.midground.bot)}`);
    if (rb.reflection && metadata.hasReflection) spatialData.push(`Reflection zone: ${toVB(rb.reflection.top, rb.reflection.bot)}`);
    if (rb.foreground) spatialData.push(`Foreground zone: ${toVB(rb.foreground.top, rb.foreground.bot)}`);
    if (rb.focalSubject) {
      const fs = rb.focalSubject;
      const fx = Math.round(fs.left / metadata.width * vbW);
      const fy = Math.round(fs.top / metadata.height * vbH);
      const fw = Math.round((fs.right - fs.left) / metadata.width * vbW);
      const fh = Math.round((fs.bot - fs.top) / metadata.height * vbH);
      spatialData.push(`Focal subject detected: X=${fx}, Y=${fy}, W=${fw}, H=${fh} — this is the most visually salient region`);
    }
  }

  const spatialBlock = spatialData.length
    ? `\n\nPRE-COMPUTED SPATIAL ANALYSIS (from our pixel-level algorithms — use as ground truth):
${spatialData.join('\n')}`
    : '';

  return `Please reinterpret the attached image into a stylized, layered vector painting.

Image: ${metadata.width}x${metadata.height} pixels (${isPortrait ? 'portrait' : 'landscape'}).${paletteStr}${spatialBlock}

== STEP 1: SPATIAL & STYLISTIC ANALYSIS ==
Output an <Analysis> block. Use our pre-computed spatial data above as anchors, then ADD your own observations:

1. **ViewBox:** "0 0 ${vbW} ${vbH}"
2. **Horizon & Depth:** Confirm or refine the horizon Y from our data. What is in background vs. foreground?
3. **Subject Mapping (CRITICAL):** Identify 2-4 main structural elements. For EACH:
   - Description: [What is it?]
   - Bounding Box: [X, Y, Width, Height] in viewBox coordinates
   - Angle/Rotation: [degrees, 0 if upright]
4. **Perspective Adjustments:** Where does foreshortening apply?
5. **Reflection:** If confirmed, which elements are mirrored and at what Y-axis?

== STEP 2: COLOR LAYER PLAN ==
Using ONLY the authoritative palette hex codes, plan 8-10 layers from back to front.

== STEP 3: SVG JSON OUTPUT ==
You MUST strictly use the bounding boxes from Step 1. The JSON schema:
{
  "viewBox": "0 0 ${vbW} ${vbH}",
  "layers": [
    {
      "id": "layer-id",
      "name": "Layer Name",
      "description": "What this layer represents",
      "paintingTip": "Watercolor technique tip naming pigments and brush sizes",
      "elements": [
        { "type": "rect|path|circle|ellipse|line|defs", "attrs": { ... } }
      ]
    }
  ]
}

ELEMENT RULES:
- Gradients: {"type":"defs","content":"<linearGradient id=\\"g1\\" ...><stop .../></linearGradient>"}
- Use transform="rotate(angle cx cy)" for tilted elements.
- Build each subject from 3-6 overlapping shapes with varying opacity.
- ONLY palette hex colors. May darken (RGB x0.80) or lighten (RGB x1.15).

Output <Analysis> first, then JSON. No markdown fences.`;
}

// ── Parse response: extract Analysis + JSON ───────────────────────

function parseResponse(text) {
  // Extract <Analysis> block if present
  let analysis = null;
  const analysisMatch = text.match(/<Analysis>([\s\S]*?)<\/Analysis>/i);
  if (analysisMatch) {
    analysis = analysisMatch[1].trim();
    console.log('[PaintWise] Analysis block:\n' + analysis);
  }

  // Find the JSON portion (everything after the Analysis block, or the whole text)
  let jsonText = analysisMatch
    ? text.slice(analysisMatch.index + analysisMatch[0].length)
    : text;

  const composition = extractJson(jsonText);
  return { analysis, composition };
}

// ── Main Export ─────────────────────────────────────────────────────

/**
 * Generate SVG composition via single-call Chain-of-Thought Gemini pipeline.
 *
 * @param {string} apiKey - Gemini API key
 * @param {string} imageSrc - Image data URI
 * @param {object} analysisMetadata - Local analysis (palette, horizon, dimensions)
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
        return { composition: cached, warnings: v.warnings, inventory: null };
      }
    }
  }

  // Resize image
  onProgress({ step: 0, label: 'Preparing image...' });
  const imageBase64 = await resizeImageToBase64(imageSrc);

  // Single CoT call: Analysis → SVG JSON
  onProgress({ step: 1, label: 'Analyzing composition & perspective...' });
  console.log('[PaintWise] Single CoT call: Analysis + SVG generation...');

  const userPrompt = buildUserPrompt(analysisMetadata);

  const text = await callGemini(apiKey, model, [
    { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
    { text: userPrompt },
  ], { maxTokens: 65536, systemInstruction: SYSTEM_INSTRUCTION });

  onProgress({ step: 2, label: 'Parsing composition...' });

  const { analysis, composition } = parseResponse(text);

  if (!composition) {
    console.error('[PaintWise] SVG parse failed. First 500 chars:', text.slice(0, 500));
    console.error('[PaintWise] Last 200 chars:', text.slice(-200));
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

  // Verify
  const verification = verifyComposition(composition, analysisMetadata);
  if (!verification.valid) {
    console.error('[PaintWise] Verification failed:', verification.errors);
    throw new Error(`Invalid composition: ${verification.errors.join('; ')}`);
  }

  // Cache
  cacheWrite(`pw-comp-${hash}`, composition);

  return { composition, warnings: verification.warnings, inventory: analysis };
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
