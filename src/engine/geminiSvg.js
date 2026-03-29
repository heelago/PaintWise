/**
 * Single-call raw SVG pipeline using Gemini BYOK.
 *
 * Ask Gemini to output raw SVG markup with <g> layer groups.
 * Parse the SVG into our { viewBox, layers: [{ elements }] } format
 * using DOMParser. This lets Gemini write natural SVG paths without
 * JSON overhead, producing much higher quality output.
 */

import { verifyComposition } from './verifyComposition.js';

// ── Utilities ──────────────────────────────────────────────────────

function resizeImageToBase64(imageSrc, maxDim = 2000) {
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
    if (parsed?.v === 4) return parsed.data;
  } catch { /* ignore */ }
  return null;
}

function cacheWrite(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ v: 4, data })); }
  catch { /* full */ }
}

// ── Gemini API caller ─────────────────────────────────────────────

async function callGemini(apiKey, model, parts, { maxTokens = 65536 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: maxTokens,
    },
  };

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
    console.warn('[PaintWise] Response truncated');
  }

  let text = '';
  for (const part of (candidate.content?.parts || [])) {
    if (part.text) text += part.text;
  }

  if (!text) throw new Error('Gemini returned empty response');

  console.log(`[PaintWise] Response: ${text.length} chars, finish: ${candidate.finishReason}`);
  return text;
}

// ── SVG Parser ────────────────────────────────────────────────────
// Parse raw SVG markup into our { viewBox, layers } format.
// Each <g> with an id becomes a layer. Child elements become
// the layer's elements array.

const SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse', 'path', 'line', 'polygon', 'polyline']);
const ATTR_CAMEL = { 'stroke-width': 'strokeWidth', 'stroke-dasharray': 'strokeDasharray',
  'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin',
  'stroke-opacity': 'strokeOpacity', 'fill-opacity': 'fillOpacity',
  'font-size': 'fontSize', 'font-family': 'fontFamily', 'text-anchor': 'textAnchor',
  'clip-path': 'clipPath', 'stop-color': 'stopColor', 'stop-opacity': 'stopOpacity',
  'flood-color': 'floodColor', 'flood-opacity': 'floodOpacity' };

function parseAttrs(el) {
  const attrs = {};
  for (const attr of el.attributes) {
    const name = ATTR_CAMEL[attr.name] || attr.name;
    // Skip id/class/data-* — not needed for rendering
    if (name === 'id' || name === 'class' || name.startsWith('data-')) continue;
    // Try to parse numbers
    const num = Number(attr.value);
    attrs[name] = (attr.value !== '' && !isNaN(num) && String(num) === attr.value) ? num : attr.value;
  }
  return attrs;
}

function parseElement(el) {
  const tag = el.tagName.toLowerCase();

  if (tag === 'defs') {
    return { type: 'defs', content: el.innerHTML };
  }

  if (SHAPE_TAGS.has(tag)) {
    return { type: tag === 'polygon' || tag === 'polyline' ? 'path' : tag, attrs: parseAttrs(el) };
  }

  if (tag === 'text') {
    const attrs = parseAttrs(el);
    attrs.children = el.textContent;
    return { type: 'text', attrs };
  }

  if (tag === 'use') {
    return { type: 'use', attrs: parseAttrs(el) };
  }

  // For <g> without an id (nested groups), flatten children
  if (tag === 'g') {
    const children = [];
    for (const child of el.children) {
      const parsed = parseElement(child);
      if (parsed) children.push(parsed);
    }
    if (children.length === 1) return children[0];
    if (children.length > 0) return { type: 'g', attrs: parseAttrs(el), children };
  }

  return null;
}

