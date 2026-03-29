// Watercolor Pigment Lookup Table
// Standard sRGB -> XYZ -> CIELAB conversion with D65 illuminant

// ---- RGB to LAB conversion ----

export function rgbToLab(r, g, b) {
  // Normalize sRGB to [0,1]
  let rr = r / 255;
  let gg = g / 255;
  let bb = b / 255;

  // Linearize (inverse sRGB companding)
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;

  // sRGB -> XYZ (D65)
  let x = rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375;
  let y = rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750;
  let z = rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041;

  // D65 reference white
  x /= 0.95047;
  y /= 1.00000;
  z /= 1.08883;

  // XYZ -> LAB
  const epsilon = 0.008856;
  const kappa = 903.3;
  x = x > epsilon ? Math.cbrt(x) : (kappa * x + 16) / 116;
  y = y > epsilon ? Math.cbrt(y) : (kappa * y + 16) / 116;
  z = z > epsilon ? Math.cbrt(z) : (kappa * z + 16) / 116;

  const L = 116 * y - 16;
  const a = 500 * (x - y);
  const bVal = 200 * (y - z);

  return [Math.round(L * 100) / 100, Math.round(a * 100) / 100, Math.round(bVal * 100) / 100];
}

// ---- Pigment data ----
// RGB values represent medium-dilution washes on white paper.
// LAB values are precomputed from the RGB using rgbToLab.

function p(name, pigmentCode, rgb, transparent, granulating, staining) {
  const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
  return { name, pigmentCode, rgb, lab, transparent, granulating, staining };
}

