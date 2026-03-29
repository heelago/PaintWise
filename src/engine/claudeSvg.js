/**
 * Client-side module for calling the SVG generation API and caching results.
 */

import { verifyComposition } from './verifyComposition.js';

// --- Hashing (FNV-1a over sampled chars) ---

function fnv1aHash(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 100) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

// --- Image resizing ---

function resizeImageToBase64(imageSrc, maxDim = 1200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const { width, height } = img;
      let targetW = width;
      let targetH = height;

      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          targetW = maxDim;
          targetH = Math.round(height * (maxDim / width));
        } else {
          targetH = maxDim;
          targetW = Math.round(width * (maxDim / height));
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const base64 = canvas.toDataURL('image/jpeg', 0.85);
      resolve(base64);
    };
    img.onerror = () => reject(new Error('Failed to load image for resizing'));
    img.src = imageSrc;
  });
}

// --- Cache helpers ---

function cacheKey(hash) {
  return `paintwise-svg-${hash}`;
}

function readCache(hash) {
  try {
    const raw = localStorage.getItem(cacheKey(hash));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.composition) {
      return parsed.composition;
    }
  } catch {
    // Corrupt cache entry — ignore
  }
  return null;
}

function writeCache(hash, composition) {
  try {
    localStorage.setItem(
      cacheKey(hash),
      JSON.stringify({ version: 1, composition })
    );
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

// --- Main export ---

/**
 * Generate an SVG composition by calling the backend API.
 * Caches successful results in localStorage keyed by image hash.
 *
 * @param {string} imageSrc - Image source (URL or data URI)
 * @param {object} analysisMetadata - Analysis results (centroids, width, height, etc.)
 * @returns {Promise<{ composition: object, warnings: string[] }>}
 */
export async function generateClaudeSvg(imageSrc, analysisMetadata) {
  // 1. Compute hash for cache lookup
  const hash = fnv1aHash(imageSrc);

  // 2. Check cache
  const cached = readCache(hash);
  if (cached) {
    const verification = verifyComposition(cached, analysisMetadata);
    if (verification.valid) {
      return { composition: cached, warnings: verification.warnings };
    }
    // Cached composition no longer passes verification — regenerate
  }

  // 3. Resize image for API payload
  const imageBase64 = await resizeImageToBase64(imageSrc);

  // 4. Call API
  let response;
  try {
    response = await fetch('/api/generate-svg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, analysisMetadata }),
    });
  } catch (err) {
    throw new Error(`Network error calling SVG generation API: ${err.message}`);
  }

  if (!response.ok) {
    let errorMsg = `SVG generation failed (HTTP ${response.status})`;
    try {
      const body = await response.json();
      if (body && body.error) {
        errorMsg = `SVG generation failed: ${body.error}`;
      }
    } catch {
      // Could not parse error body
    }
    throw new Error(errorMsg);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('SVG generation returned invalid JSON');
  }

  const composition = data.composition || data;

  // 5. Verify composition
  const verification = verifyComposition(composition, analysisMetadata);
  if (!verification.valid) {
    throw new Error(
      `Invalid SVG composition from API: ${verification.errors.join('; ')}`
    );
  }

  // 6. Cache successful result
  writeCache(hash, composition);

  return { composition, warnings: verification.warnings };
}

/**
 * Clear all PaintWise SVG cache entries from localStorage.
 */
export function clearSvgCache() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('paintwise-svg-')) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}
