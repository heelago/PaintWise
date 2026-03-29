// ===================================================================
// SVG COMPOSITION DECONSTRUCTION ENGINE
// Takes the analysis result from analyzeImage.js and deterministically
// generates layered SVG data representing the scene as a painter's
// composition breakdown — simplified flat color shapes that guide
// watercolor painting.
// ===================================================================

export const LAYER_NAMES = [
  "Paper Base",
  "Sky Gradient",
  "Horizon Glow",
  "Cloud Formations",
  "Midground Silhouette",
  "Reflection Base",
  "Reflection Silhouette",
  "Foreground Frame",
  "Detail Points",
];

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Sample average color at a point with radius averaging. */
function sampleColor(pixels, width, height, x, y, radius = 5) {
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  const x0 = Math.max(0, Math.round(x) - radius);
  const x1 = Math.min(width - 1, Math.round(x) + radius);
  const y0 = Math.max(0, Math.round(y) - radius);
  const y1 = Math.min(height - 1, Math.round(y) + radius);
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const idx = (py * width + px) * 4;
      rSum += pixels[idx];
      gSum += pixels[idx + 1];
      bSum += pixels[idx + 2];
      count++;
    }
  }
  if (count === 0) return [128, 128, 128];
  return [
    Math.round(rSum / count),
    Math.round(gSum / count),
    Math.round(bSum / count),
  ];
}

/** Darken a color by a factor (0-1, where 0.8 = 20% darker). */
function darkenColor(r, g, b, factor = 0.8) {
  return [
    Math.round(r * factor),
    Math.round(g * factor),
    Math.round(b * factor),
  ];
}

