// ═══════════════════════════════════════════════════════════════
// DRY BRUSH ENGINE — Sunset Reflection pointillist reconstruction
// Analyzes a TWILIGHT/SUNSET photo of the Reading Power Station
// in Tel Aviv — dramatic sky at top, buildings/shore band in center,
// near-perfect mirror reflection in wet sand at bottom.
// Generates thousands of elliptical marks for optical mixing.
// ═══════════════════════════════════════════════════════════════

// ── Utilities ──

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const randFloat = (lo, hi) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => Math.floor(randFloat(lo, hi + 1));

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function rgbToGray(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
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


// ── K-Means Clustering (k-means++ init) ──

function kMeans(samples, k, iterations = 12) {
  const n = samples.length;
  if (n === 0) return { centroids: [], assignments: new Uint8Array(0) };

  const centroids = [[...samples[Math.floor(Math.random() * n)]]];
  for (let c = 1; c < k; c++) {
    const dists = new Float32Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      let minD = Infinity;
      for (const cent of centroids) {
        const dr = samples[i][0] - cent[0], dg = samples[i][1] - cent[1], db = samples[i][2] - cent[2];
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
    if (centroids.length <= c) centroids.push([...samples[Math.floor(Math.random() * n)]]);
  }

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
        centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
      }
    }
  }
  return { centroids, assignments };
}


// ═══════════════════════════════════════════════════════════════
// IMAGE ANALYSIS — Sunset Reflection scene
// ═══════════════════════════════════════════════════════════════

