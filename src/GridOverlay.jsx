import { useState, useCallback, useMemo } from 'react';

// ── Constants ────────────────────────────────────────────────────
const ACCENT = '#C69A5C';
const TEXT   = '#E8E4DF';
const MUTED  = 'rgba(232,228,223,0.45)';
const BODY   = "'Crimson Text', serif";
const CARD_BD = '1px solid rgba(198,154,92,0.12)';

const PAPER_SIZES = {
  a5: { label: 'A5', w: 148, h: 210 },
  a6: { label: 'A6', w: 105, h: 148 },
};

// ── Grid Overlay (rendered inside the SVG) ───────────────────────

export function GridLines({ viewBox, cols, onCellClick, measureMode, plotPoints, onPlotPoint, paperSize }) {
  const [vbX, vbY, vbW, vbH] = viewBox.split(' ').map(Number);
  const cellW = vbW / cols;
  const rows = Math.round(vbH / cellW);
  const cellH = vbH / rows;

  // Paper scale: mm per viewBox unit
  const paper = PAPER_SIZES[paperSize] || PAPER_SIZES.a5;
  const isLandscape = vbW > vbH;
  const paperW = isLandscape ? Math.max(paper.w, paper.h) : Math.min(paper.w, paper.h);
  const scale = paperW / vbW; // mm per vbUnit

  const handleClick = useCallback((e) => {
    // Get click position in viewBox coordinates
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());

    if (measureMode && onPlotPoint) {
      onPlotPoint({ x: Math.round(svgPt.x), y: Math.round(svgPt.y) });
    } else if (onCellClick) {
      const col = Math.floor(svgPt.x / cellW);
      const row = Math.floor(svgPt.y / cellH);
      if (col >= 0 && col < cols && row >= 0 && row < rows) {
        onCellClick({
          row, col,
          x: col * cellW, y: row * cellH,
          w: cellW, h: cellH,
        });
      }
    }
  }, [cellW, cellH, cols, rows, measureMode, onCellClick, onPlotPoint]);

  const rowLabel = (r) => String.fromCharCode(65 + r); // A, B, C...

  return (
    <g onClick={handleClick} style={{ cursor: measureMode ? 'crosshair' : 'pointer' }}>
      {/* Clickable background (transparent) */}
      <rect x={vbX} y={vbY} width={vbW} height={vbH} fill="transparent" />

      {/* Vertical grid lines */}
      {Array.from({ length: cols + 1 }, (_, i) => (
        <line
          key={`v${i}`}
          x1={i * cellW} y1={0}
          x2={i * cellW} y2={vbH}
          stroke="rgba(255,255,255,0.4)"
          strokeWidth={vbW * 0.001}
          strokeDasharray={`${vbW * 0.005},${vbW * 0.005}`}
        />
      ))}

      {/* Horizontal grid lines */}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <line
          key={`h${i}`}
          x1={0} y1={i * cellH}
          x2={vbW} y2={i * cellH}
          stroke="rgba(255,255,255,0.4)"
          strokeWidth={vbW * 0.001}
          strokeDasharray={`${vbW * 0.005},${vbW * 0.005}`}
        />
      ))}

      {/* Cell labels */}
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => (
          <text
            key={`label-${r}-${c}`}
            x={c * cellW + cellW * 0.05}
            y={r * cellH + cellH * 0.15}
            fill="rgba(255,255,255,0.5)"
            fontSize={vbW * 0.012}
            fontFamily="monospace"
          >
            {rowLabel(r)}{c + 1}
          </text>
        ))
      )}

      {/* Measure mode: plot points */}
      {measureMode && plotPoints.map((pt, i) => (
        <g key={`pt-${i}`}>
          <circle cx={pt.x} cy={pt.y} r={vbW * 0.006} fill={ACCENT} stroke="white" strokeWidth={vbW * 0.002} />
          <text
            x={pt.x + vbW * 0.01}
            y={pt.y - vbW * 0.01}
            fill="white"
            fontSize={vbW * 0.012}
            fontFamily="monospace"
          >
            {i + 1}
          </text>
        </g>
      ))}

      {/* Measure mode: lines + distances between consecutive points */}
      {measureMode && plotPoints.map((pt, i) => {
        if (i === 0) return null;
        const prev = plotPoints[i - 1];
        const dx = pt.x - prev.x;
        const dy = pt.y - prev.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const distMm = (dist * scale).toFixed(1);
        const midX = (pt.x + prev.x) / 2;
        const midY = (pt.y + prev.y) / 2;
        return (
          <g key={`line-${i}`}>
            <line
              x1={prev.x} y1={prev.y}
              x2={pt.x} y2={pt.y}
              stroke={ACCENT}
              strokeWidth={vbW * 0.002}
              strokeDasharray={`${vbW * 0.008},${vbW * 0.004}`}
            />
            {/* Distance label with background */}
            <rect
              x={midX - vbW * 0.04}
              y={midY - vbW * 0.015}
              width={vbW * 0.08}
              height={vbW * 0.025}
              rx={vbW * 0.004}
              fill="rgba(0,0,0,0.7)"
            />
            <text
              x={midX}
              y={midY + vbW * 0.005}
              fill={ACCENT}
              fontSize={vbW * 0.014}
              fontFamily="monospace"
              textAnchor="middle"
            >
              {distMm}mm
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ── Cell Magnification Overlay ───────────────────────────────────

export function CellMagnifier({ composition, cell, onClose }) {
  if (!cell || !composition) return null;

  const { viewBox, layers } = composition;
  const cellViewBox = `${cell.x} ${cell.y} ${cell.w} ${cell.h}`;

  // Collect colors visible in this cell region
  const cellColors = useMemo(() => {
    const colors = new Set();
    for (const layer of layers) {
      for (const el of layer.elements) {
        if (el.type === 'defs') continue;
        const fill = el.attrs?.fill;
        const stroke = el.attrs?.stroke;
        if (fill && fill !== 'none' && !fill.startsWith('url(')) colors.add(fill);
        if (stroke && stroke !== 'none') colors.add(stroke);
      }
    }
    return [...colors].slice(0, 12);
  }, [layers]);

  const rowLabel = String.fromCharCode(65 + cell.row);

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: '#1E1C1A',
        borderRadius: 12,
        padding: 20,
        maxWidth: 500,
        width: '90vw',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        border: CARD_BD,
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontFamily: BODY, fontSize: 18, color: ACCENT }}>
            Cell {rowLabel}{cell.col + 1}
          </span>
          <span
            onClick={onClose}
            style={{ fontSize: 20, color: MUTED, cursor: 'pointer', padding: '0 4px' }}
          >
            ×
          </span>
        </div>

        {/* Zoomed SVG */}
        <div style={{
          background: '#E8E0D4',
          borderRadius: 8,
          overflow: 'hidden',
          lineHeight: 0,
        }}>
          <svg
            viewBox={cellViewBox}
            xmlns="http://www.w3.org/2000/svg"
            style={{ width: '100%', height: 'auto', display: 'block' }}
          >
            {/* Collect defs */}
            <defs>
              {layers.map((layer, li) =>
                layer.elements
                  .filter(el => el.type === 'defs' && el.content)
                  .map((el, ei) => (
                    <g key={`d-${li}-${ei}`} dangerouslySetInnerHTML={{ __html: el.content }} />
                  ))
              )}
            </defs>

            {/* Render all layers */}
            {layers.map((layer, li) => (
              <g key={layer.id}>
                {layer.elements.map((el, ei) => {
                  if (el.type === 'defs') return null;
                  const attrs = { ...el.attrs };
                  const key = `${el.type}-${li}-${ei}`;
                  switch (el.type) {
                    case 'rect':     return <rect key={key} {...attrs} />;
                    case 'circle':   return <circle key={key} {...attrs} />;
                    case 'ellipse':  return <ellipse key={key} {...attrs} />;
                    case 'path':     return <path key={key} {...attrs} />;
                    case 'line':     return <line key={key} {...attrs} />;
                    case 'polygon':  return <polygon key={key} {...attrs} />;
                    case 'polyline': return <polyline key={key} {...attrs} />;
                    case 'use':      return <use key={key} {...attrs} />;
                    default:         return null;
                  }
                })}
              </g>
            ))}

            {/* Cell border */}
            <rect
              x={cell.x} y={cell.y}
              width={cell.w} height={cell.h}
              fill="none"
              stroke={ACCENT}
              strokeWidth={cell.w * 0.005}
              strokeDasharray={`${cell.w * 0.02},${cell.w * 0.02}`}
            />
          </svg>
        </div>

        {/* Color swatches */}
        {cellColors.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <span style={{ fontFamily: BODY, fontSize: 12, color: MUTED }}>Colors in composition:</span>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {cellColors.map((color, i) => (
                <div key={i} style={{
                  width: 28, height: 28, borderRadius: 4,
                  background: color,
                  border: '1px solid rgba(255,255,255,0.1)',
                  cursor: 'pointer',
                  position: 'relative',
                }} title={color}>
                  <span style={{
                    position: 'absolute', bottom: -14, left: '50%', transform: 'translateX(-50%)',
                    fontSize: 8, color: MUTED, fontFamily: 'monospace', whiteSpace: 'nowrap',
                  }}>
                    {color}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Grid Controls (for the toolbar) ──────────────────────────────

export function GridControls({ gridOn, onToggleGrid, cols, onChangeCols, measureMode, onToggleMeasure, paperSize, onChangePaper, onClearPoints }) {
  return (
    <>
      <CtrlBtn onClick={onToggleGrid} active={gridOn} label={gridOn ? 'Grid On' : 'Grid'} />
      {gridOn && (
        <>
          <select
            value={cols}
            onChange={e => onChangeCols(Number(e.target.value))}
            style={{
              fontFamily: BODY, fontSize: 13, color: TEXT, background: 'transparent',
              border: CARD_BD, borderRadius: 6, padding: '5px 8px', cursor: 'pointer',
            }}
          >
            <option value={3} style={{ background: '#1E1C1A' }}>3 cols</option>
            <option value={4} style={{ background: '#1E1C1A' }}>4 cols</option>
            <option value={6} style={{ background: '#1E1C1A' }}>6 cols</option>
            <option value={8} style={{ background: '#1E1C1A' }}>8 cols</option>
          </select>
          <CtrlBtn onClick={onToggleMeasure} active={measureMode} label={measureMode ? 'Measuring' : 'Measure'} />
          {measureMode && (
            <>
              <select
                value={paperSize}
                onChange={e => onChangePaper(e.target.value)}
                style={{
                  fontFamily: BODY, fontSize: 13, color: TEXT, background: 'transparent',
                  border: CARD_BD, borderRadius: 6, padding: '5px 8px', cursor: 'pointer',
                }}
              >
                <option value="a5" style={{ background: '#1E1C1A' }}>A5</option>
                <option value="a6" style={{ background: '#1E1C1A' }}>A6</option>
              </select>
              <CtrlBtn onClick={onClearPoints} label="Clear" />
            </>
          )}
        </>
      )}
    </>
  );
}

function CtrlBtn({ onClick, label, active, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: BODY, fontSize: 14,
        color: active ? '#1E1C1A' : disabled ? 'rgba(232,228,223,0.2)' : MUTED,
        background: active ? ACCENT : 'transparent',
        border: active ? 'none' : CARD_BD,
        borderRadius: 6, padding: '6px 14px',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.15s',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {label}
    </button>
  );
}