/** Convert RGB array to CSS hex string. */
function rgbHex(r, g, b) {
  const h = (v) => clamp(v, 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Convert RGB array to CSS rgba string. */
function rgba(r, g, b, a) {
  return `rgba(${clamp(r, 0, 255)},${clamp(g, 0, 255)},${clamp(b, 0, 255)},${a.toFixed(2)})`;
}

/** Scale a pixel coordinate to viewBox space. */
function scaleX(px, imgW, viewW) {
  return (px / imgW) * viewW;
}
function scaleY(py, imgH, viewH) {
  return (py / imgH) * viewH;
}

/**
 * Find connected components in a binary map (Uint8Array) within
 * a bounding box. Returns array of component objects with { pixels, bounds, area }.
 */
function findConnectedComponents(map, width, height, yTop, yBot) {
  const visited = new Uint8Array(width * (yBot - yTop));
  const components = [];

  function floodFill(startX, startY) {
    const stack = [[startX, startY]];
    const pixels = [];
    let minX = startX, maxX = startX, minY = startY, maxY = startY;

    while (stack.length > 0) {
      const [cx, cy] = stack.pop();
      const localY = cy - yTop;
      const vi = localY * width + cx;
      if (cx < 0 || cx >= width || cy < yTop || cy >= yBot) continue;
      if (visited[vi]) continue;
      if (!map[cy * width + cx]) continue;

      visited[vi] = 1;
      pixels.push([cx, cy]);
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;

      stack.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
    }

    return pixels.length > 0
      ? { pixels, bounds: { minX, maxX, minY, maxY }, area: pixels.length }
      : null;
  }

  for (let y = yTop; y < yBot; y++) {
    for (let x = 0; x < width; x++) {
      const localY = y - yTop;
      if (!visited[localY * width + x] && map[y * width + x]) {
        const comp = floodFill(x, y);
        if (comp) components.push(comp);
      }
    }
  }

  return components;
}

/**
 * Trace the top edge of a set of region IDs for each column.
 * Returns array of { x, y } points in viewBox space.
 */
function traceTopEdge(regionMap, imgW, imgH, regionIds, viewW, viewH) {
  const points = [];
  // Step through columns in viewBox space, sampling every ~2px in view
  const step = Math.max(1, Math.round(imgW / (viewW / 2)));
  for (let px = 0; px < imgW; px += step) {
    let topY = imgH;
    for (let py = 0; py < imgH; py++) {
      if (regionIds.includes(regionMap[py * imgW + px])) {
        topY = py;
        break;
      }
    }
    if (topY < imgH) {
      points.push({ x: scaleX(px, imgW, viewW), y: scaleY(topY, imgH, viewH) });
    }
  }
  return points;
}

/**
 * Trace the bottom edge of a set of region IDs for each column.
 */
function traceBottomEdge(regionMap, imgW, imgH, regionIds, viewW, viewH) {
  const points = [];
  const step = Math.max(1, Math.round(imgW / (viewW / 2)));
  for (let px = 0; px < imgW; px += step) {
    let botY = -1;
    for (let py = imgH - 1; py >= 0; py--) {
      if (regionIds.includes(regionMap[py * imgW + px])) {
        botY = py;
        break;
      }
    }
    if (botY >= 0) {
      points.push({ x: scaleX(px, imgW, viewW), y: scaleY(botY, imgH, viewH) });
    }
  }
  return points;
}

/**
 * Generate a smooth SVG path string from an array of {x,y} points
 * using Catmull-Rom -> cubic bezier conversion.
 */
function pointsToPath(points, closed = false) {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;
  }

  const fmt = (v) => v.toFixed(1);
  let d = `M${fmt(points[0].x)},${fmt(points[0].y)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const tension = 6;
    const cp1x = p1.x + (p2.x - p0.x) / tension;
    const cp1y = p1.y + (p2.y - p0.y) / tension;
    const cp2x = p2.x - (p3.x - p1.x) / tension;
    const cp2y = p2.y - (p3.y - p1.y) / tension;

    d += ` C${fmt(cp1x)},${fmt(cp1y)} ${fmt(cp2x)},${fmt(cp2y)} ${fmt(p2.x)},${fmt(p2.y)}`;
  }

  if (closed) d += " Z";
  return d;
}

/**
 * Average color of all pixels in a region within a bounding box.
 */
function regionAvgColor(pixels, width, regionMap, regionIds, yTop, yBot) {
  let rS = 0, gS = 0, bS = 0, cnt = 0;
  const step = Math.max(1, Math.round((yBot - yTop) / 60));
  for (let y = yTop; y < yBot; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = y * width + x;
      if (regionIds.includes(regionMap[i])) {
        const idx = i * 4;
        rS += pixels[idx];
        gS += pixels[idx + 1];
        bS += pixels[idx + 2];
        cnt++;
      }
    }
  }
  if (cnt === 0) return [80, 80, 80];
  return [Math.round(rS / cnt), Math.round(gS / cnt), Math.round(bS / cnt)];
}

/**
 * Simplified cloud shape: find extrema points of a component and
 * build a convex-ish bezier outline.
 */
function cloudComponentToPath(comp, imgW, imgH, viewW, viewH) {
  const { bounds, pixels } = comp;
  // Sample a subset of boundary pixels — group by column, take top/bottom
  const colMin = {};
  const colMax = {};
  const step = Math.max(1, Math.round(pixels.length / 120));
  for (let i = 0; i < pixels.length; i += step) {
    const [px, py] = pixels[i];
    const col = px;
    if (!(col in colMin) || py < colMin[col]) colMin[col] = py;
    if (!(col in colMax) || py > colMax[col]) colMax[col] = py;
  }

  const cols = Object.keys(colMin).map(Number).sort((a, b) => a - b);
  if (cols.length < 3) return null;

  // Top edge: left to right using colMin
  const topPts = cols.map((c) => ({
    x: scaleX(c, imgW, viewW),
    y: scaleY(colMin[c], imgH, viewH),
  }));

  // Bottom edge: right to left using colMax
  const botPts = cols
    .slice()
    .reverse()
    .map((c) => ({
      x: scaleX(c, imgW, viewW),
      y: scaleY(colMax[c], imgH, viewH),
    }));

  const allPts = [...topPts, ...botPts];
  return pointsToPath(allPts, true);
}

// -------------------------------------------------------------------
// Layer builders
// -------------------------------------------------------------------

function buildPaperBase(viewW, viewH) {
  return {
    id: "paper-base",
    name: "Paper Base",
    description: "Warm paper tone — the lightest value in the painting",
    elements: [
      {
        type: "rect",
        attrs: {
          x: 0, y: 0, width: viewW, height: viewH,
          fill: "#F2EDE5", opacity: 0.15,
        },
      },
    ],
    paintingTip: "Leave the paper showing through for highlights",
  };
}

function buildSkyGradient(analysis, viewW, viewH) {
  const { pixels, width, height, hasHorizon, horizonY, regionBounds } = analysis;
  if (!hasHorizon && !regionBounds.sky) return null;

  const skyTop = regionBounds.sky.top;
  const skyBot = regionBounds.sky.bot;
  if (skyBot <= skyTop) return null;

  const vTop = scaleY(skyTop, height, viewH);
  const vBot = scaleY(skyBot, height, viewH);

  // Sample vertical strip at center column, 5 positions
  const cx = Math.round(width / 2);
  const sampleCount = 5;
  const stops = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    const sy = Math.round(skyTop + t * (skyBot - skyTop - 1));
    const [r, g, b] = sampleColor(pixels, width, height, cx, sy, 10);
    const offset = (t * 100).toFixed(0);
    stops.push({ offset, r, g, b });
  }

  // Also sample horizontal variation at the horizon for a secondary gradient
  const hSamples = [];
  const hY = hasHorizon ? horizonY : skyBot - 1;
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const sx = Math.round(t * (width - 1));
    hSamples.push(sampleColor(pixels, width, height, sx, Math.max(0, hY - 2), 8));
  }

  const gradId = "skyGrad";
  const stopTags = stops
    .map((s) => `<stop offset="${s.offset}%" stop-color="${rgbHex(s.r, s.g, s.b)}"/>`)
    .join("");
  const gradDef = `<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">${stopTags}</linearGradient>`;

  const elements = [
    { type: "defs", content: gradDef },
    {
      type: "rect",
      attrs: {
        x: 0, y: vTop, width: viewW, height: vBot - vTop,
        fill: `url(#${gradId})`, opacity: 1,
      },
    },
  ];

  // If horizontal variation is notable, add a subtle overlay
  const leftColor = hSamples[0];
  const rightColor = hSamples[3];
  const hDiff = Math.abs(leftColor[0] - rightColor[0]) +
                Math.abs(leftColor[1] - rightColor[1]) +
                Math.abs(leftColor[2] - rightColor[2]);
  if (hDiff > 40) {
    const hGradId = "skyHGrad";
    const hGradDef = `<linearGradient id="${hGradId}" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0%" stop-color="${rgbHex(...leftColor)}" stop-opacity="0.3"/>` +
      `<stop offset="100%" stop-color="${rgbHex(...rightColor)}" stop-opacity="0.3"/>` +
      `</linearGradient>`;
    elements.splice(1, 0, { type: "defs", content: hGradDef });
    elements.push({
      type: "rect",
      attrs: {
        x: 0, y: vTop, width: viewW, height: vBot - vTop,
        fill: `url(#${hGradId})`, opacity: 0.5,
      },
    });
  }

  return {
    id: "sky-gradient",
    name: "Sky Gradient",
    description: "The broad sky color field — first big wash",
    elements,
    paintingTip: "Wet the upper paper and lay a graduated wash from warm to cool",
  };
}

function buildHorizonGlow(analysis, viewW, viewH) {
  const { pixels, width, height, hasHorizon, horizonY, warmGlowMap, tempMap } = analysis;
  if (!hasHorizon) return null;

  // Find the warmest x-position along the horizon
  const searchRadius = Math.round(height * 0.04);
  let bestX = Math.round(width / 2);
  let bestWarmth = -Infinity;
  const step = Math.max(1, Math.round(width / 100));

  for (let x = 0; x < width; x += step) {
    let warmth = 0;
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      const y = horizonY + dy;
      if (y < 0 || y >= height) continue;
      warmth += tempMap[y * width + x];
    }
    if (warmth > bestWarmth) {
      bestWarmth = warmth;
      bestX = x;
    }
  }

  // Sample the glow color near that warm spot
  const [gr, gg, gb] = sampleColor(pixels, width, height, bestX, horizonY, 12);
  const cx = scaleX(bestX, width, viewW);
  const cy = scaleY(horizonY, height, viewH);
  const rx = viewW * 0.35;
  const ry = viewH * 0.08;

  const gradId = "horizonGlow";
  const gradDef = `<radialGradient id="${gradId}" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="${rgbHex(gr, gg, gb)}" stop-opacity="0.5"/>` +
    `<stop offset="100%" stop-color="${rgbHex(gr, gg, gb)}" stop-opacity="0"/>` +
    `</radialGradient>`;

  return {
    id: "horizon-glow",
    name: "Horizon Glow",
    description: "Warm luminous band at the horizon line",
    elements: [
      { type: "defs", content: gradDef },
      {
        type: "ellipse",
        attrs: {
          cx, cy, rx, ry,
          fill: `url(#${gradId})`, opacity: 0.4,
        },
      },
    ],
    paintingTip: "While the sky wash is still damp, drop warm color at the horizon and let it bloom",
  };
}

