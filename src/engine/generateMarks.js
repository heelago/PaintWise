// ===================================================================
// GENERIC MARK GENERATION ENGINE
// Generates pointillist elliptical marks from a generic analysis result.
// No scene-specific logic -- works with any photo analyzed by
// analyzeImage.js.  Structured so generateAllMarks() can accept an
// optional roundConfigs parameter to support style presets.
// ===================================================================

import { clamp, lerp, randFloat, shuffleArray, rgbToGray } from './analyzeImage.js';

// Helper not exported by analyzeImage
const randInt = (lo, hi) => Math.floor(randFloat(lo, hi + 1));


// ===================================================================
// REGION NAMES  (indices match regionMap values from analyzeImage)
// ===================================================================

export const REGION_NAMES = [
  "General",         // 0
  "Sky",             // 1
  "Clouds",          // 2
  "Midground",       // 3
  "Focal Subject",   // 4
  "Reflection",      // 5
  "Foreground",      // 6
  "Warm Glow",       // 7
];


// ===================================================================
// DEFAULT ROUND CONFIGS  ("dry brush" style -- 10 rounds)
// ===================================================================

export const ROUND_CONFIGS = [
  // Round 0 -- Paper tint
  {
    name: "Paper tint",
    description: "Atmospheric warmth base -- kills raw white, sets tonal key",
    markCount: [1200, 1800],
    sizeRange: [5, 9],
    heightRatio: [0.35, 0.6],
    opacityRange: [0.15, 0.35],
    biasColor: null,          // computed from scene average at runtime
    biasStrength: 0.25,
    coverageBands: [1, 2, 3, 4, 5, 6, 7, 8],
    coverageRegions: null,    // all regions
    wash: true,
    washSpacing: 4,
    color: "#C8A878",
  },

  // Round 1 -- Sky wash
  {
    name: "Sky wash",
    description: "Sky area base colors -- cool-left to warm-right gradient",
    markCount: [3000, 5000],
    sizeRange: [3, 7],
    heightRatio: [0.3, 0.55],
    opacityRange: [0.25, 0.6],
    biasColor: null,
    biasStrength: 0.3,
    coverageBands: [1, 2, 3, 4, 5, 6],
    coverageRegions: [1, 2],  // sky, clouds
    wash: true,
    washSpacing: 3,
    skyGradient: true,
    warmBias: [220, 165, 70],
    coolBias: [100, 120, 155],
    color: "#A8B0C0",
  },

  // Round 2 -- Midground wash
  {
    name: "Midground wash",
    description: "Subject band base -- buildings, shore, or main horizontal mass",
    markCount: [5000, 8000],
    sizeRange: [2, 5],
    heightRatio: [0.2, 0.45],
    opacityRange: [0.35, 0.75],
    biasColor: null,
    biasStrength: 0.08,
    coverageBands: [2, 3, 4, 5, 6, 7, 8],
    coverageRegions: [3, 4, 7],  // midground, focal, warm glow
    wash: true,
    washSpacing: 2,
    color: "#5A5A58",
  },

  // Round 3 -- Background detail
  {
    name: "Background detail",
    description: "Cloud shapes, sky variation -- mid-tone patches",
    markCount: [4000, 6000],
    sizeRange: [2, 5],
    heightRatio: [0.25, 0.5],
    opacityRange: [0.3, 0.65],
    biasColor: null,
    biasStrength: 0.08,
    coverageBands: [2, 3, 4, 5, 6, 7],
    coverageRegions: [1, 2],  // sky, clouds
    wash: true,
    washSpacing: 2.5,
    color: "#B8A898",
  },

  // Round 4 -- Focal subject
  {
    name: "Focal subject",
    description: "Main subject definition -- highest-saliency region marks",
    markCount: [4000, 7000],
    sizeRange: [1.5, 4],
    heightRatio: [0.2, 0.45],
    opacityRange: [0.4, 0.8],
    biasColor: null,
    biasStrength: 0.08,
    coverageBands: [2, 3, 4, 5, 6, 7, 8],
    coverageRegions: [4, 3],  // focal subject, midground
    wash: true,
    washSpacing: 1.8,
    color: "#4A4A48",
  },

  // Round 5 -- Reflection / water
  {
    name: "Reflection / water",
    description: "Mirror zone or lower ground -- muted, horizontal marks",
    markCount: [5000, 8000],
    sizeRange: [2, 5],
    heightRatio: [0.2, 0.45],
    opacityRange: [0.32, 0.7],
    biasColor: null,
    biasStrength: 0.08,
    coverageBands: [2, 3, 4, 5, 6, 7, 8],
    coverageRegions: [5, 6, 7],  // reflection, foreground, warm glow
    wash: true,
    washSpacing: 2,
    color: "#7A8870",
  },

  // Round 6 -- Warm accents
  {
    name: "Warm accents",
    description: "Warm glow intensification -- push warm highlights",
    markCount: [2500, 4000],
    sizeRange: [2, 4],
    heightRatio: [0.25, 0.45],
    opacityRange: [0.3, 0.65],
    biasColor: [220, 165, 55],
    biasStrength: 0.5,
    coverageBands: [1, 2, 3, 4, 5, 6],
    coverageRegions: [7],  // warm glow areas
    wash: false,
    color: "#D49040",
  },

  // Round 7 -- Scene detail pass
  {
    name: "Scene detail pass",
    description: "Fine texture everywhere -- small marks across all regions",
    markCount: [5000, 8000],
    sizeRange: [1, 3],
    heightRatio: [0.2, 0.45],
    opacityRange: [0.4, 0.8],
    biasColor: null,
    biasStrength: 0.05,
    coverageBands: [3, 4, 5, 6, 7, 8],
    coverageRegions: null,  // all regions
    wash: true,
    washSpacing: 1.5,
    color: "#6A6058",
  },

  // Round 8 -- Deep darks
  {
    name: "Deep darks",
    description: "Darkest values across the scene -- push contrast in shadows",
    markCount: [4000, 6000],
    sizeRange: [1.5, 3.5],
    heightRatio: [0.2, 0.45],
    opacityRange: [0.7, 0.98],
    biasColor: [20, 18, 14],
    biasStrength: 0.6,
    coverageBands: [6, 7, 8],
    coverageRegions: null,  // all regions
    wash: false,
    color: "#1A1610",
  },

  // Round 9 -- Final highlights + sparkle
  {
    name: "Final highlights + sparkle",
    description: "Contrast punch -- brightest sparkles and last dark accents",
    markCount: [2500, 3500],
    sizeRange: [1.5, 3.5],
    heightRatio: [0.2, 0.45],
    opacityRange: [0.55, 0.95],
    biasColor: null,
    biasStrength: 0.6,
    coverageBands: [1, 2, 7, 8],
    coverageRegions: null,  // all regions -- dual mode
    dual: true,
    darkBias: [18, 15, 12],
    sparkleBias: [245, 220, 130],
    wash: false,
    color: "#C69A5C",
  },
];


