// ===================================================================
// WEB WORKER — Image analysis + mark generation off the main thread
// ===================================================================
// Protocol:
//   Main thread sends:
//     { type: 'analyze', imageData, width, height, displayW, displayH }
//
//   Worker replies with progress updates:
//     { type: 'progress', phase: 'analyze' | 'marks', progress: 0-1 }
//
//   Worker replies with final results:
//     { type: 'result', analysis: {...}, marks: [[...], ...], texture: [...] }
//
// Usage (main thread):
//   const worker = new Worker(
//     new URL('./engine/worker.js', import.meta.url),
//     { type: 'module' }
//   );
// ===================================================================

import { analyzeImage } from './analyzeImage.js';
import { generateAllMarks, generatePaperTexture } from './generateMarks.js';

self.onmessage = function (e) {
  const { type, imageData, width, height, displayW, displayH } = e.data;

  if (type !== 'analyze') return;

  // Phase 1: Analyze image
  const analysis = analyzeImage(imageData, width, height, (p) => {
    self.postMessage({ type: 'progress', phase: 'analyze', progress: p });
  });

  // Phase 2: Generate marks for every round
  const marks = generateAllMarks(analysis, displayW, displayH, (p) => {
    self.postMessage({ type: 'progress', phase: 'marks', progress: p });
  });

  // Phase 3: Paper texture dots
  const texture = generatePaperTexture(displayW, displayH);

  // Send results back (structured clone — no transferable arrays needed
  // because analysis contains typed arrays that are cloned efficiently)
  self.postMessage({ type: 'result', analysis, marks, texture });
};