function buildCloudFormations(analysis, viewW, viewH) {
  const { pixels, width, height, cloudMap, regionBounds } = analysis;
  const skyTop = regionBounds.sky.top;
  const skyBot = regionBounds.sky.bot;
  const skyArea = width * (skyBot - skyTop);
  if (skyArea <= 0) return null;

  // Find connected components in cloudMap
  const components = findConnectedComponents(cloudMap, width, height, skyTop, skyBot);

  // Filter: keep clouds > 0.5% of sky area
  const minArea = skyArea * 0.005;
  const significant = components
    .filter((c) => c.area >= minArea)
    .sort((a, b) => b.area - a.area);

  if (significant.length === 0) return null;

  // Cap at 12 cloud masses for readability
  const clouds = significant.slice(0, 12);
  const elements = [];

  clouds.forEach((comp, i) => {
    const pathD = cloudComponentToPath(comp, width, height, viewW, viewH);
    if (!pathD) return;

    // Sample average color of this cloud
    const bnd = comp.bounds;
    const midX = Math.round((bnd.minX + bnd.maxX) / 2);
    const midY = Math.round((bnd.minY + bnd.maxY) / 2);
    const [cr, cg, cb] = sampleColor(pixels, width, height, midX, midY, 8);

    // Larger clouds get lower opacity (big soft shapes first)
    const opacityBase = 0.2 + 0.2 * (1 - i / Math.max(1, clouds.length - 1));

    elements.push({
      type: "path",
      attrs: {
        d: pathD,
        fill: rgbHex(cr, cg, cb),
        opacity: parseFloat(opacityBase.toFixed(2)),
      },
    });
  });

  if (elements.length === 0) return null;

  return {
    id: "cloud-formations",
    name: "Cloud Formations",
    description: "Soft cloud masses in the sky — paint largest shapes first",
    elements,
    paintingTip: "Lift out cloud shapes with a damp brush on still-wet sky wash, or drop in shadow tones wet-in-wet",
  };
}

