// umbra/worker.js — keeps clipping and triangulation off the main thread.

import { shapesToPolygons, fitToWall, buildSolid, polyStats } from './mesh.js';

self.onmessage = e => {
  const { shapes, wallArtWidth, build, strokeOverride, forceStroke } = e.data;
  try {
    const art = shapesToPolygons(shapes, { strokeOverride, forceStroke });
    if (!art.length) throw new Error('That SVG produced no filled area. If it is line art, turn on "outline strokes".');
    const fit = fitToWall(art, wallArtWidth);
    const stats = polyStats(fit.mp);
    const r = buildSolid(fit.mp, build);
    self.postMessage({
      ok: true,
      positions: r.positions,
      artFloatCount: r.artFloatCount,
      groupCount: r.groupCount,
      bars: r.bars,
      warnings: r.warnings,
      material: r.material,
      art: fit.mp,
      stats,
      bounds: fit.bounds
    }, [r.positions.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || String(err) });
  }
};