function parseSvgToComposition(svgText) {
  // Extract <svg> from response (might have analysis text before it)
  const svgMatch = svgText.match(/<svg[\s\S]*<\/svg>/i);
  if (!svgMatch) return null;

  // Strip markdown fences
  let svgMarkup = svgMatch[0]
    .replace(/^```(?:svg|xml|html)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '');

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (!svg) {
    console.error('[PaintWise] DOMParser failed to find <svg>');
    return null;
  }

  const viewBox = svg.getAttribute('viewBox') || '0 0 1000 750';

  const layers = [];
  let layerIndex = 0;

  for (const child of svg.children) {
    const tag = child.tagName.toLowerCase();

    // Top-level <defs> — add as elements in a hidden defs layer or attach to first layer
    if (tag === 'defs') {
      // We'll prepend defs to the first real layer later
      if (layers.length === 0) {
        layers.push({
          id: 'defs',
          name: 'Definitions',
          description: 'Gradients and patterns',
          paintingTip: '',
          elements: [{ type: 'defs', content: child.innerHTML }],
        });
      } else {
        layers[0].elements.unshift({ type: 'defs', content: child.innerHTML });
      }
      continue;
    }

    // <g> with id = a layer
    if (tag === 'g') {
      const id = child.getAttribute('id') || child.getAttribute('data-name') || `layer-${layerIndex}`;
      const name = child.getAttribute('data-name') || child.getAttribute('id') || `Layer ${layerIndex + 1}`;
      layerIndex++;

      const elements = [];
      for (const el of child.children) {
        const parsed = parseElement(el);
        if (parsed) elements.push(parsed);
      }

      if (elements.length > 0) {
        layers.push({
          id: id.replace(/\s+/g, '-').toLowerCase(),
          name,
          description: '',
          paintingTip: '',
          elements,
        });
      }
      continue;
    }

    // Top-level shape (not in a group) — add to a catch-all layer
    if (SHAPE_TAGS.has(tag) || tag === 'text' || tag === 'use') {
      const parsed = parseElement(child);
      if (parsed) {
        // Find or create catch-all layer
        let catchAll = layers.find(l => l.id === 'ungrouped');
        if (!catchAll) {
          catchAll = { id: 'ungrouped', name: 'Background', description: '', paintingTip: '', elements: [] };
          layers.push(catchAll);
        }
        catchAll.elements.push(parsed);
      }
    }
  }

  if (layers.length === 0) return null;

  console.log('[PaintWise] Parsed SVG:', {
    viewBox,
    layers: layers.length,
    names: layers.map(l => l.name),
    totalElements: layers.reduce((s, l) => s + l.elements.length, 0),
  });

  return { viewBox, layers };
}

// ── Prompt ────────────────────────────────────────────────────────

function buildPrompt(metadata) {
  const isPortrait = metadata.height > metadata.width;
  const ratio = metadata.width / metadata.height;
  const vbW = 1000;
  const vbH = Math.round(1000 / ratio);
  const orientation = isPortrait ? 'portrait (taller than wide)' : 'landscape (wider than tall)';

  return `Hey buddy, can you help me deconstruct this ${orientation} photo into a buildable image made of svg layers of each color for a painting tutorial app im working on? please first analyze the colors, perspective, and proportions in the image and then recreate a sort of approximation from shapes. it should be recognizable, with as many details as you can recreate - but with simple svg shapes. Build it as 8-10 color layers ordered back to front.

Output the result as a complete SVG element with viewBox="0 0 ${vbW} ${vbH}". Wrap each color layer in a <g id="layer-name"> tag. No markdown fences around the SVG, no extra text after it.`;
}

// ── Main Export ─────────────────────────────────────────────────────

/**
 * Generate SVG composition via single Gemini call.
 * Ask for raw SVG, parse into layer format.
 */
export async function generateGeminiSvg(apiKey, imageSrc, analysisMetadata, options = {}) {
  if (!apiKey) throw new Error('Please enter your Gemini API key');

  const hash = fnv1aHash(imageSrc);
  const model = options.model || 'gemini-3-flash-preview';
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

  // Single call — ask for raw SVG
  onProgress({ step: 1, label: 'Creating SVG composition...' });
  console.log('[PaintWise] Generating raw SVG...');

  const prompt = buildPrompt(analysisMetadata);
  const text = await callGemini(apiKey, model, [
    { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
    { text: prompt },
  ], { maxTokens: 65536 });

  // Parse raw SVG into layer format
  onProgress({ step: 2, label: 'Parsing SVG layers...' });

  const composition = parseSvgToComposition(text);
  if (!composition) {
    console.error('[PaintWise] SVG parse failed. First 500:', text.slice(0, 500));
    throw new Error('Failed to parse SVG from AI response');
  }

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
