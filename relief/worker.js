// relief/worker.js — runs the pattern + meshing build off the main thread.
// Positions come back as a transferable so big meshes cross without a copy.

import { generateFeatures, buildHeightfield } from './patterns.js';
import { gridForPanel, buildSolid } from './mesh.js';

self.onmessage = e => {
  const params = e.data;
  try {
    const t0 = performance.now();
    const features = generateFeatures(params);
    self.postMessage({ type: 'progress', stage: 'Sampling heightfield' });

    const { nx, ny, cell } = gridForPanel(params.widthMm, params.heightMm, params.cellMm);
    const heights = buildHeightfield(features, params, nx, ny);
    self.postMessage({ type: 'progress', stage: 'Skinning solid' });

    const positions = buildSolid(heights, nx, ny, params);

    // Report the built totals: in stacked-slat mode the peak is the tallest
    // slat mid-line, and the slat count matches s1c3r's slicing formula.
    const base = Math.max(0.5, params.baseMm);
    let reliefPeak = 0;
    for (let i = 0; i < heights.length; i++) {
      if (heights[i] > reliefPeak) reliefPeak = heights[i];
    }
    const sheet = params.sheetMm || 0;
    const span = params.sliceAxis === 'y' ? params.heightMm : params.widthMm;
    const slats = sheet > 0
      ? Math.max(1, Math.floor((span - sheet * 0.5) / sheet) + 1)
      : 0;

    self.postMessage({
      type: 'done',
      result: {
        positions,
        featureCount: features.length,
        triangles: positions.length / 9,
        cell,
        totalMm: base + reliefPeak,
        sheetMm: sheet,
        slats,
        ms: Math.round(performance.now() - t0)
      }
    }, [positions.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message, stack: err.stack });
  }
};
