// ===================================================================
// GENERIC DRY BRUSH ANALYSIS ENGINE
// Analyzes ANY uploaded photo for dry-brush painting reconstruction.
// Detects horizon, sky, clouds, ground/water, foreground, focal
// subject, and warm glow zones using saliency rather than shape
// matching. No scene-specific logic.
// ===================================================================

// -- Utilities --

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp  = (a, b, t) => a + (b - a) * t;
export const randFloat = (lo, hi) => lo + Math.random() * (hi - lo);

export function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function rgbToGray(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else                h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

function colorTemperature(r, g, b) {
  return (r - b) / 255; // -1 (cool) to +1 (warm)
}

function colorSaturation(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}


// -- K-Means Clustering (k-means++ init) --

function kMeans(samples, k, iterations = 12) {
  const n = samples.length;
  if (n === 0) return { centroids: [], assignments: new Uint8Array(0) };

  // k-means++ initialisation
  const centroids = [[...samples[Math.floor(Math.random() * n)]]];
  for (let c = 1; c < k; c++) {
    const dists = new Float32Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      let minD = Infinity;
      for (const cent of centroids) {
        const dr = samples[i][0] - cent[0];
        const dg = samples[i][1] - cent[1];
        const db = samples[i][2] - cent[2];
        minD = Math.min(minD, dr * dr + dg * dg + db * db);
      }
      dists[i] = minD;
      total += minD;
    }
    let r = Math.random() * total;
    for (let i = 0; i < n; i++) {
      r -= dists[i];
      if (r <= 0) { centroids.push([...samples[i]]); break; }
    }
    if (centroids.length <= c) {
      centroids.push([...samples[Math.floor(Math.random() * n)]]);
    }
  }

  // Lloyd iterations
  const assignments = new Uint8Array(n);
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < n; i++) {
      let bestD = Infinity, bestC = 0;
      for (let c = 0; c < k; c++) {
        const dr = samples[i][0] - centroids[c][0];
        const dg = samples[i][1] - centroids[c][1];
        const db = samples[i][2] - centroids[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; bestC = c; }
      }
      assignments[i] = bestC;
    }
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      sums[c][0] += samples[i][0];
      sums[c][1] += samples[i][1];
      sums[c][2] += samples[i][2];
      sums[c][3]++;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c][3] > 0) {
        centroids[c] = [
          sums[c][0] / sums[c][3],
          sums[c][1] / sums[c][3],
          sums[c][2] / sums[c][3],
        ];
      }
    }
  }
  return { centroids, assignments };
}


// ===================================================================
// Per-row statistics helpers
// ===================================================================

function computeRowStats(grayMap, tempMap, satMap, w, h) {
  const rowGray     = new Float32Array(h);
  const rowContrast = new Float32Array(h);
  const rowTemp     = new Float32Array(h);
  const rowSat      = new Float32Array(h);

  for (let y = 0; y < h; y++) {
    let gSum = 0, tSum = 0, sSum = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      gSum += grayMap[i];
      tSum += tempMap[i];
      sSum += satMap[i];
    }
    rowGray[y] = gSum / w;
    rowTemp[y] = tSum / w;
    rowSat[y]  = sSum / w;

    // Contrast = standard deviation of gray in the row
    const mean = rowGray[y];
    let variance = 0;
    for (let x = 0; x < w; x++) {
      const diff = grayMap[y * w + x] - mean;
      variance += diff * diff;
    }
    rowContrast[y] = Math.sqrt(variance / w);
  }

  return { rowGray, rowContrast, rowTemp, rowSat };
}


// ===================================================================
// Horizon detection
// ===================================================================
// Scans the middle portion of the image for the row with the
// strongest horizontal luminance gradient (largest absolute change
// in average gray between adjacent rows, sustained over a small
// vertical window). Returns the y coordinate or -1 if none found.

