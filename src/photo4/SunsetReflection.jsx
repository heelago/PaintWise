import { useState } from "react";
import DryBrushReconstructionSR from "./DryBrushReconstructionSR";
import TraceTab from "../TraceTab";

// ═══════════════════════════════════════════════
// DATA — Sunset Reflection · Reading Power Station
// ═══════════════════════════════════════════════

const PALETTE = [
  { name: "Paper White", hex: "#F5F0E6", mix: "Leave paper bare", use: "Hottest highlight in the sunset glow, brightest promenade light reflections, cloud edges catching last light" },
  { name: "Sunset Gold", hex: "#E8A030", mix: "Cadmium yellow + cadmium orange (rich)", use: "Intense sunset glow on the right side of sky and its reflection in the wet sand" },
  { name: "Warm Orange", hex: "#D07030", mix: "Cadmium orange + touch of burnt sienna", use: "Deeper sunset tones in clouds, promenade light glow, warm accents in the reflection" },
  { name: "Twilight Blue", hex: "#5A6A80", mix: "Ultramarine + Payne's grey + touch of cerulean", use: "Cool left side of sky, upper cloud tops, the cooler half of the gradient" },
  { name: "Cloud Grey", hex: "#8A8898", mix: "Ultramarine + burnt umber + lots of water", use: "Cloud masses — neutral base before warm/cool light hits them" },
  { name: "Chimney Dark", hex: "#4A4240", mix: "Payne's grey + burnt umber (concentrated)", use: "Power station chimney silhouette — the dominant vertical in both real and reflected scene" },
  { name: "Building Grey", hex: "#B8B0A8", mix: "Payne's grey + yellow ochre + lots of water", use: "Industrial buildings, power station structures — pale silhouettes against the sky" },
  { name: "Palm Silhouette", hex: "#3A4838", mix: "Sap green + Payne's grey + burnt umber", use: "Palm trees along the shoreline — dark shapes against the twilight sky" },
  { name: "Light Yellow", hex: "#F0D060", mix: "Cadmium yellow + touch of white gouache", use: "Promenade lights — the string of bright dots along the shore, and their vertical streak reflections" },
  { name: "Wet Sand Dark", hex: "#2A2420", mix: "Burnt umber + ultramarine + Payne's grey (very concentrated)", use: "Dark wet sand in the foreground — the darkest value in the painting" },
  { name: "Reflection Mute", hex: "#6A7080", mix: "Cerulean blue + burnt sienna + Payne's grey", use: "Tinting color for all reflections — mixed into every hue used in the lower half to darken and cool" },
  { name: "Lens Flare", hex: "#70C060", mix: "Sap green + cadmium yellow (optional accent)", use: "The green lens flare near shore center — a tiny deliberate mark or omit entirely" },
];

const PAINT_LAYERS = [
  {
    num: 1, title: "Sky Gradient — Warm to Cool", subtitle: "The dramatic twilight sky across the upper 40%", timing: "Wet-on-wet",
    colors: ["Sunset Gold", "Warm Orange", "Twilight Blue", "Cloud Grey"],
    description: "Wet the entire upper portion of your paper (top 40%). Starting from the RIGHT edge, lay a rich wash of Sunset Gold transitioning to Warm Orange — this is where the sun has just set. While still wet, bring in Twilight Blue from the LEFT side, letting the two temperatures meet and blend somewhere around center-left. The transition should be gradual, not a hard edge. Leave some paper dry where the brightest cloud edges will be. The sky is dramatic here — darker than golden hour, with real contrast between the warm and cool sides. Work quickly; this gradient must happen while the paper is uniformly wet.",
    shapes: "A horizontal gradient field: warm gold-orange on the right, cool blue-grey on the left, blending through the middle.",
  },
  {
    num: 2, title: "Cloud Masses", subtitle: "Scattered clouds catching warm and cool light", timing: "Wet-on-wet into Layer 1",
    colors: ["Cloud Grey", "Warm Orange", "Twilight Blue"],
    description: "While the sky wash is still damp, drop in cloud shapes using Cloud Grey as the base. The clouds are scattered across the entire sky. On their UNDERSIDES (bottom edges), touch in Warm Orange — the sunset light is hitting them from below and to the right. On their TOPS (upper edges), the clouds are cooler — let the Twilight Blue from the sky wash blend into them naturally. The clouds on the RIGHT side of the sky are warmer overall; clouds on the LEFT are cooler and darker. Don't overdefine them — let the wet paper do the blending. You want atmospheric softness, not cartoon clouds.",
    shapes: "Scattered organic cloud shapes across the sky. Warmer and brighter on the right, cooler and darker on the left.",
  },
  {
    num: 3, title: "Shore Band — Buildings & Chimney", subtitle: "The Reading Power Station silhouette across the center", timing: "Wet-on-dry",
    colors: ["Chimney Dark", "Building Grey", "Palm Silhouette"],
    description: "Once the sky is fully dry, paint the shore band — the center strip (about 15% of height). The CHIMNEY is the dominant element: a tall narrow vertical slightly left of center, painted in Chimney Dark. Keep it straight and decisive — one stroke. The white/grey industrial buildings cluster around its base, extending across the middle in Building Grey. These are simplified rectangular shapes — not detailed architecture. Palm trees are scattered along the shoreline, mostly on the left and center — paint them as dark silhouettes in Palm Silhouette. The power line tower on the right is a thin skeletal shape. Keep all these elements as simplified silhouettes — at this distance and in this light, detail is lost.",
    shapes: "Chimney: tall narrow rectangle, slightly left of center. Buildings: low rectangular cluster. Palms: dark vertical shapes with canopy masses. Power tower: thin lattice shape on right.",
  },
  {
    num: 4, title: "Promenade Lights", subtitle: "The string of bright yellow-orange dots along the shore", timing: "Wet-on-dry, small brush",
    colors: ["Light Yellow", "Warm Orange"],
    description: "Along the shoreline, there's a string of promenade lights — bright warm dots running horizontally. These are CRUCIAL atmospheric elements. Using a small round brush, place dots of Light Yellow along the shore line at regular intervals. Each dot should glow — start with a concentrated dot, then while wet, touch the edges with a barely-damp clean brush to soften the glow outward. Some lights are brighter (closer to viewer), some dimmer (further away). Add a tiny ring of Warm Orange around each bright dot for the glow halo. These artificial lights are what tell us this is twilight, not golden hour — the city lights have come on.",
    shapes: "A string of bright warm dots running horizontally along the shoreline, evenly spaced but varying in brightness.",
  },
  {
    num: 5, title: "Reflection — Buildings & Chimney", subtitle: "The inverted mirror world in wet sand", timing: "Wet-on-dry",
    colors: ["Chimney Dark", "Building Grey", "Palm Silhouette", "Reflection Mute"],
    description: "Below the shore band, begin the reflection. The wet sand creates a near-perfect mirror — everything above is reflected below, inverted. Start with the chimney reflection: it drops straight down from the real chimney, same width, same position, but slightly darker — mix a touch of Reflection Mute into your Chimney Dark. The buildings reflect as a muted band of Building Grey + Reflection Mute. Palm trees reflect as inverted dark shapes. The reflections should be positioned so they are the EXACT mirror of the real elements — same distance below the shore line as the real elements are above it. Keep edges slightly softer than the real scene — the wet sand surface isn't glass-perfect.",
    shapes: "Inverted copies of chimney, buildings, and palms hanging down from the shore line. Same positions, slightly muted and softer.",
  },
  {
    num: 6, title: "Reflected Sky & Clouds", subtitle: "The warm-cool gradient mirrored in wet sand", timing: "Wet-on-wet",
    colors: ["Sunset Gold", "Twilight Blue", "Cloud Grey", "Reflection Mute"],
    description: "The large area below the reflected buildings shows the reflected sky — this is the biggest area of the painting's lower half. Wet this zone and lay in the same gradient as the sky above: Sunset Gold on the RIGHT, Twilight Blue on the LEFT. But mix Reflection Mute into every color — the reflection is about 15-20% darker and cooler than the real sky. The reflected clouds are softer and less defined. The warm sunset glow reflecting on the right side of the water is gorgeous — don't hold back on the gold, but keep it muted relative to the sky above. This reflected sky is what makes the wet sand read as a mirror surface.",
    shapes: "A warm-to-cool gradient mirroring the sky, with soft reflected cloud shapes. Darker and cooler than the real sky above.",
  },
  {
    num: 7, title: "Light Reflections in Water", subtitle: "Vertical streaks from the promenade lights", timing: "Wet-on-dry, careful",
    colors: ["Light Yellow", "Warm Orange"],
    description: "The promenade lights don't just appear as dots in the shore band — they reflect as bright VERTICAL STREAKS in the wet sand below. Using a small brush loaded with Light Yellow, pull thin vertical strokes downward from each light dot's position. These streaks should be slightly wobbly — the wet sand surface has micro-undulations that stretch the reflections vertically. The streaks are brightest just below the shore line and fade as they extend downward. Some streaks are longer than others. Add a warm glow of dilute Warm Orange beside the brightest streaks. These light reflections are iconic to this image — they're what gives the wet sand its magic.",
    shapes: "Thin vertical bright streaks dropping from each promenade light position, fading downward. Slightly wobbly, warm-toned.",
  },
  {
    num: 8, title: "Dark Foreground & Final Details", subtitle: "Wet sand, value deepening, and finishing", timing: "Wet-on-dry, selective",
    colors: ["Wet Sand Dark", "Sunset Gold", "Chimney Dark", "Lens Flare"],
    description: "The foreground (closest to the viewer) is very dark wet sand — the darkest area of the painting. Lay a concentrated wash of Wet Sand Dark across the bottom edge, grading it from darkest at the very bottom to slightly lighter as it meets the reflected scene. This dark base grounds the entire composition. Now step back and assess: deepen any darks that need it — the chimney silhouette, the reflected chimney. Warm up the sunset glow if it's not dramatic enough. If you want the green lens flare, dab a tiny mark of Lens Flare near the shore center — or skip it entirely for a cleaner painting. Lift highlights on the water where it catches the brightest reflected light with a clean damp brush. Then STOP.",
    shapes: "Dark wet sand strip at bottom. Value deepening throughout. Optional lens flare mark. Lifted highlights on water surface.",
  },
];

