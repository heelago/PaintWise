/**
 * Client-side Gemini BYOK (Bring Your Own Key) SVG generation.
 * Calls Gemini API directly from the browser — no backend needed.
 * The user pastes their own API key in the UI.
 */

import { verifyComposition } from './verifyComposition.js';

// --- Image resizing ---

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
      // Return raw base64 without the data URI prefix
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageSrc;
  });
}

// --- Cache ---

function fnv1aHash(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 100) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function readCache(hash) {
  try {
    const raw = localStorage.getItem(`paintwise-ai-${hash}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && parsed.composition) return parsed.composition;
  } catch { /* ignore */ }
  return null;
}

function writeCache(hash, composition) {
  try {
    localStorage.setItem(`paintwise-ai-${hash}`, JSON.stringify({ version: 1, composition }));
  } catch { /* full or unavailable */ }
}

// --- Prompt ---

function buildPrompt(metadata) {
  const { width, height, hasHorizon, horizonY, hasReflection, centroids, sceneAvgColor, regionBounds } = metadata;

  const centroidsList = Array.isArray(centroids)
    ? centroids.map((c, i) => `  ${i + 1}. rgb(${c.join(', ')})`).join('\n')
    : 'none';

  const regionKeys = regionBounds ? Object.keys(regionBounds).join(', ') : 'none';
  const avgColor = Array.isArray(sceneAvgColor) ? sceneAvgColor.join(', ') : 'unknown';
  const horizonInfo = hasHorizon
    ? `detected at Y=${horizonY} (${Math.round((horizonY / height) * 100)}% from top)`
    : 'not detected';

  return `You are an expert watercolor composition designer and SVG engineer. You will receive a photograph and analysis metadata. Your task is to create a deterministic, scene-specific SVG composition that deconstructs the photograph into paintable layers.

STUDY THE PHOTOGRAPH CAREFULLY. Identify specific elements: buildings (with windows, doors, signage), poles, wires, trees, clouds (their actual shapes), textures, birds, vehicles, people silhouettes, water reflections — everything that makes THIS scene unique.

You MUST respond with ONLY a valid JSON object. No markdown code fences. No explanation before or after. Just the JSON.

Schema:
{
  "viewBox": "0 0 WIDTH HEIGHT",
  "layers": [
    {
      "id": "kebab-case-unique-id",
      "name": "Human Readable Name",
      "description": "What this layer represents and how it was derived",
      "paintingTip": "Specific watercolor technique advice for this layer",
      "elements": [
        {
          "type": "rect" | "circle" | "ellipse" | "path" | "line" | "defs",
          "attrs": { SVG attributes as camelCase key-value pairs }
        }
      ]
    }
  ]
}

RULES:
1. ViewBox: Scale so longest edge is ~800px. Match the image aspect ratio exactly. Image is ${width}x${height}.
2. Colors: Use ONLY hex colors derived from the provided centroids array or sampled from the actual image. Never invent colors.
3. Horizon: If hasHorizon is true, place the horizon line at the correct Y position (horizonY scaled to viewBox). Architectural elements must align with this line.
4. Layers: Create 5-8 layers, ordered back-to-front (background washes first, fine details last). Each layer corresponds to a watercolor painting step.
5. Scene specificity: Include the ACTUAL elements you see in the photo. If there are buildings, draw their specific shapes with windows and structural details. If there's a light pole, draw it. If there are birds, include them. Generic blobs are not acceptable.
6. Reflections: If hasReflection is true, create reflected versions of above-horizon elements below the horizon. Compress reflected shapes vertically by 0.85x and darken colors by ~20%.
7. Gradients: Put gradient definitions in a "defs" element with the SVG markup in its "content" field. Reference via url(#gradientId) in fill/stroke attrs.
8. Texture: For concrete, asphalt, or rough surfaces, use path elements with strokeDasharray patterns to simulate dry brush texture.
9. All SVG attributes must be camelCase: strokeWidth (not stroke-width), strokeDasharray (not stroke-dasharray), fillOpacity (not fill-opacity).
10. Painting tips should be specific and beginner-friendly: mention brush type, technique (wet-on-wet, dry brush), and which pigments to mix.

Now analyze this photograph:

Analysis metadata:
- Dimensions: ${width} x ${height} pixels
- Horizon: ${horizonInfo}
- Reflection: ${hasReflection ? 'detected (mirror symmetry across horizon)' : 'not detected'}
- Dominant colors (RGB):
${centroidsList}
- Scene average color: rgb(${avgColor})
- Regions detected: ${regionKeys}

Study the image carefully. Identify every specific architectural element, natural feature, and detail. Create a layered SVG composition that captures the unique character of THIS scene — not a generic interpretation.`;
}

// --- Extract JSON from response ---

function extractJson(text) {
  // Try direct parse first
  try { return JSON.parse(text); } catch { /* continue */ }

  // Strip markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }

  // Try to find JSON object in the text
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    try { return JSON.parse(text.slice(braceStart, braceEnd + 1)); } catch { /* continue */ }
  }

  return null;
}

// --- Main export ---

/**
 * Generate SVG composition using Gemini API directly from the browser.
 *
 * @param {string} apiKey - User's Gemini API key
 * @param {string} imageSrc - Image data URI
 * @param {object} analysisMetadata - Analysis results
 * @param {object} options - { force?: boolean, model?: string }
 * @returns {Promise<{ composition: object, warnings: string[] }>}
 */
export async function generateGeminiSvg(apiKey, imageSrc, analysisMetadata, options = {}) {
  if (!apiKey) throw new Error('Please enter your Gemini API key');

  // Cache check (skip if force regenerate)
  const hash = fnv1aHash(imageSrc);
  if (!options.force) {
    const cached = readCache(hash);
    if (cached) {
      const v = verifyComposition(cached, analysisMetadata);
      if (v.valid) return { composition: cached, warnings: v.warnings };
    }
  }

  // Resize image
  const imageBase64 = await resizeImageToBase64(imageSrc);

  // Build request
  const model = options.model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = buildPrompt(analysisMetadata);

  const body = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: 'image/jpeg',
            data: imageBase64,
          },
        },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  };

  // Call Gemini
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Network error: ${err.message}`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const errBody = await response.json();
      detail = errBody?.error?.message || JSON.stringify(errBody);
    } catch { detail = `HTTP ${response.status}`; }
    throw new Error(`Gemini API error: ${detail}`);
  }

  const result = await response.json();

  // Extract text from Gemini response
  const textContent = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textContent) {
    throw new Error('Gemini returned no content');
  }

  // Parse JSON
  const composition = extractJson(textContent);
  if (!composition) {
    throw new Error('Could not parse Gemini response as JSON');
  }

  // Verify
  const verification = verifyComposition(composition, analysisMetadata);
  if (!verification.valid) {
    throw new Error(`Invalid composition: ${verification.errors.join('; ')}`);
  }

  // Cache
  writeCache(hash, composition);

  return { composition, warnings: verification.warnings };
}