function detectHorizon(rowGray, rowContrast, h) {
  // Search in the 20-70% vertical range
  const lo = Math.round(h * 0.20);
  const hi = Math.round(h * 0.70);

  // Compute the row-to-row gray delta (absolute difference of means)
  const rowDelta = new Float32Array(h);
  for (let y = 1; y < h; y++) {
    rowDelta[y] = Math.abs(rowGray[y] - rowGray[y - 1]);
  }

  // Smooth with a small window (5 rows) and find peak
  const winHalf = 2;
  let bestY = -1;
  let bestScore = 0;

  for (let y = lo; y < hi; y++) {
    let sumDelta = 0;
    let sumContrast = 0;
    let count = 0;
    for (let dy = -winHalf; dy <= winHalf; dy++) {
      const yy = y + dy;
      if (yy >= 0 && yy < h) {
        sumDelta += rowDelta[yy];
        sumContrast += rowContrast[yy];
        count++;
      }
    }
    // Score combines edge strength and contrast
    const score = (sumDelta / count) * 0.6 + (sumContrast / count) * 0.4;
    if (score > bestScore) {
      bestScore = score;
      bestY = y;
    }
  }

  // Threshold: if the best score is very low the image has no clear
  // horizon (e.g. portrait, macro, abstract). Use a heuristic:
  // the average row delta across the entire image as baseline.
  let avgDelta = 0;
  for (let y = 1; y < h; y++) avgDelta += rowDelta[y];
  avgDelta /= (h - 1);

  if (bestScore < avgDelta * 1.5) {
    return -1; // no confident horizon
  }

  return bestY;
}


// ===================================================================
// Reflection detection
// ===================================================================
// Checks whether the region below the horizon mirrors the sky hue
// and luminance pattern (indicating water/wet surface).

function detectReflection(rowGray, rowTemp, rowSat, horizonY, h) {
  if (horizonY < 0) return false;

  const skyRows   = Math.min(horizonY, 30);
  const belowRows = Math.min(h - horizonY, 30);
  const checkRows = Math.min(skyRows, belowRows);
  if (checkRows < 5) return false;

  let grayCorr = 0, tempCorr = 0;
  let skyGrayMean = 0, belowGrayMean = 0;
  let skyTempMean = 0, belowTempMean = 0;

  for (let d = 0; d < checkRows; d++) {
    const skyY   = horizonY - 1 - d;
    const belowY = horizonY + d;
    if (skyY < 0 || belowY >= h) break;
    skyGrayMean  += rowGray[skyY];
    belowGrayMean += rowGray[belowY];
    skyTempMean  += rowTemp[skyY];
    belowTempMean += rowTemp[belowY];
  }
  skyGrayMean  /= checkRows;
  belowGrayMean /= checkRows;
  skyTempMean  /= checkRows;
  belowTempMean /= checkRows;

  // Compute correlation-like similarity
  for (let d = 0; d < checkRows; d++) {
    const skyY   = horizonY - 1 - d;
    const belowY = horizonY + d;
    if (skyY < 0 || belowY >= h) break;
    grayCorr += (rowGray[skyY] - skyGrayMean) * (rowGray[belowY] - belowGrayMean);
    tempCorr += (rowTemp[skyY] - skyTempMean) * (rowTemp[belowY] - belowTempMean);
  }

  // Normalise
  let skyGrayVar = 0, belowGrayVar = 0;
  for (let d = 0; d < checkRows; d++) {
    const skyY   = horizonY - 1 - d;
    const belowY = horizonY + d;
    if (skyY < 0 || belowY >= h) break;
    skyGrayVar   += (rowGray[skyY] - skyGrayMean) ** 2;
    belowGrayVar += (rowGray[belowY] - belowGrayMean) ** 2;
  }
  const denom = Math.sqrt(skyGrayVar * belowGrayVar);
  const r = denom > 0 ? grayCorr / denom : 0;

  // A positive correlation > 0.3 suggests mirrored pattern
  return r > 0.3;
}


// ===================================================================
// Focal subject detection (saliency-based)
// ===================================================================
// Finds a contiguous rectangular region of high contrast + saturation
// that covers between 5% and 30% of the image area. Works on a
// coarse grid for speed.