export function analyzeImage(img, onProgress) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const oc = document.createElement("canvas");
  oc.width = w; oc.height = h;
  const octx = oc.getContext("2d");
  octx.drawImage(img, 0, 0);
  const imageData = octx.getImageData(0, 0, w, h);
  const px = imageData.data;
  const total = w * h;

  // Per-pixel maps
  const grayMap = new Float32Array(total);
  const valueMap = new Uint8Array(total);   // 1-8 bands
  const tempMap = new Float32Array(total);   // -1..+1
  const satMap = new Float32Array(total);    // 0..1
  const hueMap = new Float32Array(total);    // 0..360

  onProgress?.("Analyzing pixels…", 0.05);

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const r = px[idx], g = px[idx + 1], b = px[idx + 2];
    const gray = rgbToGray(r, g, b);
    grayMap[i] = gray;
    valueMap[i] = clamp(Math.ceil((1 - gray / 255) * 8), 1, 8);
    tempMap[i] = colorTemperature(r, g, b);
    satMap[i] = colorSaturation(r, g, b);
    hueMap[i] = rgbToHsl(r, g, b)[0];
  }

  onProgress?.("Clustering colors…", 0.2);

  // K-means on subsampled pixels
  const stride = 4;
  const samples = [];
  for (let i = 0; i < total; i += stride) {
    const idx = i * 4;
    samples.push([px[idx], px[idx + 1], px[idx + 2]]);
  }
  const { centroids } = kMeans(samples, 14, 10);

  onProgress?.("Detecting regions…", 0.35);

  // ── Region detection ──
  // Regions: 0=general, 1=sky, 2=clouds, 3=buildings/shore band,
  //          4=chimney, 5=reflection, 6=dark foreground, 7=warm glow
  const regionMap = new Uint8Array(total);

  // Compute average gray per row
  const rowGray = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      sum += grayMap[y * w + x];
    }
    rowGray[y] = sum / w;
  }

  // Compute per-row contrast (standard deviation of gray)
  const rowContrast = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    const mean = rowGray[y];
    let variance = 0;
    for (let x = 0; x < w; x++) {
      const diff = grayMap[y * w + x] - mean;
      variance += diff * diff;
    }
    rowContrast[y] = Math.sqrt(variance / w);
  }

  // Compute per-row average temperature (for warm glow detection)
  const rowTemp = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      sum += tempMap[y * w + x];
    }
    rowTemp[y] = sum / w;
  }

  // Find the horizon/shore band: the darkest AND/OR highest-contrast
  // horizontal strip in the 35-55% vertical range
  const shoreHeight = Math.round(h * 0.15); // ~15% of image height for the buildings/shore band
  let bestShoreY = Math.round(h * 0.40);
  let bestShoreScore = -Infinity;
  const shoreSearchLo = Math.round(h * 0.35);
  const shoreSearchHi = Math.round(h * 0.55);

  for (let y = shoreSearchLo; y < shoreSearchHi - shoreHeight; y++) {
    let darkSum = 0;
    let contrastSum = 0;
    for (let dy = 0; dy < shoreHeight; dy++) {
      darkSum += (255 - rowGray[y + dy]); // higher = darker
      contrastSum += rowContrast[y + dy];
    }
    // Combined score: darkness + contrast
    const score = (darkSum / shoreHeight) * 0.6 + (contrastSum / shoreHeight) * 0.4;
    if (score > bestShoreScore) {
      bestShoreScore = score;
      bestShoreY = y;
    }
  }

  const shoreTop = bestShoreY;
  const shoreBot = bestShoreY + shoreHeight;

  // Sky: from top to shore top (~top 40%)
  const skyTop = 0;
  const skyBot = shoreTop;

  // Reflection: from shore bottom to dark foreground
  const reflectionTop = shoreBot;

  // Dark foreground: bottom ~15%
  const darkFgTop = Math.round(h * 0.85);
  const reflectionBot = darkFgTop;

  onProgress?.("Detecting chimney…", 0.45);

  // Detect the chimney: tallest narrow vertical dark element in center area
  const chimneySearchLeft = Math.round(w * 0.25);
  const chimneySearchRight = Math.round(w * 0.55);
  const chimneyMinHeight = Math.round(h * 0.06);

  // For each column, measure continuous dark run in the shore/sky overlap zone
  // The chimney extends from shore band up into the sky
  const chimneySearchTop = Math.round(h * 0.15);
  const chimneySearchBot = shoreBot;

  const colDarkRun = new Float32Array(w);
  const colDarkStart = new Float32Array(w);
  for (let x = chimneySearchLeft; x < chimneySearchRight; x++) {
    let maxRun = 0;
    let runStart = 0;
    let currentRun = 0;
    let currentStart = chimneySearchTop;
    for (let y = chimneySearchTop; y < chimneySearchBot; y++) {
      const i = y * w + x;
      if (valueMap[i] >= 5) { // dark pixel
        if (currentRun === 0) currentStart = y;
        currentRun++;
      } else {
        if (currentRun > maxRun) {
          maxRun = currentRun;
          runStart = currentStart;
        }
        currentRun = 0;
      }
    }
    if (currentRun > maxRun) {
      maxRun = currentRun;
      runStart = currentStart;
    }
    colDarkRun[x] = maxRun;
    colDarkStart[x] = runStart;
  }

  // Find the chimney column: tallest narrow dark streak
  // Check it is narrow (dark runs drop off on either side)
  let chimneyX = -1;
  let bestChimneyRun = 0;
  for (let x = chimneySearchLeft + 5; x < chimneySearchRight - 5; x++) {
    if (colDarkRun[x] > chimneyMinHeight && colDarkRun[x] > bestChimneyRun) {
      const sideOffset = Math.round(w * 0.02);
      const leftRun = colDarkRun[Math.max(0, x - sideOffset)];
      const rightRun = colDarkRun[Math.min(w - 1, x + sideOffset)];
      if (leftRun < colDarkRun[x] * 0.6 || rightRun < colDarkRun[x] * 0.6) {
        bestChimneyRun = colDarkRun[x];
        chimneyX = x;
      }
    }
  }

  // Determine chimney bounding box
  const chimneyHalfWidth = Math.round(w * 0.012); // narrow
  const chimneyLeft = chimneyX > 0 ? chimneyX - chimneyHalfWidth : -1;
  const chimneyRight = chimneyX > 0 ? chimneyX + chimneyHalfWidth : -1;
  const chimneyTop = chimneyX > 0 ? colDarkStart[chimneyX] : -1;
  const chimneyBot = chimneyX > 0 ? colDarkStart[chimneyX] + colDarkRun[chimneyX] : -1;

  // Also detect reflected chimney in the reflection zone (mirrored position)
  const chimneyReflTop = chimneyX > 0 ? reflectionTop : -1;
  const chimneyReflBot = chimneyX > 0 ? Math.min(reflectionTop + colDarkRun[chimneyX], darkFgTop) : -1;

  onProgress?.("Detecting clouds & warm glow…", 0.50);

  // Detect cloud areas: look for contrast variation in the sky zone
  // Compute per-pixel local contrast in sky to identify clouds
  // Use a simple approach: pixels in the sky zone where the local
  // neighborhood has high standard deviation are "cloud" pixels
  const cloudMap = new Uint8Array(total); // 1 = cloud pixel
  const cloudKernel = Math.round(w * 0.02); // neighborhood size

  // For efficiency, compute row-by-row in the sky zone
  for (let y = 0; y < skyBot; y++) {
    for (let x = 0; x < w; x++) {
      const pi = y * w + x;
      const gray = grayMap[pi];

      // Sample neighborhood
      let neighborSum = 0;
      let neighborSqSum = 0;
      let neighborCount = 0;
      const yLo = Math.max(0, y - cloudKernel);
      const yHi = Math.min(skyBot - 1, y + cloudKernel);
      const xLo = Math.max(0, x - cloudKernel);
      const xHi = Math.min(w - 1, x + cloudKernel);

      // Subsample for speed
      for (let ny = yLo; ny <= yHi; ny += Math.max(1, Math.round(cloudKernel / 2))) {
        for (let nx = xLo; nx <= xHi; nx += Math.max(1, Math.round(cloudKernel / 2))) {
          const ng = grayMap[ny * w + nx];
          neighborSum += ng;
          neighborSqSum += ng * ng;
          neighborCount++;
        }
      }

      if (neighborCount > 1) {
        const mean = neighborSum / neighborCount;
        const variance = neighborSqSum / neighborCount - mean * mean;
        const stdDev = Math.sqrt(Math.max(0, variance));

        // Cloud: moderate to high local contrast and not extremely dark
        if (stdDev > 15 && gray > 60 && gray < 230) {
          cloudMap[pi] = 1;
        }
      }
    }
  }

  onProgress?.("Mapping regions…", 0.60);

  // Detect promenade lights: bright warm pixels in the shore band
  // These are small bright spots along the shore line
  const lightMap = new Uint8Array(total); // 1 = promenade light pixel
  for (let y = shoreTop; y < shoreBot; y++) {
    for (let x = 0; x < w; x++) {
      const pi = y * w + x;
      const gray = grayMap[pi];
      const temp = tempMap[pi];
      const sat = satMap[pi];
      // Promenade lights: very bright, warm-ish
      if (gray > 200 && temp > 0.05) {
        lightMap[pi] = 1;
      }
    }
  }

  // Classify all pixels into regions
  let avgR = 0, avgG = 0, avgB = 0, sceneCount = 0;

  for (let i = 0; i < total; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    const xNorm = x / w;
    const val = valueMap[i];
    const temp = tempMap[i];
    const gray = grayMap[i];
    const sat = satMap[i];

    const idx = i * 4;
    avgR += px[idx]; avgG += px[idx + 1]; avgB += px[idx + 2];
    sceneCount++;

    if (y < skyBot) {
      // Sky zone
      // Check for warm glow: right side, warm temperature
      if (temp > 0.3 && xNorm > 0.45 && sat > 0.15) {
        regionMap[i] = 7; // warm glow in sky
      } else if (cloudMap[i] === 1) {
        regionMap[i] = 2; // cloud
      } else {
        regionMap[i] = 1; // sky
      }
    } else if (y >= shoreTop && y < shoreBot) {
      // Buildings/shore band
      // Check if chimney
      if (chimneyX > 0 && x >= chimneyLeft && x <= chimneyRight &&
          y >= chimneyTop && y <= chimneyBot && val >= 4) {
        regionMap[i] = 4; // chimney
      } else if (temp > 0.3 && sat > 0.2 && val <= 3) {
        regionMap[i] = 7; // warm glow in shore band
      } else {
        regionMap[i] = 3; // buildings/shore
      }
    } else if (y >= reflectionTop && y < reflectionBot) {
      // Reflection zone
      // Check for reflected chimney
      if (chimneyX > 0 && x >= chimneyLeft && x <= chimneyRight &&
          y >= chimneyReflTop && y <= chimneyReflBot && val >= 4) {
        regionMap[i] = 4; // reflected chimney (same region as real chimney)
      } else if (temp > 0.3 && xNorm > 0.45 && sat > 0.15) {
        regionMap[i] = 7; // warm glow in reflection
      } else {
        regionMap[i] = 5; // reflection
      }
    } else if (y >= darkFgTop) {
      // Dark foreground wet sand
      if (temp > 0.3 && sat > 0.15 && val <= 4) {
        regionMap[i] = 7; // warm glow in dark foreground
      } else {
        regionMap[i] = 6; // dark foreground
      }
    } else {
      regionMap[i] = 0; // general (fallback)
    }
  }

  if (sceneCount > 0) {
    avgR = Math.round(avgR / sceneCount);
    avgG = Math.round(avgG / sceneCount);
    avgB = Math.round(avgB / sceneCount);
  }

  onProgress?.("Analysis complete", 1.0);

  return {
    width: w, height: h, pixels: px,
    grayMap, valueMap, tempMap, satMap, hueMap,
    centroids, regionMap, cloudMap, lightMap,
    sceneAvgColor: [avgR, avgG, avgB],
    skyTop, skyBot,
    shoreTop, shoreBot,
    reflectionTop, reflectionBot,
    darkFgTop,
    chimneyX, chimneyLeft, chimneyRight,
    chimneyTop, chimneyBot,
    chimneyReflTop, chimneyReflBot,
  };
}


