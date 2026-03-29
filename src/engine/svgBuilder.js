// ===================================================================
// DETERMINISTIC RASTER-TO-VECTOR DECONSTRUCTION ENGINE
//
// Implements a strictly algorithmic, reproducible methodology for
// translating a raster photograph into a layered, programmatic SVG.
//
// The process eschews artistic interpretation in favor of:
//   - Coordinate mapping & grid normalization
//   - Algorithmic color extraction via strip sampling
//   - Geometric primitive extraction with reflection algebra
//   - Luminance-thresholded Bézier vectorization for organic forms
//   - Procedural texture emulation via stroke-dasharray math
//
// Based on the "Deterministic Raster-to-Vector Deconstruction"
// methodology by Gemini.
// ===================================================================

export const LAYER_NAMES = [
  "Base Washes",
  "Architectural Geometry",
  "Cloud Topography",
  "Procedural Texture",
  "Micro-Grit Detail",
];

// -------------------------------------------------------------------
// Utility
// -------------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function hexFromRgb(r, g, b) {
  return '#' + [r, g, b].map(c => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('');
}

function luminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Sample average color in a rectangular strip from the source pixels. */
function sampleStrip(pixels, imgW, imgH, x0, y0, x1, y1) {
  let rSum = 0, gSum = 0, bSum = 0, n = 0;
  const sx0 = clamp(Math.floor(x0), 0, imgW - 1);
  const sx1 = clamp(Math.floor(x1), 0, imgW - 1);
  const sy0 = clamp(Math.floor(y0), 0, imgH - 1);
  const sy1 = clamp(Math.floor(y1), 0, imgH - 1);
  for (let y = sy0; y <= sy1; y++) {
    for (let x = sx0; x <= sx1; x++) {
      const i = (y * imgW + x) * 4;
      rSum += pixels[i]; gSum += pixels[i + 1]; bSum += pixels[i + 2];
      n++;
    }
  }
  if (n === 0) return [128, 128, 128];
  return [Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)];
}

/** Sample a single row-band average color at given y-fraction of image. */
function sampleAtY(pixels, imgW, imgH, yFraction, stripHalfWidth = 5) {
  const cx = Math.floor(imgW / 2);
  const y = Math.floor(yFraction * imgH);
  return sampleStrip(pixels, imgW, imgH,
    cx - stripHalfWidth, y - 2,
    cx + stripHalfWidth, y + 2);
}

/** Darken a color by a multiplicative factor (for reflections). */
function darken([r, g, b], factor) {
  return [Math.round(r * factor), Math.round(g * factor), Math.round(b * factor)];
}

// -------------------------------------------------------------------
// Phase 1: Coordinate System Setup & Grid Normalization
// -------------------------------------------------------------------

function setupCoordinateSystem(analysis, displayW, displayH) {
  const imgW = analysis.width;
  const imgH = analysis.height;

  // Determine aspect ratio and viewBox
  const aspect = imgW / imgH;
  let vbW, vbH;
  if (aspect >= 1) {
    // Landscape
    vbW = displayW || 800;
    vbH = Math.round(vbW / aspect);
  } else {
    // Portrait
    vbH = displayH || 1200;
    vbW = Math.round(vbH * aspect);
  }

  // Horizon line: use analysis.horizonY if detected, else scan for it
  let horizonYImg;
  if (analysis.hasHorizon && analysis.horizonY != null) {
    horizonYImg = analysis.horizonY;
  } else {
    // Fallback: scan for strongest horizontal contrast band
    horizonYImg = findHorizonByScan(analysis.grayMap, imgW, imgH);
  }

  // Normalize horizon to viewBox coordinates
  const horizonY = Math.round((horizonYImg / imgH) * vbH);

  // Scale factors from image space to viewBox space
  const scaleX = vbW / imgW;
  const scaleY = vbH / imgH;

  return { vbW, vbH, horizonY, horizonYImg, scaleX, scaleY, imgW, imgH };
}