function detectFocalSubject(grayMap, satMap, tempMap, w, h) {
  // Build a coarse saliency map (cellSize ~1% of width, min 4px)
  const cellSize = Math.max(4, Math.round(w * 0.01));
  const cols = Math.ceil(w / cellSize);
  const rows = Math.ceil(h / cellSize);
  const saliency = new Float32Array(cols * rows);

  for (let cr = 0; cr < rows; cr++) {
    for (let cc = 0; cc < cols; cc++) {
      const x0 = cc * cellSize;
      const y0 = cr * cellSize;
      const x1 = Math.min(x0 + cellSize, w);
      const y1 = Math.min(y0 + cellSize, h);

      let sumGray = 0, sumGray2 = 0, sumSat = 0, count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          const g = grayMap[i];
          sumGray  += g;
          sumGray2 += g * g;
          sumSat   += satMap[i];
          count++;
        }
      }
      if (count === 0) continue;
      const meanG = sumGray / count;
      const variance = sumGray2 / count - meanG * meanG;
      const contrast = Math.sqrt(Math.max(0, variance));
      const meanSat  = sumSat / count;

      // Saliency = contrast * saturation weight
      saliency[cr * cols + cc] = contrast * 0.5 + meanSat * 128;
    }
  }

  // Global mean and stddev of saliency
  let sMean = 0;
  for (let i = 0; i < saliency.length; i++) sMean += saliency[i];
  sMean /= saliency.length;
  let sVar = 0;
  for (let i = 0; i < saliency.length; i++) sVar += (saliency[i] - sMean) ** 2;
  const sStd = Math.sqrt(sVar / saliency.length);

  // Threshold: cells above mean + 0.8*std are "salient"
  const threshold = sMean + sStd * 0.8;
  const mask = new Uint8Array(cols * rows);
  let salientCount = 0;
  for (let i = 0; i < saliency.length; i++) {
    if (saliency[i] > threshold) {
      mask[i] = 1;
      salientCount++;
    }
  }

  // If salient region is too small or too large, return null
  const totalCells = cols * rows;
  const salientFrac = salientCount / totalCells;
  if (salientFrac < 0.03 || salientFrac > 0.40) return null;

  // Find bounding box of salient cells
  let minR = rows, maxR = 0, minC = cols, maxC = 0;
  for (let cr = 0; cr < rows; cr++) {
    for (let cc = 0; cc < cols; cc++) {
      if (mask[cr * cols + cc]) {
        if (cr < minR) minR = cr;
        if (cr > maxR) maxR = cr;
        if (cc < minC) minC = cc;
        if (cc > maxC) maxC = cc;
      }
    }
  }

  // Convert back to pixel coordinates
  const left   = minC * cellSize;
  const right  = Math.min((maxC + 1) * cellSize, w);
  const top    = minR * cellSize;
  const bot    = Math.min((maxR + 1) * cellSize, h);

  // Verify bounding box covers 5-30% of image area
  const bboxArea = (right - left) * (bot - top);
  const imgArea  = w * h;
  const bboxFrac = bboxArea / imgArea;
  if (bboxFrac < 0.05 || bboxFrac > 0.35) return null;

  return { left, right, top, bot };
}


// ===================================================================
// Cloud detection in a given vertical range
// ===================================================================

function detectClouds(grayMap, w, skyTop, skyBot) {
  const total = w * (skyBot - skyTop);
  if (total <= 0) return new Uint8Array(0);

  // We build a full-image-sized cloud map but only fill the sky zone
  const cloudMap = new Uint8Array(w * skyBot); // indexed by y*w+x, only rows 0..skyBot-1
  const kernel = Math.max(3, Math.round(w * 0.02));
  const step   = Math.max(1, Math.round(kernel / 2));

  for (let y = skyTop; y < skyBot; y++) {
    for (let x = 0; x < w; x++) {
      const pi = y * w + x;
      const gray = grayMap[pi];

      // Compute local contrast via sub-sampled neighbourhood
      const yLo = Math.max(skyTop, y - kernel);
      const yHi = Math.min(skyBot - 1, y + kernel);
      const xLo = Math.max(0, x - kernel);
      const xHi = Math.min(w - 1, x + kernel);

      let nSum = 0, nSq = 0, nCount = 0;
      for (let ny = yLo; ny <= yHi; ny += step) {
        for (let nx = xLo; nx <= xHi; nx += step) {
          const ng = grayMap[ny * w + nx];
          nSum += ng;
          nSq  += ng * ng;
          nCount++;
        }
      }

      if (nCount > 1) {
        const mean = nSum / nCount;
        const variance = nSq / nCount - mean * mean;
        const stdDev = Math.sqrt(Math.max(0, variance));
        // Cloud: moderate-to-high local contrast, not extremely dark or bright
        if (stdDev > 15 && gray > 50 && gray < 235) {
          cloudMap[pi] = 1;
        }
      }
    }
  }

  return cloudMap;
}