// ===================================================================
// DENSITY BY VALUE BAND  (1 = lightest, 8 = darkest)
// Higher value bands get denser mark placement to build up darks.
// ===================================================================

const DENSITY_BY_BAND = {
  1: 0.40, 2: 0.55,
  3: 0.68, 4: 0.78,
  5: 0.86, 6: 0.92,
  7: 0.96, 8: 0.99,
};


// ===================================================================
// COLOR BIAS APPLICATION  (generic -- no scene-specific flags)
// ===================================================================

function applyColorBias(r, g, b, config, analysis, valueBand, region, xNorm) {
  let bias = config.biasColor;

  // ----- Paper tint: derive bias from scene average toward paper white -----
  if (bias === null && config === ROUND_CONFIGS[0]) {
    // Round 0 detection: use the instance identity (safe because the
    // caller passes the config object from the array).  If someone
    // passes a custom config with biasColor === null that is NOT paper
    // tint, the fallback below handles it gracefully.
    const avg = analysis.sceneAvgColor;
    if (avg) {
      bias = [
        lerp(avg[0], 225, 0.3),
        lerp(avg[1], 210, 0.3),
        lerp(avg[2], 195, 0.3),
      ];
    }
  }

  // ----- Sky gradient: interpolate cool-left to warm-right -----
  if (config.skyGradient && config.coolBias && config.warmBias) {
    const t = clamp(xNorm, 0, 1);
    bias = [
      lerp(config.coolBias[0], config.warmBias[0], t),
      lerp(config.coolBias[1], config.warmBias[1], t),
      lerp(config.coolBias[2], config.warmBias[2], t),
    ];
  }

  // ----- Dual mode (final round): dark bias for deep values, sparkle for light -----
  if (config.dual) {
    if (valueBand >= 7) {
      bias = config.darkBias;
    } else {
      bias = config.sparkleBias;
    }
  }

  // No bias to apply
  if (!bias || config.biasStrength === 0) return [r, g, b];

  const s = config.biasStrength;
  return [
    clamp(Math.round(lerp(r, bias[0], s)), 0, 255),
    clamp(Math.round(lerp(g, bias[1], s)), 0, 255),
    clamp(Math.round(lerp(b, bias[2], s)), 0, 255),
  ];
}


// ===================================================================
// ROTATION BY REGION  (generic mapping)
// ===================================================================

