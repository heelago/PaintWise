import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ROUND_CONFIGS, REGION_NAMES } from './engine/generateMarks';
import { findNearestPigment, suggestMix } from './engine/pigments';
import { generateInstructions } from './engine/instructions';
import { buildSvgComposition } from './engine/svgBuilder';
import SvgViewer from './SvgViewer';

// ── Style constants (shared dark theme) ──────────────────────────
const BG       = '#1E1C1A';
const TEXT     = '#E8E4DF';
const ACCENT   = '#C69A5C';
const MUTED    = 'rgba(232,228,223,0.45)';
const CARD_BG  = 'rgba(232,228,223,0.03)';
const CARD_BD  = '1px solid rgba(198,154,92,0.12)';
const HEADING  = "'Playfair Display', serif";
const BODY     = "'Crimson Text', serif";

// ── Canvas drawing helpers ───────────────────────────────────────

function drawPaperBase(ctx, w, h) {
  ctx.fillStyle = '#E8E0D4';
  ctx.fillRect(0, 0, w, h);
}

function drawPaperTexture(ctx, dots) {
  for (const d of dots) {
    ctx.globalAlpha = d.opacity;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawMarks(ctx, marks, count) {
  for (let i = 0; i < Math.min(count, marks.length); i++) {
    const m = marks[i];
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

// ── Component ────────────────────────────────────────────────────

export default function PaintingPage({ imageData, image, onBack }) {
  // Analysis state
  const [phase, setPhase] = useState('analyze');   // 'analyze' | 'marks' | 'done'
  const [progress, setProgress] = useState(0);
  const [analysis, setAnalysis] = useState(null);
  const [marks, setMarks] = useState(null);
  const [texture, setTexture] = useState(null);

  // Display state
  const [visibleRounds, setVisibleRounds] = useState(() =>
    ROUND_CONFIGS.map(() => true)
  );
  const [showPhoto, setShowPhoto] = useState(false);
  const [viewStyle, setViewStyle] = useState('pointillist'); // 'pointillist' | 'svg'

  // Derived data (computed once when analysis is ready)
  const svgComposition = useMemo(() => {
    if (!analysis) return null;
    const maxDisplay = 800;
    let dw = imageData.width, dh = imageData.height;
    if (dw > maxDisplay || dh > maxDisplay) {
      const s = maxDisplay / Math.max(dw, dh);
      dw = Math.round(dw * s);
      dh = Math.round(dh * s);
    }
    return buildSvgComposition(analysis, dw, dh);
  }, [analysis, imageData]);

  const instructions = useMemo(() => {
    if (!analysis) return [];
    return generateInstructions(analysis, ROUND_CONFIGS);
  }, [analysis]);

  const canvasRef = useRef(null);
  const workerRef = useRef(null);

  // ── Launch worker on mount ─────────────────────────────────────
  useEffect(() => {
    const worker = new Worker(
      new URL('./engine/worker.js', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setPhase(msg.phase);
        setProgress(msg.progress);
      } else if (msg.type === 'result') {
        setAnalysis(msg.analysis);
        setMarks(msg.marks);
        setTexture(msg.texture);
        setPhase('done');
        setProgress(1);
      }
    };

    // Determine display dimensions (cap at 800px wide for performance)
    const maxDisplay = 800;
    let dw = imageData.width;
    let dh = imageData.height;
    if (dw > maxDisplay || dh > maxDisplay) {
      const scale = maxDisplay / Math.max(dw, dh);
      dw = Math.round(dw * scale);
      dh = Math.round(dh * scale);
    }

    worker.postMessage({
      type: 'analyze',
      imageData: imageData.data,
      width: imageData.width,
      height: imageData.height,
      displayW: dw,
      displayH: dh,
    });

    return () => worker.terminate();
  }, [imageData]);

  // ── Render canvas when data or visibility changes ──────────────
  useEffect(() => {
    if (!marks || !texture) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    drawPaperBase(ctx, canvas.width, canvas.height);
    drawPaperTexture(ctx, texture);

    for (let i = 0; i < marks.length; i++) {
      if (visibleRounds[i]) {
        drawMarks(ctx, marks[i], marks[i].length);
      }
    }
  }, [marks, texture, visibleRounds, viewStyle]);

  // ── Toggle round visibility ────────────────────────────────────
  const toggleRound = useCallback((idx) => {
    setVisibleRounds((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  }, []);

  // ── Canvas dimensions ──────────────────────────────────────────
  const maxDisplay = 800;
  let canvasW = imageData.width;
  let canvasH = imageData.height;
  if (canvasW > maxDisplay || canvasH > maxDisplay) {
    const scale = maxDisplay / Math.max(canvasW, canvasH);
    canvasW = Math.round(canvasW * scale);
    canvasH = Math.round(canvasH * scale);
  }

  // ── Palette extraction ─────────────────────────────────────────
  const palette = analysis?.centroids
    ? analysis.centroids.map((c) => {
        const [r, g, b] = c;
        const nearest = findNearestPigment(r, g, b);
        const mix = suggestMix(r, g, b);
        return { r, g, b, nearest, mix };
      })
    : [];

  // ── Progress / analyzing view ──────────────────────────────────
  if (phase !== 'done') {
    const label = phase === 'analyze' ? 'Analyzing colors...' : 'Generating marks...';
    const pct = Math.round(
      (phase === 'analyze' ? progress * 50 : 50 + progress * 50)
    );

    return (
      <div style={{
        minHeight: '100vh',
        background: BG,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
      }}>
        {/* Thumbnail */}
        <img
          src={image.src}
          alt="Analyzing"
          style={{
            maxWidth: 200,
            maxHeight: 150,
            borderRadius: 8,
            objectFit: 'contain',
            marginBottom: 32,
            opacity: 0.8,
          }}
        />

        {/* Phase label */}
        <p style={{
          fontFamily: BODY,
          fontSize: 20,
          color: TEXT,
          margin: '0 0 16px',
        }}>
          {label}
        </p>

        {/* Progress bar */}
        <div style={{
          width: 320,
          height: 6,
          borderRadius: 3,
          background: 'rgba(232,228,223,0.08)',
          overflow: 'hidden',
          marginBottom: 8,
        }}>
          <div style={{
            width: `${pct}%`,
            height: '100%',
            background: ACCENT,
            borderRadius: 3,
            transition: 'width 0.3s ease',
          }} />
        </div>

        <p style={{
          fontFamily: BODY,
          fontSize: 14,
          color: MUTED,
          margin: 0,
        }}>
          {pct}%
        </p>
      </div>
    );
  }

  // ── Results view ───────────────────────────────────────────────
  return (
    <div style={{
      height: '100vh',
      background: BG,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '16px 24px',
        borderBottom: '1px solid rgba(198,154,92,0.1)',
      }}>
        <button
          onClick={onBack}
          style={{
            fontFamily: BODY,
            fontSize: 16,
            color: MUTED,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            marginRight: 16,
          }}
        >
          &larr; New Photo
        </button>
        <h1 style={{
          fontFamily: HEADING,
          fontSize: 24,
          color: ACCENT,
          margin: 0,
          fontWeight: 400,
        }}>
          PaintWise
        </h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <ControlButton
            active={viewStyle === 'pointillist'}
            onClick={() => setViewStyle('pointillist')}
            label="Pointillist"
          />
          <ControlButton
            active={viewStyle === 'svg'}
            onClick={() => setViewStyle('svg')}
            label="SVG Layers"
          />
        </div>
      </div>

      {/* Main layout */}
      <div style={{
        display: 'flex',
        flex: 1,
        overflow: 'hidden',
      }}>
        {/* ── Sidebar ──────────────────────────────────────────── */}
        <div style={{
          width: 320,
          minWidth: 280,
          borderRight: '1px solid rgba(198,154,92,0.1)',
          overflowY: 'auto',
          padding: '24px 20px',
          flexShrink: 0,
        }}>
          {/* Scene info */}
          <Section title="Scene Info">
            <InfoRow label="Dimensions" value={`${imageData.width} x ${imageData.height}`} />
            <InfoRow label="Horizon" value={analysis.hasHorizon ? 'Detected' : 'None'} />
            <InfoRow label="Reflection" value={analysis.hasReflection ? 'Detected' : 'None'} />
          </Section>

          {/* Palette */}
          <Section title="Palette">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {palette.map((c, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                }}>
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: 6,
                    background: `rgb(${c.r},${c.g},${c.b})`,
                    flexShrink: 0,
                    border: '1px solid rgba(255,255,255,0.08)',
                  }} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{
                      fontFamily: BODY,
                      fontSize: 14,
                      color: TEXT,
                      margin: '0 0 2px',
                    }}>
                      {c.nearest.pigment.name}
                    </p>
                    <p style={{
                      fontFamily: BODY,
                      fontSize: 12,
                      color: MUTED,
                      margin: 0,
                    }}>
                      {formatMix(c.mix)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Painting Steps */}
          <Section title="Painting Steps">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ROUND_CONFIGS.map((rc, i) => {
                const instr = instructions[i];
                return (
                  <div key={i}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: visibleRounds[i]
                          ? 'rgba(198,154,92,0.06)'
                          : 'transparent',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                      onClick={() => toggleRound(i)}
                    >
                      <div style={{
                        width: 14, height: 14, borderRadius: '50%',
                        background: rc.color, flexShrink: 0,
                        opacity: visibleRounds[i] ? 1 : 0.3,
                        border: '1px solid rgba(255,255,255,0.08)',
                      }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p style={{
                          fontFamily: BODY, fontSize: 14,
                          color: visibleRounds[i] ? TEXT : MUTED, margin: 0,
                        }}>
                          {instr?.title || `${i + 1}. ${rc.name}`}
                        </p>
                        <p style={{
                          fontFamily: BODY, fontSize: 11,
                          color: 'rgba(232,228,223,0.35)', margin: '2px 0 0',
                        }}>
                          {instr?.timing || ''}{instr?.brush ? ` · ${instr.brush}` : ''}
                        </p>
                      </div>
                      <span style={{
                        fontSize: 16,
                        color: visibleRounds[i] ? ACCENT : 'rgba(232,228,223,0.2)',
                        flexShrink: 0,
                      }}>
                        {visibleRounds[i] ? '\u25C9' : '\u25CB'}
                      </span>
                    </div>
                    {/* Expanded instruction when visible */}
                    {visibleRounds[i] && instr && (
                      <div style={{
                        padding: '8px 10px 8px 34px',
                        fontSize: 13, fontFamily: BODY,
                        color: 'rgba(232,228,223,0.55)',
                        lineHeight: 1.5,
                      }}>
                        <p style={{ margin: '0 0 6px' }}>{instr.instruction}</p>
                        {instr.tips?.length > 0 && (
                          <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {instr.tips.map((tip, j) => (
                              <li key={j} style={{ marginBottom: 3 }}>{tip}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        {/* ── Main content area ────────────────────────────────── */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          padding: 24,
          overflow: 'auto',
          position: 'relative',
        }}>
          {viewStyle === 'pointillist' ? (
            <>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <canvas
                  ref={canvasRef}
                  width={canvasW}
                  height={canvasH}
                  style={{
                    maxWidth: '100%',
                    height: 'auto',
                    borderRadius: 8,
                    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
                    display: 'block',
                  }}
                />
                {showPhoto && (
                  <img
                    src={image.src}
                    alt="Reference"
                    style={{
                      position: 'absolute',
                      top: 0, left: 0,
                      width: '100%', height: '100%',
                      borderRadius: 8,
                      objectFit: 'cover',
                      opacity: 0.5,
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
              <div style={{
                display: 'flex', gap: 12, marginTop: 16,
                flexWrap: 'wrap', justifyContent: 'center',
              }}>
                <ControlButton
                  active={showPhoto}
                  onClick={() => setShowPhoto((p) => !p)}
                  label={showPhoto ? 'Hide Photo' : 'Show Photo'}
                />
              </div>
            </>
          ) : (
            svgComposition && <SvgViewer composition={svgComposition} />
          )}
        </div>
      </div>
    </div>
  );
}


// ── Subcomponents ────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={{
        fontFamily: HEADING,
        fontSize: 16,
        color: ACCENT,
        margin: '0 0 12px',
        fontWeight: 400,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
      }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '4px 0',
    }}>
      <span style={{ fontFamily: BODY, fontSize: 14, color: MUTED }}>{label}</span>
      <span style={{ fontFamily: BODY, fontSize: 14, color: TEXT }}>{value}</span>
    </div>
  );
}

function ControlButton({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: BODY,
        fontSize: 14,
        color: active ? BG : MUTED,
        background: active ? ACCENT : 'transparent',
        border: active ? 'none' : CARD_BD,
        borderRadius: 6,
        padding: '8px 18px',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function formatMix(mix) {
  if (!mix) return '';
  if (!mix.secondary) {
    return mix.primary.name;
  }
  return `${mix.primary.name} + ${mix.secondary.name} (${mix.ratio})`;
}