/** Fallback horizon detection by scanning for max row-to-row contrast. */
function findHorizonByScan(grayMap, w, h) {
  let maxContrast = 0;
  let bestY = Math.round(h * 0.5);
  for (let y = Math.round(h * 0.2); y < Math.round(h * 0.8); y++) {
    let diff = 0;
    for (let x = 0; x < w; x += 4) {
      const above = grayMap[y * w + x];
      const below = grayMap[(y + 1) * w + x];
      diff += Math.abs(above - below);
    }
    if (diff > maxContrast) {
      maxContrast = diff;
      bestY = y;
    }
  }
  return bestY;
}

// -------------------------------------------------------------------
// Phase 2: Algorithmic Color Extraction (Gradient Stops)
// -------------------------------------------------------------------

function extractBaseWashes(analysis, coord) {
  const { vbW, vbH, horizonY, horizonYImg, imgW, imgH } = coord;
  const px = analysis.pixels;
  const hasHorizon = analysis.hasHorizon;

  if (!hasHorizon) {
    // No horizon: single full-image vertical gradient
    const stops = [0, 0.25, 0.5, 0.75, 1.0].map(f => {
      const [r, g, b] = sampleAtY(px, imgW, imgH, f);
      return { offset: f, color: hexFromRgb(r, g, b) };
    });

    const gradId = 'fullGrad';
    return {
      id: 'base-washes',
      name: 'Base Washes',
      description: 'Vertical gradient sampled from the image center strip',
      paintingTip: 'Lay a graduated wash from top to bottom matching these color stops',
      elements: [
        { type: 'defs', content: linearGradientSvg(gradId, stops, 0, 0, 0, vbH) },
        { type: 'rect', attrs: { x: 0, y: 0, width: vbW, height: vbH, fill: `url(#${gradId})` } },
      ],
    };
  }

  // Two-zone gradient: Zone A (above horizon) and Zone B (below horizon)
  const hFrac = horizonYImg / imgH;

  // Zone A: sample at 4 Y-positions from top to horizon
  const zoneAFractions = [0, hFrac * 0.5, hFrac * 0.85, hFrac];
  const zoneAColors = zoneAFractions.map(f => sampleAtY(px, imgW, imgH, f));

  // Zone B: sample at 4 Y-positions from horizon to bottom
  const zoneBFractions = [hFrac, hFrac + (1 - hFrac) * 0.15, hFrac + (1 - hFrac) * 0.5, 1.0];
  const zoneBColors = zoneBFractions.map(f => sampleAtY(px, imgW, imgH, f));

  // Build gradient stops for Zone A
  const zoneAStops = zoneAColors.map((c, i) => ({
    offset: zoneAFractions[i] / hFrac,
    color: hexFromRgb(...c),
  }));

  // Build gradient stops for Zone B
  const zoneBStops = zoneBColors.map((c, i) => ({
    offset: (zoneBFractions[i] - hFrac) / (1 - hFrac),
    color: hexFromRgb(...c),
  }));

  // Luminance shift verification: Zone A values should be ~15-20% darker
  // than Zone B if there's a reflection (concrete absorbs light)
  const zoneAAvgL = zoneAColors.reduce((s, c) => s + luminance(...c), 0) / zoneAColors.length;
  const zoneBAvgL = zoneBColors.reduce((s, c) => s + luminance(...c), 0) / zoneBColors.length;
  const luminanceShift = zoneBAvgL > 0 ? (1 - zoneAAvgL / zoneBAvgL) : 0;

  const elements = [
    { type: 'defs', content:
      linearGradientSvg('zoneAGrad', zoneAStops, 0, 0, 0, horizonY) +
      linearGradientSvg('zoneBGrad', zoneBStops, 0, horizonY, 0, vbH)
    },
    // Zone A rect (above horizon)
    { type: 'rect', attrs: { x: 0, y: 0, width: vbW, height: horizonY, fill: 'url(#zoneAGrad)' } },
    // Zone B rect (below horizon)
    { type: 'rect', attrs: { x: 0, y: horizonY, width: vbW, height: vbH - horizonY, fill: 'url(#zoneBGrad)' } },
  ];

  return {
    id: 'base-washes',
    name: 'Base Washes',
    description: `Two-zone gradient. Luminance shift: ${Math.round(luminanceShift * 100)}% darker in Zone A`,
    paintingTip: 'Paint Zone B (below horizon) first as the real sky wash, then Zone A as a darker mirror',
    elements,
  };
}