const COMP_SHAPES = [
  { name: "Sky Gradient Field", description: "The upper 40% — a dramatic warm-to-cool gradient with golden-orange sunset glow on the RIGHT transitioning to blue-grey on the LEFT", tip: "This gradient is the emotional core of the painting. Get it right and everything else falls into place. The transition zone should be gradual — no hard boundaries.", icon: "◐" },
  { name: "Cloud Shapes", description: "Scattered clouds across the sky catching warm light on their undersides and cool blue-grey on their tops", tip: "Clouds on the right are warmer, clouds on the left are cooler. Let the wet sky wash do the blending — don't overwork individual cloud shapes.", icon: "☁" },
  { name: "Buildings & Chimney", description: "The Reading Power Station — tall chimney slightly left of center, industrial buildings clustered at its base, palm trees along the shore, power tower on the right", tip: "The chimney is the tallest element and the anchor of the composition. Paint it as ONE confident stroke. Buildings are simple rectangles — don't detail them.", icon: "▌" },
  { name: "Promenade Lights", description: "A string of bright yellow-orange dots running along the shoreline — artificial lights that signal twilight", tip: "These lights are crucial for the mood. They need to GLOW — concentrated dot with a soft halo. Space them somewhat evenly but vary the brightness.", icon: "●" },
  { name: "Shore/Horizon Band", description: "The thin dark band separating the real scene from the reflection — where land meets wet sand", tip: "This is the painting's equator, the mirror line. It's subtle but essential — a thin dark edge where all elements transition to their reflections.", icon: "—" },
  { name: "Reflected Buildings & Chimney", description: "Inverted reflections of the chimney, buildings, and palms in the wet sand — positioned directly below their real counterparts", tip: "Align precisely below the real elements. Mix Reflection Mute into every color. Keep edges slightly softer than the originals.", icon: "▐" },
  { name: "Light Reflections", description: "Vertical bright streaks in the wet sand below each promenade light — the lights stretching downward in the mirror surface", tip: "These are thin vertical strokes, slightly wobbly, brightest near the shore and fading downward. They're iconic to this image — don't skip them.", icon: "│" },
  { name: "Dark Foreground Sand", description: "The very bottom of the painting — dark wet sand that grounds the composition and provides the darkest value", tip: "This needs to be DARK — the strongest dark in the painting. It's what gives depth and grounds the dreamy reflected world above it.", icon: "▓" },
];

const STROKES = [
  { name: "Sky Gradient Wash", where: "Layer 1 — upper sky area", brush: "1\" flat brush", how: "Pre-wet the entire sky zone evenly. Load one corner of the flat brush with Sunset Gold, the other with Twilight Blue. Starting from the right, sweep horizontally with the gold side leading. As you work leftward, rotate the brush so the blue side takes over. Overlap each pass slightly. The middle should blend naturally. Work fast — you need the paper uniformly wet for a smooth gradient. One pass is ideal; a second pass risks muddiness.", pressure: "Even, medium — let the water and gravity do the blending" },
  { name: "Cloud Drop-In", where: "Layer 2 — into wet sky", brush: "¾\" round or mop brush", how: "While the sky wash is still glistening, load Cloud Grey on the brush tip. Touch the brush to the paper where you want cloud shapes — the pigment will bloom outward into the wet wash. For warm undersides, immediately touch the bottom edge of each cloud blob with a brush tip loaded with Warm Orange. The pigment will wick downward. Don't paint cloud shapes — place pigment and let water paint the clouds for you.", pressure: "Light touch — just kiss the wet surface and let capillary action spread the color" },
  { name: "Chimney Stroke", where: "Layer 3 — the dominant vertical", brush: "#4 round or small flat", how: "Load Chimney Dark at full concentration. Starting at the base (shore line level), pull one decisive vertical stroke upward. Keep it narrow and straight. The chimney is the single most important shape in the composition — it must read as a confident, strong vertical. Don't go back to fix it. For the reflected chimney in Layer 5, pull a matching stroke DOWNWARD from the shore line — same width, same position, just inverted.", pressure: "Firm and steady — no wobble, moderate speed" },
  { name: "Building Silhouettes", where: "Layer 3 — industrial buildings", brush: "½\" flat brush", how: "Load Building Grey and lay the buildings as simple rectangular shapes along the shore band. Use the flat edge of the brush for clean horizontal and vertical lines. The buildings are low and clustered — don't make them too tall relative to the chimney. Leave tiny gaps between buildings for sky showing through. The palm trees are small dabs of Palm Silhouette — use the corner of the flat brush to tap canopy shapes, then drag down for trunks.", pressure: "Medium, using the brush's flat edge for architectural shapes" },
  { name: "Light Dots", where: "Layer 4 — promenade lights", brush: "Your smallest round brush, tip loaded", how: "Load Light Yellow at FULL concentration — these dots need to be the brightest marks in the painting. Touch the brush tip to the paper for each light, leaving a small intense dot. While each dot is wet, touch its edges with a barely-damp clean brush to create a soft glow halo. Space the lights along the shore at roughly even intervals — about 15-20 lights visible. Vary the size slightly: larger for closer lights, smaller for distant ones. A tiny ring of Warm Orange around the brightest dots adds glow.", pressure: "Just the tip — tap and lift for each dot" },
  { name: "Reflection Wash", where: "Layer 6 — reflected sky in wet sand", brush: "¾\" flat brush", how: "Wet the reflected sky zone. Mix every sky color with a touch of Reflection Mute before applying. Lay the same gradient as the real sky — gold on the right, blue on the left — but 15-20% darker overall. Work quickly with a single pass. The reflected clouds should echo the real ones but be less defined — just vague cool patches in the warm wash. Don't try to match every cloud perfectly; an approximate mirror is more convincing than a labored copy.", pressure: "Even, slightly heavier pigment load than the real sky" },
  { name: "Light Streak Pull", where: "Layer 7 — vertical light reflections", brush: "#2 or #4 round brush", how: "Load Light Yellow and position your brush directly below each promenade light dot at the shore line. Pull straight down in one fluid motion — a thin vertical stroke about 2-4cm long. The stroke should be slightly wobbly (let your hand relax) because the wet sand surface isn't perfectly flat. The brightest streaks are directly below the brightest lights. Fade the streaks by lifting pressure as you pull downward. Don't make them all the same length — variety feels natural.", pressure: "Start firm, gradually lighten as you pull downward — taper off naturally" },
  { name: "Dark Foreground Lay", where: "Layer 8 — dark wet sand at bottom", brush: "1\" flat brush", how: "Load Wet Sand Dark at high concentration — this is the darkest value in the painting. Lay it across the bottom edge with smooth horizontal strokes. Grade it from DARKEST at the very bottom to slightly lighter as it transitions into the reflected scene above. Don't bring it up too high — just the bottom 10-15% of the painting. This dark base is essential for contrast: without it, the luminous reflected sky above won't pop. One to two even passes, no streaks.", pressure: "Firm and even — full coverage, no paper grain showing" },
  { name: "Highlight Lift", where: "Layer 8 — final water highlights", brush: "Clean damp ½\" flat brush", how: "After everything is fully dry, use a clean damp brush to lift pigment in thin horizontal strokes across the reflection zone. These lifted marks represent where the wet sand catches the brightest reflected light — they should be subtle, pale streaks. Focus on the area where the sunset glow reflects most strongly (right side of the reflection zone). Also soften any edges that feel too hard in the reflection. Then STOP. The mirror effect depends on restraint.", pressure: "Firm press, clean drag — you're removing paint, not adding it" },
];

