// arrange/worker.js — runs the nester off the main thread.

import { prepare, nest, ROTATION_SETS } from './nest.js';
import { ringsForSheets } from './export.js';

let stop = false;

self.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'stop') { stop = true; return; }
  if (msg.type !== 'nest') return;

  stop = false;
  const { raw, items, sheet, opts } = msg;

  try {
    const parts = raw.map(r => prepare(
      { id: r.id, name: r.name, outer: Float64Array.from(r.outer), holes: (r.holes || []).map(h => Float64Array.from(h)) },
      ROTATION_SETS[r.rotation] || ROTATION_SETS[opts.rotation] || ROTATION_SETS.quarter
    ));

    let lastPost = 0;
    const result = nest({
      parts, items, sheet,
      spacing: opts.spacing,
      timeMs: opts.timeMs,
      seed: opts.seed,
      shouldStop: () => stop,
      onProgress: snap => {
        const now = Date.now();
        if (now - lastPost < 250) return;        // don't drown the UI thread
        lastPost = now;
        self.postMessage({
          type: 'progress',
          sheets: ringsForSheets(parts, snap.sheets),
          placed: snap.sheets.reduce((s, sh) => s + sh.length, 0),
          total: items.length,
        });
      },
    });

    self.postMessage({
      type: 'done',
      sheets: ringsForSheets(parts, result.sheets),
      placed: result.sheets.reduce((s, sh) => s + sh.length, 0),
      unplaced: result.unplaced,
      total: items.length,
      partArea: result.usedArea,
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