function buildMidgroundSilhouette(analysis, viewW, viewH) {
  const { pixels, width, height, regionMap, regionBounds } = analysis;
  const midTop = regionBounds.midground.top;
  const midBot = regionBounds.midground.bot;

  // Trace top edge of midground + focal subject regions (3, 4)
  const topEdge = traceTopEdge(regionMap, width, height, [3, 4], viewW, viewH);
  if (topEdge.length < 3) return null;

  // Get average dark color from this band
  const [mr, mg, mb] = regionAvgColor(pixels, width, regionMap, [3, 4], midTop, midBot);

  // Build a closed silhouette path: top edge left-to-right, then across the bottom
  const vBot = scaleY(midBot, height, viewH);
  const closingPoints = [
    { x: topEdge[topEdge.length - 1].x, y: vBot },
    { x: topEdge[0].x, y: vBot },
  ];
  const silhouettePath = pointsToPath(topEdge, false) +
    ` L${closingPoints[0].x.toFixed(1)},${closingPoints[0].y.toFixed(1)}` +
    ` L${closingPoints[1].x.toFixed(1)},${closingPoints[1].y.toFixed(1)} Z`;

  const elements = [
    {
      type: "path",
      attrs: {
        d: silhouettePath,
        fill: rgbHex(mr, mg, mb),
        opacity: 0.9,
      },
    },
  ];

  // If focal subject exists, add a separate highlighted path
  const focal = regionBounds.focalSubject;
  if (focal) {
    const focalTop = traceTopEdge(regionMap, width, height, [4], viewW, viewH);
    const focalBot = traceBottomEdge(regionMap, width, height, [4], viewW, viewH);
    if (focalTop.length >= 3 && focalBot.length >= 3) {
      const [fr, fg, fb] = regionAvgColor(
        pixels, width, regionMap, [4], focal.top, focal.bot
      );
      const focalPath = pointsToPath(focalTop, false) +
        " " + pointsToPath(focalBot.reverse(), false).replace(/^M/, "L") + " Z";
      elements.push({
        type: "path",
        attrs: {
          d: focalPath,
          fill: rgbHex(fr, fg, fb),
          opacity: 0.95,
        },
      });
    }
  }

  return {
    id: "midground-silhouette",
    name: "Midground Silhouette",
    description: "The dark silhouette band — buildings, trees, or shoreline",
    elements,
    paintingTip: "Let the sky and horizon glow dry completely, then paint the silhouette in one confident stroke with a loaded brush",
  };
}

