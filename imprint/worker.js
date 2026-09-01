// imprint/worker.js — image → heightfield → watertight solid, off the main
// thread. Positions come back as a transferable.

import { heightsFromImage } from './process.js';
import { gridForPanel, buildSolid } from '../relief/mesh.js';

self.onmessage = e => {
  const { gray, iw, ih, params } = e.data;
  try {
    const t0 = performance.now();
    const { nx, ny, cell } = gridForPanel(params.widthMm, params.heightMm, params.cellMm);
    self.postMessage({ type: 'progress', stage: 'Sampling image' });
    const heights = heightsFromImage(gray, iw, ih, params, nx, ny);
    self.postMessage({ type: 'progress', stage: 'Skinning solid' });
    const positions = buildSolid(heights, nx, ny, params);

    const base = Math.max(0.5, params.baseMm);
    let peak = 0;
    for (let i = 0; i < heights.length; i++) if (heights[i] > peak) peak = heights[i];
    const sheet = params.sheetMm || 0;
    const span = params.sliceAxis === 'y' ? params.heightMm : params.widthMm;
    const slats = sheet > 0
      ? Math.max(1, Math.floor((span - sheet * 0.5) / sheet) + 1)
      : 0;

    self.postMessage({
      type: 'done',
      result: {
        positions,
        triangles: positions.length / 9,
        cell,
        totalMm: base + peak,
        sheetMm: sheet,
        slats,
        ms: Math.round(performance.now() - t0)
      }
    }, [positions.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message, stack: err.stack });
  }
};
