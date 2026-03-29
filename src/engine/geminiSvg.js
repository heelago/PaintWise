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

// ── Call 1: The Analyst ───────────────────────────────────────────
// Produces a structured spatial analysis with bounding boxes,
// perspective notes, and color layer plan. This becomes the
// strict contract that Call 2 must follow.

function buildAnalystPrompt(metadata) {
  const isPortrait = metadata.width < metadata.height;
  const ratio = metadata.width / metadata.height;
  const vbW = 1000;
  const vbH = Math.round(1000 / ratio);

  // Authoritative palette
  let paletteStr = '';
  if (metadata.centroids?.length) {
    const hexList = metadata.centroids.map(c =>
      '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
    );
    paletteStr = `\nAUTHORITATIVE COLOR PALETTE (k-means from actual pixels — use ONLY these):
${JSON.stringify(hexList)}`;
  }

  // Pre-computed spatial anchors
  const anchors = [];
  if (metadata.hasHorizon && metadata.horizonY != null) {
    const hPct = Math.round((metadata.horizonY / metadata.height) * 100);
    anchors.push(`Horizon: Y=${Math.round(hPct / 100 * vbH)} (${hPct}% from top)`);
  }
  if (metadata.hasReflection) {
    anchors.push('Reflection: CONFIRMED — horizontal symmetry below horizon');
  }
  if (metadata.regionBounds) {
    const rb = metadata.regionBounds;
    const toVB = (top, bot) => `Y=${Math.round(top / metadata.height * vbH)}-${Math.round(bot / metadata.height * vbH)}`;
    if (rb.sky) anchors.push(`Sky zone: ${toVB(rb.sky.top, rb.sky.bot)}`);
    if (rb.midground) anchors.push(`Midground: ${toVB(rb.midground.top, rb.midground.bot)}`);
    if (rb.reflection && metadata.hasReflection) anchors.push(`Reflection zone: ${toVB(rb.reflection.top, rb.reflection.bot)}`);
    if (rb.foreground) anchors.push(`Foreground: ${toVB(rb.foreground.top, rb.foreground.bot)}`);
    if (rb.focalSubject) {
      const fs = rb.focalSubject;
      anchors.push(`Focal subject: X=${Math.round(fs.left / metadata.width * vbW)}, Y=${Math.round(fs.top / metadata.height * vbH)}, W=${Math.round((fs.right - fs.left) / metadata.width * vbW)}, H=${Math.round((fs.bot - fs.top) / metadata.height * vbH)}`);
    }
  }
  const anchorBlock = anchors.length ? `\nPRE-COMPUTED SPATIAL DATA (ground truth from pixel analysis):\n${anchors.join('\n')}` : '';

  return `Analyze this image for a vector painting tutorial. Image: ${metadata.width}x${metadata.height}px (${isPortrait ? 'portrait' : 'landscape'}).
ViewBox: "0 0 ${vbW} ${vbH}"${paletteStr}${anchorBlock}

Output ONLY valid JSON matching this schema. No markdown fences.

{
  "viewBox": "0 0 ${vbW} ${vbH}",
  "horizon_y": number,
  "has_reflection": boolean,
  "subjects": [
    {
      "name": "descriptive name",
      "x": number, "y": number, "w": number, "h": number,
      "angle": number,
      "depth": "background | midground | foreground",
      "notes": "perspective/foreshortening notes"
    }
  ],
  "layers": [
    { "name": "Layer Name", "hex": "#from_palette", "depth": "back | mid | front", "description": "what goes here" }
  ]
}

RULES:
- Identify 4-8 subjects with ACCURATE bounding boxes in viewBox coordinates.
- Subjects must cover the FULL image — don't leave large empty zones unmapped.
- If reflection exists, map both real AND reflected versions of subjects.
- Plan 8-10 layers ordered back-to-front. Use ONLY palette hex codes.
- Be precise with coordinates — these will be used as strict rendering constraints.`;
}

// ── Call 2: The Painter ──────────────────────────────────────────
// Receives the Analyst's structured output as a strict contract
// and must render SVG elements within the specified bounding boxes.