function linearGradientSvg(id, stops, x1, y1, x2, y2) {
  const stopsStr = stops.map(s =>
    `<stop offset="${Math.round(s.offset * 100)}%" stop-color="${s.color}"/>`
  ).join('');
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">${stopsStr}</linearGradient>`;
}

// -------------------------------------------------------------------
// Phase 3: Geometric Primitive Extraction (Architectural Symmetry)
// -------------------------------------------------------------------

function extractArchitecture(analysis, coord) {
  const { vbW, vbH, horizonY, horizonYImg, scaleX, scaleY, imgW, imgH } = coord;
  const hasHorizon = analysis.hasHorizon;

  if (!hasHorizon) {
    return {
      id: 'architecture',
      name: 'Architectural Geometry',
      description: 'No horizon detected — skipping architectural extraction',
      paintingTip: '',
      elements: [],
    };
  }

  // Scan the horizon band for dark architectural blocks
  // Look in a band from horizonY-15% to horizonY+5% of image height
  const bandTopImg = Math.max(0, Math.round(horizonYImg - imgH * 0.15));
  const bandBotImg = Math.min(imgH - 1, Math.round(horizonYImg + imgH * 0.05));
  const grayMap = analysis.grayMap;
  const regionMap = analysis.regionMap;

  // Threshold: find dark columns (architectural silhouette)
  const darkThreshold = 80; // gray value
  const columnDarkness = new Float32Array(imgW);
  const columnTopmost = new Int32Array(imgW).fill(bandBotImg);

  for (let x = 0; x < imgW; x++) {
    let darkCount = 0;
    let topY = bandBotImg;
    for (let y = bandTopImg; y <= bandBotImg; y++) {
      const g = grayMap[y * imgW + x];
      if (g < darkThreshold) {
        darkCount++;
        if (y < topY) topY = y;
      }
    }
    columnDarkness[x] = darkCount;
    columnTopmost[x] = topY;
  }

  // Find contiguous dark blocks by run-length encoding on columns
  const blocks = [];
  let inBlock = false;
  let blockStart = 0;
  const minDarkCount = (bandBotImg - bandTopImg) * 0.15;

  for (let x = 0; x < imgW; x++) {
    const isDark = columnDarkness[x] > minDarkCount;
    if (isDark && !inBlock) {
      blockStart = x;
      inBlock = true;
    } else if (!isDark && inBlock) {
      const blockW = x - blockStart;
      if (blockW > imgW * 0.02) { // minimum 2% of image width
        // Find the topmost point across this block
        let minTop = bandBotImg;
        for (let bx = blockStart; bx < x; bx++) {
          if (columnTopmost[bx] < minTop) minTop = columnTopmost[bx];
        }
        // Sample color from this block
        const color = sampleStrip(analysis.pixels, imgW, imgH,
          blockStart, minTop, x - 1, bandBotImg);
        blocks.push({
          xImg: blockStart,
          wImg: blockW,
          topImg: minTop,
          botImg: bandBotImg,
          color,
        });
      }
      inBlock = false;
    }
  }
  if (inBlock) {
    const blockW = imgW - blockStart;
    if (blockW > imgW * 0.02) {
      let minTop = bandBotImg;
      for (let bx = blockStart; bx < imgW; bx++) {
        if (columnTopmost[bx] < minTop) minTop = columnTopmost[bx];
      }
      const color = sampleStrip(analysis.pixels, imgW, imgH,
        blockStart, minTop, imgW - 1, bandBotImg);
      blocks.push({ xImg: blockStart, wImg: blockW, topImg: minTop, botImg: bandBotImg, color });
    }
  }

  // Reflection compression scalar
  const Sy = 0.85;
  const elements = [];

  for (const block of blocks) {
    const x = Math.round(block.xImg * scaleX);
    const w = Math.round(block.wImg * scaleX);
    const hReal = Math.round((block.botImg - block.topImg) * scaleY);
    const yReal = horizonY - hReal; // buildings sit on the horizon
    const hex = hexFromRgb(...block.color);

    // Real block (below horizon in scene = Zone B)
    elements.push({
      type: 'rect',
      attrs: { x, y: horizonY, width: w, height: hReal, fill: hex, opacity: 0.9 },
    });

    // Reflected block (above horizon in scene = Zone A)
    // Formula: H_reflected = H_real × Sy, Y_reflected = Hy - H_reflected
    const hRefl = Math.round(hReal * Sy);
    const yRefl = horizonY - hRefl;
    const reflHex = hexFromRgb(...darken(block.color, 0.82));

    elements.push({
      type: 'rect',
      attrs: { x, y: yRefl, width: w, height: hRefl, fill: reflHex, opacity: 0.55 },
    });
  }

  return {
    id: 'architecture',
    name: 'Architectural Geometry',
    description: `${blocks.length} blocks detected. Reflections compressed by Sy=${Sy}`,
    paintingTip: 'Paint the real buildings first (dark, concentrated), then their reflections (diluted, same shapes)',
    elements,
  };
}

