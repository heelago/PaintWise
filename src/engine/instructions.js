// ===================================================================
// TEMPLATE-BASED PAINTING INSTRUCTION GENERATOR
// Produces beginner-friendly watercolor instructions from analysis
// data and round configs. No LLM needed -- pure template logic.
// ===================================================================

import { findNearestPigment, suggestMix } from './pigments.js';
import { REGION_NAMES } from './generateMarks.js';

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function rgbToHex(r, g, b) {
  const h = (v) => v.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** True when R-B difference implies warmth. */
function isWarm(r, g, b) {
  return (r - b) > 20;
}

/** Describe a vertical position as a human-readable phrase. */
function describeVerticalPos(yNorm) {
  if (yNorm < 0.25) return 'upper quarter';
  if (yNorm < 0.40) return 'upper third';
  if (yNorm < 0.60) return 'middle band';
  if (yNorm < 0.75) return 'lower third';
  return 'lower quarter';
}

/** Describe a horizontal position. */
function describeHorizontalPos(xNorm) {
  if (xNorm < 0.33) return 'left side';
  if (xNorm < 0.66) return 'center';
  return 'right side';
}

/** Describe a bounding box position relative to the full image. */
function describeRegionPosition(bounds, imgW, imgH) {
  if (!bounds) return '';
  const cx = ((bounds.left || 0) + (bounds.right || imgW)) / 2 / imgW;
  const cy = ((bounds.top || 0) + (bounds.bot || imgH)) / 2 / imgH;
  return `around the ${describeHorizontalPos(cx)}, in the ${describeVerticalPos(cy)}`;
}

/** Calculate what percentage of image height a region covers. */
function regionHeightPct(bounds, imgH) {
  if (!bounds || bounds.top == null || bounds.bot == null) return 0;
  return Math.round(((bounds.bot - bounds.top) / imgH) * 100);
}

// -------------------------------------------------------------------
// Centroid color extraction per region
// -------------------------------------------------------------------

/**
 * Collect centroids that fall within the given region indices by
 * sampling the regionMap. Returns deduplicated pigment results
 * (top N unique pigment names).
 */
function colorsForRegions(analysis, regionIndices, maxColors = 3) {
  const { centroids, regionMap, width, height } = analysis;
  if (!centroids || centroids.length === 0) return [];

  // For each centroid, find which region it most commonly falls into
  // by checking the regionMap at a grid of sample points near the
  // centroid's typical color. Since centroids are color clusters (not
  // spatial), we scan the regionMap for pixels whose color is closest
  // to each centroid and tally their region.
  const regionTallies = centroids.map(() => new Map());
  const stride = Math.max(1, Math.floor(Math.sqrt(width * height / 2000)));

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const pi = y * width + x;
      const region = regionMap[pi];
      const pidx = pi * 4;
      const pr = analysis.pixels[pidx];
      const pg = analysis.pixels[pidx + 1];
      const pb = analysis.pixels[pidx + 2];

      // Find nearest centroid
      let bestC = 0, bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const dr = pr - centroids[c][0];
        const dg = pg - centroids[c][1];
        const db = pb - centroids[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; bestC = c; }
      }
      const tally = regionTallies[bestC];
      tally.set(region, (tally.get(region) || 0) + 1);
    }
  }

  // Filter centroids whose dominant region is in the target set
  const regionSet = regionIndices
    ? new Set(regionIndices)
    : null; // null means all regions

  const relevant = [];
  for (let c = 0; c < centroids.length; c++) {
    if (!regionSet) {
      relevant.push(centroids[c]);
      continue;
    }
    const tally = regionTallies[c];
    let maxCount = 0, dominantRegion = 0;
    for (const [reg, cnt] of tally) {
      if (cnt > maxCount) { maxCount = cnt; dominantRegion = reg; }
    }
    if (regionSet.has(dominantRegion)) {
      relevant.push(centroids[c]);
    }
  }

  // Map through pigment matcher and deduplicate
  const seen = new Set();
  const results = [];
  for (const rgb of relevant) {
    const r = Math.round(rgb[0]), g = Math.round(rgb[1]), b = Math.round(rgb[2]);
    const { pigment } = findNearestPigment(r, g, b);
    if (!pigment || seen.has(pigment.name)) continue;
    seen.add(pigment.name);

    const mix = suggestMix(r, g, b);
    let mixDesc = null;
    if (mix.secondary) {
      mixDesc = `${mix.primary.name} + ${mix.secondary.name} (${mix.ratio})`;
    }

    results.push({
      name: pigment.name,
      hex: rgbToHex(...pigment.rgb),
      mix: mixDesc,
    });
    if (results.length >= maxColors) break;
  }

  return results;
}

