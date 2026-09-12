// unfold/worker.js — runs the one-piece solver off the main thread.
import { solveOnePiece, continueSearch } from './solver.js';

let state = null;
const strip = r => ({ mesh: r.mesh, tree: r.tree, overlaps: r.overlaps, simplifiedFrom: r.simplifiedFrom, rounds: r.rounds, ms: r.ms });

self.onmessage = async e => {
  const { type, id } = e.data;
  try {
    if (type === 'solve') {
      const r = await solveOnePiece(e.data.positions, { ...e.data.opts, onProgress: p => self.postMessage({ type: 'progress', id, ...p }) });
      state = r.state;
      self.postMessage({ type: 'done', id, ...strip(r) });
    } else if (type === 'more' && state) {
      const r = continueSearch(state, { timeLimit: e.data.timeLimit, onProgress: p => self.postMessage({ type: 'progress', id, ...p }) });
      self.postMessage({ type: 'done', id, ...strip(r) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err.message });
  }
};