// -------------------------------------------------------------------
// Phase 4: Vectorizing Organic Forms (Cloud Topography)
// -------------------------------------------------------------------

function extractCloudTopography(analysis, coord) {
  const { vbW, vbH, horizonY, horizonYImg, scaleX, scaleY, imgW, imgH } = coord;
  const px = analysis.pixels;

  // Determine sky zone: if horizon exists, use Zone B (real sky = below horizon in image)
  // If no horizon, use upper 40%
  let skyTopImg, skyBotImg;
  if (analysis.hasHorizon) {
    // In many reflection photos, the real sky is below the horizon in the image
    // (puddle above, sky below). Use regionBounds if available.
    if (analysis.regionBounds?.sky) {
      skyTopImg = analysis.regionBounds.sky.top;
      skyBotImg = analysis.regionBounds.sky.bot;
    } else {
      skyTopImg = 0;
      skyBotImg = horizonYImg;
    }
  } else {
    skyTopImg = 0;
    skyBotImg = Math.round(imgH * 0.4);
  }

  if (skyBotImg - skyTopImg < imgH * 0.05) {
    return {
      id: 'clouds',
      name: 'Cloud Topography',
      description: 'Sky zone too small for cloud extraction',
      paintingTip: '',
      elements: [],
    };
  }

  // Luminance thresholding into 3 tonal bands
  const bands = { shadow: [], midtone: [], highlight: [] };

  for (let y = skyTopImg; y < skyBotImg; y++) {
    for (let x = 0; x < imgW; x++) {
      const i = (y * imgW + x) * 4;
      const L = luminance(px[i], px[i + 1], px[i + 2]);
      if (L < 0.4) bands.shadow.push({ x, y, r: px[i], g: px[i + 1], b: px[i + 2] });
      else if (L > 0.75) bands.highlight.push({ x, y, r: px[i], g: px[i + 1], b: px[i + 2] });
      else bands.midtone.push({ x, y, r: px[i], g: px[i + 1], b: px[i + 2] });
    }
  }

  const elements = [];

  // For each band, find connected masses and create Bézier paths
  for (const [bandName, bandPixels, opacity] of [
    ['shadow', bands.shadow, 0.6],
    ['midtone', bands.midtone, 0.35],
    ['highlight', bands.highlight, 0.9],
  ]) {
    if (bandPixels.length < (skyBotImg - skyTopImg) * imgW * 0.005) continue;

    // Find connected components using a coarse grid
    const gridSize = Math.max(4, Math.round(imgW / 80));
    const gridW = Math.ceil(imgW / gridSize);
    const gridH = Math.ceil((skyBotImg - skyTopImg) / gridSize);
    const grid = new Uint8Array(gridW * gridH);

    for (const p of bandPixels) {
      const gx = Math.floor(p.x / gridSize);
      const gy = Math.floor((p.y - skyTopImg) / gridSize);
      if (gx >= 0 && gx < gridW && gy >= 0 && gy < gridH) {
        grid[gy * gridW + gx] = 1;
      }
    }

    // Flood fill to find components
    const visited = new Uint8Array(gridW * gridH);
    const components = [];

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        if (grid[gy * gridW + gx] && !visited[gy * gridW + gx]) {
          const comp = floodFill(grid, visited, gridW, gridH, gx, gy);
          if (comp.length > 3) components.push(comp); // skip tiny clusters
        }
      }
    }

    // For each component, compute bounding box and generate quadratic Bézier path
    for (const comp of components) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let rSum = 0, gSum = 0, bSum = 0;

      for (const { x: gx, y: gy } of comp) {
        const px = gx * gridSize;
        const py = (gy * gridSize) + skyTopImg;
        if (px < minX) minX = px;
        if (px + gridSize > maxX) maxX = px + gridSize;
        if (py < minY) minY = py;
        if (py + gridSize > maxY) maxY = py + gridSize;
      }

      // Sample average color from this component's region
      const cx = Math.round((minX + maxX) / 2);
      const cy = Math.round((minY + maxY) / 2);
      const sampleC = sampleStrip(analysis.pixels, imgW, imgH,
        cx - 5, cy - 5, cx + 5, cy + 5);

      // Scale to viewBox
      const vMinX = Math.round(minX * scaleX);
      const vMaxX = Math.round(maxX * scaleX);
      const vMinY = Math.round(minY * scaleY);
      const vMaxY = Math.round(maxY * scaleY);

      // Control Point Generation per Gemini spec:
      // Anchor points at absolute extrema (top, bottom, left, right)
      // Quadratic control points at bounding box tangent intersections
      const midX = (vMinX + vMaxX) / 2;
      const midY = (vMinY + vMaxY) / 2;
      const padX = (vMaxX - vMinX) * 0.1;
      const padY = (vMaxY - vMinY) * 0.1;

      // Elliptical path via quadratic Béziers:
      // Start at left-mid, curve to top-mid, to right-mid, to bottom-mid, close
      const path = [
        `M${vMinX},${midY}`,
        `Q${vMinX},${vMinY - padY} ${midX},${vMinY}`,   // left→top
        `Q${vMaxX},${vMinY - padY} ${vMaxX},${midY}`,   // top→right
        `Q${vMaxX},${vMaxY + padY} ${midX},${vMaxY}`,   // right→bottom
        `Q${vMinX},${vMaxY + padY} ${vMinX},${midY}`,   // bottom→left
        'Z',
      ].join(' ');

      elements.push({
        type: 'path',
        attrs: {
          d: path,
          fill: hexFromRgb(...sampleC),
          opacity,
        },
      });
    }
  }

  // Layer stacking: shadows first (largest/darkest), then midtones, then highlights
  // This is already handled by the iteration order above

  return {
    id: 'clouds',
    name: 'Cloud Topography',
    description: `${elements.length} tonal masses extracted via luminance thresholding`,
    paintingTip: 'Paint darkest cloud masses first (wet), then midtones, then lift/add highlights',
    elements,
  };
}