export const PIGMENTS = [
  // ---- Yellows ----
  p("Cadmium Yellow Light",    "PY35",   [255, 234, 84],  false, false, false),
  p("Cadmium Yellow",          "PY37",   [255, 214, 0],   false, false, false),
  p("Hansa Yellow Light",      "PY3",    [252, 236, 100], true,  false, true),
  p("Hansa Yellow Medium",     "PY97",   [248, 220, 52],  true,  false, true),
  p("Yellow Ochre",            "PY43",   [210, 176, 80],  false, true,  false),
  p("Raw Sienna",              "PBr7",   [196, 154, 72],  true,  true,  false),
  p("Quinacridone Gold",       "PO49",   [212, 162, 48],  true,  false, true),
  p("Indian Yellow",           "PY150",  [236, 190, 44],  true,  false, true),
  p("Naples Yellow",           "PY41",   [246, 218, 148], false, false, false),
  p("Aureolin",                "PY40",   [253, 232, 78],  true,  false, false),
  p("Bismuth Yellow",          "PY184",  [248, 224, 68],  false, false, false),
  p("Nickel Azo Yellow",       "PY150",  [220, 186, 40],  true,  false, true),
  p("Gold Ochre",              "PY42",   [200, 164, 60],  false, true,  false),

  // ---- Oranges ----
  p("Cadmium Orange",          "PO20",   [238, 142, 32],  false, false, false),
  p("Transparent Orange",      "PO71",   [232, 132, 40],  true,  false, true),
  p("Pyrrol Orange",           "PO73",   [240, 118, 28],  false, false, true),
  p("Perinone Orange",         "PO43",   [226, 124, 44],  true,  false, true),

  // ---- Reds ----
  p("Cadmium Red",             "PR108",  [210, 46, 36],   false, false, false),
  p("Cadmium Red Light",       "PR108",  [228, 62, 38],   false, false, false),
  p("Alizarin Crimson",        "PR83",   [180, 32, 54],   true,  false, true),
  p("Quinacridone Rose",       "PV19",   [206, 56, 96],   true,  false, true),
  p("Pyrrol Red",              "PR254",  [216, 42, 40],   false, false, true),
  p("Pyrrol Scarlet",          "PR255",  [226, 64, 36],   false, false, true),
  p("Venetian Red",            "PR101",  [164, 72, 52],   false, true,  false),
  p("Indian Red",              "PR101",  [148, 68, 60],   false, true,  false),
  p("Perylene Red",            "PR179",  [166, 36, 42],   true,  false, true),
  p("Naphthol Red",            "PR112",  [204, 48, 40],   false, false, true),

  // ---- Pinks / Magentas ----
  p("Opera Rose",              "PR122/BV10", [236, 84, 152], true,  false, true),
  p("Quinacridone Magenta",    "PR122",  [186, 42, 102],  true,  false, true),
  p("Permanent Rose",          "PV19",   [210, 64, 108],  true,  false, true),
  p("Quinacridone Pink",       "PV42",   [218, 80, 120],  true,  false, true),

  // ---- Violets ----
  p("Dioxazine Violet",        "PV23",   [88, 36, 108],   true,  false, true),
  p("Ultramarine Violet",      "PV15",   [108, 64, 132],  true,  true,  false),
  p("Quinacridone Violet",     "PV19",   [142, 40, 88],   true,  false, true),
  p("Cobalt Violet",           "PV14",   [142, 72, 148],  true,  true,  false),
  p("Mineral Violet",          "PV16",   [124, 80, 128],  false, true,  false),

  // ---- Blues ----
  p("Ultramarine Blue",        "PB29",   [46, 52, 152],   true,  true,  false),
  p("Cobalt Blue",             "PB28",   [36, 88, 176],   true,  true,  false),
  p("Cerulean Blue",           "PB35",   [52, 132, 192],  false, true,  false),
  p("Phthalo Blue (GS)",       "PB15:3", [16, 52, 148],   true,  false, true),
  p("Phthalo Blue (RS)",       "PB15:1", [28, 48, 118],   true,  false, true),
  p("Prussian Blue",           "PB27",   [24, 52, 92],    true,  false, true),
  p("Indanthrone Blue",        "PB60",   [40, 48, 108],   true,  false, true),
  p("French Ultramarine",      "PB29",   [38, 44, 148],   true,  true,  false),
  p("Manganese Blue",          "PB33",   [56, 148, 206],  true,  true,  false),
  p("Cobalt Turquoise",        "PB36",   [48, 148, 172],  true,  true,  false),

  // ---- Greens ----
  p("Viridian",                "PG18",   [36, 120, 100],  true,  true,  false),
  p("Phthalo Green (BS)",      "PG7",    [16, 92, 84],    true,  false, true),
  p("Phthalo Green (YS)",      "PG36",   [20, 128, 76],   true,  false, true),
  p("Sap Green",               "PG36/PY150", [88, 132, 48], true, false, true),
  p("Hooker's Green",          "PG36/PY150", [56, 104, 52], true,  false, true),
  p("Chromium Oxide Green",    "PG17",   [88, 120, 76],   false, true,  false),
  p("Terre Verte",             "PG23",   [108, 132, 100], true,  true,  false),
  p("Cobalt Green",            "PG50",   [60, 160, 120],  true,  true,  false),
  p("Perylene Green",          "PBk31",  [40, 68, 52],    true,  false, true),
  p("Cascade Green",           "PG7/PY150", [68, 148, 104], true, false, true),
  p("Olive Green",             "PY150/PG7", [108, 116, 48], true, false, true),

  // ---- Earth tones ----
  p("Burnt Sienna",            "PBr7",   [164, 88, 40],   true,  true,  false),
  p("Burnt Umber",             "PBr7",   [120, 72, 40],   true,  true,  false),
  p("Raw Umber",               "PBr7",   [136, 112, 72],  true,  true,  false),
  p("Sepia",                   "PBr7",   [88, 56, 36],    true,  true,  false),
  p("Van Dyke Brown",          "PBr7",   [76, 48, 32],    true,  false, true),
  p("Transparent Brown Oxide", "PR101",  [144, 80, 36],   true,  true,  false),
  p("Transparent Red Oxide",   "PR101",  [172, 84, 36],   true,  false, false),
  p("English Red",             "PR101",  [160, 76, 56],   false, true,  false),
  p("Caput Mortuum",           "PR101",  [120, 52, 48],   false, true,  false),

  // ---- Neutrals / Blacks / Whites ----
  p("Payne's Gray",            "PB29/PBk7", [56, 60, 76],  true,  false, true),
  p("Davy's Gray",             "PBk19",  [128, 128, 116], false, true,  false),
  p("Neutral Tint",            "PBk6/PV19", [68, 64, 76],  true,  false, true),
  p("Ivory Black",             "PBk9",   [36, 32, 32],    false, false, false),
  p("Lamp Black",              "PBk6",   [40, 40, 40],    false, false, true),
  p("Mars Black",              "PBk11",  [44, 40, 38],    false, true,  false),
  p("Chinese White",           "PW4",    [240, 240, 238], false, false, false),
  p("Titanium White",          "PW6",    [248, 248, 246], false, false, false),

  // ---- Additional spectrum fillers ----
  p("Cobalt Teal Blue",        "PG50",   [52, 162, 168],  true,  true,  false),
  p("Potter's Pink",           "PR233",  [186, 132, 124], false, true,  false),
  p("Jaune Brillant",          "PY216",  [244, 212, 108], false, false, false),
  p("Quinacridone Coral",      "PR209",  [210, 88, 72],   true,  false, true),
  p("Sleeping Beauty Turquoise","PG50/PB28", [64, 164, 180], true, true, false),
];

