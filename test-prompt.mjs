#!/usr/bin/env node
/**
 * Quick prompt tester — hits Gemini API directly, saves results.
 * Usage: node test-prompt.mjs [--simple | --two-call | --tag NAME]
 *
 * Reads API key from .env.local, uses public/reference-sunset.jpeg.
 * Saves output to test-results/<tag>-<timestamp>.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// ── Config ──
const ENV = readFileSync('.env.local', 'utf-8');
const API_KEY = ENV.match(/VITE_GEMINI_KEY=(.+)/)?.[1]?.trim();
if (!API_KEY) { console.error('No VITE_GEMINI_KEY in .env.local'); process.exit(1); }

const MODEL = 'gemini-2.5-flash';
const IMAGE_PATH = 'public/reference-sunset.jpeg';
const RESULTS_DIR = 'test-results';

// ── Args ──
const args = process.argv.slice(2);
const tag = args.find((a, i) => args[i - 1] === '--tag') || 'test';
const mode = args.includes('--convo') ? 'convo' : 'simple';

// ── Helpers ──
function imageToBase64(path) {
  return readFileSync(path).toString('base64');
}

async function callGemini(parts, { maxTokens = 65536, systemInstruction = null } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
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

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`API ${res.status}: ${err?.error?.message || 'unknown'}`);
  }

  const result = await res.json();
  const candidate = result?.candidates?.[0];
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  let text = '';
  for (const part of (candidate?.content?.parts || [])) {
    if (part.text) text += part.text;
  }

  console.log(`  → ${text.length} chars, ${candidate?.finishReason}, ${elapsed}s`);
  return { text, finishReason: candidate?.finishReason, elapsed };
}

function extractJson(text) {
  // Strip markdown fences
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  // Math expression repair
  cleaned = cleaned.replace(/:\s*(\d[\d\s+\-*/().]*\d)\s*([,\n\r\}])/g, (match, expr, after) => {
    try {
      const val = Function('"use strict"; return (' + expr + ')')();
      if (typeof val === 'number' && isFinite(val)) return ': ' + Math.round(val * 100) / 100 + after;
    } catch {}
    return match;
  });
  try { return JSON.parse(cleaned); } catch {}

  // Find JSON in text
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  const end = cleaned.lastIndexOf('}');
  if (end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }

  // Truncation repair
  let json = cleaned.slice(start);
  json = json.replace(/,\s*"[^"]*$/, '').replace(/,\s*$/, '');
  json = json.replace(/:\s*"[^"]*$/, ': ""').replace(/:\s*$/, ': null');
  let braces = 0, brackets = 0, inStr = false, esc = false;
  for (const ch of json) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') braces++; if (ch === '}') braces--;
    if (ch === '[') brackets++; if (ch === ']') brackets--;
  }
  for (let i = 0; i < brackets; i++) json += ']';
  for (let i = 0; i < braces; i++) json += '}';
  try { return JSON.parse(json); } catch {}
  return null;
}

// ── Prompts ──

// Multiple prompt variants to test
const PROMPTS = {
  simple: `Hey, can you help me deconstruct this photo into a buildable image made of SVG layers of each color for a painting tutorial app I'm working on?

Please first analyze the colors, perspective, and proportions in the image and then recreate a sort of approximation from shapes.

Output the result as JSON matching this schema (no markdown fences, no extra text after the JSON):
{
  "viewBox": "0 0 1000 [height based on aspect ratio]",
  "layers": [
    {
      "id": "layer-id",
      "name": "Layer Name",
      "description": "what this layer represents",
      "paintingTip": "watercolor technique tip",
      "elements": [
        { "type": "rect|path|circle|ellipse|line|defs", "attrs": { ... } }
      ]
    }
  ]
}

For gradients use: {"type":"defs","content":"<linearGradient id=\\"g1\\" .../>"}
Use camelCase for SVG attrs (strokeWidth, etc). All values must be computed numbers.`,

  'with-palette': null, // built dynamically below

  'with-reflection': null, // built dynamically below
};

// Build dynamic variants using image metadata
function buildDynamicPrompts() {
  // Read the image to get dimensions
  const { width, height } = { width: 2000, height: 1500 }; // reference-sunset is 4:3
  const vbH = Math.round(1000 / (width / height));

  PROMPTS['with-palette'] = `Hey, can you help me deconstruct this photo into a buildable image made of SVG layers for a painting tutorial app?

The image is ${width}x${height}px (landscape). Please use viewBox="0 0 1000 ${vbH}".

I've already extracted the color palette — please use ONLY these hex colors (you may darken or lighten slightly): ["#6b6359","#9b8d78","#3d3228","#503e2e","#1e160f","#c08a4e","#443c34","#786b5a","#595147","#876b48","#2e2720","#ab9874","#b0926e","#917e66"]

Please first analyze the colors, perspective, and proportions in the image and then recreate an approximation from shapes — like a simplified, stylized vector painting with 8-10 color layers ordered back to front.

Note: there appears to be a reflection in the water — please include the reflected elements.

Output the result as JSON matching this schema (no markdown fences, no extra text after the JSON):
{
  "viewBox": "0 0 1000 ${vbH}",
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

For gradients use: {"type":"defs","content":"<linearGradient id=\\"g1\\" ...><stop .../></linearGradient>"}
Use camelCase for SVG attrs (strokeWidth, etc). All values must be computed numbers.`;
}