function floodFill(grid, visited, w, h, startX, startY) {
  const stack = [{ x: startX, y: startY }];
  const result = [];
  while (stack.length > 0) {
    const { x, y } = stack.pop();
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    const idx = y * w + x;
    if (visited[idx] || !grid[idx]) continue;
    visited[idx] = 1;
    result.push({ x, y });
    stack.push({ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 });
  }
  return result;
}

// -------------------------------------------------------------------
// Phase 5: Procedural Texture Emulation
// -------------------------------------------------------------------

function extractProceduralTexture(analysis, coord) {
  const { vbW, vbH, horizonY, imgW, imgH, scaleX, scaleY } = coord;
  const hasHorizon = analysis.hasHorizon;

  if (!hasHorizon) {
    return {
      id: 'texture',
      name: 'Procedural Texture',
      description: 'No horizon — skipping texture layer',
      paintingTip: '',
      elements: [],
    };
  }

  const elements = [];

  // Determine which zone has "ground" texture (concrete, sand, etc.)
  // In reflection photos, the foreground texture is often near the edges
  // or in the top portion (if the image is inverted puddle)

  // Generate sweeping dash-array paths to emulate dry brush texture
  // across the foreground/concrete areas
  const fgTopImg = analysis.regionBounds?.foreground?.top ?? Math.round(imgH * 0.85);
  const fgBotImg = imgH;

  // Also check if there's texture in the upper zone (puddle edge concrete)
  const textureZones = [];

  // Zone near horizon (shore/concrete band)
  const nearHorizon = {
    yStart: Math.max(0, horizonY - Math.round(vbH * 0.03)),
    yEnd: Math.min(vbH, horizonY + Math.round(vbH * 0.03)),
  };
  textureZones.push(nearHorizon);

  // Foreground zone
  const fgTop = Math.round(fgTopImg * scaleY);
  if (fgTop < vbH) {
    textureZones.push({ yStart: fgTop, yEnd: vbH });
  }

  // Sample color from horizon band for texture
  const hBandColor = sampleStrip(analysis.pixels, imgW, imgH,
    0, Math.round(analysis.horizonY ?? imgH * 0.5) - 3,
    imgW - 1, Math.round(analysis.horizonY ?? imgH * 0.5) + 3);

  for (const zone of textureZones) {
    const zoneH = zone.yEnd - zone.yStart;
    if (zoneH < 5) continue;

    // Generate 3-5 sweeping paths with stochastic dash arrays
    const pathCount = Math.max(2, Math.min(5, Math.round(zoneH / 15)));

    for (let p = 0; p < pathCount; p++) {
      const yOff = zone.yStart + (zoneH * (p + 0.5)) / pathCount;

      // Sweeping quadratic Bézier across the width
      const cpY = yOff + (Math.sin(p * 2.7) * zoneH * 0.3);
      const path = `M-10,${Math.round(yOff)} Q${Math.round(vbW * 0.35)},${Math.round(cpY)} ${Math.round(vbW * 0.65)},${Math.round(yOff + zoneH * 0.1)} T${vbW + 10},${Math.round(yOff - zoneH * 0.05)}`;

      // Dasharray math: stochastic pattern for dry brush tooth
      const dashes = [
        3 + (p * 2) % 5,
        10 + (p * 3) % 12,
        15 + (p * 7) % 10,
        8 + (p * 5) % 7,
      ].join(', ');

      const strokeW = Math.max(8, Math.min(40, zoneH * 0.5));
      const texColor = darken(hBandColor, 0.7 + p * 0.06);

      elements.push({
        type: 'path',
        attrs: {
          d: path,
          fill: 'none',
          stroke: hexFromRgb(...texColor),
          strokeWidth: strokeW,
          strokeDasharray: dashes,
          strokeLinecap: 'round',
          opacity: 0.25 + p * 0.05,
        },
      });
    }
  }

  return {
    id: 'texture',
    name: 'Procedural Texture',
    description: `${elements.length} dash-array paths emulating dry brush texture`,
    paintingTip: 'Use a dry, fan-shaped brush dragged lightly to catch the paper tooth',
    elements,
  };
}