const CONSTRUCTION_STAGES = [
  { id: "horizon-halves", name: "Horizon Line & Halves", description: "Draw a light pencil line across the paper at about 55% from the top — this is the shore/horizon line where the real scene meets its reflection. The upper portion (above the line) is slightly smaller than the lower portion because the sky is about 40% and the buildings 15%, while the reflection takes up the remaining 45% below. This horizontal line is the foundation of the entire composition. The real scene sits above it; the mirror world hangs below it. Mark these two zones clearly in your mind before touching paint to paper." },
  { id: "sky-gradient", name: "Sky Gradient Mapping", description: "The sky gradient runs HORIZONTALLY: warm golden-orange on the RIGHT side, transitioning to cool blue-grey on the LEFT side. Mark the right third of the sky zone as the 'warm zone' — this is where the sun has set. Mark the left third as the 'cool zone'. The center third is the transition. This warm-to-cool split is the KEY color relationship in the painting. It appears in the sky, AND it repeats in the reflection below. If you get this gradient right, the painting will have its essential character." },
  { id: "cloud-placement", name: "Cloud Placement", description: "Sketch light outlines for the main cloud masses across the sky. The clouds are scattered across the full width. Clouds on the RIGHT catch warm sunset light on their undersides — they'll be touched with orange-gold below and cool grey above. Clouds on the LEFT are predominantly cool blue-grey with less warm light. The clouds have varied sizes and organic shapes — no two alike. Leave clear sky gaps between cloud groups. The clouds continue into the reflected zone below, inverted and slightly muted." },
  { id: "chimney-buildings", name: "Chimney & Buildings", description: "The chimney is the DOMINANT VERTICAL — a tall narrow shape positioned slightly left of center. It rises from the building band up into the sky. Mark its position precisely, because its reflection must align perfectly below the shore line. The industrial buildings cluster around the chimney base as a band of low rectangular shapes. Palm trees are scattered along the shore — mostly left and center. A power line tower sits on the right side. These elements form a thin horizontal band (about 15% of the height) sitting just above the shore line." },
  { id: "light-positions", name: "Promenade Light Positions", description: "Along the shore line, mark positions for the promenade lights — roughly 15-20 dots spaced somewhat evenly across the width. These bright dots sit right at the junction between the buildings and the reflection zone. They're crucial both as elements in the real scene AND because they create the vertical streak reflections below. Mark each light position carefully — each one will need a corresponding vertical streak in the reflection zone. The lights are brightest in the center and slightly dimmer at the edges." },
  { id: "reflection-align", name: "Reflection Alignment", description: "Below the shore line, mark the reflected positions of every element. The chimney reflection drops straight down — its tip should be the same distance below the shore as the real chimney tip is above it. The building reflections form an inverted band. The palm reflections hang downward. Each promenade light gets a vertical streak extending downward. The reflected sky gradient mirrors the real sky: warm on the RIGHT, cool on the LEFT. The alignment must be precise — even small offsets will break the mirror illusion." },
  { id: "light-temperature", name: "Light Direction & Temperature", description: "The sunset is to the RIGHT, low on the horizon. This means: the right side of everything is warmer and brighter. The chimney's right edge catches warm light; its left edge is in shadow. Buildings facing right are warmer. Clouds on the right are lit from below with warm orange; clouds on the left are in twilight shadow. In the reflection, this light direction is PRESERVED — the right side of reflections is also warmer. The overall scene is DARKER than golden hour — this is late twilight, with artificial lights competing with the dying sunset." },
  { id: "value-map", name: "Value Map", description: "DARKEST: the foreground wet sand at the very bottom of the painting — nearly black. Also dark: the chimney silhouette, the shore line edge. LIGHTEST: the sunset glow in the sky (upper right), the promenade light dots, and their reflections. MID-TONES: the buildings, the cloud masses, the general reflected sky. The VALUE CONTRAST is strongest between the dark foreground sand and the luminous reflected sunset glow just above it — this transition from dark to light is what gives the painting its dramatic depth. Without the dark foreground, the reflection loses its magic." },
];

// ═══════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════

function SwatchDot({ hex, size = 32 }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: hex, border: "2px solid rgba(255,255,255,0.3)", boxShadow: "0 1px 4px rgba(0,0,0,0.2)", flexShrink: 0 }} />;
}

// ═══════════════════════════════════════════════
// COMPOSITION SVG SHAPES — Landscape orientation
// ═══════════════════════════════════════════════

