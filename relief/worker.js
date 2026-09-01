// relief/worker.js — runs the pattern + meshing build off the main thread.
// Positions come back as a transferable so big meshes cross without a copy.

import { generateFeatures, buildHeightfield } from './patterns.js';
import { gridForPanel, buildSolid, snapBase } from './mesh.js';

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

    // In stacked mode base and relief snap to whole sheets — report the
    // snapped totals so the UI and filenames can show real dimensions.
    const baseQ = snapBase(params.baseMm, params.sheetMm || 0);
    let reliefPeak = 0;
    for (let i = 0; i < heights.length; i++) {
      if (heights[i] > reliefPeak) reliefPeak = heights[i];
    }

    self.postMessage({
      type: 'done',
      result: {
        positions,
        featureCount: features.length,
        triangles: positions.length / 9,
        cell,
        baseMm: baseQ,
        totalMm: baseQ + reliefPeak,
        sheetMm: params.sheetMm || 0,
        ms: Math.round(performance.now() - t0)
      }
    }, [positions.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message, stack: err.stack });
  }
};