// ═══════════════════════════════════════════════════════════════
// ROUND CONFIGURATIONS — 12 rounds
// ═══════════════════════════════════════════════════════════════

export const ROUND_CONFIGS = [
  // Round 0: Paper tint
  {
    name: "Paper tint",
    description: "Atmospheric warmth base — kills raw white, sets twilight tone",
    markCount: [1200, 1800],
    sizeRange: [5, 9],
    heightRatio: [0.35, 0.6],
    opacityRange: [0.15, 0.35],
    biasColor: null, // computed from scene average
    biasStrength: 0.25,
    coverageBands: [1, 2, 3, 4, 5, 6, 7, 8],
    coverageRegions: null,
    wash: true,
    washSpacing: 4,
    color: "#C8A878",
  },
  // Round 1: Sky gradient wash
  {
    name: "Sky gradient wash",
    description: "Sky base — warm golden/orange right, cool blue-grey left",
    markCount: [3000, 5000],
    sizeRange: [3, 7],
    heightRatio: [0.3, 0.55],
    opacityRange: [0.25, 0.6],
    biasColor: null,
    biasStrength: 0.3,
    coverageBands: [1, 2, 3, 4, 5, 6],
    coverageRegions: [1, 2],
    wash: true,
    washSpacing: 3,
    skyGradient: true,
    warmBias: [220, 165, 70],   // golden orange for right side
    coolBias: [100, 120, 155],  // blue-grey for left side
    color: "#A8B0C0",
  },
  // Round 2: Cloud shapes
  {
    name: "Cloud shapes",
    description: "Mid-tone cloud variations in sky — lighter/darker patches",
    markCount: [4000, 6000],
    sizeRange: [2, 5],
    heightRatio: [0.25, 0.5],
    opacityRange: [0.3, 0.65],
    biasColor: null,
    biasStrength: 0.08,
    coverageBands: [2, 3, 4, 5, 6, 7],
    coverageRegions: [2, 7],
    wash: true,
    washSpacing: 2.5,
    cloudMode: true,
    color: "#B8A898",
  },
  // Round 3: Buildings & shore mid-tones
  {
    name: "Buildings & shore mid-tones",
    description: "Architectural strip — buildings, palm trees, promenade, power line tower",
    markCount: [6000, 9000],
    sizeRange: [2, 5],
    heightRatio: [0.2, 0.45],
    opacityRange: [0.35, 0.75],
    biasColor: null,
    biasStrength: 0.08,
    coverageBands: [2, 3, 4, 5, 6, 7, 8],
    coverageRegions: [3, 7],
    wash: true,
    washSpacing: 2,
    shoreMode: true,
    color: "#5A5A58",
  },
  // Round 4: Chimney & verticals
  {
    name: "Chimney & verticals",
    description: "Power station chimney — both real and reflected, plus power line tower",
    markCount: [1500, 2500],
    sizeRange: [1.5, 3.5],
    heightRatio: [0.15, 0.4],
    opacityRange: [0.55, 0.9],
    biasColor: [40, 35, 30],
    biasStrength: 0.45,
    coverageBands: [3, 4, 5, 6, 7, 8],
    coverageRegions: [4],
    wash: true,
    washSpacing: 1.5,
    chimneyMode: true,
    color: "#3A3828",
  },
  // Round 5: Reflection mid-tones
  {
    name: "Reflection mid-tones",
    description: "Mirror in wet sand — inverted buildings, sky, chimney with slight distortion",
    markCount: [6000, 9000],
    sizeRange: [2, 5],
    heightRatio: [0.2, 0.45],
    opacityRange: [0.32, 0.7],
    biasColor: null,
    biasStrength: 0.08,
    coverageBands: [2, 3, 4, 5, 6, 7, 8],
    coverageRegions: [5, 7],
    wash: true,
    washSpacing: 2,
    reflectionMode: true,
    color: "#7A8870",
  },
  // Round 6: Promenade lights
  {
    name: "Promenade lights",
    description: "Bright dots along shore + vertical streak reflections in wet sand",
    markCount: [2000, 3500],
    sizeRange: [1, 3],
    heightRatio: [0.3, 0.7],
    opacityRange: [0.7, 0.98],
    biasColor: [255, 230, 160],
    biasStrength: 0.55,
    coverageBands: [1, 2, 3],
    coverageRegions: [3, 5],
    promenadeLights: true,
    color: "#FFE8A0",
  },
  // Round 7: Scene detail pass
  {
    name: "Scene detail pass",
    description: "Fine marks across buildings, shore, and reflection for texture",
    markCount: [5000, 8000],
    sizeRange: [1, 3],
    heightRatio: [0.2, 0.45],
    opacityRange: [0.4, 0.8],
    biasColor: null,
    biasStrength: 0.05,
    coverageBands: [3, 4, 5, 6, 7, 8],
    coverageRegions: [3, 5, 4],
    wash: true,
    washSpacing: 1.5,
    detailPass: true,
    color: "#6A6058",
  },
  // Round 8: Dark foreground sand
  {
    name: "Dark foreground sand",
    description: "Push the bottom dark — very dark wet sand in closest foreground",
    markCount: [4000, 6000],
    sizeRange: [2, 5],
    heightRatio: [0.25, 0.5],
    opacityRange: [0.65, 0.95],
    biasColor: [25, 22, 20],
    biasStrength: 0.55,
    coverageBands: [4, 5, 6, 7, 8],
    coverageRegions: [6],
    wash: true,
    washSpacing: 2,
    darkForeground: true,
    color: "#1A1610",
  },
  // Round 9: Golden glow intensification
  {
    name: "Golden glow intensification",
    description: "Sunset warmth — push warm highlights on right side of sky and reflection",
    markCount: [3000, 4500],
    sizeRange: [2, 4],
    heightRatio: [0.25, 0.45],
    opacityRange: [0.3, 0.65],
    biasColor: [220, 165, 55],
    biasStrength: 0.5,
    coverageBands: [1, 2, 3, 4, 5, 6],
    coverageRegions: [7],
    regionBias: 0.65,
    color: "#D49040",
  },
  // Round 10: Deep darks
  {
    name: "Deep darks",
    description: "Push the darkest values everywhere — chimney, buildings, shadows, foreground",
    markCount: [4000, 6000],
    sizeRange: [1.5, 3.5],
    heightRatio: [0.2, 0.45],
    opacityRange: [0.7, 0.98],
    biasColor: [20, 18, 14],
    biasStrength: 0.6,
    coverageBands: [6, 7, 8],
    coverageRegions: null,
    deepDarks: true,
    color: "#1A1610",
  },
  // Round 11: Final highlights + sparkle
  {
    name: "Final highlights + sparkle",
    description: "Contrast punch — brightest sparkles on water and last dark accents",
    markCount: [2500, 3500],
    sizeRange: [1.5, 3.5],
    heightRatio: [0.2, 0.45],
    opacityRange: [0.55, 0.95],
    biasColor: null,
    biasStrength: 0.6,
    coverageBands: [1, 2, 7, 8],
    coverageRegions: null,
    dual: true,
    darkBias: [18, 15, 12],
    sparkleBias: [245, 220, 130],
    color: "#C69A5C",
  },
];