const COMP_SVG = [
  // Sky gradient field (upper area)
  { id: "sky-gradient", color: "#E8A030", opacity: 0.3, paths: [
    { type: "rect", x: 400, y: 0, width: 400, height: 212, fill: "#E8A030", opacity: 0.25 },
    { type: "rect", x: 0, y: 0, width: 400, height: 212, fill: "#5A6A80", opacity: 0.2 },
    { type: "path", d: "M300,0 L500,0 L500,212 L300,212 Z", fill: "#9A7858", opacity: 0.12 },
  ]},
  // Cloud shapes
  { id: "clouds", color: "#8A8898", opacity: 0.4, paths: [
    { type: "ellipse", cx: 150, cy: 60, rx: 80, ry: 25 },
    { type: "ellipse", cx: 320, cy: 45, rx: 60, ry: 20 },
    { type: "ellipse", cx: 500, cy: 70, rx: 90, ry: 28 },
    { type: "ellipse", cx: 670, cy: 50, rx: 70, ry: 22 },
    { type: "ellipse", cx: 250, cy: 110, rx: 55, ry: 18 },
    { type: "ellipse", cx: 580, cy: 120, rx: 65, ry: 20 },
    { type: "ellipse", cx: 100, cy: 140, rx: 50, ry: 16 },
    { type: "ellipse", cx: 720, cy: 130, rx: 60, ry: 18 },
  ]},
  // Buildings & chimney silhouette
  { id: "buildings-chimney", color: "#4A4240", opacity: 0.55, paths: [
    // Chimney (tall, slightly left of center)
    { type: "rect", x: 340, y: 115, width: 12, height: 100, fill: "#4A4240" },
    { type: "rect", x: 337, y: 110, width: 18, height: 10, fill: "#4A4240" },
    // Buildings clustered around chimney base
    { type: "rect", x: 280, y: 195, width: 240, height: 25, fill: "#B8B0A8" },
    { type: "rect", x: 310, y: 180, width: 70, height: 40, fill: "#B8B0A8" },
    { type: "rect", x: 400, y: 185, width: 50, height: 35, fill: "#B8B0A8" },
    { type: "rect", x: 470, y: 190, width: 60, height: 30, fill: "#B8B0A8" },
    // More buildings extending right
    { type: "rect", x: 540, y: 195, width: 80, height: 25, fill: "#B8B0A8" },
    { type: "rect", x: 640, y: 198, width: 60, height: 22, fill: "#B8B0A8" },
    // Palm trees
    { type: "line", x1: 140, y1: 215, x2: 145, y2: 150, sw: 3 },
    { type: "line", x1: 190, y1: 215, x2: 188, y2: 160, sw: 2.5 },
    { type: "line", x1: 240, y1: 215, x2: 242, y2: 155, sw: 2.5 },
    { type: "line", x1: 430, y1: 215, x2: 432, y2: 165, sw: 2 },
    { type: "ellipse", cx: 145, cy: 142, rx: 22, ry: 14 },
    { type: "ellipse", cx: 188, cy: 152, rx: 20, ry: 12 },
    { type: "ellipse", cx: 242, cy: 148, rx: 18, ry: 11 },
    { type: "ellipse", cx: 432, cy: 158, rx: 16, ry: 10 },
    // Power line tower (right side)
    { type: "line", x1: 710, y1: 215, x2: 715, y2: 150, sw: 2 },
    { type: "line", x1: 700, y1: 170, x2: 730, y2: 170, sw: 1.5 },
    { type: "line", x1: 703, y1: 185, x2: 727, y2: 185, sw: 1 },
  ]},
  // Promenade lights (dots along shore)
  { id: "promenade-lights", color: "#F0D060", opacity: 0.85, paths: [
    { type: "ellipse", cx: 160, cy: 218, rx: 3, ry: 3 },
    { type: "ellipse", cx: 210, cy: 218, rx: 3, ry: 3 },
    { type: "ellipse", cx: 260, cy: 218, rx: 3.5, ry: 3.5 },
    { type: "ellipse", cx: 310, cy: 218, rx: 3, ry: 3 },
    { type: "ellipse", cx: 360, cy: 218, rx: 3.5, ry: 3.5 },
    { type: "ellipse", cx: 410, cy: 218, rx: 3, ry: 3 },
    { type: "ellipse", cx: 455, cy: 218, rx: 3.5, ry: 3.5 },
    { type: "ellipse", cx: 500, cy: 218, rx: 3, ry: 3 },
    { type: "ellipse", cx: 545, cy: 218, rx: 3, ry: 3 },
    { type: "ellipse", cx: 590, cy: 218, rx: 2.5, ry: 2.5 },
    { type: "ellipse", cx: 635, cy: 218, rx: 2.5, ry: 2.5 },
    { type: "ellipse", cx: 675, cy: 218, rx: 2, ry: 2 },
  ]},
  // Shore/horizon band
  { id: "shore-band", color: "#2A2420", opacity: 0.5, paths: [
    { type: "path", d: "M0,212 C100,210 200,214 300,211 C400,213 500,210 600,213 C700,211 750,214 800,212 L800,225 C750,227 700,224 600,226 C500,224 400,227 300,225 C200,227 100,224 0,226 Z" },
  ]},
  // Reflection of buildings & chimney
  { id: "buildings-reflected", color: "#3A3838", opacity: 0.4, paths: [
    // Reflected chimney (inverted, hanging down)
    { type: "rect", x: 340, y: 225, width: 12, height: 95, fill: "#3A3838" },
    { type: "rect", x: 337, y: 315, width: 18, height: 10, fill: "#3A3838" },
    // Reflected buildings
    { type: "rect", x: 280, y: 225, width: 240, height: 22, fill: "#9A9490" },
    { type: "rect", x: 310, y: 225, width: 70, height: 35, fill: "#9A9490" },
    { type: "rect", x: 400, y: 225, width: 50, height: 30, fill: "#9A9490" },
    { type: "rect", x: 470, y: 225, width: 60, height: 26, fill: "#9A9490" },
    { type: "rect", x: 540, y: 225, width: 80, height: 22, fill: "#9A9490" },
    { type: "rect", x: 640, y: 225, width: 60, height: 20, fill: "#9A9490" },
    // Reflected palms (inverted)
    { type: "line", x1: 140, y1: 225, x2: 145, y2: 290, sw: 2.5 },
    { type: "line", x1: 190, y1: 225, x2: 188, y2: 280, sw: 2 },
    { type: "line", x1: 240, y1: 225, x2: 242, y2: 285, sw: 2 },
    { type: "line", x1: 430, y1: 225, x2: 432, y2: 275, sw: 1.5 },
    { type: "ellipse", cx: 145, cy: 298, rx: 20, ry: 12 },
    { type: "ellipse", cx: 188, cy: 288, rx: 18, ry: 10 },
    { type: "ellipse", cx: 242, cy: 292, rx: 16, ry: 10 },
    { type: "ellipse", cx: 432, cy: 282, rx: 14, ry: 8 },
  ]},
  // Light reflections (vertical streaks in water)
  { id: "light-streaks", color: "#F0D060", opacity: 0.6, paths: [
    { type: "line", x1: 160, y1: 225, x2: 160, y2: 320, sw: 1.5 },
    { type: "line", x1: 210, y1: 225, x2: 210, y2: 310, sw: 1.5 },
    { type: "line", x1: 260, y1: 225, x2: 261, y2: 330, sw: 1.8 },
    { type: "line", x1: 310, y1: 225, x2: 310, y2: 305, sw: 1.5 },
    { type: "line", x1: 360, y1: 225, x2: 361, y2: 335, sw: 1.8 },
    { type: "line", x1: 410, y1: 225, x2: 410, y2: 310, sw: 1.5 },
    { type: "line", x1: 455, y1: 225, x2: 456, y2: 340, sw: 1.8 },
    { type: "line", x1: 500, y1: 225, x2: 500, y2: 315, sw: 1.5 },
    { type: "line", x1: 545, y1: 225, x2: 545, y2: 300, sw: 1.3 },
    { type: "line", x1: 590, y1: 225, x2: 590, y2: 295, sw: 1.2 },
    { type: "line", x1: 635, y1: 225, x2: 635, y2: 290, sw: 1 },
    { type: "line", x1: 675, y1: 225, x2: 675, y2: 280, sw: 0.8 },
  ]},
  // Dark foreground wet sand
  { id: "foreground-sand", color: "#2A2420", opacity: 0.5, paths: [
    { type: "path", d: "M0,460 C100,455 200,462 300,458 C400,461 500,456 600,460 C700,457 750,462 800,458 L800,530 L0,530 Z" },
    { type: "rect", x: 0, y: 475, width: 800, height: 55, fill: "#1A1610", opacity: 0.4 },
  ]},
];

function renderCompPath(p, i, color, op) {
  const k = `${p.type}-${i}`;
  if (p.type === "rect") return <rect key={k} x={p.x} y={p.y} width={p.width} height={p.height} fill={p.fill || color} opacity={p.opacity || op} />;
  if (p.type === "path") return <path key={k} d={p.d} fill={p.fill || color} stroke={p.stroke || "none"} strokeWidth={p.sw || 0} opacity={p.opacity || op} />;
  if (p.type === "line") return <line key={k} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={color} strokeWidth={p.sw || 1.5} opacity={op} strokeLinecap="round" />;
  if (p.type === "ellipse") return <ellipse key={k} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill={color} opacity={op} />;
  return null;
}

