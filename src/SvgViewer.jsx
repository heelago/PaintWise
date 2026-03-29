import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// ── Style constants (matching PaintingPage dark theme) ────────────
const BG      = '#1E1C1A';
const TEXT    = '#E8E4DF';
const ACCENT  = '#C69A5C';
const MUTED   = 'rgba(232,228,223,0.45)';
const CARD_BG = 'rgba(232,228,223,0.03)';
const CARD_BD = '1px solid rgba(198,154,92,0.12)';
const HEADING = "'Playfair Display', serif";
const BODY    = "'Crimson Text', serif";

// ── Element renderer ─────────────────────────────────────────────

function renderElement(el, index, outlineMode) {
  const attrs = { ...el.attrs };

  if (outlineMode && el.type !== 'defs') {
    const origStroke = el.attrs.stroke;
    const origFill = el.attrs.fill;
    if (origStroke && origFill === 'none') {
      // Already a stroke-only element (texture paths) — thin it out
      attrs.strokeWidth = 1;
      attrs.opacity = 0.5;
      delete attrs.strokeDasharray;
    } else {
      attrs.fill = 'none';
      attrs.stroke = origFill || ACCENT;
      attrs.strokeWidth = 1;
      attrs.opacity = 0.7;
    }
  }

  // Handle style object (e.g., mixBlendMode)
  if (attrs.style && typeof attrs.style === 'string') {
    try { attrs.style = JSON.parse(attrs.style); } catch { delete attrs.style; }
  }

  const key = `${el.type}-${index}`;

  switch (el.type) {
    case 'rect':    return <rect key={key} {...attrs} />;
    case 'circle':  return <circle key={key} {...attrs} />;
    case 'ellipse': return <ellipse key={key} {...attrs} />;
    case 'path':    return <path key={key} {...attrs} />;
    case 'line':    return <line key={key} {...attrs} />;
    case 'text':    return <text key={key} {...attrs}>{attrs.children || attrs.text || ''}</text>;
    case 'g':       return <g key={key} {...attrs}>{(el.children || []).map((c, ci) => renderElement(c, `${index}-${ci}`, outlineMode))}</g>;
    case 'defs':    return null; // handled separately
    default:        return null;
  }
}

// ── Extract dominant fill color from a layer's elements ──────────

function layerDominantColor(layer) {
  for (const el of layer.elements) {
    if (el.type === 'defs') continue;
    if (el.attrs.fill && el.attrs.fill !== 'none' && !el.attrs.fill.startsWith('url(')) {
      return el.attrs.fill;
    }
    if (el.attrs.stroke && el.attrs.stroke !== 'none') {
      return el.attrs.stroke;
    }
  }
  return ACCENT;
}

// ── Main component ───────────────────────────────────────────────