const PAINTER_SYSTEM = `You are an SVG engineer creating a stylized vector painting for a tutorial app.

STYLE: Bold, simplified geometric shapes — like a modern gouache painting or flat-vector editorial illustration. Abstracted but proportionally accurate.

STRICT RULES:
- You will receive a spatial analysis with subject bounding boxes. Your SVG elements MUST fall within these bounding boxes. Do not deviate from the specified coordinates.
- Build each subject from 3-6 overlapping shapes with varying opacity (0.2-0.95).
- ALL SVG attrs camelCase: strokeWidth, strokeDasharray, strokeLinecap.
- All values COMPUTED NUMBERS (not expressions).
- Use transform="rotate(angle cx cy)" for tilted elements.`;

function buildPainterPrompt(analysis) {
  return `Render this spatial analysis as layered SVG JSON. You MUST place elements within the bounding boxes specified below.

SPATIAL ANALYSIS (STRICT — follow these coordinates exactly):
${JSON.stringify(analysis, null, 2)}

Output ONLY valid JSON. No markdown fences.
{
  "viewBox": "${analysis.viewBox}",
  "layers": [
    {
      "id": "layer-id",
      "name": "Layer Name",
      "description": "what this layer represents",
      "paintingTip": "watercolor technique tip naming pigments and brush sizes",
      "elements": [
        { "type": "rect|path|circle|ellipse|line|defs", "attrs": { ... } }
      ]
    }
  ]
}

RENDERING RULES:
- Follow the layer plan from the analysis. Render layers back-to-front.
- For EACH subject in the analysis, render 3-6 overlapping shapes WITHIN its bounding box.
- Gradients: {"type":"defs","content":"<linearGradient id=\\"g1\\" ...><stop .../></linearGradient>"}
- Background: large shapes, low opacity. Foreground: detailed shapes, high opacity.
- ONLY use hex colors from the analysis palette. May darken (RGB x0.80) or lighten (RGB x1.15).
- If has_reflection is true, render reflected copies of subjects below horizon_y with darkened colors and reduced opacity.`;
}

// ── Main Export ─────────────────────────────────────────────────────

/**
 * Generate SVG composition via two-call Gemini pipeline.
 * Call 1 (Analyst): Spatial analysis with bounding boxes.
 * Call 2 (Painter): SVG rendering constrained by the analysis.
 */
export async function generateGeminiSvg(apiKey, imageSrc, analysisMetadata, options = {}) {
  if (!apiKey) throw new Error('Please enter your Gemini API key');

  const hash = fnv1aHash(imageSrc);
  const model = options.model || 'gemini-2.5-flash';
  const onProgress = options.onProgress || (() => {});

  // Check composition cache
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

  // Call 1: Analyst — spatial analysis with bounding boxes
  onProgress({ step: 1, label: 'Analyzing composition & perspective...' });
  let analysis = options.force ? null : cacheRead(`pw-inv-${hash}`);
  if (!analysis) {
    console.log('[PaintWise] Call 1 (Analyst): Spatial analysis...');
    const analystPrompt = buildAnalystPrompt(analysisMetadata);
    const text1 = await callGemini(apiKey, model, [
      { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
      { text: analystPrompt },
    ], { maxTokens: 8192 });

    analysis = extractJson(text1);
    if (!analysis) {
      console.error('[PaintWise] Analysis parse failed:', text1.slice(0, 1000));
      throw new Error('Failed to parse spatial analysis from AI');
    }
    cacheWrite(`pw-inv-${hash}`, analysis);

    console.log('[PaintWise] Analysis:', {
      viewBox: analysis.viewBox,
      subjects: analysis.subjects?.length,
      layers: analysis.layers?.length,
      horizon: analysis.horizon_y,
      reflection: analysis.has_reflection,
    });
  } else {
    console.log('[PaintWise] Using cached analysis');
  }

  // Call 2: Painter — SVG rendering constrained by analysis
  onProgress({ step: 2, label: 'Painting SVG composition...' });
  console.log('[PaintWise] Call 2 (Painter): SVG rendering...');

  const painterPrompt = buildPainterPrompt(analysis);
  const text2 = await callGemini(apiKey, model, [
    { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
    { text: painterPrompt },
  ], { maxTokens: 65536, systemInstruction: PAINTER_SYSTEM });

  const composition = extractJson(text2);
  if (!composition) {
    console.error('[PaintWise] SVG parse failed. First 500 chars:', text2.slice(0, 500));
    console.error('[PaintWise] Last 200 chars:', text2.slice(-200));
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