// ═══════════════════════════════════════════════
// CONSTRUCTION SVG PARTS
// ═══════════════════════════════════════════════

function CStage1({ opacity }) {
  return <g opacity={opacity}>
    {/* Horizon/shore line */}
    <line x1="0" y1="218" x2="800" y2="218" stroke="#C69A5C" strokeWidth="1.2" strokeDasharray="8 4" />
    <text x="405" y="213" fill="#C69A5C" fontSize="9" fontFamily="'Crimson Text',serif" opacity="0.8" textAnchor="middle">shore / horizon line</text>
    {/* Upper half label */}
    <rect x="5" y="5" width="790" height="208" fill="none" stroke="#C69A5C" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.3" />
    <text x="790" y="110" fill="#C69A5C" fontSize="8" fontFamily="'Crimson Text',serif" opacity="0.6" textAnchor="end">REAL scene (~55%)</text>
    {/* Lower half label */}
    <rect x="5" y="225" width="790" height="300" fill="none" stroke="#8A9CAA" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.3" />
    <text x="790" y="380" fill="#8A9CAA" fontSize="8" fontFamily="'Crimson Text',serif" opacity="0.6" textAnchor="end">REFLECTED scene (~45%)</text>
    {/* Sky zone marker */}
    <line x1="0" y1="212" x2="800" y2="212" stroke="#C69A5C" strokeWidth="0.4" strokeDasharray="3 3" opacity="0.3" />
    <text x="790" y="20" fill="#C69A5C" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.4" textAnchor="end">sky (~40%)</text>
    {/* Foreground marker */}
    <line x1="0" y1="460" x2="800" y2="460" stroke="#2A2420" strokeWidth="0.4" strokeDasharray="3 3" opacity="0.3" />
    <text x="790" y="500" fill="#2A2420" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.5" textAnchor="end">dark foreground sand</text>
  </g>;
}

function CStage2({ opacity }) {
  return <g opacity={opacity}>
    {/* Warm zone (right side of sky) */}
    <rect x="500" y="0" width="300" height="212" fill="#E8A030" opacity="0.08" />
    <text x="650" y="30" fill="#E8A030" fontSize="9" fontFamily="'Crimson Text',serif" opacity="0.7">WARM — sunset glow</text>
    {/* Cool zone (left side of sky) */}
    <rect x="0" y="0" width="300" height="212" fill="#5A6A80" opacity="0.08" />
    <text x="20" y="30" fill="#5A6A80" fontSize="9" fontFamily="'Crimson Text',serif" opacity="0.7">COOL — twilight blue</text>
    {/* Transition zone */}
    <rect x="300" y="0" width="200" height="212" fill="none" stroke="#9A7858" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.3" />
    <text x="400" y="30" fill="#9A7858" fontSize="8" fontFamily="'Crimson Text',serif" opacity="0.5" textAnchor="middle">transition</text>
    {/* Gradient arrow */}
    <line x1="100" y1="195" x2="700" y2="195" stroke="#C69A5C" strokeWidth="0.6" opacity="0.4" />
    <line x1="690" y1="191" x2="700" y2="195" stroke="#C69A5C" strokeWidth="0.6" opacity="0.4" />
    <line x1="690" y1="199" x2="700" y2="195" stroke="#C69A5C" strokeWidth="0.6" opacity="0.4" />
    <text x="400" y="190" fill="#C69A5C" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.5" textAnchor="middle">cool → warm gradient direction</text>
  </g>;
}

function CStage3({ opacity }) {
  return <g opacity={opacity}>
    {/* Cloud shapes in sky */}
    <ellipse cx="150" cy="60" rx="80" ry="25" fill="none" stroke="#8A8898" strokeWidth="0.8" strokeDasharray="4 3" opacity="0.5" />
    <ellipse cx="320" cy="45" rx="60" ry="20" fill="none" stroke="#8A8898" strokeWidth="0.8" strokeDasharray="4 3" opacity="0.5" />
    <ellipse cx="500" cy="70" rx="90" ry="28" fill="none" stroke="#8A8898" strokeWidth="0.8" strokeDasharray="4 3" opacity="0.5" />
    <ellipse cx="670" cy="50" rx="70" ry="22" fill="none" stroke="#8A8898" strokeWidth="0.8" strokeDasharray="4 3" opacity="0.5" />
    <ellipse cx="250" cy="110" rx="55" ry="18" fill="none" stroke="#8A8898" strokeWidth="0.7" strokeDasharray="4 3" opacity="0.4" />
    <ellipse cx="580" cy="120" rx="65" ry="20" fill="none" stroke="#8A8898" strokeWidth="0.7" strokeDasharray="4 3" opacity="0.4" />
    {/* Warm underside indicators (right-side clouds) */}
    <line x1="460" y1="95" x2="540" y2="95" stroke="#E8A030" strokeWidth="1.5" opacity="0.4" />
    <text x="500" y="106" fill="#E8A030" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.5" textAnchor="middle">warm undersides</text>
    <line x1="630" y1="70" x2="710" y2="70" stroke="#E8A030" strokeWidth="1.5" opacity="0.4" />
    {/* Cool top indicators (left-side clouds) */}
    <line x1="110" y1="38" x2="190" y2="38" stroke="#5A6A80" strokeWidth="1.5" opacity="0.4" />
    <text x="150" y="50" fill="#5A6A80" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.5" textAnchor="middle">cool tops</text>
  </g>;
}

function CStage4({ opacity }) {
  return <g opacity={opacity}>
    {/* Real chimney */}
    <rect x="340" y="115" width="12" height="100" fill="none" stroke="#4A4240" strokeWidth="1" />
    <rect x="337" y="110" width="18" height="10" fill="none" stroke="#4A4240" strokeWidth="0.7" />
    <text x="365" y="165" fill="#4A4240" fontSize="8" fontFamily="'Crimson Text',serif" opacity="0.7">chimney</text>
    {/* Buildings band */}
    <rect x="280" y="195" width="240" height="25" fill="none" stroke="#B8B0A8" strokeWidth="0.6" />
    <rect x="540" y="195" width="160" height="25" fill="none" stroke="#B8B0A8" strokeWidth="0.5" />
    <text x="500" y="210" fill="#B8B0A8" fontSize="8" fontFamily="'Crimson Text',serif" opacity="0.6">buildings & infrastructure</text>
    {/* Palm trees */}
    <line x1="140" y1="215" x2="145" y2="150" stroke="#3A4838" strokeWidth="1" strokeDasharray="3 2" opacity="0.5" />
    <line x1="190" y1="215" x2="188" y2="160" stroke="#3A4838" strokeWidth="1" strokeDasharray="3 2" opacity="0.5" />
    <line x1="240" y1="215" x2="242" y2="155" stroke="#3A4838" strokeWidth="1" strokeDasharray="3 2" opacity="0.5" />
    <text x="120" y="145" fill="#3A4838" fontSize="8" fontFamily="'Crimson Text',serif" opacity="0.6">palms</text>
    {/* Power tower */}
    <line x1="710" y1="215" x2="715" y2="150" stroke="#4A4240" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.4" />
    <text x="720" y="145" fill="#4A4240" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.5">tower</text>
  </g>;
}

function CStage5({ opacity }) {
  return <g opacity={opacity}>
    {/* Promenade light dots */}
    {[160, 210, 260, 310, 360, 410, 455, 500, 545, 590, 635, 675].map((x, i) => (
      <g key={i}>
        <circle cx={x} cy={218} r={4 + (i < 6 ? 1 : 0)} fill="none" stroke="#F0D060" strokeWidth="0.6" opacity="0.6" />
        <circle cx={x} cy={218} r={1.5} fill="#F0D060" opacity="0.7" />
      </g>
    ))}
    <text x="400" y="235" fill="#F0D060" fontSize="8" fontFamily="'Crimson Text',serif" opacity="0.7" textAnchor="middle">promenade lights — bright warm dots along shore</text>
    {/* Vertical streak indicators */}
    {[160, 260, 360, 455, 545, 635].map((x, i) => (
      <line key={`streak-${i}`} x1={x} y1={225} x2={x} y2={260} stroke="#F0D060" strokeWidth="0.4" strokeDasharray="2 3" opacity="0.3" />
    ))}
    <text x="400" y="270" fill="#F0D060" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.4" textAnchor="middle">each light → vertical streak below</text>
  </g>;
}