// ═══════════════════════════════════════════════════════════════
// MARK GENERATION
// ═══════════════════════════════════════════════════════════════

const DENSITY_BY_BAND = {
  1: 0.40, 2: 0.55,
  3: 0.68, 4: 0.78,
  5: 0.86, 6: 0.92,
  7: 0.96, 8: 0.99,
};

function checkCoverage(config, valueBand, region) {
  if (!config.coverageBands.includes(valueBand)) return false;
  if (config.coverageRegions && !config.coverageRegions.includes(region)) return false;
  return true;
}

function applyColorBias(r, g, b, config, analysis, valueBand, region, temp, xNorm) {
  let bias = config.biasColor;

  // Paper tint: use scene average
  if (bias === null && config.name === "Paper tint") {
    const avg = analysis.sceneAvgColor;
    bias = [lerp(avg[0], 225, 0.3), lerp(avg[1], 210, 0.3), lerp(avg[2], 195, 0.3)];
  }

  // Sky gradient: warm right (golden/orange), cool left (blue-grey)
  if (config.skyGradient) {
    const t = clamp(xNorm, 0, 1);
    bias = [
      lerp(config.coolBias[0], config.warmBias[0], t),
      lerp(config.coolBias[1], config.warmBias[1], t),
      lerp(config.coolBias[2], config.warmBias[2], t),
    ];
  }

  // Dual mode (final darks + highlights)
  if (config.dual) {
    if (valueBand >= 7) {
      bias = config.darkBias;
    } else {
      bias = config.sparkleBias;
    }
  }

  if (!bias || config.biasStrength === 0) return [r, g, b];

  const s = config.biasStrength;
  return [
    clamp(Math.round(lerp(r, bias[0], s)), 0, 255),
    clamp(Math.round(lerp(g, bias[1], s)), 0, 255),
    clamp(Math.round(lerp(b, bias[2], s)), 0, 255),
  ];
}