function buildReflectionBase(analysis, viewW, viewH) {
  const { pixels, width, height, hasReflection, hasHorizon, horizonY, regionBounds } = analysis;
  if (!hasReflection) return null;

  const reflTop = regionBounds.reflection.top;
  const reflBot = regionBounds.reflection.bot;
  if (reflBot <= reflTop) return null;

  const vTop = scaleY(reflTop, height, viewH);
  const vBot = scaleY(reflBot, height, viewH);

  // Sample vertical gradient in the reflection zone (center column)
  const cx = Math.round(width / 2);
  const sampleCount = 5;
  const stops = [];

  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    const sy = Math.round(reflTop + t * (reflBot - reflTop - 1));
    let [r, g, b] = sampleColor(pixels, width, height, cx, sy, 10);
    // Darken slightly to simulate reflection darkening
    [r, g, b] = darkenColor(r, g, b, 0.82);
    const offset = (t * 100).toFixed(0);
    stops.push({ offset, r, g, b });
  }

  const gradId = "reflGrad";
  const stopTags = stops
    .map((s) => `<stop offset="${s.offset}%" stop-color="${rgbHex(s.r, s.g, s.b)}"/>`)
    .join("");
  const gradDef = `<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">${stopTags}</linearGradient>`;

  return {
    id: "reflection-base",
    name: "Reflection Base",
    description: "Water reflection — a darker echo of the sky",
    elements: [
      { type: "defs", content: gradDef },
      {
        type: "rect",
        attrs: {
          x: 0, y: vTop, width: viewW, height: vBot - vTop,
          fill: `url(#${gradId})`, opacity: 0.9,
        },
      },
    ],
    paintingTip: "Wet the water area and float in the reflection wash — keep it slightly darker and cooler than the sky",
  };
}

