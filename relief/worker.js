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

    self.postMessage({
      type: 'done',
      result: {
        positions,
        featureCount: features.length,
        triangles: positions.length / 9,
        cell,
        ms: Math.round(performance.now() - t0)
      }
    }, [positions.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message, stack: err.stack });
  }
};
