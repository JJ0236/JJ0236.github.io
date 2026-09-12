// unfold/decimate.js — quadric edge-collapse decimation (Garland & Heckbert).
//
// Pure. Takes the welded mesh from buildMesh (verts + tris) and collapses the
// cheapest edges until the live triangle count reaches the target. Returns a
// flat triangle soup for buildMesh to weld and merge again. Collapses that
// would flip a triangle or break the manifold link condition are refused.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);

// Quadric stored as the 10 unique entries of the symmetric 4x4 matrix.
const planeQuadric = (p, q, r) => {
  const n = cross(sub(q, p), sub(r, p));
  const l = len(n);
  if (l < 1e-18) return new Float64Array(10);
  const a = n[0] / l, b = n[1] / l, c = n[2] / l, d = -(a * p[0] + b * p[1] + c * p[2]);
  // Weight by area so big faces dominate, as in the original paper's variants.
  const w = l / 2;
  return Float64Array.from([a * a, a * b, a * c, a * d, b * b, b * c, b * d, c * c, c * d, d * d].map(x => x * w));
};
const qAdd = (A, B) => A.map((x, i) => x + B[i]);
const qError = (Q, [x, y, z]) =>
  Q[0] * x * x + 2 * Q[1] * x * y + 2 * Q[2] * x * z + 2 * Q[3] * x +
  Q[4] * y * y + 2 * Q[5] * y * z + 2 * Q[6] * y + Q[7] * z * z + 2 * Q[8] * z + Q[9];

// Optimal collapse point: solve the 3x3 normal equations; fall back to the
// best of the endpoints and midpoint when the quadric is degenerate.
function optimalPoint(Q, pa, pb) {
  const m = [[Q[0], Q[1], Q[2]], [Q[1], Q[4], Q[5]], [Q[2], Q[5], Q[7]]];
  const rhs = [-Q[3], -Q[6], -Q[8]];
  const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const scale = Math.abs(m[0][0]) + Math.abs(m[1][1]) + Math.abs(m[2][2]);
  const cands = [pa, pb, [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2]];
  if (Math.abs(det) > 1e-9 * scale * scale * scale) {
    const inv = (i, j) => {
      const r = [0, 1, 2].filter(k => k !== j), c = [0, 1, 2].filter(k => k !== i);
      const minor = m[r[0]][c[0]] * m[r[1]][c[1]] - m[r[0]][c[1]] * m[r[1]][c[0]];
      return ((i + j) % 2 ? -minor : minor) / det;
    };
    const x = [0, 1, 2].map(i => inv(i, 0) * rhs[0] + inv(i, 1) * rhs[1] + inv(i, 2) * rhs[2]);
    // Reject solutions that fly off far from the edge; they mean a near-singular system.
    if (len(sub(x, cands[2])) < 4 * len(sub(pa, pb)) + 1e-9) cands.unshift(x);
  }
  let best = null;
  for (const c of cands) { const e = qError(Q, c); if (!best || e < best.e) best = { p: c, e }; }
  return best;
}

class MinHeap {
  constructor() { this.a = []; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].cost <= a[i].cost) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].cost < a[m].cost) m = l; if (r < a.length && a[r].cost < a[m].cost) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

// opts.boost: vertex indices whose edges collapse first (their cost is scaled
// by opts.boostFactor). The solver passes the vertices of overlapping faces so
// simplification is spent where the net is failing (after Bhargava et al.).
export function decimate(mesh, targetTris, opts = {}) {
  const boost = opts.boost || null, boostFactor = opts.boostFactor ?? 0.02;
  const V = mesh.verts.map(v => v.slice());
  const T = mesh.tris.map(t => t.slice());
  const alive = new Array(T.length).fill(true);
  let liveCount = T.length;
  const vertTris = V.map(() => new Set());
  T.forEach((t, i) => t.forEach(v => vertTris[v].add(i)));
  const Q = V.map(() => new Float64Array(10));
  T.forEach(t => { const q = planeQuadric(V[t[0]], V[t[1]], V[t[2]]); t.forEach(v => { Q[v] = qAdd(Q[v], q); }); });
  const version = new Array(V.length).fill(0);
  const dead = new Array(V.length).fill(false);

  const neighbours = v => { const s = new Set(); for (const ti of vertTris[v]) for (const u of T[ti]) if (u !== v) s.add(u); return s; };
  const heap = new MinHeap();
  const pushEdge = (a, b) => {
    if (a === b) return;
    if (a > b) [a, b] = [b, a];
    const best = optimalPoint(qAdd(Q[a], Q[b]), V[a], V[b]);
    const cost = boost && (boost.has(a) || boost.has(b)) ? best.e * boostFactor : best.e;
    heap.push({ a, b, va: version[a], vb: version[b], cost, p: best.p });
  };
  const seen = new Set();
  T.forEach(t => { for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3]; const key = a < b ? `${a},${b}` : `${b},${a}`; if (!seen.has(key)) { seen.add(key); pushEdge(a, b); } } });

  const triNormal = (i, override) => {
    const [a, b, c] = T[i].map(v => override && override.has(v) ? override.get(v) : V[v]);
    return cross(sub(b, a), sub(c, a));
  };

  while (liveCount > targetTris && heap.size) {
    const e = heap.pop();
    const { a, b } = e;
    if (dead[a] || dead[b] || e.va !== version[a] || e.vb !== version[b]) continue;
    // Link condition: shared neighbours must be exactly the apexes of the
    // triangles on this edge, otherwise the collapse pinches the surface.
    const shared = [...vertTris[a]].filter(ti => vertTris[b].has(ti));
    const apexes = new Set(shared.flatMap(ti => T[ti].filter(v => v !== a && v !== b)));
    const na = neighbours(a), nb = neighbours(b);
    let linkOk = true;
    for (const v of na) if (nb.has(v) && !apexes.has(v)) { linkOk = false; break; }
    if (!linkOk) continue;
    // No triangle may flip or collapse to a sliver.
    const override = new Map([[a, e.p], [b, e.p]]);
    let flip = false;
    for (const ti of new Set([...vertTris[a], ...vertTris[b]])) {
      if (shared.includes(ti)) continue;
      const n0 = triNormal(ti), n1 = triNormal(ti, override);
      const l0 = len(n0), l1 = len(n1);
      if (l1 < 1e-12 || dot(n0, n1) / (l0 * l1) < 0.2) { flip = true; break; }
    }
    if (flip) continue;
    // Collapse b into a.
    for (const ti of shared) { alive[ti] = false; liveCount--; vertTris[a].delete(ti); vertTris[b].delete(ti); for (const v of T[ti]) vertTris[v].delete(ti); }
    for (const ti of vertTris[b]) { T[ti] = T[ti].map(v => v === b ? a : v); vertTris[a].add(ti); }
    vertTris[b].clear();
    V[a] = e.p;
    Q[a] = qAdd(Q[a], Q[b]);
    dead[b] = true;
    version[a]++; version[b]++;
    for (const v of neighbours(a)) pushEdge(a, v);
  }

  const out = [];
  T.forEach((t, i) => { if (alive[i]) for (const v of t) out.push(V[v][0], V[v][1], V[v][2]); });
  return out;
}
