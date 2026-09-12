// unfold/solver.js — one-piece nets by tabu search over the unfold tree.
//
// After Zawallich, "Unfolding Polyhedra via Tabu Search" (2023): keep one
// spanning tree of the dual graph, count overlapping face pairs, and move a
// random overlapping face (with its subtree) to a different neighbour, taking
// the move that lowers the count most. A short tabu list stops the search
// undoing itself and a random re-root each iteration keeps every face movable.
// When search stalls, edges of the overlapping faces are collapsed first
// (after Bhargava et al., "Mesh Simplification for Unfolding", 2024) and the
// search resumes on the simpler mesh.
//
// Pure: runs in a worker or under node.

import { prepareLayout, polysOverlap } from './unfold.js';
import { buildMesh } from './mesh.js';
import { decimate } from './decimate.js';

const mulberry32 = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/* ── Net: a tree with its layout and overlap bookkeeping ─────────────────── */

export class Net {
  constructor(mesh, seed = 1) {
    this.mesh = mesh;
    this.F = mesh.faces.length;
    const L = prepareLayout(mesh, mesh.verts);
    this.local = L.local; this.adj = L.adj; this.place = L.placeAgainst;
    this.rng = mulberry32(seed);
    const F = this.F;
    this.parent = new Int32Array(F).fill(-1);
    this.parentEdge = new Array(F).fill(null);
    this.pos = new Array(F);
    // Dual-graph components: overlaps only count within one.
    this.comp = new Int32Array(F).fill(-1);
    let c = 0;
    for (let s = 0; s < F; s++) {
      if (this.comp[s] >= 0) continue;
      const stack = [s]; this.comp[s] = c;
      while (stack.length) { const f = stack.pop(); for (const { to } of this.adj[f]) if (this.comp[to] < 0) { this.comp[to] = c; stack.push(to); } }
      c++;
    }
    this.components = c;
    // Grid cell from the median face size.
    // Grid cell from the median face, but never so small that the largest
    // face spans more than a handful of cells: decimation can leave a few
    // huge faces beside many slivers, and a face touching thousands of cells
    // makes every move crawl.
    const sizes = this.local.map(poly => { const b = bboxOf(poly); return Math.max(b.w, b.h); }).sort((a, b) => a - b);
    this.cell = Math.max(1e-6, sizes[sizes.length >> 1] * 1.5, sizes[sizes.length - 1] / 6);
    this.grid = new Map();
    this.cellsOf = new Array(F).fill(null);
    this.ov = Array.from({ length: F }, () => new Set());
    this.total = 0;
    this.stamp = new Int32Array(F);
    this.stampId = 0;
  }

  /* grid */
  cellKeys(poly) {
    const b = bboxOf(poly), c = this.cell;
    const x0 = Math.floor(b.x0 / c), x1 = Math.floor(b.x1 / c), y0 = Math.floor(b.y0 / c), y1 = Math.floor(b.y1 / c);
    const keys = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(x * 73856093 ^ y * 19349663);
    return keys;
  }
  insert(f) {
    const keys = this.cellKeys(this.pos[f]);
    this.cellsOf[f] = keys;
    for (const k of keys) { let s = this.grid.get(k); if (!s) { s = new Set(); this.grid.set(k, s); } s.add(f); }
  }
  remove(f) {
    for (const k of this.cellsOf[f] || []) { const s = this.grid.get(k); if (s) { s.delete(f); if (!s.size) this.grid.delete(k); } }
    this.cellsOf[f] = null;
  }
  // Overlaps of face f against everything currently in the grid.
  overlapsOf(f) {
    const out = [];
    const seen = new Set();
    for (const k of this.cellsOf[f]) for (const g of this.grid.get(k) || []) {
      if (g === f || seen.has(g) || this.comp[g] !== this.comp[f]) continue;
      seen.add(g);
      if (polysOverlap(this.pos[f], this.pos[g])) out.push(g);
    }
    return out;
  }
  clearOv(f) { for (const g of this.ov[f]) { this.ov[g].delete(f); this.total--; } this.ov[f].clear(); }
  setOv(f) { for (const g of this.overlapsOf(f)) { if (!this.ov[f].has(g)) { this.ov[f].add(g); this.ov[g].add(f); this.total++; } } }