function regionRotation(region) {
  switch (region) {
    case 1: // sky -- horizontal
      return (Math.random() - 0.5) * 0.15;
    case 2: // clouds -- slightly varied
      return (Math.random() - 0.5) * 0.35;
    case 3: // midground -- mostly horizontal, occasional vertical for structure
      if (Math.random() < 0.25) {
        return Math.PI / 2 + (Math.random() - 0.5) * 0.25;
      }
      return (Math.random() - 0.5) * 0.2;
    case 4: // focal subject -- slight random
      return (Math.random() - 0.5) * 0.3;
    case 5: // reflection -- horizontal with water jitter
      return (Math.random() - 0.5) * 0.2 + (Math.random() - 0.5) * 0.08;
    case 6: // foreground -- horizontal
      return (Math.random() - 0.5) * 0.15;
    case 7: // warm glow -- gentle random
      return (Math.random() - 0.5) * 0.2;
    default: // general
      return (Math.random() - 0.5) * 0.2;
  }
}


// ===================================================================
// COVERAGE CHECK
// ===================================================================

function checkCoverage(config, valueBand, region) {
  if (config.coverageBands && !config.coverageBands.includes(valueBand)) {
    return false;
  }
  if (config.coverageRegions && !config.coverageRegions.includes(region)) {
    return false;
  }
  return true;
}


// ===================================================================
// GENERATE ROUND MARKS  (core per-round loop)
// ===================================================================

export function generateRoundMarks(config, analysis, w, h) {
  const {
    width: imgW, height: imgH, pixels,
    valueMap, regionMap, tempMap,
  } = analysis;

  const scaleX = imgW / w;
  const scaleY = imgH / h;

  if (config.wash) {
    return generateWashMarks(config, analysis, w, h);
  }

  // --- Non-wash round: random xy sampling ---

  const areaScale = (w * h) / (600 * 400);
  const targetCount = Math.round(
    randInt(config.markCount[0], config.markCount[1]) * Math.max(0.6, areaScale)
  );

  const marks = [];
  let attempts = 0;
  const maxAttempts = targetCount * 25;

  while (marks.length < targetCount && attempts < maxAttempts) {
    attempts++;

    const x = randFloat(0, w);
    const y = randFloat(0, h);

    const ix = clamp(Math.floor(x * scaleX), 0, imgW - 1);
    const iy = clamp(Math.floor(y * scaleY), 0, imgH - 1);
    const pi = iy * imgW + ix;

    const valueBand = valueMap[pi];
    const region = regionMap[pi];
    const xNorm = ix / imgW;

    // Coverage filter
    if (!checkCoverage(config, valueBand, region)) continue;

    // Deep darks override: enforce minimum darkness
    if (config.coverageBands &&
        config.coverageBands[0] >= 6 &&
        valueBand < 6) {
      continue;
    }

    // Density-based acceptance
    const density = DENSITY_BY_BAND[valueBand] || 0.5;
    if (region === 5) {
      // Boost reflection density slightly (water smooths out detail)
      if (Math.random() > Math.min(1, density + 0.15)) continue;
    } else {
      if (Math.random() > density) continue;
    }

    // Sample photo color
    const pidx = pi * 4;
    let cr = pixels[pidx], cg = pixels[pidx + 1], cb = pixels[pidx + 2];

    // Apply color bias
    [cr, cg, cb] = applyColorBias(cr, cg, cb, config, analysis, valueBand, region, xNorm);

    // Color jitter (+-10 RGB)
    const jitter = 10;
    cr = clamp(Math.round(cr + (Math.random() - 0.5) * jitter * 2), 0, 255);
    cg = clamp(Math.round(cg + (Math.random() - 0.5) * jitter * 2), 0, 255);
    cb = clamp(Math.round(cb + (Math.random() - 0.5) * jitter * 2), 0, 255);

    // Size
    const markWidth = randFloat(config.sizeRange[0], config.sizeRange[1]);
    const hr = config.heightRatio || [0.25, 0.5];
    const markHeight = markWidth * randFloat(hr[0], hr[1]);

    // Opacity from value band
    const valueFactor = (valueBand - 1) / 7;
    const opacity = lerp(
      config.opacityRange[0], config.opacityRange[1],
      0.2 + 0.8 * valueFactor
    );

    // Rotation from region
    const rotation = regionRotation(region);

    marks.push({
      x, y,
      r: cr, g: cg, b: cb,
      opacity,
      width: markWidth,
      height: markHeight,
      rotation,
    });
  }

  return shuffleArray(marks);
}


// ===================================================================
// GENERATE WASH MARKS  (grid-based sampling)
// ===================================================================

