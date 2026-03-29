#!/usr/bin/env node
/**
 * Test: "Painter's Algorithm" prompt — forces texture-over-form approach.
 * Outputs raw SVG with <g> layers.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const ENV = readFileSync('.env.local', 'utf-8');
const API_KEY = ENV.match(/VITE_GEMINI_KEY=(.+)/)?.[1]?.trim();
const MODEL = 'gemini-2.5-flash';
const IMAGE_PATH = process.argv.find((a, i) => process.argv[i - 1] === '--image') || 'test-images/A16DFB1D-7500-4157-967B-E5CC55F96CFB_4_5005_c.jpeg';
const tag = process.argv.find((a, i) => process.argv[i - 1] === '--tag') || 'painter-algo';

async function callGemini(contents, { maxTokens = 65536, systemInstruction = null } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{ parts: contents }],
    generationConfig: { temperature: 0.8, maxOutputTokens: maxTokens },
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
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(`API ${res.status}: ${e?.error?.message}`); }
  const result = await res.json();
  const text = (result?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  console.log(`  → ${text.length} chars, ${result?.candidates?.[0]?.finishReason}, ${((Date.now()-t0)/1000).toFixed(1)}s`);
  return text;
}

// Detect dimensions
let imgW = 360, imgH = 540;
try {
  const out = execSync(`sips -g pixelWidth -g pixelHeight "${IMAGE_PATH}" 2>/dev/null`).toString();
  const wm = out.match(/pixelWidth:\s*(\d+)/);
  const hm = out.match(/pixelHeight:\s*(\d+)/);
  if (wm && hm) { imgW = +wm[1]; imgH = +hm[1]; }
} catch {}
const isPortrait = imgH > imgW;
const vbW = isPortrait ? 800 : 1000;
const vbH = isPortrait ? Math.round(800 / (imgW / imgH)) : Math.round(1000 / (imgW / imgH));

const SYSTEM = `You are a master digital artist and expert SVG developer. Your task is to deconstruct a provided image into a beautifully layered, stylized SVG illustration. You do not trace; you interpret. You use simple geometry, clever opacities, and layering to create the illusion of the original photo.`;

const prompt = `Please deconstruct the attached image into a scalable, artistic SVG. Before writing any code, you must complete the following planning phase:

STEP 1: VISUAL ANALYSIS
- What is the overall mood and lighting?
- Identify the 5-7 dominant hex colors in the image.
- What is the focal point, and where is it located on a rough X/Y percentage grid?

STEP 2: THE PAINTER'S ALGORITHM (LAYER PLAN)
Break the image down into exactly 5 to 6 distinct semantic layers, from back to front. For each layer, describe what basic SVG primitives (rects, lines, ellipses, simple polygons) you will use.

STEP 3: SVG CONSTRAINTS
- DO NOT try to draw complex, multi-point <path> outlines of literal objects.
- DO use overlapping primitives with varying opacity (e.g., 0.3 to 0.7) to build up textures and colors.
- DO use <linearGradient> for skies and water.
- DO use repeating geometric patterns (like <line> or thin <ellipse>) for textures like water ripples or rain.

STEP 4: CODE GENERATION
Now, write the complete SVG code. Wrap each layer in a <g id="layer-name"> tag so the structure perfectly matches your Step 2 plan. Use viewBox="0 0 ${vbW} ${vbH}". No markdown fences around the SVG.`;

console.log(`\n🎨 Painter's Algorithm Test — tag: ${tag}`);
console.log(`  Image: ${IMAGE_PATH} (${imgW}x${imgH})`);
console.log(`  ViewBox: 0 0 ${vbW} ${vbH}`);
console.log('\n📤 Calling Gemini...');

const imageBase64 = readFileSync(IMAGE_PATH).toString('base64');
const mime = IMAGE_PATH.endsWith('.png') ? 'image/png' : 'image/jpeg';
const text = await callGemini([
  { inline_data: { mime_type: mime, data: imageBase64 } },
  { text: prompt },
], { systemInstruction: SYSTEM });

// Extract SVG
let svg = text;
const svgMatch = text.match(/<svg[\s\S]*<\/svg>/i);
if (svgMatch) svg = svgMatch[0];
svg = svg.replace(/^```(?:svg|xml|html)?\s*\n?/, '').replace(/\n?```\s*$/, '');

if (!existsSync('test-results')) mkdirSync('test-results');
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const svgFile = `test-results/${tag}-${ts}.svg`;
writeFileSync(svgFile, svg);

// Also save the full response for analysis
writeFileSync(svgFile.replace('.svg', '.txt'), text);

const gCount = (svg.match(/<g[\s>]/g) || []).length;
const elCount = (svg.match(/<(rect|path|circle|ellipse|line|polygon)\s/g) || []).length;
console.log(`\n✅ SVG: ${gCount} groups, ${elCount} shape elements, ${svg.length} chars`);
console.log(`🖼  SVG: ${svgFile}`);
console.log(`📝 Full response: ${svgFile.replace('.svg', '.txt')}`);