/** Format a color list as readable text: "Raw Sienna and Cobalt Blue" */
function colorNames(colors) {
  if (colors.length === 0) return 'a neutral tone';
  if (colors.length === 1) return colors[0].name;
  if (colors.length === 2) return `${colors[0].name} and ${colors[1].name}`;
  return colors.slice(0, -1).map(c => c.name).join(', ') +
    ', and ' + colors[colors.length - 1].name;
}

// -------------------------------------------------------------------
// Per-round template builders
// -------------------------------------------------------------------

function buildRound0(analysis, config) {
  const avg = analysis.sceneAvgColor || [180, 170, 150];
  const { pigment } = findNearestPigment(avg[0], avg[1], avg[2]);
  const tintName = pigment ? pigment.name : 'Raw Sienna';
  const warm = isWarm(avg[0], avg[1], avg[2]);
  const toneWord = warm ? 'warm' : 'cool';

  const colors = [{
    name: tintName,
    hex: pigment ? rgbToHex(...pigment.rgb) : '#C49A48',
    mix: null,
  }];

  return {
    roundIndex: 0,
    title: 'Step 1: Paper Tint',
    timing: 'Wet-on-wet',
    brush: 'Large flat brush (1.5" or wider)',
    colors,
    instruction:
      `Wet the entire paper with clean water using broad, even strokes. ` +
      `While the surface is still glistening, apply a very dilute wash of ${tintName} ` +
      `across the full sheet. This kills the raw white and sets a ${toneWord} atmospheric ` +
      `tone for the whole painting. Tilt your board gently to let the wash flow evenly ` +
      `and settle into the paper texture.`,
    tips: [
      'Keep the wash very light -- you can always add more later, but you cannot take it away',
      'Prop one end of your board up about 2-3 cm so gravity helps the wash flow smoothly',
      'Use more water than you think you need -- the wash should look like tinted water, not paint',
      `The paper should look ${warm ? 'like old parchment' : 'like a cool morning sky'} when dry`,
    ],
  };
}

function buildRound1(analysis, config) {
  const { regionBounds, hasHorizon, height, width } = analysis;
  const skyPct = regionHeightPct(regionBounds.sky, height);
  const colors = colorsForRegions(analysis, config.coverageRegions, 3);

  const horizonRef = hasHorizon
    ? 'Work the upper portion above the horizon line. '
    : '';
  const skySize = skyPct > 40
    ? 'The sky takes up a large area, so work boldly. '
    : 'The sky area is relatively compact, so be precise. ';

  let gradientNote = '';
  if (colors.length >= 2) {
    const c0warm = isWarm(
      ...analysis.centroids[0]?.map(Math.round) || [128, 128, 128]
    );
    gradientNote = c0warm
      ? `Vary the color from warmer tones on the right toward cooler tones on the left. `
      : `Let the wash transition gently across the sky -- slightly different on each side. `;
  }

  return {
    roundIndex: 1,
    title: 'Step 2: Sky Wash',
    timing: 'Wet-on-wet',
    brush: 'Large flat brush or mop brush',
    colors,
    instruction:
      `${horizonRef}Wet the sky area and, while still damp, lay in broad strokes ` +
      `of ${colorNames(colors)}. ${skySize}${gradientNote}` +
      `Work quickly before the paper dries -- you want soft edges with no hard lines.`,
    tips: [
      'Try working with your board upside down so gravity pulls the wash away from the horizon, keeping that edge clean',
      'If the wash pools at the bottom of the sky area, lift the excess with a damp (not wet) brush',
      `The sky covers roughly ${skyPct}% of the image height`,
    ],
  };
}

function buildRound2(analysis, config) {
  const { regionBounds, height, width } = analysis;
  const colors = colorsForRegions(analysis, config.coverageRegions, 3);
  const pos = describeRegionPosition(regionBounds.midground, width, height);

  return {
    roundIndex: 2,
    title: 'Step 3: Midground Wash',
    timing: 'Wet-on-dry',
    brush: 'Medium round brush (size 8-12)',
    colors,
    instruction:
      `Let the paper dry completely from the previous step. Now paint the midground ` +
      `band -- the horizontal strip ${pos}. Use ${colorNames(colors)} in medium-strength ` +
      `washes (more pigment than the sky, but still fluid). Build up the shapes you see ` +
      `with overlapping, slightly varied strokes. Leave some paper showing through for texture.`,
    tips: [
      'Wait for the paper to be fully dry before starting -- touch the back of your hand to it to check',
      'Vary your pressure: lighter strokes for distant shapes, heavier for closer ones',
      'If you see distinct shapes (trees, buildings, hills), paint around their edges rather than over them',
    ],
  };
}