// ===================================================================
// Warm glow map
// ===================================================================
// Marks pixels with high temperature AND high saturation.

function buildWarmGlowMap(tempMap, satMap, total) {
  const warmGlowMap = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (tempMap[i] > 0.25 && satMap[i] > 0.15) {
      warmGlowMap[i] = 1;
    }
  }
  return warmGlowMap;
}


// ===================================================================
// MAIN ANALYSIS FUNCTION
// ===================================================================
// Regions:
//   0 = general
//   1 = sky (clear)
//   2 = clouds
//   3 = midground (buildings / shore / subject band)
//   4 = focal subject
//   5 = reflection / water
//   6 = foreground
//   7 = warm glow

export function analyzeImage(imageData, width, height, onProgress) {
  // Accept either ImageData object or raw Uint8ClampedArray
  const px    = imageData.data ?? imageData;
  const w     = width;
  const h     = height;
  const total = w * h;

  // ------------------------------------------------------------------
  // 1. Per-pixel maps
  // ------------------------------------------------------------------
  onProgress?.(0.05);

  const grayMap  = new Float32Array(total);
  const valueMap = new Uint8Array(total);    // 1-8 bands (1=lightest, 8=darkest)
  const tempMap  = new Float32Array(total);  // -1..+1
  const satMap   = new Float32Array(total);  // 0..1
  const hueMap   = new Float32Array(total);  // 0..360

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const r = px[idx], g = px[idx + 1], b = px[idx + 2];
    const gray = rgbToGray(r, g, b);
    grayMap[i]  = gray;
    valueMap[i] = clamp(Math.ceil((1 - gray / 255) * 8), 1, 8);
    tempMap[i]  = colorTemperature(r, g, b);
    satMap[i]   = colorSaturation(r, g, b);
    hueMap[i]   = rgbToHsl(r, g, b)[0];
  }

  // ------------------------------------------------------------------
  // 2. K-means clustering (k=14, stride=4)
  // ------------------------------------------------------------------
  onProgress?.(0.20);

  const stride  = 4;
  const samples = [];
  for (let i = 0; i < total; i += stride) {
    const idx = i * 4;
    samples.push([px[idx], px[idx + 1], px[idx + 2]]);
  }
  const { centroids } = kMeans(samples, 14, 10);

  // ------------------------------------------------------------------
  // 3. Row-level statistics
  // ------------------------------------------------------------------
  onProgress?.(0.30);

  const { rowGray, rowContrast, rowTemp, rowSat } = computeRowStats(
    grayMap, tempMap, satMap, w, h
  );

  // ------------------------------------------------------------------
  // 4. Horizon detection
  // ------------------------------------------------------------------
  onProgress?.(0.35);

  const rawHorizonY = detectHorizon(rowGray, rowContrast, h);
  const hasHorizon  = rawHorizonY >= 0;
  const horizonY    = hasHorizon ? rawHorizonY : -1;

  // ------------------------------------------------------------------
  // 5. Zone boundaries
  // ------------------------------------------------------------------
  // If horizon found, use it to divide sky / midground / below.
  // If not, fall back to simple top/middle/bottom splits.

  let skyTop, skyBot;
  let midTop, midBot;
  let reflTop, reflBot;
  let fgTop;

  if (hasHorizon) {
    // Midground band: centered on horizon, ~12% of image height
    const bandHalf = Math.round(h * 0.06);
    midTop  = Math.max(0, horizonY - bandHalf);
    midBot  = Math.min(h, horizonY + bandHalf);
    skyTop  = 0;
    skyBot  = midTop;
    reflTop = midBot;
    fgTop   = Math.round(h * 0.85);
    reflBot = fgTop;
  } else {
    // Fallback: top 35% sky, 35-65% midground, 65-85% lower, 85-100% fg
    skyTop  = 0;
    skyBot  = Math.round(h * 0.35);
    midTop  = skyBot;
    midBot  = Math.round(h * 0.65);
    reflTop = midBot;
    fgTop   = Math.round(h * 0.85);
    reflBot = fgTop;
  }

  // ------------------------------------------------------------------
  // 6. Reflection detection
  // ------------------------------------------------------------------
  onProgress?.(0.40);

  const hasReflection = hasHorizon
    ? detectReflection(rowGray, rowTemp, rowSat, horizonY, h)
    : false;

  // ------------------------------------------------------------------
  // 7. Focal subject detection (saliency-based)
  // ------------------------------------------------------------------
  onProgress?.(0.45);

  const focalBounds = detectFocalSubject(grayMap, satMap, tempMap, w, h);

  // ------------------------------------------------------------------
  // 8. Cloud detection in sky zone
  // ------------------------------------------------------------------
  onProgress?.(0.50);

  const cloudMap = new Uint8Array(total);
  if (skyBot > skyTop) {
    const skyCloudMap = detectClouds(grayMap, w, skyTop, skyBot);
    // Copy into full-size cloudMap
    for (let y = skyTop; y < skyBot; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (i < skyCloudMap.length && skyCloudMap[i]) {
          cloudMap[i] = 1;
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // 9. Warm glow map
  // ------------------------------------------------------------------
  onProgress?.(0.55);

  const warmGlowMap = buildWarmGlowMap(tempMap, satMap, total);

  // ------------------------------------------------------------------
  // 10. Region classification
  // ------------------------------------------------------------------
  onProgress?.(0.60);

  const regionMap = new Uint8Array(total);

  // Scene average colour
  let avgR = 0, avgG = 0, avgB = 0;
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    avgR += px[idx];
    avgG += px[idx + 1];
    avgB += px[idx + 2];
  }
  avgR = Math.round(avgR / total);
  avgG = Math.round(avgG / total);
  avgB = Math.round(avgB / total);
  const sceneAvgColor = [avgR, avgG, avgB];

  onProgress?.(0.70);

  for (let i = 0; i < total; i++) {
    const x = i % w;
    const y = Math.floor(i / w);

    // Check focal subject first (highest priority after warm glow)
    const inFocal = focalBounds &&
      x >= focalBounds.left && x < focalBounds.right &&
      y >= focalBounds.top  && y < focalBounds.bot;

    // Warm glow overrides everything
    if (warmGlowMap[i]) {
      regionMap[i] = 7; // warm glow
      continue;
    }

    // Focal subject (only if it has notably high saliency at this pixel)
    if (inFocal) {
      // Only label as focal if the pixel itself has elevated contrast or
      // saturation, to avoid labelling uniform background patches inside
      // the bounding box.
      const localSat  = satMap[i];
      const localGray = grayMap[i];
      // Slightly relaxed threshold — if inside the focal bbox and has
      // any interesting quality, mark it.
      if (localSat > 0.12 || valueMap[i] >= 5 || Math.abs(tempMap[i]) > 0.2) {
        regionMap[i] = 4; // focal subject
        continue;
      }
    }

    // Zone-based classification
    if (y < skyBot) {
      // Sky zone
      if (cloudMap[i]) {
        regionMap[i] = 2; // cloud
      } else {
        regionMap[i] = 1; // clear sky
      }
    } else if (y >= midTop && y < midBot) {
      regionMap[i] = 3; // midground
    } else if (y >= reflTop && y < fgTop) {
      regionMap[i] = hasReflection ? 5 : 3; // reflection or continued midground
    } else if (y >= fgTop) {
      regionMap[i] = 6; // foreground
    } else {
      regionMap[i] = 0; // general fallback
    }
  }

  onProgress?.(0.90);

  // ------------------------------------------------------------------
  // 11. Build region bounds summary
  // ------------------------------------------------------------------
  const regionBounds = {
    sky:        { top: skyTop,  bot: skyBot  },
    midground:  { top: midTop,  bot: midBot  },
    reflection: { top: reflTop, bot: reflBot },
    foreground: { top: fgTop,   bot: h       },
    focalSubject: focalBounds
      ? { left: focalBounds.left, right: focalBounds.right,
          top: focalBounds.top,   bot: focalBounds.bot }
      : null,
  };

  // ------------------------------------------------------------------
  // Done
  // ------------------------------------------------------------------
  onProgress?.(1.0);

  return {
    width:  w,
    height: h,
    pixels: px,

    // Per-pixel maps
    grayMap,
    valueMap,
    tempMap,
    satMap,
    hueMap,

    // Clustering
    centroids,

    // Region classification
    regionMap,
    regionBounds,

    // Scene-level metadata
    sceneAvgColor,
    horizonY,
    hasHorizon,
    hasReflection,

    // Auxiliary maps
    cloudMap,
    warmGlowMap,
  };
}