function buildReflectionSilhouette(analysis, viewW, viewH) {
  const { pixels, width, height, hasReflection, hasHorizon, horizonY, regionMap, regionBounds } = analysis;
  if (!hasReflection || !hasHorizon) return null;

  const reflTop = regionBounds.reflection.top;
  const reflBot = regionBounds.reflection.bot;

  // Get the midground top edge (same as silhouette layer)
  const topEdge = traceTopEdge(regionMap, width, height, [3, 4], viewW, viewH);
  if (topEdge.length < 3) return null;

  const vHorizon = scaleY(horizonY, height, viewH);
  const compressionY = 0.85;

  // Flip the top edge vertically around the horizon, with slight compression
  // and small wobble for water ripple effect
  const seed = width * height; // deterministic seed
  const flippedEdge = topEdge.map((p, i) => {
    const distAbove = vHorizon - p.y;
    const reflected = vHorizon + distAbove * compressionY;
    // Small deterministic wobble based on position
    const wobble = Math.sin(i * 0.7 + seed * 0.0001) * 1.5;
    return { x: p.x + wobble * 0.3, y: reflected + wobble };
  });

  // Clamp to reflection zone
  const vReflBot = scaleY(reflBot, height, viewH);
  flippedEdge.forEach((p) => {
    p.y = Math.min(p.y, vReflBot);
  });

  const [mr, mg, mb] = regionAvgColor(pixels, width, regionMap, [3, 4],
    regionBounds.midground.top, regionBounds.midground.bot);
  const [dr, dg, db] = darkenColor(mr, mg, mb, 0.75);

  // Build path: flipped top edge, then close along the horizon line
  const silPath = pointsToPath(flippedEdge, false) +
    ` L${flippedEdge[flippedEdge.length - 1].x.toFixed(1)},${vHorizon.toFixed(1)}` +
    ` L${flippedEdge[0].x.toFixed(1)},${vHorizon.toFixed(1)} Z`;

  return {
    id: "reflection-silhouette",
    name: "Reflection Silhouette",
    description: "Mirrored silhouette in the water — softer and darker",
    elements: [
      {
        type: "path",
        attrs: {
          d: silPath,
          fill: rgbHex(dr, dg, db),
          opacity: 0.45,
        },
      },
    ],
    paintingTip: "While the water wash is damp, drag the silhouette color downward with vertical brush strokes for a broken reflection",
  };
}

function buildForegroundFrame(analysis, viewW, viewH) {
  const { pixels, width, height, regionMap, regionBounds } = analysis;
  const fgTop = regionBounds.foreground.top;
  const fgBot = regionBounds.foreground.bot;
  if (fgBot <= fgTop) return null;

  // Trace the top edge of the foreground region
  const topEdge = traceTopEdge(regionMap, width, height, [6], viewW, viewH);

  const vBot = scaleY(fgBot, height, viewH);
  const [fr, fg, fb] = regionAvgColor(pixels, width, regionMap, [6], fgTop, fgBot);

  let elements;

  if (topEdge.length >= 3) {
    const fgPath = pointsToPath(topEdge, false) +
      ` L${viewW.toFixed(1)},${vBot.toFixed(1)}` +
      ` L0,${vBot.toFixed(1)} Z`;
    elements = [
      {
        type: "path",
        attrs: {
          d: fgPath,
          fill: rgbHex(fr, fg, fb),
          opacity: 0.92,
        },
      },
    ];
  } else {
    // Fallback: simple rectangle for foreground
    const vTop = scaleY(fgTop, height, viewH);
    elements = [
      {
        type: "rect",
        attrs: {
          x: 0, y: vTop, width: viewW, height: vBot - vTop,
          fill: rgbHex(fr, fg, fb),
          opacity: 0.92,
        },
      },
    ];
  }

  return {
    id: "foreground-frame",
    name: "Foreground Frame",
    description: "Dark ground or frame at the bottom — anchors the composition",
    elements,
    paintingTip: "Use a large flat brush to lay the foreground in broad, horizontal strokes while everything else is dry",
  };
}