function CStage6({ opacity }) {
  return <g opacity={opacity}>
    {/* Vertical alignment lines showing reflection precision */}
    <line x1="346" y1="110" x2="346" y2="325" stroke="#8A9CAA" strokeWidth="0.3" strokeDasharray="2 4" opacity="0.3" />
    <line x1="145" y1="142" x2="145" y2="298" stroke="#8A9CAA" strokeWidth="0.3" strokeDasharray="2 4" opacity="0.3" />
    <line x1="188" y1="152" x2="188" y2="288" stroke="#8A9CAA" strokeWidth="0.3" strokeDasharray="2 4" opacity="0.3" />
    {/* Distance annotations */}
    <line x1="50" y1="110" x2="50" y2="218" stroke="#C69A5C" strokeWidth="0.5" opacity="0.4" />
    <line x1="48" y1="110" x2="52" y2="110" stroke="#C69A5C" strokeWidth="0.5" opacity="0.4" />
    <line x1="48" y1="218" x2="52" y2="218" stroke="#C69A5C" strokeWidth="0.5" opacity="0.4" />
    <line x1="50" y1="218" x2="50" y2="326" stroke="#8A9CAA" strokeWidth="0.5" opacity="0.4" />
    <line x1="48" y1="326" x2="52" y2="326" stroke="#8A9CAA" strokeWidth="0.5" opacity="0.4" />
    <text x="30" y="165" fill="#C69A5C" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.5" textAnchor="middle" transform="rotate(-90,30,165)">equal distance</text>
    <text x="30" y="275" fill="#8A9CAA" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.5" textAnchor="middle" transform="rotate(-90,30,275)">equal distance</text>
    <text x="400" y="350" fill="#8A9CAA" fontSize="9" fontFamily="'Crimson Text',serif" opacity="0.6" textAnchor="middle">reflections are near-perfect — wet sand is still water</text>
    <text x="400" y="365" fill="#8A9CAA" fontSize="8" fontFamily="'Crimson Text',serif" opacity="0.5" textAnchor="middle">mute all reflected colors ~15-20% darker/cooler</text>
  </g>;
}

function CStage7({ opacity }) {
  return <g opacity={opacity}>
    {/* Sun position - right side, at horizon level */}
    <circle cx="790" cy="200" r="14" fill="none" stroke="#D49040" strokeWidth="0.8" opacity="0.5" />
    <text x="760" y="195" fill="#D49040" fontSize="8" fontFamily="'Crimson Text',serif" opacity="0.7">sun (just set)</text>
    {/* Light rays */}
    <line x1="790" y1="200" x2="150" y2="60" stroke="#D49040" strokeWidth="0.3" strokeDasharray="4 6" opacity="0.2" />
    <line x1="790" y1="200" x2="346" y2="115" stroke="#D49040" strokeWidth="0.3" strokeDasharray="4 6" opacity="0.2" />
    <line x1="790" y1="200" x2="400" y2="218" stroke="#D49040" strokeWidth="0.3" strokeDasharray="4 6" opacity="0.2" />
    {/* Warm zone right */}
    <rect x="600" y="0" width="200" height="530" fill="#D49040" opacity="0.04" />
    <text x="700" y="15" fill="#D49040" fontSize="8" fontFamily="'Crimson Text',serif" opacity="0.6">warmest</text>
    {/* Cool zone left */}
    <rect x="0" y="0" width="150" height="530" fill="#5A6A80" opacity="0.04" />
    <text x="20" y="15" fill="#5A6A80" fontSize="8" fontFamily="'Crimson Text',serif" opacity="0.5">coolest</text>
    <text x="400" y="525" fill="#D49040" fontSize="8" fontFamily="'Crimson Text',serif" opacity="0.5" textAnchor="middle">late twilight — sunset glow from the right, artificial lights along shore</text>
  </g>;
}

function CStage8({ opacity }) {
  return <g opacity={opacity}>
    {/* Lightest zones — sunset glow */}
    <rect x="550" y="10" width="220" height="80" fill="#E8A030" opacity="0.08" />
    <text x="660" y="55" fill="#E8A030" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.6" textAnchor="middle">lightest — sunset glow</text>
    {/* Light dots zone */}
    <rect x="130" y="210" width="570" height="16" fill="#F0D060" opacity="0.06" />
    <text x="415" y="208" fill="#F0D060" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.5" textAnchor="middle">bright — promenade lights</text>
    {/* Darkest zones — foreground sand */}
    <rect x="0" y="460" width="800" height="70" fill="#2A2420" opacity="0.12" />
    <text x="400" y="500" fill="#E8E4DF" fontSize="8" fontFamily="'Crimson Text',serif" opacity="0.6" textAnchor="middle">DARKEST — wet sand foreground</text>
    {/* Dark chimney zone */}
    <rect x="335" y="110" width="22" height="215" fill="#2A2420" opacity="0.06" />
    <text x="370" y="330" fill="#E8E4DF" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.4">dark chimney</text>
    {/* Mid-tone zones */}
    <text x="400" y="160" fill="#E8E4DF" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.4" textAnchor="middle">mid-tones — clouds, buildings, general reflected sky</text>
    {/* Key contrast annotation */}
    <line x1="400" y1="440" x2="400" y2="480" stroke="#C69A5C" strokeWidth="0.5" opacity="0.4" />
    <text x="400" y="435" fill="#C69A5C" fontSize="7" fontFamily="'Crimson Text',serif" opacity="0.5" textAnchor="middle">strongest contrast: luminous reflection meets dark sand</text>
  </g>;
}

// ═══════════════════════════════════════════════
// SECTION COMPONENTS
// ═══════════════════════════════════════════════