function generateWashMarks(config, analysis, displayW, displayH) {
  const {
    width: imgW, height: imgH, pixels,
    valueMap, regionMap, tempMap,
  } = analysis;

  const scaleX = imgW / displayW;
  const scaleY = imgH / displayH;
  const spacing = config.washSpacing || 5;
  const marks = [];

  for (let gy = spacing / 2; gy < displayH; gy += spacing) {
    for (let gx = spacing / 2; gx < displayW; gx += spacing) {
      // Jitter the position within the grid cell
      const x = gx + (Math.random() - 0.5) * spacing * 0.8;
      const y = gy + (Math.random() - 0.5) * spacing * 0.8;
      if (x < 0 || x >= displayW || y < 0 || y >= displayH) continue;

      const ix = clamp(Math.floor(x * scaleX), 0, imgW - 1);
      const iy = clamp(Math.floor(y * scaleY), 0, imgH - 1);
      const pi = iy * imgW + ix;
      const region = regionMap[pi];
      const valueBand = valueMap[pi];
      const xNorm = ix / imgW;

      // Region filter
      if (config.coverageRegions) {
        if (!config.coverageRegions.includes(region)) continue;
      }

      // Value band filter
      if (config.coverageBands) {
        if (!config.coverageBands.includes(valueBand)) continue;
      }

      // Organic skip -- ~8% random gaps for natural feel
      if (Math.random() < 0.08) continue;

      // Sample photo color
      const pidx = pi * 4;
      let cr = pixels[pidx], cg = pixels[pidx + 1], cb = pixels[pidx + 2];

      // Apply color bias
      [cr, cg, cb] = applyColorBias(cr, cg, cb, config, analysis, valueBand, region, xNorm);

      // Reflection muting (slight blue shift for water effect)
      if (region === 5) {
        cr = clamp(Math.round(cr * 0.92), 0, 255);
        cg = clamp(Math.round(cg * 0.95), 0, 255);
        cb = clamp(Math.round(cb * 1.04), 0, 255);
      }

      // Cloud desaturation (atmospheric haze)
      if (region === 2) {
        const avg = (cr + cg + cb) / 3;
        cr = clamp(Math.round(lerp(cr, avg, 0.15)), 0, 255);
        cg = clamp(Math.round(lerp(cg, avg, 0.15)), 0, 255);
        cb = clamp(Math.round(lerp(cb, avg, 0.15)), 0, 255);
      }

      // Foreground darkening
      if (region === 6) {
        cr = clamp(Math.round(cr * 0.75), 0, 255);
        cg = clamp(Math.round(cg * 0.75), 0, 255);
        cb = clamp(Math.round(cb * 0.75), 0, 255);
      }

      // Color jitter (+-10 RGB)
      const jitter = 10;
      cr = clamp(Math.round(cr + (Math.random() - 0.5) * jitter * 2), 0, 255);
      cg = clamp(Math.round(cg + (Math.random() - 0.5) * jitter * 2), 0, 255);
      cb = clamp(Math.round(cb + (Math.random() - 0.5) * jitter * 2), 0, 255);

      // Size
      const markWidth = randFloat(config.sizeRange[0], config.sizeRange[1]);
      const hr = config.heightRatio || [0.25, 0.5];
      const markHeight = markWidth * randFloat(hr[0], hr[1]);

      // Opacity from value band
      const valueFactor = (valueBand - 1) / 7;
      const opacity = lerp(
        config.opacityRange[0], config.opacityRange[1],
        0.15 + 0.85 * valueFactor
      );

      // Rotation from region
      const rotation = regionRotation(region);

      marks.push({
        x, y,
        r: cr, g: cg, b: cb,
        opacity,
        width: markWidth,
        height: markHeight,
        rotation,
      });
    }
  }

  return shuffleArray(marks);
}


// ===================================================================
// GENERATE ALL MARKS  (orchestrator)
// Accepts optional roundConfigs to support style presets.
// ===================================================================

export function generateAllMarks(analysis, displayW, displayH, onProgress, roundConfigs) {
  const configs = roundConfigs || ROUND_CONFIGS;
  const allRounds = [];

  for (let i = 0; i < configs.length; i++) {
    onProgress?.(i / configs.length);

    const marks = generateRoundMarks(configs[i], analysis, displayW, displayH);
    allRounds.push(marks);
  }

  onProgress?.(1.0);
  return allRounds;
}


// ===================================================================
// PAPER TEXTURE  (copied from SR engine)
// ===================================================================

export function generatePaperTexture(w, h) {
  const count = Math.round((w * h) / 50);
  const dots = [];

  for (let i = 0; i < count; i++) {
    const shade = randInt(200, 230);
    dots.push({
      x: randFloat(0, w),
      y: randFloat(0, h),
      r: randFloat(0.3, 1.2),
      opacity: randFloat(0.02, 0.06),
      color: `rgb(${shade},${shade - randInt(0, 8)},${shade - randInt(5, 15)})`,
    });
  }

  return dots;
}
