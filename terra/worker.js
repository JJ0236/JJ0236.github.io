// terra/worker.js — runs the geometry build off the main thread.
//
// Fetching stays on the main thread (progress UI, mirror fallback); only the
// CPU-bound meshing happens here. Layer positions come back as transferables,
// so a multi-million-triangle model crosses the boundary without a copy.

import { buildModel, checkManifold } from './geometry.js';

self.onmessage = e => {
  const { selection, dem, osm, params, verify } = e.data;
  try {
    const result = buildModel({
      selection, dem, osm, params,
      onProgress: (stage, frac) => self.postMessage({ type: 'progress', stage, frac })
    });

    if (verify) {
      result.checks = result.layers.map(l => ({
        id: l.id,
        ...checkManifold(l.positions, l.parts)
      }));
    }

    self.postMessage({ type: 'done', result },
      result.layers.map(l => l.positions.buffer));
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message, stack: err.stack });
  }
};