function buildDetailPoints(analysis, viewW, viewH) {
  const { pixels, width, height, hasHorizon, horizonY, hasReflection, warmGlowMap, regionBounds, grayMap } = analysis;

  // Scan for bright warm spots near the horizon / midground
  const midTop = regionBounds.midground.top;
  const midBot = regionBounds.midground.bot;
  const scanStep = Math.max(4, Math.round(width / 80));
  const brightSpots = [];

  for (let y = midTop; y < midBot; y += scanStep) {
    for (let x = 0; x < width; x += scanStep) {
      const i = y * width + x;
      if (warmGlowMap[i] && grayMap[i] > 180) {
        brightSpots.push({
          x, y,
          brightness: grayMap[i],
        });
      }
    }
  }

  // Sort by brightness descending, keep top ~15
  brightSpots.sort((a, b) => b.brightness - a.brightness);
  const topSpots = brightSpots.slice(0, 15);

  if (topSpots.length === 0) {
    // Fallback: find the single brightest pixel in midground
    let bestI = -1, bestB = 0;
    for (let y = midTop; y < midBot; y += scanStep * 2) {
      for (let x = 0; x < width; x += scanStep * 2) {
        const i = y * width + x;
        if (grayMap[i] > bestB) {
          bestB = grayMap[i];
          bestI = i;
        }
      }
    }
    if (bestI >= 0) {
      topSpots.push({
        x: bestI % width,
        y: Math.floor(bestI / width),
        brightness: bestB,
      });
    }
  }

  if (topSpots.length === 0) return null;

  const elements = [];

  topSpots.forEach((spot) => {
    const [sr, sg, sb] = sampleColor(pixels, width, height, spot.x, spot.y, 4);
    const cx = scaleX(spot.x, width, viewW);
    const cy = scaleY(spot.y, height, viewH);
    const r = Math.max(1.5, viewW * 0.004 * (spot.brightness / 255));

    elements.push({
      type: "circle",
      attrs: {
        cx: parseFloat(cx.toFixed(1)),
        cy: parseFloat(cy.toFixed(1)),
        r: parseFloat(r.toFixed(1)),
        fill: rgbHex(sr, sg, sb),
        opacity: 0.85,
      },
    });

    // If there is a reflection, add a reflected light streak
    if (hasReflection && hasHorizon) {
      const vHorizon = scaleY(horizonY, height, viewH);
      const distAbove = vHorizon - cy;
      if (distAbove > 0) {
        const reflCy = vHorizon + distAbove * 0.7;
        const [dr, dg, db] = darkenColor(sr, sg, sb, 0.7);
        elements.push({
          type: "ellipse",
          attrs: {
            cx: parseFloat(cx.toFixed(1)),
            cy: parseFloat(reflCy.toFixed(1)),
            rx: parseFloat((r * 0.6).toFixed(1)),
            ry: parseFloat((r * 2.5).toFixed(1)),
            fill: rgbHex(dr, dg, db),
            opacity: 0.4,
          },
        });
      }
    }
  });

  return {
    id: "detail-points",
    name: "Detail Points",
    description: "Bright highlights and light spots — final accents",
    elements,
    paintingTip: "Use a fine round brush or the corner of a flat brush to touch in bright points last — less is more",
  };
}

// -------------------------------------------------------------------
// Main export
// -------------------------------------------------------------------

/**
 * Build a layered SVG composition breakdown from the analysis result.
 *
 * @param {Object} analysis - Return value of analyzeImage()
 * @param {number} [displayW=600] - ViewBox width
 * @param {number} [displayH=400] - ViewBox height
 * @returns {{ viewBox: string, layers: Array }}
 */
export function buildSvgComposition(analysis, displayW = 600, displayH = 400) {
  const viewW = displayW;
  const viewH = displayH;

  const builders = [
    () => buildPaperBase(viewW, viewH),
    () => buildSkyGradient(analysis, viewW, viewH),
    () => buildHorizonGlow(analysis, viewW, viewH),
    () => buildCloudFormations(analysis, viewW, viewH),
    () => buildMidgroundSilhouette(analysis, viewW, viewH),
    () => buildReflectionBase(analysis, viewW, viewH),
    () => buildReflectionSilhouette(analysis, viewW, viewH),
    () => buildForegroundFrame(analysis, viewW, viewH),
    () => buildDetailPoints(analysis, viewW, viewH),
  ];

  const layers = [];
  for (const build of builders) {
    const layer = build();
    if (layer) layers.push(layer);
  }

  return {
    viewBox: `0 0 ${viewW} ${viewH}`,
    layers,
  };
}
