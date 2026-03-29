#!/usr/bin/env node
/**
 * Test: Ask Gemini for raw SVG output (like chat does),
 * then parse into layer structure.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

const ENV = readFileSync('.env.local', 'utf-8');
const API_KEY = ENV.match(/VITE_GEMINI_KEY=(.+)/)?.[1]?.trim();
const MODEL = 'gemini-2.5-flash';
const IMAGE_PATH = process.argv.find((a, i) => process.argv[i - 1] === '--image') || 'test-images/A16DFB1D-7500-4157-967B-E5CC55F96CFB_4_5005_c.jpeg';
const tag = process.argv.find((a, i) => process.argv[i - 1] === '--tag') || 'raw-svg';

async function callGemini(contents, maxTokens = 65536) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: contents }],
      generationConfig: { temperature: 0.8, maxOutputTokens: maxTokens },
    }),
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
  const { execSync } = await import('child_process');
  const out = execSync(`sips -g pixelWidth -g pixelHeight "${IMAGE_PATH}" 2>/dev/null`).toString();
  const wm = out.match(/pixelWidth:\s*(\d+)/);
  const hm = out.match(/pixelHeight:\s*(\d+)/);
  if (wm && hm) { imgW = +wm[1]; imgH = +hm[1]; }
} catch {}
const isPortrait = imgH > imgW;
const vbW = 1000, vbH = Math.round(1000 / (imgW / imgH));
const orientation = isPortrait ? 'portrait (taller than wide)' : 'landscape (wider than tall)';

const prompt = `Hey buddy, can you help me deconstruct this ${orientation} photo into a buildable image made of svg layers of each color for a painting tutorial app im working on? please first analyze the colors, perspective, and proportions in the image and then recreate a sort of approximation from shapes. it should be recognizable, with as many details as you can recreate - but with simple svg shapes. Build it as 8-10 color layers ordered back to front.

Output the result as a complete SVG with viewBox="0 0 ${vbW} ${vbH}". Group each color layer in a <g> element with an id and a data-name attribute. No markdown fences around the SVG.`;

console.log(`\n🎨 Raw SVG Test — tag: ${tag}`);
console.log(`  Image: ${IMAGE_PATH} (${imgW}x${imgH}, ${orientation})`);
console.log(`  ViewBox: 0 0 ${vbW} ${vbH}`);
console.log('\n📤 Calling Gemini for raw SVG...');

const imageBase64 = readFileSync(IMAGE_PATH).toString('base64');
const mime = IMAGE_PATH.endsWith('.png') ? 'image/png' : 'image/jpeg';
const text = await callGemini([
  { inline_data: { mime_type: mime, data: imageBase64 } },
  { text: prompt },
]);

// Extract SVG from response
let svg = text;
const svgMatch = text.match(/<svg[\s\S]*<\/svg>/i);
if (svgMatch) svg = svgMatch[0];
// Strip markdown fences
svg = svg.replace(/^```(?:svg|xml|html)?\s*\n?/, '').replace(/\n?```\s*$/, '');

if (!existsSync('test-results')) mkdirSync('test-results');
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const svgFile = `test-results/${tag}-${ts}.svg`;
writeFileSync(svgFile, svg);

// Count elements
const gCount = (svg.match(/<g[\s>]/g) || []).length;
const elCount = (svg.match(/<(rect|path|circle|ellipse|line|polygon)\s/g) || []).length;
console.log(`\n✅ SVG: ${gCount} groups, ${elCount} shape elements, ${svg.length} chars`);
console.log(`🖼  Saved: ${svgFile}`);