function buildRound3(analysis, config) {
  const hasClouds = analysis.cloudMap && analysis.cloudMap.some(v => v > 0);
  const colors = colorsForRegions(analysis, config.coverageRegions, 2);

  const cloudInstr = hasClouds
    ? `You can see cloud shapes in the sky. Use a slightly damp brush to dab in cloud ` +
      `forms with ${colorNames(colors)}. Clouds are not flat white -- their shadows have color. ` +
      `Leave the tops of clouds lighter and darken the undersides.`
    : `Add texture and variation to the sky. Use ${colorNames(colors)} to build subtle ` +
      `tone changes -- lighter in some areas, slightly deeper in others. This gives the ` +
      `sky dimension rather than looking flat.`;

  return {
    roundIndex: 3,
    title: 'Step 4: Background Detail',
    timing: 'Wet-on-dry',
    brush: 'Medium round brush (size 6-8)',
    colors,
    instruction:
      `Switch to a smaller brush for this step. ${cloudInstr} ` +
      `Work with a lighter touch now -- these are refinement marks, not broad washes.`,
    tips: [
      hasClouds
        ? 'For soft cloud edges, paint the shape and immediately soften one side with a clean damp brush'
        : 'Try tiny circular motions to create gentle variation without hard edges',
      'Step back from your painting after every few strokes to check the overall balance',
      'Less is more at this stage -- it is easier to add than to fix overworking',
    ],
  };
}

function buildRound4(analysis, config) {
  const { regionBounds, width, height } = analysis;
  const focal = regionBounds.focalSubject;
  const colors = colorsForRegions(analysis, config.coverageRegions, 3);

  let posRef = '';
  if (focal) {
    posRef = `The main subject sits ${describeRegionPosition(focal, width, height)}. Focus your strongest marks here. `;
  }

  return {
    roundIndex: 4,
    title: 'Step 5: Focal Subject',
    timing: 'Wet-on-dry',
    brush: 'Medium round brush (size 6-10)',
    colors,
    instruction:
      `Now define the main subject of the scene. ${posRef}Use ${colorNames(colors)} ` +
      `with more pigment and less water than before -- you want stronger, more confident ` +
      `marks here. Build up the shape with overlapping strokes, letting each layer dry ` +
      `slightly before adding the next. This is where your painting starts to come alive.`,
    tips: [
      'Use the strongest color contrast where you want the viewer\'s eye to go',
      'Squint at your reference photo -- it helps you see the big shapes without getting lost in details',
      'Leave a few gaps and light spots inside the subject to keep it from looking flat',
    ],
  };
}

function buildRound5(analysis, config) {
  const { hasReflection, regionBounds, height, width } = analysis;
  const colors = colorsForRegions(analysis, config.coverageRegions, 3);

  let instruction;
  if (hasReflection) {
    instruction =
      `This area below the horizon contains a reflection (water or wet surface). ` +
      `Wet the reflection zone lightly, then mirror the colors from above the horizon ` +
      `but shift them slightly cooler and darker. Use ${colorNames(colors)} with ` +
      `horizontal strokes -- reflections are always more muted than what they mirror. ` +
      `Keep your brush moving in flat, side-to-side motions.`;
  } else {
    instruction =
      `Work the lower ground area with ${colorNames(colors)}. Paint the terrain, ` +
      `ground texture, or whatever occupies the bottom portion of the scene. Use ` +
      `varied strokes -- some horizontal for flat ground, some following the contours ` +
      `of slopes or edges you see.`;
  }

  return {
    roundIndex: 5,
    title: 'Step 6: Reflection & Water',
    timing: hasReflection ? 'Wet-on-wet' : 'Wet-on-dry',
    brush: hasReflection ? 'Large flat brush' : 'Medium round brush (size 8-10)',
    colors,
    instruction,
    tips: hasReflection
      ? [
          'Reflections are always darker and cooler than the sky above -- add a touch more blue',
          'Use long horizontal strokes -- water never reflects in vertical lines',
          'While the wash is damp, drag a clean dry brush sideways to create subtle ripple effects',
        ]
      : [
          'Vary your colors within the ground area -- real terrain is never one flat tone',
          'Let some earlier layers peek through to build depth',
          'Use the edge of your brush for sharper texture marks',
        ],
  };
}