function generateRoundMarks(analysis, config, displayW, displayH) {
  const { width: imgW, height: imgH, pixels, valueMap, tempMap, satMap, regionMap,
          lightMap, cloudMap,
          shoreTop, shoreBot, skyTop, skyBot,
          reflectionTop, reflectionBot, darkFgTop,
          chimneyLeft, chimneyRight } = analysis;
  const scaleX = imgW / displayW;
  const scaleY = imgH / displayH;

  // Scale mark count by canvas area relative to reference (600x400 landscape)
  const areaScale = (displayW * displayH) / (600 * 400);
  const targetCount = Math.round(randInt(config.markCount[0], config.markCount[1]) * Math.max(0.6, areaScale));

  if (config.wash) {
    return generateWashMarks(analysis, config, displayW, displayH);
  }

  // Non-wash rounds: promenade lights, golden glow, deep darks, palm detail, etc.
  const marks = [];
  let attempts = 0;
  const maxAttempts = targetCount * 25;

  while (marks.length < targetCount && attempts < maxAttempts) {
    attempts++;

    let x, y;

    // Promenade lights: special sampling for bright dots in shore band + vertical streaks in reflection
    if (config.promenadeLights) {
      if (Math.random() < 0.5) {
        // Shore band: sample for bright light dots
        x = randFloat(0, displayW);
        y = randFloat((shoreTop / imgH) * displayH, (shoreBot / imgH) * displayH);
      } else {
        // Reflection zone below shore: vertical streak reflections of lights
        x = randFloat(0, displayW);
        y = randFloat((reflectionTop / imgH) * displayH, (reflectionBot / imgH) * displayH);
      }
    } else if (config.regionBias && config.coverageRegions && Math.random() < config.regionBias) {
      // Golden glow: sample broadly but favor warm areas
      x = randFloat(0, displayW);
      y = randFloat(0, displayH);
    } else if (config.deepDarks) {
      x = randFloat(0, displayW);
      y = randFloat(0, displayH);
    } else {
      x = randFloat(0, displayW);
      y = randFloat(0, displayH);
    }

    const ix = clamp(Math.floor(x * scaleX), 0, imgW - 1);
    const iy = clamp(Math.floor(y * scaleY), 0, imgH - 1);
    const pi = iy * imgW + ix;

    const valueBand = valueMap[pi];
    const region = regionMap[pi];
    const temp = tempMap[pi];
    const xNorm = ix / imgW;

    // Promenade lights: special acceptance logic
    if (config.promenadeLights) {
      if (region === 3) {
        // Shore band: only accept bright warm pixels (the lights themselves)
        if (lightMap[pi] !== 1 && valueBand > 2) continue;
      } else if (region === 5) {
        // Reflection: accept bright-ish pixels below a light source
        // Check if there's a light above in the shore band
        const shoreY = clamp(Math.floor(((shoreTop + shoreBot) / 2 / imgH) * imgH), 0, imgH - 1);
        const shorePI = shoreY * imgW + ix;
        const hasLightAbove = lightMap[shorePI] === 1;
        if (!hasLightAbove && valueBand > 3) continue;
        if (hasLightAbove && valueBand > 4) continue;
      } else {
        continue; // only shore band and reflection
      }
    } else {
      if (!checkCoverage(config, valueBand, region)) continue;
    }

    // Deep darks: only accept the darkest pixels
    if (config.deepDarks && valueBand < 6) continue;

    // Density-based acceptance
    const density = DENSITY_BY_BAND[valueBand] || 0.5;
    if (config.promenadeLights) {
      // Always accept promenade light candidates (already filtered above)
    } else if (region === 5) {
      // Boost reflection density slightly (water smooths out detail)
      if (Math.random() > Math.min(1, density + 0.15)) continue;
    } else {
      if (Math.random() > density) continue;
    }

    // Sample photo color
    const pidx = pi * 4;
    let cr = pixels[pidx], cg = pixels[pidx + 1], cb = pixels[pidx + 2];

    [cr, cg, cb] = applyColorBias(cr, cg, cb, config, analysis, valueBand, region, temp, xNorm);

    // Random color variation
    const colorJitter = config.promenadeLights ? 10 : config.detailPass ? 8 : config.deepDarks ? 6 : 12;
    cr = clamp(Math.round(cr + (Math.random() - 0.5) * colorJitter), 0, 255);
    cg = clamp(Math.round(cg + (Math.random() - 0.5) * colorJitter), 0, 255);
    cb = clamp(Math.round(cb + (Math.random() - 0.5) * colorJitter), 0, 255);

    const width = randFloat(config.sizeRange[0], config.sizeRange[1]);
    const height = width * randFloat(config.heightRatio[0], config.heightRatio[1]);

    const valueFactor = (valueBand - 1) / 7;
    const opacity = lerp(config.opacityRange[0], config.opacityRange[1], 0.2 + 0.8 * valueFactor);

    // Rotation logic
    let rotation;
    if (config.promenadeLights) {
      if (region === 5) {
        // Light reflections in water: vertical streaks
        rotation = Math.PI / 2 + (Math.random() - 0.5) * 0.15;
      } else {
        // Light dots on shore: small random rotation
        rotation = Math.random() * Math.PI * 2;
      }
    } else if (region === 4) {
      // Chimney: vertical marks
      rotation = Math.PI / 2 + (Math.random() - 0.5) * 0.1;
    } else if (region === 5) {
      // Reflection: slightly randomized horizontal (water distortion)
      rotation = (Math.random() - 0.5) * 0.25 + (Math.random() - 0.5) * 0.1;
    } else if (region === 6) {
      // Dark foreground: horizontal with slight jitter
      rotation = (Math.random() - 0.5) * 0.15;
    } else {
      // General: slight random
      rotation = (Math.random() - 0.5) * 0.3;
    }

    marks.push({ x, y, width, height, rotation, r: cr, g: cg, b: cb, opacity });
  }

  return shuffle(marks);
}