  /* tree */
  subtree(f) {
    const out = [f];
    this.stampId++;
    this.stamp[f] = this.stampId;
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      for (const { to } of this.adj[p]) if (this.parent[to] === p && this.stamp[to] !== this.stampId) { this.stamp[to] = this.stampId; out.push(to); }
    }
    return out;
  }

  // Place f against its parent (or at its local coords for a root) and every
  // descendant after it; refresh grid and overlaps for the whole subtree.
  relayout(f) {
    const S = this.subtree(f);
    for (const s of S) { if (this.cellsOf[s]) { this.clearOv(s); this.remove(s); } }
    for (const s of S) {
      const p = this.parent[s];
      this.pos[s] = p < 0 ? this.local[s] : this.place(this.pos[p], p, s, this.parentEdge[s]);
      this.insert(s);
    }
    for (const s of S) this.setOv(s);
    return S;
  }

  layoutAll() {
    this.grid.clear(); this.cellsOf.fill(null);
    for (const s of this.ov) s.clear();
    this.total = 0;
    for (let f = 0; f < this.F; f++) if (this.parent[f] < 0) this.relayout(f);
  }

  // Make r the root of its tree. Positions do not change: placing a parent
  // against its child is the same rigid relation.
  reroot(r) {
    const path = [];
    for (let f = r; f >= 0; f = this.parent[f]) path.push(f);
    const edges = path.map(f => this.parentEdge[f]);
    this.parent[r] = -1; this.parentEdge[r] = null;
    for (let i = 0; i + 1 < path.length; i++) {
      const node = path[i], old = path[i + 1];
      this.parent[old] = node; this.parentEdge[old] = edges[i];
    }
  }

  // Initial tree: grow face by face along long edges; when no overlap-free
  // attachment remains, take the least overlapping one anyway.
  grow(jitter = 0.3) {
    const F = this.F, rng = this.rng;
    const placed = new Uint8Array(F);
    this.parent.fill(-1); this.parentEdge.fill(null);
    this.grid.clear(); this.cellsOf.fill(null); for (const s of this.ov) s.clear(); this.total = 0;
    const byArea = [...Array(F).keys()].sort((a, b) => this.mesh.faces[b].area - this.mesh.faces[a].area);
    for (const root of byArea) {
      if (placed[root]) continue;
      placed[root] = 1; this.pos[root] = this.local[root]; this.insert(root); this.setOv(root);
      let cands = [];
      const push = f => { for (const { e, to } of this.adj[f]) if (!placed[to]) cands.push({ e, to, from: f, pri: e.len * (1 + jitter * rng()) }); };
      push(root);
      while (cands.length) {
        cands.sort((a, b) => b.pri - a.pri);
        cands = cands.filter(c => !placed[c.to]);
        if (!cands.length) break;
        let chosen = null, chosenPos = null, chosenOv = Infinity;
        const limit = Math.min(cands.length, 24);
        for (let i = 0; i < limit; i++) {
          const c = cands[i];
          const p = this.place(this.pos[c.from], c.from, c.to, c.e);
          this.pos[c.to] = p; this.insert(c.to);
          const n = this.overlapsOf(c.to).length;
          this.remove(c.to);
          if (n < chosenOv) { chosenOv = n; chosen = c; chosenPos = p; if (n === 0) break; }
        }
        const { e, to, from } = chosen;
        placed[to] = 1; this.parent[to] = from; this.parentEdge[to] = e; this.pos[to] = chosenPos;
        this.insert(to); this.setOv(to);
        push(to);
      }
    }
  }

  overlappingFaces() { const out = []; for (let f = 0; f < this.F; f++) if (this.ov[f].size) out.push(f); return out; }

  snapshot() { return { parent: Array.from(this.parent), parentEdge: this.parentEdge.slice(), total: this.total }; }
  restore(s) { this.parent.set(s.parent); this.parentEdge = s.parentEdge.slice(); this.layoutAll(); }

  // Export for unfold(): parents-before-children order and plain edge copies.
  tree(info) {
    const order = [];
    const F = this.F;
    for (let r = 0; r < F; r++) if (this.parent[r] < 0) {
      order.push(r);
      for (let i = order.length - 1; i < order.length; i++) {
        const p = order[i];
        for (const { to } of this.adj[p]) if (this.parent[to] === p) order.push(to);
      }
    }
    return { parent: Array.from(this.parent), parentEdge: this.parentEdge.map(e => e ? { id: e.id, a: e.a, b: e.b, sides: e.sides, len: e.len, dihedral: e.dihedral } : null), order, info };
  }
}