// -------------------------------------------------------------------
// Phase 5b: Micro-Grit Detail Points
// -------------------------------------------------------------------

function extractMicroGrit(analysis, coord) {
  const { vbW, vbH, horizonY, scaleX, scaleY, imgW, imgH } = coord;
  const px = analysis.pixels;
  const grayMap = analysis.grayMap;

  // Place explicit <circle> elements at high-contrast pixel locations
  // Scan for local contrast peaks
  const elements = [];
  const stride = Math.max(4, Math.round(imgW / 100));
  const maxDots = 200;
  const candidates = [];

  for (let y = 0; y < imgH; y += stride) {
    for (let x = 0; x < imgW; x += stride) {
      const g = grayMap[y * imgW + x];
      // Compute local contrast (difference from neighbors)
      let contrast = 0;
      let count = 0;
      for (let dy = -stride; dy <= stride; dy += stride) {
        for (let dx = -stride; dx <= stride; dx += stride) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < imgW && ny >= 0 && ny < imgH) {
            contrast += Math.abs(g - grayMap[ny * imgW + nx]);
            count++;
          }
        }
      }
      if (count > 0) contrast /= count;

      if (contrast > 25) {
        const i = (y * imgW + x) * 4;
        candidates.push({
          x: Math.round(x * scaleX),
          y: Math.round(y * scaleY),
          contrast,
          r: px[i], g: px[i + 1], b: px[i + 2],
        });
      }
    }
  }

  // Sort by contrast descending, take top N
  candidates.sort((a, b) => b.contrast - a.contrast);
  const selected = candidates.slice(0, maxDots);

  for (const dot of selected) {
    // Radius 1-3 based on contrast strength
    const radius = 1 + Math.min(2, Math.floor(dot.contrast / 40));
    // Opacity varies with contrast
    const opacity = 0.3 + Math.min(0.5, dot.contrast / 100);

    elements.push({
      type: 'circle',
      attrs: {
        cx: dot.x,
        cy: dot.y,
        r: radius,
        fill: hexFromRgb(dot.r, dot.g, dot.b),
        opacity: Math.round(opacity * 100) / 100,
      },
    });
  }

  // Add warm glow dots if warmGlowMap exists
  if (analysis.warmGlowMap) {
    const glowDots = [];
    for (let y = 0; y < imgH; y += stride * 2) {
      for (let x = 0; x < imgW; x += stride * 2) {
        if (analysis.warmGlowMap[y * imgW + x]) {
          const i = (y * imgW + x) * 4;
          if (grayMap[y * imgW + x] > 180) { // bright warm spots
            glowDots.push({
              x: Math.round(x * scaleX),
              y: Math.round(y * scaleY),
              r: px[i], g: px[i + 1], b: px[i + 2],
            });
          }
        }
      }
    }

    // Light points with reflected streaks (if horizon exists)
    for (const dot of glowDots.slice(0, 30)) {
      elements.push({
        type: 'circle',
        attrs: {
          cx: dot.x, cy: dot.y, r: 2.5,
          fill: hexFromRgb(dot.r, dot.g, dot.b),
          opacity: 0.85,
        },
      });

      // Reflected light streak (if near horizon)
      if (analysis.hasHorizon) {
        const reflY = 2 * horizonY - dot.y;
        if (reflY > 0 && reflY < vbH) {
          elements.push({
            type: 'ellipse',
            attrs: {
              cx: dot.x, cy: reflY,
              rx: 1.5, ry: 5,
              fill: hexFromRgb(dot.r, dot.g, dot.b),
              opacity: 0.35,
            },
          });
        }
      }
    }
  }

  return {
    id: 'micro-grit',
    name: 'Micro-Grit Detail',
    description: `${elements.length} contrast anchors placed at high-contrast pixel locations`,
    paintingTip: 'Flick a loaded brush or use the tip of a rigger for these textural anchors',
    elements,
  };
}

// -------------------------------------------------------------------
// Main export
// -------------------------------------------------------------------

export function buildSvgComposition(analysis, displayW = 800, displayH = 600) {
  const coord = setupCoordinateSystem(analysis, displayW, displayH);

  const layers = [
    extractBaseWashes(analysis, coord),
    extractArchitecture(analysis, coord),
    extractCloudTopography(analysis, coord),
    extractProceduralTexture(analysis, coord),
    extractMicroGrit(analysis, coord),
  ];

  return {
    viewBox: `0 0 ${coord.vbW} ${coord.vbH}`,
    layers,
  };
}
