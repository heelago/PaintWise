import { useState, useCallback } from 'react';
import { useImageUpload } from './engine/useImageUpload';

// ── Style constants (shared dark theme) ──────────────────────────
const BG       = '#1E1C1A';
const TEXT     = '#E8E4DF';
const ACCENT   = '#C69A5C';
const MUTED    = 'rgba(232,228,223,0.45)';
const CARD_BG  = 'rgba(232,228,223,0.03)';
const CARD_BD  = '1px solid rgba(198,154,92,0.12)';
const HEADING  = "'Playfair Display', serif";
const BODY     = "'Crimson Text', serif";

export default function UploadPage({ onAnalyze }) {
  const {
    image, imageData, uploading, error,
    inputRef, handleDrop, handleDragOver, handleFileInput, reset,
  } = useImageUpload();

  const [dragging, setDragging] = useState(false);

  const onDragEnter = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const onDropWrapped = useCallback((e) => {
    setDragging(false);
    handleDrop(e);
  }, [handleDrop]);

  // Load sample photo
  const loadSample = useCallback(async () => {
    try {
      const res = await fetch('/reference-sunset.jpeg');
      const blob = await res.blob();
      const file = new File([blob], 'reference-sunset.jpeg', { type: blob.type });
      // Reuse the processFile path via a synthetic input event
      const dt = new DataTransfer();
      dt.items.add(file);
      const syntheticEvent = { dataTransfer: dt, preventDefault() {}, stopPropagation() {} };
      handleDrop(syntheticEvent);
    } catch {
      // Silently fail — sample may not exist
    }
  }, [handleDrop]);

  return (
    <div style={{
      minHeight: '100vh',
      background: BG,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 600, width: '100%', textAlign: 'center' }}>

        {/* Title */}
        <h1 style={{
          fontFamily: HEADING,
          fontSize: 48,
          color: ACCENT,
          margin: '0 0 12px',
          fontWeight: 400,
          letterSpacing: 1,
        }}>
          PaintWise
        </h1>

        {/* Subtitle */}
        <p style={{
          fontFamily: BODY,
          fontSize: 20,
          color: MUTED,
          margin: '0 0 40px',
          lineHeight: 1.5,
        }}>
          Upload a photo. Get a watercolor painting guide.
        </p>

        {/* Drop zone */}
        {!image ? (
          <div
            onDrop={onDropWrapped}
            onDragOver={handleDragOver}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            style={{
              height: 200,
              border: `2px dashed ${dragging ? ACCENT : 'rgba(198,154,92,0.3)'}`,
              borderRadius: 12,
              background: dragging ? 'rgba(198,154,92,0.06)' : CARD_BG,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'border-color 0.2s, background 0.2s',
            }}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <p style={{ fontFamily: BODY, fontSize: 18, color: ACCENT, margin: 0 }}>
                Processing...
              </p>
            ) : error ? (
              <p style={{ fontFamily: BODY, fontSize: 16, color: '#D45', margin: 0 }}>
                {error}
              </p>
            ) : (
              <>
                <p style={{ fontFamily: BODY, fontSize: 18, color: TEXT, margin: '0 0 16px' }}>
                  Drop your photo here
                </p>
                <button style={{
                  fontFamily: BODY,
                  fontSize: 16,
                  background: 'transparent',
                  color: ACCENT,
                  border: `1px solid ${ACCENT}`,
                  borderRadius: 6,
                  padding: '8px 24px',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                }}>
                  Browse
                </button>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={handleFileInput}
            />
          </div>
        ) : (
          /* Thumbnail + Analyze */
          <div style={{
            background: CARD_BG,
            border: CARD_BD,
            borderRadius: 12,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 20,
          }}>
            <img
              src={image.src}
              alt="Uploaded photo"
              style={{
                maxWidth: '100%',
                maxHeight: 300,
                borderRadius: 8,
                objectFit: 'contain',
              }}
            />
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={reset}
                style={{
                  fontFamily: BODY,
                  fontSize: 16,
                  background: 'transparent',
                  color: MUTED,
                  border: `1px solid rgba(232,228,223,0.15)`,
                  borderRadius: 6,
                  padding: '10px 24px',
                  cursor: 'pointer',
                }}
              >
                Choose Another
              </button>
              <button
                onClick={() => onAnalyze(imageData, image)}
                style={{
                  fontFamily: BODY,
                  fontSize: 16,
                  background: ACCENT,
                  color: BG,
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 32px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  letterSpacing: 0.5,
                }}
              >
                Analyze
              </button>
            </div>
          </div>
        )}

        {/* File type hint */}
        <p style={{
          fontFamily: BODY,
          fontSize: 14,
          color: 'rgba(232,228,223,0.3)',
          margin: '16px 0 0',
        }}>
          JPEG, PNG, or WebP &middot; Under 10 MB
        </p>

        {/* Sample button */}
        {!image && (
          <button
            onClick={loadSample}
            style={{
              fontFamily: BODY,
              fontSize: 15,
              color: 'rgba(198,154,92,0.6)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              marginTop: 24,
              textDecoration: 'underline',
              textUnderlineOffset: 4,
            }}
          >
            Try with sample photo
          </button>
        )}
      </div>
    </div>
  );
}
