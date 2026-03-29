/**
 * Verification checks for SVG compositions returned by Claude.
 * Validates schema, proportions, color accuracy, and element/layer counts.
 */

// --- Helpers ---

const VALID_ELEMENT_TYPES = new Set([
  'rect', 'circle', 'ellipse', 'path', 'line', 'defs',
]);

const VIEWBOX_PATTERN = /^0\s+0\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/;

const HEX_COLOR_PATTERN = /#([0-9a-fA-F]{3,8})/g;

/**
 * Parse a hex color string to [r, g, b].
 * Supports #RGB, #RRGGBB, #RRGGBBAA (alpha ignored).
 */
function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  // Take first 6 chars (ignore alpha if present)
  h = h.slice(0, 6);
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Euclidean distance between two RGB colors.
 */
function colorDistance(rgb1, rgb2) {
  const dr = rgb1[0] - rgb2[0];
  const dg = rgb1[1] - rgb2[1];
  const db = rgb1[2] - rgb2[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Collect all hex colors from an element's attrs (fill, stroke).
 */
function collectColors(elements) {
  const colors = [];
  for (const el of elements) {
    if (!el.attrs) continue;
    for (const attr of ['fill', 'stroke']) {
      const val = el.attrs[attr];
      if (typeof val !== 'string') continue;
      let match;
      HEX_COLOR_PATTERN.lastIndex = 0;
      while ((match = HEX_COLOR_PATTERN.exec(val)) !== null) {
        colors.push('#' + match[1]);
      }
    }
  }
  return colors;
}

// --- Main export ---

/**
 * Verify a composition object against expected schema and analysis metadata.
 *
 * @param {object} composition - The SVG composition from the API
 * @param {object} analysisMetadata - Source image analysis (width, height, centroids, etc.)
 * @returns {{ valid: boolean, warnings: string[], errors: string[] }}
 */
export function verifyComposition(composition, analysisMetadata) {
  const errors = [];
  const warnings = [];

  // ------------------------------------------------------------------
  // 1. Schema validation
  // ------------------------------------------------------------------

  if (!composition || typeof composition !== 'object') {
    errors.push('Composition is not an object');
    return { valid: false, warnings, errors };
  }

  // viewBox
  if (typeof composition.viewBox !== 'string' || !VIEWBOX_PATTERN.test(composition.viewBox)) {
    errors.push('viewBox must be a string matching "0 0 N N"');
  }

  // layers array
  if (!Array.isArray(composition.layers) || composition.layers.length === 0) {
    errors.push('layers must be a non-empty array');
  } else {
    for (let li = 0; li < composition.layers.length; li++) {
      const layer = composition.layers[li];
      if (typeof layer.id !== 'string') {
        errors.push(`Layer ${li}: missing or invalid "id" (expected string)`);
      }
      if (typeof layer.name !== 'string') {
        errors.push(`Layer ${li}: missing or invalid "name" (expected string)`);
      }
      if (!Array.isArray(layer.elements)) {
        errors.push(`Layer ${li}: "elements" must be an array`);
      } else {
        for (let ei = 0; ei < layer.elements.length; ei++) {
          const el = layer.elements[ei];
          if (!VALID_ELEMENT_TYPES.has(el.type)) {
            errors.push(
              `Layer ${li}, element ${ei}: invalid type "${el.type}" (expected one of ${[...VALID_ELEMENT_TYPES].join(', ')})`
            );
          }
          if (el.type === 'defs') {
            // Accept content string OR attrs — Gemini sometimes uses attrs for defs
            if (typeof el.content !== 'string' && (!el.attrs || typeof el.attrs !== 'object')) {
              warnings.push(`Layer ${li}, element ${ei}: defs element has neither "content" string nor "attrs"`);
            }
          } else {
            if (!el.attrs || typeof el.attrs !== 'object') {
              errors.push(`Layer ${li}, element ${ei}: non-defs element must have "attrs" object`);
            }
          }
        }
      }
    }
  }

  // If schema errors exist, skip further checks
  if (errors.length > 0) {
    return { valid: false, warnings, errors };
  }

  // ------------------------------------------------------------------
  // 2. ViewBox proportions
  // ------------------------------------------------------------------

  const vbMatch = composition.viewBox.match(VIEWBOX_PATTERN);
  if (vbMatch && analysisMetadata.width && analysisMetadata.height) {
    const vbW = parseFloat(vbMatch[1]);
    const vbH = parseFloat(vbMatch[2]);
    const vbRatio = vbW / vbH;
    const imgRatio = analysisMetadata.width / analysisMetadata.height;
    const ratioDiff = Math.abs(vbRatio - imgRatio) / imgRatio;
    if (ratioDiff > 0.1) {
      warnings.push(
        `ViewBox aspect ratio (${vbRatio.toFixed(2)}) differs from image (${imgRatio.toFixed(2)}) by ${(ratioDiff * 100).toFixed(1)}%`
      );
    }
  }

  // ------------------------------------------------------------------
  // 3. Color accuracy
  // ------------------------------------------------------------------

  const allElements = composition.layers.flatMap((l) => l.elements);
  const hexColors = collectColors(allElements);
  const centroids = analysisMetadata.centroids || [];

  if (hexColors.length > 0 && centroids.length > 0) {
    const centroidRgbs = centroids.map((c) => {
      if (c.rgb) return c.rgb;
      if (c.hex) return hexToRgb(c.hex);
      return null;
    }).filter(Boolean);

    if (centroidRgbs.length > 0) {
      let farCount = 0;
      for (const hex of hexColors) {
        const rgb = hexToRgb(hex);
        const minDist = Math.min(...centroidRgbs.map((cr) => colorDistance(rgb, cr)));
        if (minDist > 150) farCount++;
      }
      if (farCount / hexColors.length > 0.5) {
        warnings.push(
          `Over 50% of colors (${farCount}/${hexColors.length}) are far from analysis centroids`
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // 4. Element count
  // ------------------------------------------------------------------

  const totalElements = allElements.length;
  if (totalElements > 500) {
    warnings.push(
      `High element count (${totalElements}) may impact rendering performance`
    );
  }

  for (let li = 0; li < composition.layers.length; li++) {
    if (composition.layers[li].elements.length === 0) {
      warnings.push(`Layer ${li} ("${composition.layers[li].name}") has 0 elements`);
    }
  }

  // ------------------------------------------------------------------
  // 5. Layer count
  // ------------------------------------------------------------------

  const layerCount = composition.layers.length;
  if (layerCount < 2) {
    warnings.push(`Only ${layerCount} layer found; expected at least 2`);
  } else if (layerCount > 12) {
    warnings.push(`${layerCount} layers found; more than 12 may be excessive`);
  }

  return { valid: errors.length === 0, warnings, errors };
}