const bboxOf = pts => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
};

/* ── Tabu search ─────────────────────────────────────────────────────────── */

// Runs until no overlaps remain or the deadline passes. Returns the best
// snapshot seen and leaves the net in that state.
export function tabuSearch(net, { deadline, onProgress, maxIter = 1e9 } = {}) {
  const F = net.F, rng = net.rng;
  const m = Math.max(4, Math.round(3 * Math.log(Math.max(4, F)) / Math.log(3)));
  const tabu = [];
  const isTabu = key => tabu.includes(key);
  let best = net.snapshot(), iter = 0, sinceBest = 0, lastReport = now(), lastImprove = now(), restarts = 0;
  const stallMs = Math.max(1500, (deadline - now()) / 5);
  const report = () => { if (onProgress && now() - lastReport > 150) { lastReport = now(); onProgress({ overlaps: net.total, best: best.total, iter }); } };

  // Subtree sizes under the current rooting, for choosing a parent direction.
  const sub = new Int32Array(F);
  const subtreeSizes = () => {
    sub.fill(1);
    const order = [];
    for (let r = 0; r < F; r++) if (net.parent[r] < 0) {
      order.push(r);
      for (let i = order.length - 1; i < order.length; i++) { const p = order[i]; for (const { to } of net.adj[p]) if (net.parent[to] === p) order.push(to); }
    }
    for (let i = order.length - 1; i >= 0; i--) { const f = order[i], p = net.parent[f]; if (p >= 0) sub[p] += sub[f]; }
  };
  const compSize = new Int32Array(net.components);
  for (let f = 0; f < F; f++) compSize[net.comp[f]]++;

  while (net.total > 0 && iter < maxIter) {
    if (now() > deadline) break;
    iter++;
    const ovs = net.overlappingFaces();
    if (!ovs.length) break;
    let f = ovs[Math.floor(rng() * ovs.length)];
    // Re-root into f's largest branch so f drags the smallest possible
    // subtree with it: a move then disturbs the net as little as it can.
    subtreeSizes();
    let bestDir = -1, bestSide = -1;
    for (const { to } of net.adj[f]) {
      if (net.parent[to] === f) { if (sub[to] > bestSide) { bestSide = sub[to]; bestDir = to; } }
      else if (net.parent[f] === to) { const side = compSize[net.comp[f]] - sub[f]; if (side > bestSide) { bestSide = side; bestDir = to; } }
    }
    if (bestDir >= 0 && net.parent[f] !== bestDir) net.reroot(bestDir);
    let moved = false;
    for (let climb = 0; climb < 3 && !moved && f >= 0 && net.parent[f] >= 0; climb++) {
      // Own subtree as a set: relayout reuses the stamp array, so it cannot
      // double as the membership test here.
      const subSet = new Set(net.subtree(f));
      const oldParent = net.parent[f], oldEdge = net.parentEdge[f];
      let bestMove = null;
      for (const { e, to } of net.adj[f]) {
        if (to === oldParent || subSet.has(to)) continue;
        const key = `${f}>${to}`;
        net.parent[f] = to; net.parentEdge[f] = e;
        net.relayout(f);
        const total = net.total;
        const allowed = !isTabu(key) || total < best.total;
        if (allowed && (!bestMove || total < bestMove.total)) bestMove = { to, e, total };
        net.parent[f] = oldParent; net.parentEdge[f] = oldEdge;
        net.relayout(f);
      }
      if (bestMove) {
        net.parent[f] = bestMove.to; net.parentEdge[f] = bestMove.e;
        net.relayout(f);
        tabu.push(`${f}>${oldParent}`);
        while (tabu.length > m) tabu.shift();
        moved = true;
      } else f = net.parent[f];
    }
    if (net.total < best.total) { best = net.snapshot(); sinceBest = 0; lastImprove = now(); }
    else if (++sinceBest > 4 * m) { tabu.length = 0; sinceBest = 0; }
    // Stalled: regrow from scratch with a different edge ordering and keep
    // whichever start the search improves further. The global best survives.
    if (now() - lastImprove > stallMs && now() < deadline) {
      restarts++;
      net.grow(0.5 + rng());
      tabu.length = 0; sinceBest = 0; lastImprove = now();
      if (net.total < best.total) best = net.snapshot();
    }
    report();
  }
  if (net.total > best.total) net.restore(best);
  return { overlaps: net.total, iter, restarts };
}