function generateWashMarks(analysis, config, displayW, displayH) {
  const { width: imgW, height: imgH, pixels, valueMap, tempMap, regionMap,
          cloudMap, lightMap,
          shoreTop, shoreBot, skyTop, skyBot,
          reflectionTop, reflectionBot, darkFgTop,
          chimneyLeft, chimneyRight } = analysis;
  const scaleX = imgW / displayW;
  const scaleY = imgH / displayH;
  const spacing = config.washSpacing || 5;
  const marks = [];

  for (let gy = spacing / 2; gy < displayH; gy += spacing) {
    for (let gx = spacing / 2; gx < displayW; gx += spacing) {
      const x = gx + (Math.random() - 0.5) * spacing * 0.8;
      const y = gy + (Math.random() - 0.5) * spacing * 0.8;
      if (x < 0 || x >= displayW || y < 0 || y >= displayH) continue;

      const ix = clamp(Math.floor(x * scaleX), 0, imgW - 1);
      const iy = clamp(Math.floor(y * scaleY), 0, imgH - 1);
      const pi = iy * imgW + ix;
      const region = regionMap[pi];
      const valueBand = valueMap[pi];
      const xNorm = ix / imgW;

      // Region filter for specific rounds
      if (config.coverageRegions) {
        if (!config.coverageRegions.includes(region)) continue;
      }

      // Sky gradient mode: only sky and cloud regions
      if (config.skyGradient) {
        if (region !== 1 && region !== 2) continue;
      }

      // Cloud mode: only cloud and warm glow regions in the sky
      if (config.cloudMode) {
        if (region !== 2 && region !== 7) continue;
        // For region 7 (warm glow), only if it's in the sky area
        if (region === 7) {
          const yNorm = iy / imgH;
          if (yNorm > (skyBot / imgH) + 0.02) continue;
        }
      }

      // Shore mode: buildings/shore band and glow
      if (config.shoreMode) {
        if (region !== 3 && region !== 7) continue;
        // For region 7, only accept within or near shore band
        if (region === 7) {
          const yNorm = iy / imgH;
          const shoreBandTop = shoreTop / imgH;
          const shoreBandBot = shoreBot / imgH;
          if (yNorm < shoreBandTop - 0.03 || yNorm > shoreBandBot + 0.03) continue;
        }
      }

      // Chimney mode: only chimney region
      if (config.chimneyMode) {
        if (region !== 4) continue;
      }

      // Reflection mode: only reflection and glow
      if (config.reflectionMode) {
        if (region !== 5 && region !== 7) continue;
        // For region 7, only accept in reflection zone
        if (region === 7) {
          const yNorm = iy / imgH;
          if (yNorm < reflectionTop / imgH || yNorm > darkFgTop / imgH) continue;
        }
      }

      // Dark foreground mode: only dark foreground region
      if (config.darkForeground) {
        if (region !== 6) continue;
      }

      // Detail pass: buildings/shore, reflection, and chimney — skip lightest
      if (config.detailPass) {
        if (region !== 3 && region !== 5 && region !== 4) continue;
        if (valueBand < 3) continue;
      }

      if (Math.random() < 0.08) continue; // organic skip

      const pidx = pi * 4;
      let cr = pixels[pidx], cg = pixels[pidx + 1], cb = pixels[pidx + 2];

      [cr, cg, cb] = applyColorBias(cr, cg, cb, config, analysis, valueBand, region, tempMap[pi], xNorm);

      // Reflection gets slightly muted/blue-shifted colors (water effect)
      if (config.reflectionMode && region === 5) {
        cr = clamp(Math.round(cr * 0.92), 0, 255);
        cg = clamp(Math.round(cg * 0.95), 0, 255);
        cb = clamp(Math.round(cb * 1.04), 0, 255);
      }

      // Cloud mode: slightly desaturate for atmospheric haze
      if (config.cloudMode && region === 2) {
        const avg = (cr + cg + cb) / 3;
        cr = clamp(Math.round(lerp(cr, avg, 0.15)), 0, 255);
        cg = clamp(Math.round(lerp(cg, avg, 0.15)), 0, 255);
        cb = clamp(Math.round(lerp(cb, avg, 0.15)), 0, 255);
      }

      // Dark foreground: push darker
      if (config.darkForeground) {
        cr = clamp(Math.round(cr * 0.7), 0, 255);
        cg = clamp(Math.round(cg * 0.7), 0, 255);
        cb = clamp(Math.round(cb * 0.7), 0, 255);
      }

      const jitter = config.darkForeground ? 6 : config.detailPass ? 6 : config.chimneyMode ? 8 : 12;
      cr = clamp(Math.round(cr + (Math.random() - 0.5) * jitter), 0, 255);
      cg = clamp(Math.round(cg + (Math.random() - 0.5) * jitter), 0, 255);
      cb = clamp(Math.round(cb + (Math.random() - 0.5) * jitter), 0, 255);

      const width = randFloat(config.sizeRange[0], config.sizeRange[1]);
      const height = width * randFloat(config.heightRatio[0], config.heightRatio[1]);
      const valueFactor = (valueBand - 1) / 7;
      const opacity = lerp(config.opacityRange[0], config.opacityRange[1], 0.15 + 0.85 * valueFactor);

      // Rotation
      let rotation;
      if (config.chimneyMode) {
        // Chimney: vertical marks
        rotation = Math.PI / 2 + (Math.random() - 0.5) * 0.1;
      } else if (config.skyGradient || config.cloudMode) {
        // Sky and clouds: horizontal orientation, generous marks
        if (config.cloudMode) {
          // Clouds: slightly varied orientation
          rotation = (Math.random() - 0.5) * 0.35;
        } else {
          rotation = (Math.random() - 0.5) * 0.15;
        }
      } else if (config.shoreMode) {
        // Buildings/shore: mixed horizontal, some verticals for structure
        if (valueBand >= 5 && Math.random() < 0.35) {
          rotation = Math.PI / 2 + (Math.random() - 0.5) * 0.25; // vertical for structure
        } else {
          rotation = (Math.random() - 0.5) * 0.2;
        }
      } else if (config.reflectionMode) {
        // Reflection: horizontal with slight water distortion jitter
        rotation = (Math.random() - 0.5) * 0.2 + (Math.random() - 0.5) * 0.08;
      } else if (config.darkForeground) {
        // Dark foreground: mostly horizontal, dense
        rotation = (Math.random() - 0.5) * 0.15;
      } else if (config.detailPass) {
        // Detail pass: follow region-appropriate orientation
        if (region === 3) rotation = (Math.random() - 0.5) * 0.25; // shore: mostly horizontal
        else if (region === 5) rotation = (Math.random() - 0.5) * 0.2; // reflection: slight water
        else if (region === 4) rotation = Math.PI / 2 + (Math.random() - 0.5) * 0.1; // chimney: vertical
        else rotation = (Math.random() - 0.5) * 0.3; // varied
      } else if (region === 4) {
        // Chimney pixels encountered in non-chimney rounds
        rotation = Math.PI / 2 + (Math.random() - 0.5) * 0.1;
      } else if (region === 1) {
        // Sky: horizontal
        rotation = (Math.random() - 0.5) * 0.15;
      } else if (region === 5) {
        // Reflection: slight water distortion
        rotation = (Math.random() - 0.5) * 0.2;
      } else if (region === 6) {
        // Dark foreground: horizontal
        rotation = (Math.random() - 0.5) * 0.15;
      } else {
        rotation = (Math.random() - 0.5) * 0.2; // gentle random
      }

      marks.push({ x, y, width, height, rotation, r: cr, g: cg, b: cb, opacity });
    }
  }
  return shuffle(marks);
}