buildDynamicPrompts();

// ── Main ──

async function run() {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR);

  const imageBase64 = imageToBase64(IMAGE_PATH);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resultFile = join(RESULTS_DIR, `${tag}-${timestamp}.json`);

  console.log(`\n🎨 PaintWise Prompt Test — mode: ${mode}, tag: ${tag}`);
  console.log(`  Image: ${IMAGE_PATH}`);

  let analysis = null;
  let composition = null;
  let rawText = '';

  const promptKey = args.find((a, i) => args[i - 1] === '--prompt') || 'simple';
  const promptText = PROMPTS[promptKey] || PROMPTS.simple;
  if (!PROMPTS[promptKey]) console.log(`  ⚠ Unknown prompt "${promptKey}", using "simple"`);

  if (mode === 'convo') {
    // Conversational two-step: analyze first, then build in same thread
    const vbH = 750; // 4:3 aspect

    const step1 = `Hey buddy, can you help me deconstruct this photo for a painting tutorial app I'm working on?

The image is 2000x1500px (landscape).

I've already extracted the color palette — please use these as your base colors: ["#6b6359","#9b8d78","#3d3228","#503e2e","#1e160f","#c08a4e","#443c34","#786b5a","#595147","#876b48","#2e2720","#ab9874","#b0926e","#917e66"]

Note: there appears to be a reflection in the water.

Before we build anything, please first analyze the colors, perspective, and proportions in the image:
1. Confirm or refine the color palette — 8-12 distinct colors from background to foreground with hex codes.
2. Break down the main objects and their approximate relative sizes and positions.
3. Note how they sit in space — where is the horizon, what's the perspective, any reflections or foreshortened angles?
4. Give me a mental map of how we should build this as layers of simple vector shapes, back to front.`;

    const step2 = `Perfect, thank you! Now, based exactly on your analysis, can you recreate a buildable image made of SVG layers for each color?

Please use viewBox="0 0 1000 ${vbH}" and recreate an approximation from shapes (ellipses, rects, paths, polygons). Make sure to strictly use the exact colors you extracted and rely heavily on your proportion and perspective analysis so the scale looks accurate!

Output ONLY valid JSON matching this schema (no markdown fences, no extra text after the JSON):
{
  "viewBox": "0 0 1000 ${vbH}",
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

For gradients use: {"type":"defs","content":"<linearGradient id=\\"g1\\" ...><stop .../></linearGradient>"}
Use camelCase for SVG attrs (strokeWidth, etc). All values must be computed numbers.`;

    console.log('\n📤 Step 1: Analyzing image...');
    const { text: analysisText } = await callGemini([
      { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
      { text: step1 },
    ], { maxTokens: 4096 });
    analysis = analysisText;
    console.log('   Preview:', analysisText.slice(0, 200));

    console.log('\n📤 Step 2: Building SVG (multi-turn with analysis)...');
    const { text: svgText } = await callGemini([
      { role: 'user', parts: [
        { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
        { text: step1 },
      ]},
      { role: 'model', parts: [{ text: analysisText }] },
      { role: 'user', parts: [{ text: step2 }] },
    ], { maxTokens: 65536 });
    rawText = svgText;
    composition = extractJson(svgText);
  } else {
    console.log(`\n📤 Single call (prompt: ${promptKey})...`);
    const { text } = await callGemini([
      { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
      { text: promptText },
    ]);
    rawText = text;

    const jsonStart = text.indexOf('{');
    composition = extractJson(jsonStart >= 0 ? text.slice(jsonStart) : text);
  }

  if (composition) {
    const els = composition.layers?.reduce((s, l) => s + (l.elements?.length || 0), 0) || 0;
    console.log(`\n✅ Composition: ${composition.layers?.length} layers, ${els} elements`);
    console.log(`   Layers: ${composition.layers?.map(l => l.name).join(', ')}`);
  } else {
    console.log('\n❌ Failed to parse JSON from response');
    console.log('   First 300 chars:', rawText.slice(0, 300));
  }

  // Save result
  const result = {
    tag,
    mode,
    timestamp,
    model: MODEL,
    image: IMAGE_PATH,
    analysis,
    composition,
    rawResponseLength: rawText.length,
    rawResponsePreview: rawText.slice(0, 500),
    valid: !!composition?.viewBox && !!composition?.layers?.length,
  };

  writeFileSync(resultFile, JSON.stringify(result, null, 2));
  console.log(`\n💾 Saved: ${resultFile}`);
}

run().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
