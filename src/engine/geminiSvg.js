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

// ── Single-call natural prompt ────────────────────────────────────
// Simple, conversational prompt that lets Gemini do what it does
// best — analyze and recreate. We inject the authoritative palette
// and aspect ratio, but keep everything else natural.

function buildPrompt(metadata) {
  const isPortrait = metadata.width < metadata.height;
  const ratio = metadata.width / metadata.height;
  const vbW = 1000;
  const vbH = Math.round(1000 / ratio);

  // Authoritative palette
  let paletteNote = '';
  if (metadata.centroids?.length) {
    const hexList = metadata.centroids.map(c =>
      '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
    );
    paletteNote = `\n\nI've already extracted the color palette from the image — please use ONLY these hex colors (you may darken or lighten them slightly): ${JSON.stringify(hexList)}`;
  }

  let sceneHints = '';
  if (metadata.hasReflection) {
    sceneHints += '\nNote: there appears to be a reflection in the water — please include the reflected elements.';
  }

  return `Hey, can you help me deconstruct this photo into a buildable image made of SVG layers for a painting tutorial app I'm working on?

The image is ${metadata.width}x${metadata.height}px (${isPortrait ? 'portrait' : 'landscape'}). Please use viewBox="0 0 ${vbW} ${vbH}".${paletteNote}${sceneHints}

Please first analyze the colors, perspective, and proportions in the image and then recreate a sort of approximation from shapes — like a simplified, stylized vector painting with 8-10 color layers ordered back to front.

Output the result as JSON matching this schema (no markdown fences, no extra text after the JSON):
{
  "viewBox": "0 0 ${vbW} ${vbH}",
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

For gradients use defs elements like: {"type":"defs","content":"<linearGradient id=\\"g1\\" ...><stop .../></linearGradient>"}
Use camelCase for SVG attrs (strokeWidth, etc). All values must be computed numbers.`;
}

// ── Main Export ─────────────────────────────────────────────────────

/**
 * Generate SVG composition via single natural-language Gemini call.
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
        return { composition: cached, warnings: v.warnings, inventory: null };
      }
    }
  }

  // Resize image
  onProgress({ step: 0, label: 'Preparing image...' });
  const imageBase64 = await resizeImageToBase64(imageSrc);

  // Single call with natural prompt
  onProgress({ step: 1, label: 'Creating SVG composition...' });
  console.log('[PaintWise] Generating SVG composition...');

  const prompt = buildPrompt(analysisMetadata);

  const text = await callGemini(apiKey, model, [
    { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
    { text: prompt },
  ], { maxTokens: 65536 });

  onProgress({ step: 2, label: 'Parsing result...' });

  const composition = extractJson(text);
  if (!composition) {
    console.error('[PaintWise] SVG parse failed. First 500 chars:', text.slice(0, 500));
    console.error('[PaintWise] Last 200 chars:', text.slice(-200));
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
  return { composition, warnings: verification.warnings, inventory: null };
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