/* ── One piece, simplifying only when search stalls ──────────────────────── */

// positions: triangle soup. Returns the mesh actually used, the tree, and how
// far it had to simplify. `state` lets continueSearch pick up where it left.
export async function solveOnePiece(positions, { minFaces = 20, timeLimit = 15000, seed = 1, onProgress } = {}) {
  const t0 = now();
  let mesh = buildMesh(positions);
  const from = mesh.faces.length;
  let rounds = 0;
  let net = new Net(mesh, seed);
  net.grow(0.3);
  const progress = (extra = {}) => onProgress?.({ faces: mesh.faces.length, rounds, elapsed: now() - t0, ...extra });
  progress({ overlaps: net.total, best: net.total });
  let res = tabuSearch(net, { deadline: t0 + timeLimit, onProgress: p => progress(p) });
  // Search ran out of time with overlaps left: simplify where the net fails
  // (edges of the stubborn faces collapse first) and search again briefly,
  // round by round, down to the face floor.
  const roundTime = Math.min(1500, Math.max(600, timeLimit / 12));
  while (res.overlaps > 0 && mesh.faces.length > minFaces && mesh.triCount > 4) {
    const boost = new Set();
    for (const f of net.overlappingFaces()) for (const v of mesh.faces[f].verts) boost.add(v);
    const target = Math.max(4, Math.floor(mesh.triCount * 0.88));
    let next;
    try { next = buildMesh(decimate(mesh, target, { boost })); } catch { break; }
    if (next.triCount >= mesh.triCount) break;
    mesh = next; rounds++;
    net = new Net(mesh, seed + rounds);
    net.grow(0.3);
    progress({ overlaps: net.total, best: net.total });
    res = tabuSearch(net, { deadline: now() + roundTime, onProgress: p => progress(p) });
    if (rounds > 60) break;
  }
  const info = `${res.overlaps ? `${res.overlaps} overlaps left` : 'no overlaps'} · ${res.iter} moves · ${((now() - t0) / 1000).toFixed(1)} s`;
  return { mesh, tree: net.tree(info), overlaps: res.overlaps, simplifiedFrom: from, rounds, ms: now() - t0, state: { net, mesh, from, rounds } };
}

// More search on the same mesh from the best tree so far.
export function continueSearch(state, { timeLimit = 15000, onProgress } = {}) {
  const t0 = now();
  const { net, mesh } = state;
  const res = tabuSearch(net, { deadline: t0 + timeLimit, onProgress: p => onProgress?.({ faces: mesh.faces.length, rounds: state.rounds, elapsed: now() - t0, ...p }) });
  const info = `${res.overlaps ? `${res.overlaps} overlaps left` : 'no overlaps'} · ${res.iter} more moves`;
  return { mesh, tree: net.tree(info), overlaps: res.overlaps, simplifiedFrom: state.from, rounds: state.rounds, ms: now() - t0, state };
}
