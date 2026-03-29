import { useState, useEffect, useRef, useCallback } from "react";
import { analyzeImage, generateAllMarks, generatePaperTexture, getRegionBoundaries, samplePoint, ROUND_CONFIGS } from "./dryBrushEngineSR";
import GIF from "gif.js";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const PAPER_COLOR = "#E8E0D4";
const FONT_BODY = "'Crimson Text', Georgia, serif";
const FONT_HEAD = "'Playfair Display', Georgia, serif";
const GOLD = "#C69A5C";
const TEXT = "#E8E4DF";
const DIM = "rgba(232,228,223,0.4)";
const FAINT = "rgba(232,228,223,0.08)";

const pill = (active) => ({
  padding: "5px 12px", borderRadius: 20, fontSize: 11, cursor: "pointer",
  fontFamily: FONT_BODY, border: `1px solid ${active ? "rgba(198,154,92,0.4)" : "rgba(232,228,223,0.12)"}`,
  background: active ? "rgba(198,154,92,0.12)" : "rgba(232,228,223,0.04)",
  color: active ? GOLD : DIM,
});

const cardStyle = {
  background: "rgba(232,228,223,0.03)", borderRadius: 10,
  border: "1px solid rgba(198,154,92,0.12)", padding: "12px 14px",
};


// ═══════════════════════════════════════════════════════════════
// CANVAS DRAWING
// ═══════════════════════════════════════════════════════════════

function drawPaperBase(ctx, w, h) {
  ctx.fillStyle = PAPER_COLOR;
  ctx.fillRect(0, 0, w, h);
}