// ---- Delta E (CIE76) ----

function deltaE(lab1, lab2) {
  const dL = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

// ---- Nearest pigment finder ----

export function findNearestPigment(r, g, b) {
  const lab = rgbToLab(r, g, b);
  let best = null;
  let bestDist = Infinity;

  for (const pigment of PIGMENTS) {
    const dist = deltaE(lab, pigment.lab);
    if (dist < bestDist) {
      bestDist = dist;
      best = pigment;
    }
  }

  return { pigment: best, distance: Math.round(bestDist * 100) / 100 };
}

// ---- Top N pigments finder ----

export function findNearestPigments(r, g, b, n = 3) {
  const lab = rgbToLab(r, g, b);

  const results = PIGMENTS.map(pigment => ({
    pigment,
    distance: Math.round(deltaE(lab, pigment.lab) * 100) / 100,
  }));

  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, n);
}

// ---- Mix recipe suggestion ----

export function suggestMix(r, g, b) {
  const targetLab = rgbToLab(r, g, b);
  const nearest = findNearestPigment(r, g, b);

  // Close enough -- single pigment will do
  if (nearest.distance < 15) {
    return { primary: nearest.pigment };
  }

  // Try all pairs and find the combination whose midpoint LAB
  // is closest to the target. We test ratios 30/70, 50/50, 70/30.
  const ratios = [
    { w1: 0.3, w2: 0.7, label: "1:2" },
    { w1: 0.5, w2: 0.5, label: "1:1" },
    { w1: 0.7, w2: 0.3, label: "2:1" },
  ];

  let bestPair = null;
  let bestDist = Infinity;
  let bestRatio = null;

  for (let i = 0; i < PIGMENTS.length; i++) {
    const pA = PIGMENTS[i];
    for (let j = i + 1; j < PIGMENTS.length; j++) {
      const pB = PIGMENTS[j];

      for (const { w1, w2, label } of ratios) {
        const mixLab = [
          pA.lab[0] * w1 + pB.lab[0] * w2,
          pA.lab[1] * w1 + pB.lab[1] * w2,
          pA.lab[2] * w1 + pB.lab[2] * w2,
        ];
        const dist = deltaE(targetLab, mixLab);
        if (dist < bestDist) {
          bestDist = dist;
          bestPair = [pA, pB];
          bestRatio = label;
        }
      }
    }
  }

  if (bestPair) {
    return {
      primary: bestPair[0],
      secondary: bestPair[1],
      ratio: bestRatio,
    };
  }

  // Fallback: just return the nearest single pigment
  return { primary: nearest.pigment };
}