function PaintingLayers() {
  const [active, setActive] = useState(0);
  const cl = PAINT_LAYERS[active];
  return <div>
    <div style={{ display: "flex", gap: 6, marginBottom: 18, justifyContent: "center", flexWrap: "wrap" }}>
      {PAINT_LAYERS.map((l, i) => (
        <button key={i} onClick={() => setActive(i)} style={{ width: 38, height: 38, borderRadius: "50%", border: active===i?"2px solid #C69A5C":"1px solid rgba(232,228,223,0.15)", background: active===i?"rgba(198,154,92,0.2)":"rgba(232,228,223,0.05)", color: active===i?"#C69A5C":"rgba(232,228,223,0.5)", fontFamily: "'Playfair Display',Georgia,serif", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{l.num}</button>
      ))}
    </div>
    <div style={{ background: "rgba(232,228,223,0.03)", borderRadius: 12, border: "1px solid rgba(198,154,92,0.12)", padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 19, fontWeight: 400, fontFamily: "'Playfair Display',Georgia,serif" }}>{cl.title}</h3>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "rgba(232,228,223,0.5)", fontStyle: "italic" }}>{cl.subtitle}</p>
        </div>
        <span style={{ background: "rgba(198,154,92,0.15)", color: "#C69A5C", padding: "3px 10px", borderRadius: 20, fontSize: 10, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{cl.timing}</span>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {cl.colors.map(cn => { const c = PALETTE.find(p => p.name === cn); return c ? <div key={cn} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(0,0,0,0.2)", borderRadius: 20, padding: "2px 10px 2px 2px" }}><SwatchDot hex={c.hex} size={20} /><span style={{ fontSize: 11, color: "rgba(232,228,223,0.7)" }}>{c.name}</span></div> : null; })}
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.7, color: "rgba(232,228,223,0.85)", margin: "0 0 12px" }}>{cl.description}</p>
      <div style={{ background: "rgba(198,154,92,0.08)", borderLeft: "3px solid rgba(198,154,92,0.3)", padding: "8px 12px", borderRadius: "0 8px 8px 0", fontSize: 12, color: "rgba(232,228,223,0.6)", fontStyle: "italic" }}>
        <strong style={{ color: "#C69A5C", fontStyle: "normal" }}>What you're painting:</strong> {cl.shapes}
      </div>
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
      <button onClick={() => setActive(Math.max(0, active - 1))} disabled={active === 0} style={{ padding: "7px 14px", background: "rgba(232,228,223,0.05)", border: "1px solid rgba(232,228,223,0.1)", borderRadius: 8, color: active === 0 ? "rgba(232,228,223,0.2)" : "rgba(232,228,223,0.6)", cursor: active === 0 ? "default" : "pointer", fontFamily: "'Crimson Text',Georgia,serif", fontSize: 12 }}>← Previous</button>
      <button onClick={() => setActive(Math.min(PAINT_LAYERS.length - 1, active + 1))} disabled={active === PAINT_LAYERS.length - 1} style={{ padding: "7px 14px", background: active === PAINT_LAYERS.length - 1 ? "rgba(232,228,223,0.03)" : "rgba(198,154,92,0.15)", border: "1px solid rgba(198,154,92,0.2)", borderRadius: 8, color: active === PAINT_LAYERS.length - 1 ? "rgba(232,228,223,0.2)" : "#C69A5C", cursor: active === PAINT_LAYERS.length - 1 ? "default" : "pointer", fontFamily: "'Crimson Text',Georgia,serif", fontSize: 12 }}>Next Layer →</button>
    </div>
  </div>;
}

function PaletteView() {
  return <div>
    <p style={{ fontSize: 12, color: "rgba(232,228,223,0.45)", fontStyle: "italic", margin: "0 0 14px" }}>12 colors. Warm sunset dominance with cool twilight and dark wet sand anchoring.</p>
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {PALETTE.map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 12px", background: "rgba(232,228,223,0.03)", borderRadius: 10, border: "1px solid rgba(232,228,223,0.06)" }}>
          <SwatchDot hex={c.hex} size={34} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2, fontFamily: "'Playfair Display',Georgia,serif" }}>{c.name}</div>
            <div style={{ fontSize: 11, color: "#C69A5C", marginBottom: 2 }}>Mix: {c.mix}</div>
            <div style={{ fontSize: 11, color: "rgba(232,228,223,0.5)" }}>{c.use}</div>
          </div>
        </div>
      ))}
    </div>
    <div style={{ marginTop: 18, padding: 12, background: "rgba(198,154,92,0.08)", borderRadius: 10, border: "1px solid rgba(198,154,92,0.15)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#C69A5C", marginBottom: 5, fontFamily: "'Playfair Display',Georgia,serif" }}>Tube Paints You Need</div>
      <div style={{ fontSize: 12, lineHeight: 1.8, color: "rgba(232,228,223,0.7)" }}>Yellow Ochre · Cadmium Yellow · Cadmium Orange · Cadmium Red · Burnt Sienna · Burnt Umber · Sap Green · Cerulean Blue · Ultramarine Blue · Payne's Grey · White Gouache (optional)</div>
    </div>
  </div>;
}

function CompositionPlotter() {
  const [revealed, setRevealed] = useState(0);
  const labels = [null, {x:650,y:30}, {x:500,y:106}, {x:500,y:210}, {x:415,y:235}, {x:650,y:220}, {x:500,y:290}, {x:400,y:340}, {x:400,y:500}];
  const names = ["Sky Gradient","Clouds","Buildings & Chimney","Promenade Lights","Shore Band","Reflected Buildings","Light Streaks","Foreground Sand"];
  return <div>
    <p style={{ fontSize: 12, color: "rgba(232,228,223,0.45)", fontStyle: "italic", margin: "0 0 10px" }}>The scene in {COMP_SVG.length} shape layers. Step through to see each element.</p>
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 800, background: "#1a1816", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(198,154,92,0.15)" }}>
        <svg viewBox="0 0 800 530" style={{ width: "100%", display: "block" }}>
          <rect x="0" y="0" width="800" height="530" fill="#E8E4DF" opacity="0.08" />
          {COMP_SVG.slice(0, revealed).map((shape, si) => (
            <g key={shape.id}>
              {shape.paths.map((p, pi) => renderCompPath(p, pi, shape.color, shape.opacity))}
              {labels[si+1] && si < revealed && (
                <g>
                  <circle cx={labels[si+1].x} cy={labels[si+1].y} r={2.5} fill={si===revealed-1?"#C69A5C":"rgba(232,228,223,0.3)"} />
                  <text x={labels[si+1].x+8} y={labels[si+1].y+4} fill={si===revealed-1?"#C69A5C":"rgba(232,228,223,0.5)"} fontSize="10" fontFamily="'Crimson Text',serif">{names[si+1] || shape.id}</text>
                </g>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 14 }}>
      <button onClick={() => setRevealed(Math.max(0, revealed - 1))} disabled={revealed === 0} style={{ width: 34, height: 34, borderRadius: "50%", border: "1px solid rgba(232,228,223,0.15)", background: "rgba(232,228,223,0.05)", color: revealed===0?"rgba(232,228,223,0.15)":"rgba(232,228,223,0.7)", fontSize: 18, cursor: revealed===0?"default":"pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
      <span style={{ fontSize: 12, color: "rgba(232,228,223,0.4)", minWidth: 55, textAlign: "center" }}>{revealed} / {COMP_SVG.length}</span>
      <button onClick={() => setRevealed(Math.min(COMP_SVG.length, revealed + 1))} disabled={revealed >= COMP_SVG.length} style={{ width: 34, height: 34, borderRadius: "50%", border: "1px solid rgba(232,228,223,0.15)", background: "rgba(232,228,223,0.05)", color: revealed>=COMP_SVG.length?"rgba(232,228,223,0.15)":"rgba(232,228,223,0.7)", fontSize: 18, cursor: revealed>=COMP_SVG.length?"default":"pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
    </div>
    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 10, marginBottom: 14 }}>
      <button onClick={() => setRevealed(COMP_SVG.length)} style={{ padding: "4px 12px", borderRadius: 20, border: "1px solid rgba(232,228,223,0.12)", background: "rgba(232,228,223,0.04)", color: "rgba(232,228,223,0.4)", fontSize: 11, cursor: "pointer", fontFamily: "'Crimson Text',Georgia,serif" }}>Show All</button>
    </div>
    {revealed > 0 && COMP_SHAPES[revealed-1] && (
      <div style={{ background: "rgba(232,228,223,0.03)", borderRadius: 10, border: "1px solid rgba(198,154,92,0.12)", padding: "12px 14px" }}>
        <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: 15, marginBottom: 5 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: COMP_SVG[revealed-1]?.color || "#888", marginRight: 7 }} />
          {COMP_SHAPES[revealed-1]?.name}
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "rgba(232,228,223,0.65)" }}>{COMP_SHAPES[revealed-1]?.description}</p>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#C69A5C", fontStyle: "italic" }}>{COMP_SHAPES[revealed-1]?.icon} {COMP_SHAPES[revealed-1]?.tip}</p>
      </div>
    )}
  </div>;
}

function ConstructionStudy() {
  const [stage, setStage] = useState(0);
  const stageComponents = [CStage1, CStage2, CStage3, CStage4, CStage5, CStage6, CStage7, CStage8];
  const vis = (n) => n <= stage ? (n === stage ? 1 : 0.5) : 0;

  return <div>
    <p style={{ fontSize: 12, color: "rgba(232,228,223,0.45)", fontStyle: "italic", margin: "0 0 10px" }}>8 stages from empty paper to understanding the whole scene.</p>
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 800, background: "#1a1816", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(198,154,92,0.15)" }}>
        <svg viewBox="0 0 800 530" style={{ width: "100%", display: "block" }}>
          <rect x="0" y="0" width="800" height="530" fill="#E8E4DF" opacity="0.04" />
          {stageComponents.map((Comp, i) => i <= stage ? <Comp key={i} opacity={vis(i)} /> : null)}
        </svg>
      </div>
    </div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 14 }}>
      <button onClick={() => setStage(Math.max(0, stage - 1))} disabled={stage === 0} style={{ width: 34, height: 34, borderRadius: "50%", border: "1px solid rgba(232,228,223,0.15)", background: "rgba(232,228,223,0.05)", color: stage===0?"rgba(232,228,223,0.15)":"rgba(232,228,223,0.7)", fontSize: 18, cursor: stage===0?"default":"pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
      <span style={{ fontSize: 12, color: "rgba(232,228,223,0.4)", minWidth: 55, textAlign: "center" }}>{stage + 1} / {CONSTRUCTION_STAGES.length}</span>
      <button onClick={() => setStage(Math.min(CONSTRUCTION_STAGES.length - 1, stage + 1))} disabled={stage >= CONSTRUCTION_STAGES.length - 1} style={{ width: 34, height: 34, borderRadius: "50%", border: "1px solid rgba(232,228,223,0.15)", background: "rgba(232,228,223,0.05)", color: stage>=CONSTRUCTION_STAGES.length-1?"rgba(232,228,223,0.15)":"rgba(232,228,223,0.7)", fontSize: 18, cursor: stage>=CONSTRUCTION_STAGES.length-1?"default":"pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
    </div>
    <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 10, marginBottom: 14 }}>
      {CONSTRUCTION_STAGES.map((_, i) => (
        <button key={i} onClick={() => setStage(i)} style={{ width: i===stage?20:7, height: 7, borderRadius: 4, border: "none", background: i<=stage?"#C69A5C":"rgba(232,228,223,0.12)", cursor: "pointer", transition: "all 0.3s ease", opacity: i<=stage?0.8:0.4 }} />
      ))}
    </div>
    <div style={{ background: "rgba(232,228,223,0.03)", borderRadius: 10, border: "1px solid rgba(198,154,92,0.12)", padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(198,154,92,0.2)", border: "1px solid rgba(198,154,92,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "#C69A5C", fontFamily: "'Playfair Display',Georgia,serif" }}>{stage + 1}</span>
        <span style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: 15 }}>{CONSTRUCTION_STAGES[stage].name}</span>
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: "rgba(232,228,223,0.7)" }}>{CONSTRUCTION_STAGES[stage].description}</p>
    </div>
  </div>;
}