function drawPaperTexture(ctx, textureDots) {
  for (const d of textureDots) {
    ctx.globalAlpha = d.opacity;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawMarks(ctx, marks, count) {
  if (!marks) return;
  const len = Math.min(count, marks.length);
  for (let i = 0; i < len; i++) {
    const m = marks[i];
    if (!m) continue;
    ctx.globalAlpha = m.opacity;
    ctx.fillStyle = `rgb(${m.r},${m.g},${m.b})`;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.rotation);
    ctx.beginPath();
    ctx.ellipse(0, 0, m.width / 2, m.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawRegionOverlay(ctx, boundaries, displayW, displayH) {
  const colors = {
    1: "rgba(140,170,200,0.4)",    // sky (light blue)
    2: "rgba(200,200,210,0.35)",   // clouds (white-ish)
    3: "rgba(120,110,100,0.5)",    // buildings/shore (grey)
    4: "rgba(58,53,48,0.6)",       // chimney (dark)
    5: "rgba(100,130,160,0.4)",    // reflection (blue-ish)
    6: "rgba(40,30,20,0.5)",       // dark foreground (dark brown)
    7: "rgba(212,144,64,0.5)",     // warm glow (golden)
  };
  for (const [regionId, points] of Object.entries(boundaries)) {
    const color = colors[regionId] || "rgba(255,255,255,0.3)";
    ctx.fillStyle = color;
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPhotoOverlay(ctx, img, w, h, opacity) {
  ctx.globalAlpha = opacity;
  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalAlpha = 1;
}


// ═══════════════════════════════════════════════════════════════
// GRID HELPERS
// ═══════════════════════════════════════════════════════════════

function getCellKey(col, row) {
  return String.fromCharCode(65 + row) + (col + 1);
}

function extractCellColors(ctx, x, y, w, h, dpr, maxColors = 8) {
  const sx = Math.round(x * dpr), sy = Math.round(y * dpr);
  const sw = Math.round(w * dpr), sh = Math.round(h * dpr);
  if (sw <= 0 || sh <= 0) return [];
  const imgData = ctx.getImageData(sx, sy, sw, sh).data;
  // Sample every ~4px for speed
  const step = Math.max(1, Math.floor(sw * sh / 800)) * 4;
  const buckets = {};
  for (let i = 0; i < imgData.length; i += step * 4) {
    const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
    // Quantize to 24-level bins
    const qr = Math.round(r / 24) * 24;
    const qg = Math.round(g / 24) * 24;
    const qb = Math.round(b / 24) * 24;
    const key = `${qr},${qg},${qb}`;
    if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, count: 0 };
    buckets[key].r += r;
    buckets[key].g += g;
    buckets[key].b += b;
    buckets[key].count++;
  }
  const sorted = Object.values(buckets).sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, maxColors);
  const totalSamples = top.reduce((s, t) => s + t.count, 0);
  return top.map(t => ({
    r: Math.round(t.r / t.count),
    g: Math.round(t.g / t.count),
    b: Math.round(t.b / t.count),
    pct: Math.round((t.count / totalSamples) * 100),
  }));
}

function drawGridOverlay(ctx, w, h, cols, rows, revealed, focused, dpr) {
  const cellW = w / cols;
  const cellH = h / rows;

  // Darken unrevealed cells
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = getCellKey(c, r);
      if (!revealed[key]) {
        ctx.fillStyle = "rgba(20,18,16,0.82)";
        ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
      }
    }
  }

  // Grid lines
  ctx.strokeStyle = "rgba(198,154,92,0.5)";
  ctx.lineWidth = 1;
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cellW, 0);
    ctx.lineTo(c * cellW, h);
    ctx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * cellH);
    ctx.lineTo(w, r * cellH);
    ctx.stroke();
  }

  // Focused cell highlight
  if (focused) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (getCellKey(c, r) === focused) {
          ctx.strokeStyle = "#C69A5C";
          ctx.lineWidth = 2.5;
          ctx.strokeRect(c * cellW + 1, r * cellH + 1, cellW - 2, cellH - 2);
          ctx.lineWidth = 1;
        }
      }
    }
  }

  // Cell labels
  ctx.font = `bold 13px ${FONT_BODY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = getCellKey(c, r);
      const cx = c * cellW + cellW / 2;
      const cy = r * cellH + cellH / 2;
      if (!revealed[key]) {
        // Label on dark overlay
        ctx.fillStyle = "rgba(198,154,92,0.7)";
        ctx.fillText(key, cx, cy);
      } else {
        // Small label in corner
        ctx.fillStyle = "rgba(198,154,92,0.55)";
        ctx.font = `bold 10px ${FONT_BODY}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(key, c * cellW + 4, r * cellH + 3);
        ctx.font = `bold 13px ${FONT_BODY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
      }
    }
  }
}

function drawCmRulers(ctx, w, h, a6Wmm, a6Hmm) {
  const pxPerMmX = w / a6Wmm;
  const pxPerMmY = h / a6Hmm;
  const rulerH = 16;

  // Top ruler
  ctx.fillStyle = "rgba(30,28,26,0.85)";
  ctx.fillRect(0, 0, w, rulerH);
  ctx.strokeStyle = "rgba(198,154,92,0.5)";
  ctx.fillStyle = "rgba(198,154,92,0.8)";
  ctx.font = `9px ${FONT_BODY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let mm = 0; mm <= a6Wmm; mm++) {
    const x = mm * pxPerMmX;
    const isCm = mm % 10 === 0;
    const isHalf = mm % 5 === 0;
    ctx.beginPath();
    ctx.moveTo(x, rulerH);
    ctx.lineTo(x, rulerH - (isCm ? 10 : isHalf ? 7 : 3));
    ctx.stroke();
    if (isCm && mm > 0) {
      ctx.fillText(`${mm / 10}`, x, 1);
    }
  }

  // Left ruler
  ctx.fillStyle = "rgba(30,28,26,0.85)";
  ctx.fillRect(0, 0, rulerH, h);
  ctx.fillStyle = "rgba(198,154,92,0.8)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (let mm = 0; mm <= a6Hmm; mm++) {
    const y = mm * pxPerMmY;
    const isCm = mm % 10 === 0;
    const isHalf = mm % 5 === 0;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(198,154,92,0.5)";
    ctx.moveTo(rulerH, y);
    ctx.lineTo(rulerH - (isCm ? 10 : isHalf ? 7 : 3), y);
    ctx.stroke();
    if (isCm && mm > 0) {
      ctx.save();
      ctx.translate(2, y);
      ctx.fillText(`${mm / 10}`, 0, 0);
      ctx.restore();
    }
  }

  // Corner block
  ctx.fillStyle = "rgba(30,28,26,0.85)";
  ctx.fillRect(0, 0, rulerH, rulerH);
  ctx.fillStyle = "rgba(198,154,92,0.5)";
  ctx.font = `7px ${FONT_BODY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("cm", rulerH / 2, rulerH / 2);
}


// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function DryBrushReconstructionSR({ photoSrc = "/reference-sunset.jpeg" }) {
  // Loading
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ msg: "Loading image…", pct: 0 });

  // Data
  const analysisRef = useRef(null);
  const allMarksRef = useRef([]);
  const textureRef = useRef([]);
  const boundariesRef = useRef({});
  const imgRef = useRef(null);

  // Canvas
  const canvasRef = useRef(null);
  const displayW = useRef(600);
  const displayH = useRef(400);
  const containerRef = useRef(null);

  // State
  const [roundProgress, setRoundProgress] = useState(() => new Array(ROUND_CONFIGS.length).fill(0));
  const [roundVisible, setRoundVisible] = useState(() => new Array(ROUND_CONFIGS.length).fill(true));
  const [viewMode, setViewMode] = useState("all");
  const [activeRound, setActiveRound] = useState(7);
  const [animating, setAnimating] = useState(false);
  const animRef = useRef(null);

  // Comparison
  const [showPhoto, setShowPhoto] = useState(false);
  const [photoOpacity, setPhotoOpacity] = useState(0.5);
  const [sideBySide, setSideBySide] = useState(false);
  const [valueMatch, setValueMatch] = useState(false);
  const [showRegions, setShowRegions] = useState(false);

  // Hover
  const [tooltip, setTooltip] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Paint mode
  const [paintMode, setPaintMode] = useState(false);
  const [paintRound, setPaintRound] = useState(2);
  const [brushSize, setBrushSize] = useState(5);
  const [brushOpacity, setBrushOpacity] = useState(0.3);
  const [userMarks, setUserMarks] = useState([]);
  const paintingRef = useRef(false);
  const lastPosRef = useRef(null);

  // Grid focus mode
  const [gridMode, setGridMode] = useState(false);
  const [gridCols, setGridCols] = useState(4);
  const [gridRows, setGridRows] = useState(3);
  const [revealedCells, setRevealedCells] = useState({});
  const [focusedCell, setFocusedCell] = useState(null);
  const [cellColors, setCellColors] = useState({});
  const zoomCanvasRef = useRef(null);

  // A6 landscape: 148mm × 105mm
  const A6_W_MM = 148;
  const A6_H_MM = 105;

  // Stats
  const totalMarks = allMarksRef.current.reduce((s, r) => s + r.length, 0);
  const visibleMarks = roundProgress.reduce((s, p) => s + p, 0) + userMarks.length;


  // ── Load image + analyze + generate ──

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const aspect = img.naturalHeight / img.naturalWidth;
      const containerW = containerRef.current?.clientWidth || 700;
      // LANDSCAPE: use wider canvas
      const dw = Math.min(containerW, 680);
      const dh = Math.round(dw * aspect);
      displayW.current = dw;
      displayH.current = dh;

      setProgress({ msg: "Analyzing photo…", pct: 0.1 });

      setTimeout(() => {
        let analysis;
        try {
          analysis = analyzeImage(img, (msg, pct) => {
            setProgress({ msg, pct: 0.1 + pct * 0.4 });
          });
        } catch(e) {
          console.error("ANALYSIS ERROR:", e.message, e.stack);
          setProgress({ msg: "Analysis error: " + e.message, pct: 0 });
          return;
        }
        analysisRef.current = analysis;

        setProgress({ msg: "Generating marks…", pct: 0.55 });

        setTimeout(() => {
          let marks;
          try {
            marks = generateAllMarks(analysis, dw, dh, (msg, pct) => {
              setProgress({ msg, pct: 0.55 + pct * 0.35 });
            });
          } catch(e) {
            console.error("GENERATION ERROR:", e.message, e.stack);
            setProgress({ msg: "Generation error: " + e.message, pct: 0 });
            return;
          }
          allMarksRef.current = marks;
          textureRef.current = generatePaperTexture(dw, dh);
          boundariesRef.current = getRegionBoundaries(analysis, dw, dh);

          setRoundProgress(marks.map(r => r.length));
          setProgress({ msg: "Ready", pct: 1 });
          setLoading(false);
        }, 20);
      }, 20);
    };
    img.onerror = () => setProgress({ msg: "Failed to load image", pct: 0 });
    img.src = photoSrc;
  }, [photoSrc]);


  // ── Redraw canvas ──

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || loading) return;

    const dpr = window.devicePixelRatio || 1;
    const w = displayW.current;
    const h = displayH.current;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    drawPaperBase(ctx, w, h);
    drawPaperTexture(ctx, textureRef.current);

    const marks = allMarksRef.current;
    for (let r = 0; r < ROUND_CONFIGS.length; r++) {
      if (!isRoundVisible(r)) continue;
      drawMarks(ctx, marks[r], roundProgress[r]);
    }

    if (userMarks.length > 0) {
      drawMarks(ctx, userMarks, userMarks.length);
    }

    if (showRegions) {
      drawRegionOverlay(ctx, boundariesRef.current, w, h);
    }

    if (showPhoto && imgRef.current) {
      drawPhotoOverlay(ctx, imgRef.current, w, h, photoOpacity);
    }

    // Grid overlay + rulers
    if (gridMode) {
      // Extract colors + draw zoom BEFORE overlay darkens cells
      if (focusedCell && revealedCells[focusedCell]) {
        const cellW = w / gridCols;
        const cellH = h / gridRows;
        for (let r = 0; r < gridRows; r++) {
          for (let c = 0; c < gridCols; c++) {
            if (getCellKey(c, r) === focusedCell) {
              const colors = extractCellColors(ctx, c * cellW, r * cellH, cellW, cellH, dpr);
              setCellColors(prev => {
                const next = { ...prev };
                next[focusedCell] = colors;
                return next;
              });

              // Draw zoomed view from clean canvas (no grid overlay yet)
              const zc = zoomCanvasRef.current;
              if (zc) {
                const zoomW = Math.min(containerRef.current?.clientWidth || 680, 680);
                const zoomH = Math.round(zoomW * (cellH / cellW));
                zc.width = zoomW * dpr;
                zc.height = zoomH * dpr;
                zc.style.width = `${zoomW}px`;
                zc.style.height = `${zoomH}px`;
                const zCtx = zc.getContext("2d");
                zCtx.imageSmoothingEnabled = false;
                zCtx.drawImage(
                  canvas,
                  Math.round(c * cellW * dpr), Math.round(r * cellH * dpr),
                  Math.round(cellW * dpr), Math.round(cellH * dpr),
                  0, 0, zoomW * dpr, zoomH * dpr
                );
              }
            }
          }
        }
      }

      drawGridOverlay(ctx, w, h, gridCols, gridRows, revealedCells, focusedCell, dpr);
      drawCmRulers(ctx, w, h, A6_W_MM, A6_H_MM);
    }
  }, [loading, roundProgress, roundVisible, viewMode, activeRound, showPhoto, photoOpacity, userMarks, showRegions, gridMode, gridCols, gridRows, revealedCells, focusedCell]);

  useEffect(() => { redraw(); }, [redraw]);

  // Draw zoom canvas after render (when ref is available)
  useEffect(() => {
    const zc = zoomCanvasRef.current;
    const canvas = canvasRef.current;
    if (!zc || !canvas || !focusedCell || !revealedCells[focusedCell] || !gridMode) return;
    const dpr = window.devicePixelRatio || 1;
    const w = displayW.current;
    const h = displayH.current;
    const cellW = w / gridCols;
    const cellH = h / gridRows;
    const row = focusedCell.charCodeAt(0) - 65;
    const col = parseInt(focusedCell.slice(1)) - 1;
    if (col < 0 || col >= gridCols || row < 0 || row >= gridRows) return;
    const zoomW = Math.min(containerRef.current?.clientWidth || 680, 680);
    const zoomH = Math.round(zoomW * (cellH / cellW));
    zc.width = zoomW * dpr;
    zc.height = zoomH * dpr;
    zc.style.width = `${zoomW}px`;
    zc.style.height = `${zoomH}px`;
    const zCtx = zc.getContext("2d");
    zCtx.imageSmoothingEnabled = false;
    zCtx.drawImage(
      canvas,
      Math.round(col * cellW * dpr), Math.round(row * cellH * dpr),
      Math.round(cellW * dpr), Math.round(cellH * dpr),
      0, 0, zoomW * dpr, zoomH * dpr
    );
  }, [focusedCell, revealedCells, gridMode, gridCols, gridRows, cellColors]);

  function isRoundVisible(r) {
    if (viewMode === "solo") return r === activeRound;
    if (viewMode === "upTo") return r <= activeRound;
    return roundVisible[r];
  }


  // ── Animation ──

  const stopAnimation = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = null;
    setAnimating(false);
  }, []);

  const animateRound = useCallback((roundIdx, onDone) => {
    const marks = allMarksRef.current[roundIdx];
    if (!marks) { onDone?.(); return; }

    const batchSize = Math.max(4, Math.ceil(marks.length / 400));

    function step() {
      setRoundProgress(prev => {
        const next = [...prev];
        const current = next[roundIdx];
        if (current >= marks.length) {
          onDone?.();
          return next;
        }
        next[roundIdx] = Math.min(marks.length, current + batchSize);
        return next;
      });
      animRef.current = requestAnimationFrame(step);
    }
    animRef.current = requestAnimationFrame(step);
  }, []);

  const playAll = useCallback(() => {
    stopAnimation();
    setAnimating(true);
    setRoundProgress(new Array(ROUND_CONFIGS.length).fill(0));
    setViewMode("all");
    setRoundVisible(new Array(ROUND_CONFIGS.length).fill(true));

    let currentRound = 0;
    function nextRound() {
      if (currentRound >= ROUND_CONFIGS.length) { setAnimating(false); return; }
      animateRound(currentRound, () => {
        currentRound++;
        nextRound();
      });
    }
    setTimeout(nextRound, 50);
  }, [animateRound, stopAnimation]);

  const playRound = useCallback((idx) => {
    stopAnimation();
    setAnimating(true);
    setRoundProgress(prev => { const n = [...prev]; n[idx] = 0; return n; });
    setTimeout(() => animateRound(idx, () => setAnimating(false)), 50);
  }, [animateRound, stopAnimation]);

  const showFinal = useCallback(() => {
    stopAnimation();
    setRoundProgress(allMarksRef.current.map(r => r.length));
    setViewMode("all");
    setRoundVisible(new Array(ROUND_CONFIGS.length).fill(true));
  }, [stopAnimation]);

  const reset = useCallback(() => {
    stopAnimation();
    setRoundProgress(new Array(ROUND_CONFIGS.length).fill(0));
    setUserMarks([]);
  }, [stopAnimation]);


  // ── GIF Export ──

  const [gifExporting, setGifExporting] = useState(false);
  const [gifProgress, setGifProgress] = useState(0);

  const saveGif = useCallback(() => {
    if (gifExporting || loading) return;
    setGifExporting(true);
    setGifProgress(0);

    const w = displayW.current;
    const h = displayH.current;

    const oc = document.createElement("canvas");
    oc.width = w;
    oc.height = h;
    const ctx = oc.getContext("2d");

    const gif = new GIF({
      workers: 4,
      quality: 8,
      width: w,
      height: h,
      workerScript: "/gif.worker.js",
    });

    const marks = allMarksRef.current;
    const texture = textureRef.current;

    const totalMarksAll = marks.reduce((s, r) => s + r.length, 0);
    const TOTAL_FRAMES = 120;
    const FINAL_HOLD = 20;

    const frameTargets = [];
    for (let f = 0; f < TOTAL_FRAMES; f++) {
      const marksShown = Math.floor((f + 1) / TOTAL_FRAMES * totalMarksAll);
      const perRound = new Array(marks.length).fill(0);
      let remaining = marksShown;
      for (let r = 0; r < marks.length; r++) {
        const take = Math.min(remaining, marks[r].length);
        perRound[r] = take;
        remaining -= take;
        if (remaining <= 0) break;
      }
      frameTargets.push(perRound);
    }

    let frameIdx = 0;
    function renderNext() {
      if (frameIdx >= frameTargets.length) {
        for (let i = 0; i < FINAL_HOLD; i++) {
          gif.addFrame(ctx, { copy: true, delay: 80 });
        }
        gif.on("finished", (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "sunset-reflection-reconstruction.gif";
          a.click();
          URL.revokeObjectURL(url);
          setGifExporting(false);
        });
        gif.render();
        return;
      }

      const perRound = frameTargets[frameIdx];
      setGifProgress(frameIdx / TOTAL_FRAMES);

      ctx.fillStyle = PAPER_COLOR;
      ctx.fillRect(0, 0, w, h);
      for (const d of texture) {
        ctx.globalAlpha = d.opacity;
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (let r = 0; r < marks.length; r++) {
        drawMarks(ctx, marks[r], perRound[r]);
      }

      gif.addFrame(ctx, { copy: true, delay: 60 });
      frameIdx++;
      setTimeout(renderNext, 0);
    }

    renderNext();
  }, [gifExporting, loading]);


  // ── Hover tooltip ──

  const handleMouseMove = useCallback((e) => {
    if (paintingRef.current || !analysisRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (mx < 0 || my < 0 || mx > displayW.current || my > displayH.current) {
      setTooltip(null); return;
    }

    const info = samplePoint(analysisRef.current, displayW.current, displayH.current, mx, my);

    const nearRounds = [];
    for (let r = 0; r < ROUND_CONFIGS.length; r++) {
      if (!isRoundVisible(r)) continue;
      const marks = allMarksRef.current[r];
      for (let i = 0; i < roundProgress[r]; i++) {
        const m = marks[i];
        if (Math.abs(m.x - mx) < 6 && Math.abs(m.y - my) < 6) {
          nearRounds.push(r);
          break;
        }
      }
    }

    const dpr = window.devicePixelRatio || 1;
    const ctx = canvasRef.current.getContext("2d");
    const pxData = ctx.getImageData(Math.round(mx * dpr), Math.round(my * dpr), 1, 1).data;
    const reconColor = [pxData[0], pxData[1], pxData[2]];

    setTooltip({ ...info, reconColor, nearRounds, mx, my });
    setTooltipPos({ x: e.clientX, y: e.clientY });
  }, [roundProgress, roundVisible, viewMode, activeRound]);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);


  // ── Interactive painting ──

  const handlePaintStart = useCallback((e) => {
    if (!paintMode || !analysisRef.current) return;
    paintingRef.current = true;
    const rect = canvasRef.current.getBoundingClientRect();
    lastPosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, [paintMode]);

  const handlePaintMove = useCallback((e) => {
    if (!paintingRef.current || !analysisRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const last = lastPosRef.current;
    if (!last) { lastPosRef.current = { x: mx, y: my }; return; }

    const dist = Math.sqrt((mx - last.x) ** 2 + (my - last.y) ** 2);
    const steps = Math.max(1, Math.floor(dist / 3));

    const analysis = analysisRef.current;
    const newMarks = [];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const x = last.x + (mx - last.x) * t + (Math.random() - 0.5) * 2;
      const y = last.y + (my - last.y) * t + (Math.random() - 0.5) * 2;

      const ix = clamp(Math.floor(x * (analysis.width / displayW.current)), 0, analysis.width - 1);
      const iy = clamp(Math.floor(y * (analysis.height / displayH.current)), 0, analysis.height - 1);
      const pi = iy * analysis.width + ix;

      const pidx = pi * 4;
      const cr = analysis.pixels[pidx], cg = analysis.pixels[pidx + 1], cb = analysis.pixels[pidx + 2];

      // Auto-rotate to ridge angle in sand zone
      const region = analysis.regionMap[pi];
      let rotation;
      if (region === 0 || region === 4 || region === 5) {
        rotation = Math.atan2(iy - analysis.vanishY, ix - analysis.vanishX) + (Math.random() - 0.5) * 0.15;
      } else {
        rotation = (Math.random() - 0.5) * 0.3;
      }

      newMarks.push({
        x, y,
        width: brushSize + (Math.random() - 0.5) * 2,
        height: (brushSize * 0.3) + (Math.random() - 0.5),
        rotation,
        r: clamp(Math.round(cr + (Math.random() - 0.5) * 20), 0, 255),
        g: clamp(Math.round(cg + (Math.random() - 0.5) * 20), 0, 255),
        b: clamp(Math.round(cb + (Math.random() - 0.5) * 20), 0, 255),
        opacity: brushOpacity * (0.7 + Math.random() * 0.3),
      });
    }

    if (newMarks.length > 0) {
      setUserMarks(prev => [...prev, ...newMarks]);
    }
    lastPosRef.current = { x: mx, y: my };
  }, [paintMode, paintRound, brushSize, brushOpacity]);

  const handlePaintEnd = useCallback(() => {
    paintingRef.current = false;
    lastPosRef.current = null;
  }, []);


  // ── Grid click handler ──

  const handleGridClick = useCallback((e) => {
    if (!gridMode) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = displayW.current;
    const h = displayH.current;
    const col = Math.floor(mx / (w / gridCols));
    const row = Math.floor(my / (h / gridRows));
    if (col < 0 || col >= gridCols || row < 0 || row >= gridRows) return;
    const key = getCellKey(col, row);

    // Show only this cell — one at a time
    setRevealedCells({ [key]: true });
    setFocusedCell(key);
  }, [gridMode, gridCols, gridRows]);

  function toggleGridMode() {
    setGridMode(g => !g);
    if (!gridMode) {
      // Entering grid mode — reset cells
      setRevealedCells({});
      setFocusedCell(null);
      setCellColors({});
    }
  }

  function revealAllCells() {
    const all = {};
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        all[getCellKey(c, r)] = true;
      }
    }
    setRevealedCells(all);
  }

  function hideAllCells() {
    setRevealedCells({});
    setFocusedCell(null);
  }

  // ── Toggle helpers ──

  function toggleRound(idx) {
    setRoundVisible(prev => { const n = [...prev]; n[idx] = !n[idx]; return n; });
    setViewMode("all");
  }

  function soloRound(idx) {
    setActiveRound(idx);
    setViewMode(viewMode === "solo" && activeRound === idx ? "all" : "solo");
  }

  function upToRound(idx) {
    setActiveRound(idx);
    setViewMode("upTo");
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }


  // ═══════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.3 }}>●</div>
        <div style={{ fontFamily: FONT_HEAD, fontSize: 18, marginBottom: 12 }}>
          Analyzing the sunset…
        </div>
        <div style={{ fontSize: 13, color: DIM, marginBottom: 16 }}>{progress.msg}</div>
        <div style={{ width: 200, height: 4, background: FAINT, borderRadius: 2, margin: "0 auto", overflow: "hidden" }}>
          <div style={{ width: `${progress.pct * 100}%`, height: "100%", background: GOLD, borderRadius: 2, transition: "width 0.3s ease" }} />
        </div>
        <div style={{ fontSize: 11, color: DIM, marginTop: 8 }}>{Math.round(progress.pct * 100)}%</div>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      {/* ── Header ── */}
      <p style={{ fontSize: 13, color: DIM, fontStyle: "italic", margin: "0 0 12px" }}>
        {totalMarks.toLocaleString()} dry brush marks reconstruct the scene through optical mixing.
      </p>

      {/* ── Comparison toolbar ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        <button onClick={() => setShowPhoto(!showPhoto)} style={pill(showPhoto)}>
          {showPhoto ? "Hide Photo" : "Photo Overlay"}
        </button>
        {showPhoto && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="range" min="0" max="100" value={Math.round(photoOpacity * 100)}
              onChange={e => setPhotoOpacity(e.target.value / 100)}
              style={{ width: 80, accentColor: GOLD }} />
            <span style={{ fontSize: 11, color: DIM }}>{Math.round(photoOpacity * 100)}%</span>
          </div>
        )}
        <button onClick={() => setSideBySide(!sideBySide)} style={pill(sideBySide)}>Side by Side</button>
        <button onClick={() => setValueMatch(!valueMatch)} style={pill(valueMatch)}>Value Match</button>
        <button onClick={() => setShowRegions(!showRegions)} style={pill(showRegions)}>Regions</button>
        <button onClick={() => setPaintMode(!paintMode)} style={pill(paintMode)}>
          {paintMode ? "Exit Paint" : "Paint Mode"}
        </button>
        <button onClick={toggleGridMode} style={pill(gridMode)}>
          {gridMode ? "Exit Grid" : "Focus Grid"}
        </button>
      </div>

      {/* ── Paint mode controls ── */}
      {paintMode && (
        <div style={{ ...cardStyle, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 12, color: DIM }}>
            Round:
            <select value={paintRound} onChange={e => setPaintRound(Number(e.target.value))}
              style={{ marginLeft: 6, background: "rgba(0,0,0,0.3)", color: TEXT, border: `1px solid ${FAINT}`, borderRadius: 4, padding: "2px 6px", fontSize: 12, fontFamily: FONT_BODY }}>
              {ROUND_CONFIGS.map((rc, i) => <option key={i} value={i}>{i}: {rc.name}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 12, color: DIM, display: "flex", alignItems: "center", gap: 4 }}>
            Size:
            <input type="range" min="2" max="12" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))}
              style={{ width: 60, accentColor: GOLD }} />
            <span style={{ width: 16, textAlign: "right" }}>{brushSize}</span>
          </div>
          <div style={{ fontSize: 12, color: DIM, display: "flex", alignItems: "center", gap: 4 }}>
            Opacity:
            <input type="range" min="5" max="80" value={Math.round(brushOpacity * 100)}
              onChange={e => setBrushOpacity(e.target.value / 100)}
              style={{ width: 60, accentColor: GOLD }} />
            <span style={{ width: 24, textAlign: "right" }}>{Math.round(brushOpacity * 100)}%</span>
          </div>
          <button onClick={() => setUserMarks([])} style={{ ...pill(false), fontSize: 10 }}>Clear painted</button>
        </div>
      )}

      {/* ── Grid focus controls ── */}
      {gridMode && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...cardStyle, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: DIM, display: "flex", alignItems: "center", gap: 4 }}>
              Grid:
              <select value={`${gridCols}x${gridRows}`} onChange={e => {
                const [c, r] = e.target.value.split("x").map(Number);
                setGridCols(c); setGridRows(r);
                setRevealedCells({}); setFocusedCell(null); setCellColors({});
              }} style={{ background: "rgba(0,0,0,0.3)", color: TEXT, border: `1px solid ${FAINT}`, borderRadius: 4, padding: "2px 6px", fontSize: 12, fontFamily: FONT_BODY }}>
                <option value="3x2">3 x 2 (6 cells)</option>
                <option value="4x3">4 x 3 (12 cells)</option>
                <option value="5x4">5 x 4 (20 cells)</option>
                <option value="6x4">6 x 4 (24 cells)</option>
                <option value="6x5">6 x 5 (30 cells)</option>
              </select>
            </div>
            <span style={{ fontSize: 11, color: DIM, marginLeft: "auto" }}>
              A6 landscape: {A6_W_MM}mm x {A6_H_MM}mm · each cell ≈ {Math.round(A6_W_MM / gridCols)}mm x {Math.round(A6_H_MM / gridRows)}mm
            </span>
          </div>

          {/* Cell mini-map */}
          <div style={{ ...cardStyle, padding: "8px 10px" }}>
            <div style={{ fontSize: 11, color: DIM, marginBottom: 6 }}>Click a cell to focus on it — one at a time, with enlarged view and colors below.</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: 3 }}>
              {Array.from({ length: gridRows }, (_, r) =>
                Array.from({ length: gridCols }, (_, c) => {
                  const key = getCellKey(c, r);
                  const isRevealed = !!revealedCells[key];
                  const isFocused = focusedCell === key;
                  return (
                    <button key={key} onClick={() => {
                      setRevealedCells({ [key]: true });
                      setFocusedCell(key);
                    }} style={{
                      padding: "4px 0", fontSize: 10, fontFamily: FONT_BODY,
                      background: isFocused ? "rgba(198,154,92,0.25)" : isRevealed ? "rgba(198,154,92,0.08)" : "rgba(232,228,223,0.04)",
                      border: `1.5px solid ${isFocused ? GOLD : isRevealed ? "rgba(198,154,92,0.3)" : "rgba(232,228,223,0.1)"}`,
                      borderRadius: 4, cursor: "pointer",
                      color: isRevealed ? GOLD : DIM,
                    }}>
                      {key}
                    </button>
                  );
                })
              ).flat()}
            </div>
          </div>

          {/* Focused cell color palette + zoom */}
          {focusedCell && revealedCells[focusedCell] && (
            <div style={{ ...cardStyle, marginTop: 8 }}>
              <div style={{ fontFamily: FONT_HEAD, fontSize: 14, marginBottom: 6 }}>
                Cell {focusedCell} — Colors
              </div>
              <div style={{ fontSize: 10, color: DIM, marginBottom: 8 }}>
                Position on A6: {(() => {
                  const row = focusedCell.charCodeAt(0) - 65;
                  const col = parseInt(focusedCell.slice(1)) - 1;
                  const xMm = Math.round(col * (A6_W_MM / gridCols));
                  const yMm = Math.round(row * (A6_H_MM / gridRows));
                  const wMm = Math.round(A6_W_MM / gridCols);
                  const hMm = Math.round(A6_H_MM / gridRows);
                  return `${xMm}mm–${xMm + wMm}mm from left, ${yMm}mm–${yMm + hMm}mm from top`;
                })()}
              </div>
              {cellColors[focusedCell] && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {cellColors[focusedCell].map((c, i) => (
                    <div key={i} style={{ textAlign: "center" }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 6,
                        background: `rgb(${c.r},${c.g},${c.b})`,
                        border: "1px solid rgba(255,255,255,0.15)",
                        marginBottom: 3,
                      }} />
                      <div style={{ fontSize: 9, color: DIM }}>{c.pct}%</div>
                      <div style={{ fontSize: 8, color: DIM, opacity: 0.7 }}>
                        {c.r},{c.g},{c.b}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: DIM, marginBottom: 6 }}>Enlarged view:</div>
              <div style={{
                borderRadius: 8, overflow: "hidden",
                border: "1px solid rgba(198,154,92,0.25)",
              }}>
                <canvas ref={zoomCanvasRef} style={{ display: "block", width: "100%" }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Canvas area — LANDSCAPE ── */}
      <div style={{
        display: "block",
        filter: valueMatch ? "grayscale(1)" : "none",
        marginBottom: 12,
      }}>
        {sideBySide && (
          <div style={{
            width: displayW.current, borderRadius: "10px 10px 0 0", overflow: "hidden",
            border: "1px solid rgba(198,154,92,0.15)", borderBottom: "none",
          }}>
            <img src={photoSrc} alt="Reference"
              style={{ width: "100%", display: "block" }} />
          </div>
        )}
        <div style={{
          borderRadius: sideBySide ? "0 0 10px 10px" : 10, overflow: "hidden",
          border: "1px solid rgba(198,154,92,0.15)",
          cursor: paintMode ? "crosshair" : gridMode ? "pointer" : "default",
          display: "inline-block",
        }}>
          <canvas ref={canvasRef}
            style={{ display: "block", width: displayW.current, height: displayH.current }}
            onClick={gridMode ? handleGridClick : undefined}
            onMouseMove={paintMode ? handlePaintMove : (!gridMode ? handleMouseMove : undefined)}
            onMouseDown={paintMode ? handlePaintStart : undefined}
            onMouseUp={paintMode ? handlePaintEnd : undefined}
            onMouseLeave={(e) => { handleMouseLeave(e); handlePaintEnd(); }}
          />
        </div>
      </div>

      {/* ── Playback controls ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 12 }}>
        <button onClick={reset} style={pill(false)}>Reset</button>
        <button onClick={playAll} disabled={animating} style={pill(false)}>
          {animating ? "Painting…" : "Paint All"}
        </button>
        {animating && <button onClick={stopAnimation} style={pill(true)}>Stop</button>}
        <button onClick={showFinal} style={pill(false)}>Show Final</button>
        <button onClick={saveGif} disabled={gifExporting || loading} style={pill(gifExporting)}>
          {gifExporting ? `Exporting… ${Math.round(gifProgress * 100)}%` : "Save GIF"}
        </button>
        <span style={{ fontSize: 11, color: DIM, marginLeft: "auto" }}>
          {visibleMarks.toLocaleString()} / {totalMarks.toLocaleString()} marks
        </span>
      </div>

      {/* ── View mode ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button onClick={() => setViewMode("all")} style={pill(viewMode === "all")}>All</button>
        <button onClick={() => setViewMode("solo")} style={pill(viewMode === "solo")}>Solo</button>
        <button onClick={() => setViewMode("upTo")} style={pill(viewMode === "upTo")}>Build Up</button>
      </div>

      {/* ── Round cards ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {ROUND_CONFIGS.map((rc, i) => {
          const marks = allMarksRef.current[i] || [];
          const revealed = roundProgress[i];
          const vis = isRoundVisible(i);
          const pct = marks.length > 0 ? Math.round((revealed / marks.length) * 100) : 0;

          return (
            <div key={i} style={{
              ...cardStyle,
              opacity: vis ? 1 : 0.4,
              borderColor: (viewMode === "solo" && activeRound === i) ? GOLD
                : (viewMode === "upTo" && activeRound === i) ? GOLD
                : "rgba(198,154,92,0.12)",
              transition: "all 0.2s",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <button onClick={() => toggleRound(i)} style={{
                  width: 18, height: 18, borderRadius: "50%", border: "2px solid " + (vis ? rc.color : "rgba(232,228,223,0.15)"),
                  background: vis ? rc.color : "transparent", cursor: "pointer", flexShrink: 0, padding: 0,
                }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: FONT_HEAD, fontSize: 14 }}>
                      {i}. {rc.name}
                    </span>
                    <span style={{ fontSize: 10, color: DIM }}>{marks.length} marks</span>
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(232,228,223,0.5)", lineHeight: 1.4 }}>
                    {rc.description}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button onClick={() => playRound(i)} disabled={animating} title="Animate this round"
                    style={{ ...pill(false), padding: "3px 8px", fontSize: 10 }}>▶</button>
                  <button onClick={() => soloRound(i)} title="Solo this round"
                    style={{ ...pill(viewMode === "solo" && activeRound === i), padding: "3px 8px", fontSize: 10 }}>S</button>
                  <button onClick={() => upToRound(i)} title="Show rounds 0 through this"
                    style={{ ...pill(viewMode === "upTo" && activeRound === i), padding: "3px 8px", fontSize: 10 }}>↑</button>
                </div>
              </div>

              <div style={{ height: 3, background: FAINT, borderRadius: 2, marginTop: 4 }}>
                <div style={{
                  width: `${pct}%`, height: "100%", background: rc.color,
                  borderRadius: 2, transition: "width 0.15s linear",
                }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Tooltip ── */}
      {tooltip && !paintMode && (
        <div style={{
          position: "fixed", left: tooltipPos.x + 16, top: tooltipPos.y - 10,
          background: "rgba(30,28,26,0.95)", borderRadius: 8,
          border: "1px solid rgba(198,154,92,0.2)", padding: "8px 10px",
          pointerEvents: "none", zIndex: 999, maxWidth: 240,
          fontFamily: FONT_BODY, fontSize: 12, color: TEXT, lineHeight: 1.5,
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 20, height: 20, borderRadius: 4, border: "1px solid rgba(255,255,255,0.2)",
                background: `rgb(${tooltip.photoColor.join(",")})` }} />
              <div style={{ fontSize: 9, color: DIM }}>Photo</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 20, height: 20, borderRadius: 4, border: "1px solid rgba(255,255,255,0.2)",
                background: `rgb(${tooltip.reconColor.join(",")})` }} />
              <div style={{ fontSize: 9, color: DIM }}>Built</div>
            </div>
            <div style={{ fontSize: 11, color: DIM }}>
              Value {tooltip.valueBand}/8 · {tooltip.region}
            </div>
          </div>
          {tooltip.nearRounds.length > 0 && (
            <div style={{ fontSize: 10, color: DIM }}>
              Rounds: {tooltip.nearRounds.map(r => `${r} (${ROUND_CONFIGS[r].name})`).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