function buildRound6(analysis, config) {
  const colors = colorsForRegions(analysis, config.coverageRegions, 2);

  return {
    roundIndex: 6,
    title: 'Step 7: Warm Accents',
    timing: 'Wet-on-dry',
    brush: 'Small round brush (size 4-6)',
    colors,
    instruction:
      `Switch to a small brush and use concentrated (less diluted) ${colorNames(colors)}. ` +
      `Look for areas that catch warm light -- sunlit edges, glowing patches, or anywhere ` +
      `that feels "golden." Place small, deliberate touches of warm color. These accents ` +
      `make the painting feel like it has real sunlight.`,
    tips: [
      'Use very little water -- you want rich, intense color for these marks',
      'Warm accents work best near the edges of shapes, where light would naturally catch',
      'A few well-placed warm spots are better than many -- resist the urge to overdo it',
    ],
  };
}

function buildRound7(analysis, config) {
  const colors = colorsForRegions(analysis, config.coverageRegions, 3);

  return {
    roundIndex: 7,
    title: 'Step 8: Scene Detail',
    timing: 'Dry brush',
    brush: 'Small rigger brush or old worn round brush (size 2-4)',
    colors,
    instruction:
      `Use the side of a nearly dry brush to add fine texture across the entire painting. ` +
      `Pick up ${colorNames(colors)} with just the tip, then drag the brush lightly so it ` +
      `skips across the paper texture. This creates a grainy, textured effect that adds ` +
      `depth everywhere -- tree bark, water shimmer, architectural details, grass, anything.`,
    tips: [
      '"Dry brush" means your brush has paint but very little water -- wipe it on a paper towel until it barely leaves marks',
      'Hold the brush almost flat against the paper and drag sideways for the best texture',
      'Work quickly with light pressure -- these marks should feel spontaneous, not careful',
    ],
  };
}

function buildRound8(analysis, config) {
  const colors = colorsForRegions(analysis, config.coverageRegions, 2);
  if (colors.length === 0) {
    colors.push({ name: "Payne's Gray", hex: '#383C4C', mix: null });
  }

  return {
    roundIndex: 8,
    title: 'Step 9: Deep Darks',
    timing: 'Wet-on-dry',
    brush: 'Small round brush (size 4-6)',
    colors,
    instruction:
      `Squint at your painting -- where are the darkest darks? Mix concentrated ` +
      `${colorNames(colors)} with very little water. Place these dark accents into ` +
      `shadows, under overhangs, at the base of objects, and anywhere contrast is ` +
      `strongest. These darks will make your lights look brighter by comparison.`,
    tips: [
      'Squinting blurs the details and helps you see only the darkest shapes',
      'Avoid using pure black -- mix your darks from two strong colors for richer shadows',
      'Place darks next to your lightest areas for maximum contrast and visual punch',
      'Less is more -- a few strong darks are better than dark marks everywhere',
    ],
  };
}

function buildRound9(analysis, config) {
  const colors = colorsForRegions(analysis, config.coverageRegions, 3);

  return {
    roundIndex: 9,
    title: 'Step 10: Final Highlights & Sparkle',
    timing: 'Dry brush',
    brush: 'Small rigger brush (size 0-2) and the corner of a flat brush',
    colors,
    instruction:
      `Step back and assess your painting from a distance. Use ${colorNames(colors)} ` +
      `for final pops of light and shadow. Add tiny bright highlights where light hits ` +
      `the sharpest edges -- the tip of a mast, the crest of a wave, a sunlit rooftop ` +
      `edge. Then add the last deep accents in the very darkest crevices. These extreme ` +
      `values give the painting its finished sparkle.`,
    tips: [
      'For bright highlights on dark areas, try using a bit of opaque white (Chinese White) or leave the paper bare',
      'Use the very tip of a rigger brush for fine lines and tiny dots',
      'This is your last chance to adjust -- fix anything that feels off before signing',
      'Stop before you think you are done -- overworking at this stage can flatten the painting',
    ],
  };
}

// -------------------------------------------------------------------
// Round builder dispatch
// -------------------------------------------------------------------

const ROUND_BUILDERS = [
  buildRound0,
  buildRound1,
  buildRound2,
  buildRound3,
  buildRound4,
  buildRound5,
  buildRound6,
  buildRound7,
  buildRound8,
  buildRound9,
];

// -------------------------------------------------------------------
// Main export
// -------------------------------------------------------------------

/**
 * Generate beginner-friendly painting instructions from analysis data.
 *
 * @param {object} analysis - The return value of analyzeImage()
 * @param {object[]} roundConfigs - The ROUND_CONFIGS array from generateMarks.js
 * @returns {object[]} Array of instruction objects, one per round.
 */
export function generateInstructions(analysis, roundConfigs) {
  const results = [];

  for (let i = 0; i < roundConfigs.length; i++) {
    const builder = ROUND_BUILDERS[i];
    if (!builder) break;

    const instruction = builder(analysis, roundConfigs[i]);
    results.push(instruction);
  }

  return results;
}
