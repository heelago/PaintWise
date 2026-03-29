// ===================================================================
// useImageUpload — React hook for photo upload + resize
// ===================================================================
// Handles drag-drop, file-input, validates type/size, resizes to
// maxDimension on the longest edge, and returns both a display-ready
// data URL and raw pixel data for the analysis worker.
// ===================================================================

import { useState, useCallback, useRef } from 'react';

export function useImageUpload(maxDimension = 2000) {
  const [image, setImage] = useState(null);        // { src: dataURL, width, height, element }
  const [imageData, setImageData] = useState(null); // { data: Uint8ClampedArray, width, height }
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const processFile = useCallback(async (file) => {
    setUploading(true);
    setError(null);

    // Validate MIME type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setError('Please upload a JPEG, PNG, or WebP image.');
      setUploading(false);
      return;
    }

    // Validate file size (10 MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be under 10MB.');
      setUploading(false);
      return;
    }

    try {
      const dataUrl = await readFileAsDataURL(file);
      const img = await loadImage(dataUrl);

      // Resize if the longest edge exceeds maxDimension
      const { canvas, width, height } = resizeImage(img, maxDimension);
      const ctx = canvas.getContext('2d');
      const pixels = ctx.getImageData(0, 0, width, height);

      setImage({ src: canvas.toDataURL('image/jpeg', 0.92), width, height, element: img });
      setImageData({ data: pixels.data, width, height });
    } catch (err) {
      setError('Failed to load image. Please try another file.');
    } finally {
      setUploading(false);
    }
  }, [maxDimension]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleFileInput = useCallback((e) => {
    const file = e.target?.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const reset = useCallback(() => {
    setImage(null);
    setImageData(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  return {
    image, imageData, uploading, error,
    inputRef, handleDrop, handleDragOver, handleFileInput, reset,
  };
}


// -- Helpers (module-private) --

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function resizeImage(img, maxDim) {
  let { naturalWidth: w, naturalHeight: h } = img;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, width: w, height: h };
}