export default function SvgViewer({ composition }) {
  const { viewBox, layers } = composition;
  const layerCount = layers.length;

  const [visibleLayers, setVisibleLayers] = useState(() => layers.map(() => true));
  const [activeStep, setActiveStep] = useState(layerCount - 1);
  const [outlineMode, setOutlineMode] = useState(false);
  const [freeToggle, setFreeToggle] = useState(false);
  const svgRef = useRef(null);

  const saveAsImage = useCallback((format = 'png') => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const [, , w, h] = viewBox.split(' ').map(Number);
      const scale = 2; // 2x for retina quality
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#F2EDE5'; // paper background
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const link = document.createElement('a');
      link.download = `paintwise-composition.${format}`;
      link.href = canvas.toDataURL(format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95);
      link.click();
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [viewBox]);

  // Reset state when layer count changes (new composition)
  useEffect(() => {
    setVisibleLayers(layers.map(() => true));
    setActiveStep(layerCount - 1);
    setFreeToggle(false);
  }, [layerCount]);

  // Collect all defs content across all visible layers
  const allDefs = useMemo(() => {
    const parts = [];
    layers.forEach((layer, li) => {
      if (!visibleLayers[li]) return;
      for (const el of layer.elements) {
        if (el.type === 'defs' && el.content) {
          parts.push(el.content);
        }
      }
    });
    return parts.join('');
  }, [layers, visibleLayers]);

  // Step navigation
  const stepTo = useCallback((step) => {
    const clamped = Math.max(0, Math.min(layers.length - 1, step));
    setActiveStep(clamped);
    setFreeToggle(false);
    setVisibleLayers(layers.map((_, i) => i <= clamped));
  }, [layers]);

  const stepPrev = useCallback(() => stepTo(activeStep - 1), [activeStep, stepTo]);
  const stepNext = useCallback(() => stepTo(activeStep + 1), [activeStep, stepTo]);

  const showAll = useCallback(() => {
    setVisibleLayers(layers.map(() => true));
    setActiveStep(layers.length - 1);
    setFreeToggle(false);
  }, [layers]);

  const hideAll = useCallback(() => {
    setVisibleLayers(layers.map(() => false));
    setActiveStep(0);
    setFreeToggle(true);
  }, [layers]);

  const toggleLayer = useCallback((idx) => {
    setFreeToggle(true);
    setVisibleLayers((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  }, []);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── SVG Canvas ──────────────────────────────────────────── */}
      <div style={{
        background: '#E8E0D4',
        borderRadius: 8,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        overflow: 'hidden',
        lineHeight: 0,
      }}>
        <svg
          ref={svgRef}
          viewBox={viewBox}
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          {/* Defs block */}
          {allDefs && (
            <defs dangerouslySetInnerHTML={{ __html: allDefs }} />
          )}

          {/* Layers */}
          {layers.map((layer, li) => (
            <g
              key={layer.id}
              opacity={visibleLayers[li] ? 1 : 0}
              style={{ transition: 'opacity 0.3s ease' }}
            >
              {layer.elements.map((el, ei) => renderElement(el, ei, outlineMode))}
            </g>
          ))}
        </svg>
      </div>

      {/* ── Controls ────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        marginTop: 16,
      }}>
        {/* Step-through + bulk buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <CtrlBtn onClick={stepPrev} disabled={activeStep <= 0} label="Previous" />
          <CtrlBtn onClick={stepNext} disabled={activeStep >= layers.length - 1} label="Next" />
          <Spacer />
          <CtrlBtn onClick={showAll} label="Show All" />
          <CtrlBtn onClick={hideAll} label="Hide All" />
          <Spacer />
          <CtrlBtn
            onClick={() => setOutlineMode((m) => !m)}
            active={outlineMode}
            label={outlineMode ? 'Filled' : 'Outline'}
          />
          <Spacer />
          <CtrlBtn onClick={() => saveAsImage('png')} label="Save PNG" />
          <CtrlBtn onClick={() => saveAsImage('jpg')} label="Save JPG" />
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {layers.map((_, i) => {
            const isVisible = visibleLayers[i];
            const isActive = !freeToggle && i === activeStep;
            return (
              <div
                key={i}
                onClick={() => stepTo(i)}
                style={{
                  width: isActive ? 10 : 8,
                  height: isActive ? 10 : 8,
                  borderRadius: '50%',
                  background: isActive ? ACCENT : isVisible ? TEXT : 'rgba(232,228,223,0.15)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  border: isActive ? `1px solid ${ACCENT}` : '1px solid transparent',
                }}
                title={layers[i].name}
              />
            );
          })}
        </div>
      </div>

      {/* ── Layer List ──────────────────────────────────────────── */}
      <div style={{
        marginTop: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        <h3 style={{
          fontFamily: HEADING,
          fontSize: 16,
          color: ACCENT,
          margin: '0 0 8px',
          fontWeight: 400,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
        }}>
          Layers
        </h3>

        {layers.map((layer, i) => {
          const isActive = !freeToggle && i === activeStep;
          const isVisible = visibleLayers[i];
          const dotColor = layerDominantColor(layer);

          return (
            <div
              key={layer.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 6,
                background: isActive ? 'rgba(198,154,92,0.08)' : 'transparent',
                transition: 'background 0.15s',
              }}
            >
              {/* Color dot */}
              <div style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: dotColor,
                flexShrink: 0,
                marginTop: 3,
                opacity: isVisible ? 1 : 0.25,
                border: '1px solid rgba(255,255,255,0.08)',
              }} />

              {/* Text block */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontFamily: BODY,
                  fontSize: 14,
                  color: isVisible ? TEXT : MUTED,
                  margin: 0,
                }}>
                  {i + 1}. {layer.name}
                </p>
                <p style={{
                  fontFamily: BODY,
                  fontSize: 12,
                  color: 'rgba(232,228,223,0.3)',
                  margin: '2px 0 0',
                }}>
                  {layer.description}
                </p>
                {isActive && layer.paintingTip && (
                  <p style={{
                    fontFamily: BODY,
                    fontSize: 12,
                    fontStyle: 'italic',
                    color: ACCENT,
                    margin: '4px 0 0',
                    lineHeight: 1.4,
                  }}>
                    {layer.paintingTip}
                  </p>
                )}
              </div>

              {/* Eye toggle */}
              <span
                onClick={() => toggleLayer(i)}
                style={{
                  fontSize: 16,
                  color: isVisible ? ACCENT : 'rgba(232,228,223,0.2)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  marginTop: 2,
                  userSelect: 'none',
                }}
              >
                {isVisible ? '\u25C9' : '\u25CB'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────

function CtrlBtn({ onClick, label, active, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: BODY,
        fontSize: 14,
        color: active ? BG : disabled ? 'rgba(232,228,223,0.2)' : MUTED,
        background: active ? ACCENT : 'transparent',
        border: active ? 'none' : CARD_BD,
        borderRadius: 6,
        padding: '6px 14px',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.15s',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {label}
    </button>
  );
}

function Spacer() {
  return <div style={{ width: 8 }} />;
}