export function generateAllMarks(analysis, displayW, displayH, onProgress) {
  const allRounds = [];
  for (let i = 0; i < ROUND_CONFIGS.length; i++) {
    onProgress?.(`Generating round ${i}: ${ROUND_CONFIGS[i].name}…`, i / ROUND_CONFIGS.length);
    const marks = generateRoundMarks(analysis, ROUND_CONFIGS[i], displayW, displayH);
    allRounds.push(marks);
  }
  onProgress?.("All marks generated", 1.0);
  return allRounds;
}


// ═══════════════════════════════════════════════════════════════
// PAPER TEXTURE
// ═══════════════════════════════════════════════════════════════

export function generatePaperTexture(displayW, displayH) {
  const count = Math.round((displayW * displayH) / 50);
  const dots = [];
  for (let i = 0; i < count; i++) {
    const shade = randInt(200, 230);
    dots.push({
      x: randFloat(0, displayW),
      y: randFloat(0, displayH),
      r: randFloat(0.3, 1.2),
      opacity: randFloat(0.02, 0.06),
      color: `rgb(${shade},${shade - randInt(0, 8)},${shade - randInt(5, 15)})`,
    });
  }
  return dots;
}


// ═══════════════════════════════════════════════════════════════
// REGION BOUNDARY — for zone overlays
// ═══════════════════════════════════════════════════════════════