function StrokesView() {
  const [expanded, setExpanded] = useState(null);
  return <div>
    <p style={{ fontSize: 12, color: "rgba(232,228,223,0.45)", fontStyle: "italic", margin: "0 0 14px" }}>9 stroke types for this painting. Tap for details.</p>
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {STROKES.map((s, i) => (
        <div key={i} onClick={() => setExpanded(expanded === i ? null : i)} style={{ padding: 12, background: expanded === i ? "rgba(198,154,92,0.08)" : "rgba(232,228,223,0.03)", borderRadius: 10, border: expanded === i ? "1px solid rgba(198,154,92,0.2)" : "1px solid rgba(232,228,223,0.06)", cursor: "pointer", transition: "all 0.2s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 15, fontFamily: "'Playfair Display',Georgia,serif" }}>{s.name}</div>
              <div style={{ fontSize: 11, color: "rgba(232,228,223,0.5)", marginTop: 2 }}>{s.where}</div>
            </div>
            <span style={{ color: "rgba(232,228,223,0.3)", fontSize: 18, transform: expanded === i ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s" }}>›</span>
          </div>
          {expanded === i && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(198,154,92,0.15)" }}>
              <div style={{ display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 6, padding: "4px 9px", fontSize: 11 }}>
                  <span style={{ color: "rgba(232,228,223,0.4)" }}>Brush: </span><span style={{ color: "#E8E4DF" }}>{s.brush}</span>
                </div>
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 6, padding: "4px 9px", fontSize: 11 }}>
                  <span style={{ color: "rgba(232,228,223,0.4)" }}>Pressure: </span><span style={{ color: "#E8E4DF" }}>{s.pressure}</span>
                </div>
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.7, color: "rgba(232,228,223,0.75)", margin: 0 }}>{s.how}</p>
            </div>
          )}
        </div>
      ))}
    </div>
    <div style={{ marginTop: 18, padding: 12, background: "rgba(198,154,92,0.08)", borderRadius: 10, border: "1px solid rgba(198,154,92,0.15)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#C69A5C", marginBottom: 5, fontFamily: "'Playfair Display',Georgia,serif" }}>The Key Technique: Painting the Twilight Mirror</div>
      <div style={{ fontSize: 13, lineHeight: 1.7, color: "rgba(232,228,223,0.7)" }}>This painting's central challenge is the warm-to-cool gradient appearing TWICE — once in the sky, once in the reflection — while maintaining the mirror relationship. The trick: paint the sky first and let it dry completely. Then paint the reflection as a slightly muted echo. Mix Reflection Mute (cerulean + burnt sienna + Payne's grey) into every color you use in the lower half. The promenade lights and their vertical streaks are the secondary challenge — they need to GLOW against the darker surroundings. Use concentrated Light Yellow for the dots and pull the streaks while the dots are still wet so they bleed downward naturally. The dark foreground sand is your anchor — without it, the luminous reflection has nothing to contrast against.</div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════

function SRTraceTab() {
  return <TraceTab referencePhoto="/reference-sunset.jpeg" defaultOrientation="landscape" />;
}

const SECTIONS = [
  { id: "layers", label: "Layers", icon: "◐", component: PaintingLayers },
  { id: "palette", label: "Palette", icon: "◉", component: PaletteView },
  { id: "scene", label: "Scene", icon: "△", component: CompositionPlotter },
  { id: "study", label: "Study", icon: "⬡", component: ConstructionStudy },
  { id: "strokes", label: "Strokes", icon: "╱", component: StrokesView },
  { id: "trace", label: "Trace", icon: "✦", component: SRTraceTab },
  { id: "reconstruct", label: "Water", icon: "≋", component: DryBrushReconstructionSR },
];

export default function SunsetReflection() {
  const [activeSection, setActiveSection] = useState("layers");
  const Active = SECTIONS.find(s => s.id === activeSection)?.component;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(165deg, #2C2824 0%, #1E1C1A 40%, #252220 100%)", color: "#E8E4DF", fontFamily: "'Crimson Text', Georgia, serif" }}>
      <div style={{ padding: "28px 20px 14px" }}>
        <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: "#C69A5C", marginBottom: 6 }}>Watercolor Companion</div>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: 0, fontFamily: "'Playfair Display',Georgia,serif" }}>Sunset Reflection · Reading Power Station</h1>
        <p style={{ fontSize: 12, color: "rgba(232,228,223,0.4)", margin: "4px 0 0", fontStyle: "italic" }}>Twilight mirror · promenade lights · warm-cool gradient · wet sand</p>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid rgba(198,154,92,0.12)", borderTop: "1px solid rgba(198,154,92,0.08)", background: "rgba(0,0,0,0.15)", overflowX: "auto" }}>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)} style={{ flex: "0 0 auto", minWidth: 60, padding: "11px 10px", background: activeSection===s.id?"rgba(198,154,92,0.1)":"transparent", border: "none", borderBottom: activeSection===s.id?"2px solid #C69A5C":"2px solid transparent", color: activeSection===s.id?"#E8E4DF":"rgba(232,228,223,0.35)", fontFamily: "'Crimson Text',Georgia,serif", fontSize: 11, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, transition: "all 0.2s ease" }}>
            <span style={{ fontSize: 15 }}>{s.icon}</span><span>{s.label}</span>
          </button>
        ))}
      </div>
      <div style={{ padding: "18px 20px 40px" }}>{Active && <Active />}</div>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet" />
    </div>
  );
}