export function getRegionBoundaries(analysis, displayW, displayH) {
  const { regionMap, width: w, height: h } = analysis;
  const scaleX = w / displayW;
  const scaleY = h / displayH;
  const step = Math.max(3, Math.round(w / 100));

  // Collect boundary points per region
  const boundaries = {};
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const i = y * w + x;
      const r = regionMap[i];
      if (r === 0) continue; // skip general
      // Check if boundary pixel
      const neighbors = [regionMap[i - 1], regionMap[i + 1], regionMap[i - w], regionMap[i + w]];
      if (neighbors.some(n => n !== r)) {
        if (!boundaries[r]) boundaries[r] = [];
        boundaries[r].push({ x: x / scaleX, y: y / scaleY });
      }
    }
  }
  return boundaries;
}


// ═══════════════════════════════════════════════════════════════
// HOVER SAMPLING
// ═══════════════════════════════════════════════════════════════

const REGION_NAMES = [
  "General",             // 0
  "Sky",                 // 1
  "Clouds",              // 2
  "Buildings/shore",     // 3
  "Chimney",             // 4
  "Reflection",          // 5
  "Dark foreground",     // 6
  "Warm glow",           // 7
];

export function samplePoint(analysis, displayW, displayH, mx, my) {
  const { width: imgW, height: imgH, pixels, valueMap, tempMap, satMap, regionMap } = analysis;
  const ix = clamp(Math.floor(mx * (imgW / displayW)), 0, imgW - 1);
  const iy = clamp(Math.floor(my * (imgH / displayH)), 0, imgH - 1);
  const pi = iy * imgW + ix;
  const pidx = pi * 4;

  return {
    photoColor: [pixels[pidx], pixels[pidx + 1], pixels[pidx + 2]],
    valueBand: valueMap[pi],
    temperature: tempMap[pi],
    saturation: satMap[pi],
    region: REGION_NAMES[regionMap[pi]] || "Unknown",
    regionId: regionMap[pi],
  };
}
