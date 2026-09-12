// unfold/unfold.js — polygon mesh to a laser-ready net, plus the fold animation.
//
// Pure. Everything is in millimetres after `opts.scale`. Layout coordinates
// are mathematical (y up) with every face wound counter-clockwise, which is
// the view of the model's outside. Only toPatterns() converts to SVG space.

/* ── Small vector helpers ────────────────────────────────────────────────── */

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
const norm3 = a => mul3(a, 1 / (len3(a) || 1));

/* ── Quaternions, for the fold animation ─────────────────────────────────── */

export const Q = {
  id: () => [0, 0, 0, 1],
  axisAngle(k, a) { const s = Math.sin(a / 2); return [k[0] * s, k[1] * s, k[2] * s, Math.cos(a / 2)]; },
  mul(p, q) {
    return [
      p[3] * q[0] + p[0] * q[3] + p[1] * q[2] - p[2] * q[1],
      p[3] * q[1] - p[0] * q[2] + p[1] * q[3] + p[2] * q[0],
      p[3] * q[2] + p[0] * q[1] - p[1] * q[0] + p[2] * q[3],
      p[3] * q[3] - p[0] * q[0] - p[1] * q[1] - p[2] * q[2],
    ];
  },
  rot(q, v) {
    const u = [q[0], q[1], q[2]], s = q[3];
    return add3(add3(mul3(u, 2 * dot3(u, v)), mul3(v, s * s - dot3(u, u))), mul3(cross3(u, v), 2 * s));
  },
  // Columns c0,c1,c2 of a rotation matrix.
  fromColumns(c0, c1, c2) {
    const m = [[c0[0], c1[0], c2[0]], [c0[1], c1[1], c2[1]], [c0[2], c1[2], c2[2]]];
    const tr = m[0][0] + m[1][1] + m[2][2];
    let q;
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2;
      q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4];
    } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
      const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
      q = [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s];
    } else if (m[1][1] > m[2][2]) {
      const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
      q = [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s];
    } else {
      const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
      q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s];
    }
    const l = Math.hypot(...q);
    return q.map(x => x / l);
  },
  slerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map(x => -x); d = -d; }
    if (d > 0.9995) { const r = a.map((x, i) => x + (b[i] - x) * t); const l = Math.hypot(...r); return r.map(x => x / l); }
    const th = Math.acos(d), s = Math.sin(th);
    const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return a.map((x, i) => x * wa + b[i] * wb);
  },
};

// Rigid transform { q, t }: p -> rot(q, p) + t.
const T = {
  id: () => ({ q: Q.id(), t: [0, 0, 0] }),
  apply: (T, p) => add3(Q.rot(T.q, p), T.t),
  compose: (A, B) => ({ q: Q.mul(A.q, B.q), t: add3(Q.rot(A.q, B.t), A.t) }),
  // Rotation by `a` about the axis through point P with direction k.
  hinge(P, k, a) { const q = Q.axisAngle(norm3(k), a); return { q, t: sub3(P, Q.rot(q, P)) }; },
};

/* ── 2D geometry ─────────────────────────────────────────────────────────── */

const EPS = 1e-3;   // mm; touching is not overlapping

function segCross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return false;
  const qp = [c[0] - a[0], c[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den, u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  const et = EPS / Math.hypot(...r), eu = EPS / Math.hypot(...s);
  return t > et && t < 1 - et && u > eu && u < 1 - eu;
}

function pointSegDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function strictlyInside(p, poly) {
  for (let i = 0; i < poly.length; i++) if (pointSegDist(p, poly[i], poly[(i + 1) % poly.length]) <= EPS) return false;
  return pointInPoly(p, poly);
}

const bbox = pts => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
};

export function polysOverlap(P, Qp) {
  const a = bbox(P), b = bbox(Qp);
  if (a.x1 < b.x0 - EPS || b.x1 < a.x0 - EPS || a.y1 < b.y0 - EPS || b.y1 < a.y0 - EPS) return false;
  for (let i = 0; i < P.length; i++) for (let j = 0; j < Qp.length; j++) {
    if (segCross(P[i], P[(i + 1) % P.length], Qp[j], Qp[(j + 1) % Qp.length])) return true;
  }
  for (const p of P) if (strictlyInside(p, Qp)) return true;
  for (const p of Qp) if (strictlyInside(p, P)) return true;
  // Identical polygons or one wholly covering the other with shared vertices.
  const cP = centroid2(P), cQ = centroid2(Qp);
  return strictlyInside(cP, Qp) || strictlyInside(cQ, P);
}

const centroid2 = pts => { let x = 0, y = 0; for (const p of pts) { x += p[0] / pts.length; y += p[1] / pts.length; } return [x, y]; };

function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cr(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cr(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const rot2 = (p, th) => [p[0] * Math.cos(th) - p[1] * Math.sin(th), p[0] * Math.sin(th) + p[1] * Math.cos(th)];

/* ── The unfolder ────────────────────────────────────────────────────────── */

export const DEFAULTS = { scale: 1, sheet: { w: 210, h: 297 }, margin: 5, tabs: true, tabH: 6, tabAngle: 60, labels: true, scoreFace: 'inside', gap: 3, onePiece: false, mvMarks: true };

export function unfold(mesh, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const { faces, edges } = mesh;
  const verts3 = mesh.verts.map(v => mul3(v, opts.scale));
  const uW = opts.sheet.w - 2 * opts.margin, uH = opts.sheet.h - 2 * opts.margin;
  const tabAllow = opts.tabs ? 2 * opts.tabH : 0;
  const warnings = mesh.warnings.slice();

  // Local 2D coordinates of every face: right-handed basis in its plane.
  const local = faces.map(f => {
    const p0 = verts3[f.verts[0]];
    const u = norm3(sub3(verts3[f.verts[1]], p0));
    const w = cross3(f.normal, u);
    return f.verts.map(i => { const d = sub3(verts3[i], p0); return [dot3(d, u), dot3(d, w)]; });
  });

  // Face adjacency.
  const adj = faces.map(() => []);
  for (const e of edges) {
    adj[e.sides[0].face].push({ e, to: e.sides[1].face });
    adj[e.sides[1].face].push({ e, to: e.sides[0].face });
  }
  const edgeIndexIn = (f, e) => e.sides.find(s => s.face === f).index;

  // Rigid placement of face f against its placed parent p across edge e: the
  // child's copy of the edge runs the other way round, so it lands on the far
  // side automatically.
  const placeAgainst = (posP, p, f, e) => {
    const ip = edgeIndexIn(p, e), ic = edgeIndexIn(f, e);
    const Pa = posP[ip], Pb = posP[(ip + 1) % posP.length];
    const Cb = local[f][ic], Ca = local[f][(ic + 1) % local[f].length];
    const th = Math.atan2(Pb[1] - Pa[1], Pb[0] - Pa[0]) - Math.atan2(Cb[1] - Ca[1], Cb[0] - Ca[0]);
    const rCa = rot2(Ca, th);
    const tx = Pa[0] - rCa[0], ty = Pa[1] - rCa[1];
    return local[f].map(q => { const r = rot2(q, th); return [r[0] + tx, r[1] + ty]; });
  };
  // Sheet limit, only enforced when pieces are allowed to multiply.
  const sheetFit = opts.onePiece ? null : (polys, cand) => {
    const b = bbox(polys.flat().concat(cand));
    return (b.w + tabAllow <= uW && b.h + tabAllow <= uH) || (b.w + tabAllow <= uH && b.h + tabAllow <= uW);
  };

  const tree = opts.tree || growForest(faces, adj, local, placeAgainst, {
    onePiece: !!opts.onePiece, seed: opts.seed ?? 1, sheetFit,
    tries: opts.tries ?? (opts.onePiece ? Math.max(8, Math.min(48, Math.round(6000 / faces.length))) : 1),
  });
  const { parent, parentEdge, order } = tree;

  // Layout replays the forest. It was grown overlap-free, so every island is
  // exactly one tree root and no edge needs cutting here.
  const pos = new Array(faces.length);
  const islandOf = new Array(faces.length);
  const islands = [];
  const cutByOverlap = new Set();
  const newIsland = f => { islandOf[f] = islands.length; islands.push({ faces: [f], root: f, polys: [local[f]] }); pos[f] = local[f]; };
  for (const f of order) {
    if (parent[f] < 0) { newIsland(f); continue; }
    const p = parent[f];
    const cand = placeAgainst(pos[p], p, f, parentEdge[f]);
    const isl = islands[islandOf[p]];
    pos[f] = cand; islandOf[f] = islandOf[p]; isl.faces.push(f); isl.polys.push(cand);
  }

  const treeEdges = new Set(parentEdge.filter(Boolean).map(e => e.id));
  const foldEdges = edges.filter(e => treeEdges.has(e.id) && !cutByOverlap.has(e.id));
  const cutEdges = edges.filter(e => !treeEdges.has(e.id) || cutByOverlap.has(e.id));

  // Tabs. One per cut edge, on whichever side has room.
  const tabs = [];
  const tabAt = new Map();          // `${face},${index}` -> tab
  const tanA = Math.tan(opts.tabAngle * Math.PI / 180);
  let noTab = 0;
  if (opts.tabs) {
    for (const e of cutEdges) {
      let placed = null;
      for (const h of [opts.tabH, opts.tabH / 2, opts.tabH / 4]) {
        for (const side of e.sides) {
          const f = side.face, i = side.index, n = pos[f].length;
          const A = pos[f][i], B = pos[f][(i + 1) % n];
          const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
          const ux = dx / L, uy = dy / L;
          const nx = uy, ny = -ux;                     // right of the edge = outside the face
          let s = h / tanA, hh = h;
          if (s > 0.4 * L) { s = 0.4 * L; hh = s * tanA; }
          const poly = [A, [A[0] + nx * hh + ux * s, A[1] + ny * hh + uy * s], [B[0] + nx * hh - ux * s, B[1] + ny * hh - uy * s], B];
          const isl = islands[islandOf[f]];
          const clash = isl.polys.some(q => polysOverlap(poly, q)) || tabs.some(t => t.island === islandOf[f] && polysOverlap(poly, t.poly));
          if (!clash) { placed = { edge: e, face: f, index: i, poly, island: islandOf[f], h: hh }; break; }
        }
        if (placed) break;
      }
      if (placed) { tabs.push(placed); tabAt.set(`${placed.face},${placed.index}`, placed); }
      else noTab++;
    }
  }

  // Labels: cut edges numbered, the number on both faces and on the tab.
  const labels = [];
  const labelFor = new Map();
  if (opts.labels) {
    cutEdges.forEach((e, k) => {
      const text = String(k + 1);
      labelFor.set(e.id, text);
      const size = Math.max(2, Math.min(6, e.len * 0.25));
      for (const side of e.sides) {
        const f = side.face, n = pos[f].length;
        const A = pos[f][side.index], B = pos[f][(side.index + 1) % n];
        const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
        const lx = -dy / L, ly = dx / L;             // left = inside the face
        const off = size * 0.9;
        labels.push({ island: islandOf[f], x: (A[0] + B[0]) / 2 + lx * off, y: (A[1] + B[1]) / 2 + ly * off, dx: dx / L, dy: dy / L, text, size });
      }
      const tab = tabs.find(t => t.edge === e);
      if (tab) {
        const c = centroid2(tab.poly);
        const A = tab.poly[0], B = tab.poly[3];
        const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
        labels.push({ island: tab.island, x: c[0], y: c[1], dx: dx / L, dy: dy / L, text, size: Math.min(size, tab.h * 0.7) });
      }
    });
  }

  // Island outlines, with tabs spliced in where a boundary edge carries one.
  for (const [ii, isl] of islands.entries()) {
    const key = p => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
    const directed = new Map();
    for (const f of isl.faces) {
      const n = pos[f].length;
      for (let i = 0; i < n; i++) directed.set(key(pos[f][i]) + '|' + key(pos[f][(i + 1) % n]), { f, i });
    }
    const outFrom = new Map();
    for (const [k, v] of directed) {
      const [ka, kb] = k.split('|');
      if (directed.has(kb + '|' + ka)) continue;
      if (!outFrom.has(ka)) outFrom.set(ka, []);
      outFrom.get(ka).push({ ...v, kb });
    }
    const used = new Set();
    const loops = [];
    for (const [ka, list] of outFrom) {
      for (const first of list) {
        const k0 = `${first.f},${first.i}`;
        if (used.has(k0)) continue;
        const loop = [];
        let cur = first, curKey = ka;
        let guard = 0;
        while (cur && !used.has(`${cur.f},${cur.i}`) && guard++ < 100000) {
          used.add(`${cur.f},${cur.i}`);
          const n = pos[cur.f].length;
          const A = pos[cur.f][cur.i], B = pos[cur.f][(cur.i + 1) % n];
          loop.push(A);
          const tab = tabAt.get(`${cur.f},${cur.i}`);
          if (tab) loop.push(tab.poly[1], tab.poly[2]);
          const nexts = (outFrom.get(cur.kb) || []).filter(x => !used.has(`${x.f},${x.i}`));
          if (!nexts.length) break;
          if (nexts.length === 1) { cur = nexts[0]; continue; }
          // Several ways on: take the sharpest right turn so the loop hugs the faces.
          const din = Math.atan2(B[1] - A[1], B[0] - A[0]);
          let best = nexts[0], bestTurn = Infinity;
          for (const x of nexts) {
            const P0 = pos[x.f][x.i], P1 = pos[x.f][(x.i + 1) % pos[x.f].length];
            let turn = Math.atan2(P1[1] - P0[1], P1[0] - P0[0]) - din;
            turn = ((turn + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
            if (turn < bestTurn) { bestTurn = turn; best = x; }
          }
          cur = best;
        }
        if (loop.length >= 3) loops.push(loop);
      }
    }
    isl.loops = loops;
    isl.tabs = tabs.filter(t => t.island === ii);
    isl.labels = labels.filter(l => l.island === ii);
    isl.folds = [];
  }
  for (const e of foldEdges) {
    const s = e.sides[0], f = s.face, n = pos[f].length;
    islands[islandOf[f]].folds.push({ a: pos[f][s.index], b: pos[f][(s.index + 1) % n], mountain: e.dihedral >= 0, edge: e });
  }
  for (const t of tabs) islands[t.island].folds.push({ a: t.poly[0], b: t.poly[3], mountain: t.edge.dihedral >= 0, tab: true });

  // Packing: rotate each island to its tightest bounding box, then shelves.
  for (const isl of islands) {
    const pts = isl.loops.flat();
    const hull = convexHull(pts);
    let best = { th: 0, area: Infinity };
    for (let d = 0; d < 180; d += 5) {
      const th = d * Math.PI / 180;
      const b = bbox(hull.map(p => rot2(p, th)));
      if (b.w * b.h < best.area - 1e-9) best = { th, area: b.w * b.h, b };
    }
    isl.theta = best.th;
    const b = best.b;
    isl.w = b.w; isl.h = b.h;
    isl.shift = [-b.x0, -b.y0];
  }
  const orderIsl = islands.map((_, i) => i).sort((a, b) => islands[b].h - islands[a].h);
  const sheets = [];
  let cur = null, x = 0, y = 0, shelfH = 0;
  const g = opts.gap;
  // One-piece mode never splits for the sheet: everything packs onto a single
  // page sized to the net, and the sheet is only compared against it.
  const packW = opts.onePiece ? Math.max(uW, ...islands.map(i => i.w)) : uW;
  const packH = opts.onePiece ? Infinity : uH;
  for (const i of orderIsl) {
    const isl = islands[i];
    if (isl.w > uW || isl.h > uH) warnings.push(opts.onePiece
      ? `The net is ${isl.w.toFixed(0)} × ${isl.h.toFixed(0)} mm, larger than the ${uW.toFixed(0)} × ${uH.toFixed(0)} mm sheet area. Lower the size to fit, or use a bigger sheet.`
      : `Piece ${i + 1} is larger than the sheet.`);
    if (!cur || x + isl.w > packW + 1e-9) {
      if (cur) { y += shelfH + g; x = 0; shelfH = 0; }
      if (!cur || y + isl.h > packH + 1e-9) { cur = { islands: [] }; sheets.push(cur); x = 0; y = 0; shelfH = 0; }
    }
    isl.sheet = sheets.length - 1;
    isl.offset = [x, y];
    cur.islands.push(i);
    x += isl.w + g;
    shelfH = Math.max(shelfH, isl.h);
  }
  let pageW = uW, pageH = uH;
  if (opts.onePiece) {
    pageW = 0; pageH = 0;
    for (const isl of islands) { pageW = Math.max(pageW, isl.offset[0] + isl.w); pageH = Math.max(pageH, isl.offset[1] + isl.h); }
  }
  const place = (isl, p) => { const r = rot2(p, isl.theta); return [r[0] + isl.shift[0] + isl.offset[0], r[1] + isl.shift[1] + isl.offset[1]]; };
  const placeDir = (isl, d) => rot2(d, isl.theta);
  for (const isl of islands) {
    isl.pLoops = isl.loops.map(l => l.map(p => place(isl, p)));
    isl.pFolds = isl.folds.map(f => ({ ...f, a: place(isl, f.a), b: place(isl, f.b) }));
    isl.pLabels = isl.labels.map(l => { const [x, y] = place(isl, [l.x, l.y]); const [dx, dy] = placeDir(isl, [l.dx, l.dy]); return { ...l, x, y, dx, dy }; });
    isl.pTabs = isl.tabs.map(t => t.poly.map(p => place(isl, p)));
  }
  const SHEET_GAP = 20;
  const placed = faces.map((f, fi) => { const isl = islands[islandOf[fi]]; return pos[fi].map(p => { const q = place(isl, p); return [q[0] + isl.sheet * (pageW + SHEET_GAP), q[1]]; }); });

  // Fold animation setup. Flat net lies in z = 0 with the outside facing +z.
  // The assembled model is shifted to hover over the middle of the net.
  const netCentre = [(sheets.length * (pageW + SHEET_GAP) - SHEET_GAP) / 2, pageH / 2];
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of verts3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  const shift = [netCentre[0] - (lo[0] + hi[0]) / 2, netCentre[1] - (lo[1] + hi[1]) / 2, -lo[2] + 2];
  const target = verts3.map(v => add3(v, shift));
  const flat3 = placed.map(poly => poly.map(([x, y]) => [x, y, 0]));

  const rootPose = new Array(faces.length), hinge = new Array(faces.length), fullPose = new Array(faces.length);
  const rigidFrom = (fi) => {
    const P = flat3[fi], V = faces[fi].verts.map(i => target[i]);
    const e1 = norm3(sub3(P[1], P[0])), e3 = [0, 0, 1], e2 = cross3(e3, e1);
    const E1 = norm3(sub3(V[1], V[0])), E3 = faces[fi].normal, E2 = cross3(E3, E1);
    // R = [E1 E2 E3] · [e1 e2 e3]^T ; columns of R are R·x̂, R·ŷ, R·ẑ.
    const col = k => add3(add3(mul3(E1, e1[k]), mul3(E2, e2[k])), mul3(E3, e3[k]));
    const q = Q.fromColumns(col(0), col(1), col(2));
    return { q, t: sub3(V[0], Q.rot(q, P[0])) };
  };
  for (const f of order) {
    if (parent[f] < 0 || cutByOverlap.has(parentEdge[f].id)) {
      rootPose[f] = rigidFrom(f); fullPose[f] = rootPose[f]; hinge[f] = null; continue;
    }
    const p = parent[f], e = parentEdge[f];
    const ip = edgeIndexIn(p, e);
    const A = flat3[p][ip], B = flat3[p][(ip + 1) % flat3[p].length];
    const k = sub3(B, A);
    let best = null;
    for (const sign of [1, -1]) {
      const ang = sign * Math.abs(e.dihedral);
      const pose = T.compose(fullPose[p], T.hinge(A, k, ang));
      const err = faces[f].verts.reduce((acc, vi, j) => acc + len3(sub3(T.apply(pose, flat3[f][j]), target[vi])), 0);
      if (!best || err < best.err) best = { err, ang, pose };
    }
    hinge[f] = { A, k, angle: best.ang };
    fullPose[f] = best.pose;
  }
  // Island root animates about its own flat centroid.
  const islandCentre = islands.map(isl => {
    const pts = isl.faces.flatMap(f => flat3[f]);
    return mul3(pts.reduce((a, p) => add3(a, p), [0, 0, 0]), 1 / pts.length);
  });

  const stats = {
    faces: faces.length, islands: islands.length, sheets: sheets.length,
    folds: foldEdges.length, cuts: cutEdges.length, tabs: tabs.length, noTab,
    netW: pageW, netH: pageH, tries: tree.tries,
  };
  return { opts, mesh, uW: pageW, uH: pageH, sheetW: uW, sheetH: uH, islands, sheets, order, parent, islandOf, flat3, target, rootPose, hinge, islandCentre, foldEdges, cutEdges, stats, warnings, SHEET_GAP, tree };
}

/* ── Forest search ───────────────────────────────────────────────────────── */

const mulberry32 = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// Tightest bounding-box area of a point set over a sweep of rotations, used
// to prefer compact nets among one-piece solutions.
function compactness(pts) {
  const hull = convexHull(pts);
  let best = Infinity;
  for (let d = 0; d < 180; d += 10) {
    const b = bbox(hull.map(p => rot2(p, d * Math.PI / 180)));
    best = Math.min(best, b.w * b.h);
  }
  return best;
}

// Grows islands face by face. An attachment that would overlap what is
// already placed is skipped, and the face waits to be reached through another
// neighbour. Faces nothing can reach start a new island. Repeated with
// different roots and randomised edge priorities; the result with the fewest
// islands wins, ties broken by the most compact net.
export function growForest(faces, adj, local, placeAgainst, o) {
  const byArea = faces.map((f, i) => i).sort((a, b) => faces[b].area - faces[a].area);
  const rng = mulberry32(o.seed ?? 1);
  const tries = Math.max(1, o.tries ?? 1);

  const growOnce = (firstRoot, jitter) => {
    const n = faces.length;
    const parent = new Array(n).fill(-1), parentEdge = new Array(n).fill(null);
    const placed = new Array(n).fill(false), pos = new Array(n);
    const order = [];
    let islands = 0, firstSize = 0;
    const allPts = [];
    for (let rootPick = 0; ; rootPick++) {
      let root = rootPick === 0 ? firstRoot : byArea.find(f => !placed[f]);
      if (root === undefined) break;
      islands++;
      placed[root] = true; pos[root] = local[root]; order.push(root);
      const polys = [local[root]];
      const cands = [];
      const push = f => { for (const { e, to } of adj[f]) if (!placed[to]) cands.push({ e, to, from: f, pri: e.len * (1 + jitter * rng()) }); };
      push(root);
      while (cands.length) {
        let bi = 0;
        for (let i = 1; i < cands.length; i++) if (cands[i].pri > cands[bi].pri) bi = i;
        const { e, to, from } = cands.splice(bi, 1)[0];
        if (placed[to]) continue;
        const cand = placeAgainst(pos[from], from, to, e);
        if (o.sheetFit && !o.sheetFit(polys, cand)) continue;
        if (polys.some(q => polysOverlap(cand, q))) continue;
        placed[to] = true; pos[to] = cand; parent[to] = from; parentEdge[to] = e; order.push(to); polys.push(cand);
        push(to);
      }
      if (rootPick === 0) { firstSize = polys.length; for (const q of polys) allPts.push(...q); }
    }
    return { parent, parentEdge, order, islands, firstSize, compact: compactness(allPts) };
  };

  let best = null;
  const roots = byArea.slice(0, Math.min(byArea.length, 8));
  let t = 0;
  for (; t < tries; t++) {
    const root = roots[t % roots.length];
    const jitter = t === 0 ? 0 : Math.min(2, 0.3 * t);
    const res = growOnce(root, jitter);
    const better = !best || res.islands < best.islands || (res.islands === best.islands && res.compact < best.compact - 1e-9);
    if (better) best = res;
    if (!o.onePiece) break;
    // Once a one-piece net exists, spend a few more tries looking for a more compact one.
    if (best.islands === 1 && t >= 9) break;
  }
  best.tries = t + 1;
  return best;
}

/* ── One piece, simplifying as needed ────────────────────────────────────── */

// Searches for a single-piece net; when none turns up at this face count,
// decimates the mesh and tries again, stopping at minFaces. yieldFn lets a
// page repaint between rounds. Returns the best net found and the mesh it
// came from.
export async function solveOnePiece(mesh, options, { minFaces = 20, onProgress, yieldFn } = {}) {
  const [{ decimate }, { buildMesh }] = await Promise.all([import('./decimate.js'), import('./mesh.js')]);
  let m = mesh, rounds = 0, r = null;
  const from = mesh.faces.length;
  for (;;) {
    r = unfold(m, { ...options, onePiece: true });
    onProgress?.({ faces: m.faces.length, islands: r.stats.islands, rounds });
    if (r.stats.islands === 1 || m.faces.length <= minFaces || m.triCount <= 4) break;
    const target = Math.max(4, Math.floor(m.triCount * 0.82));
    let next;
    try { next = buildMesh(decimate(m, target)); } catch { break; }
    if (next.triCount >= m.triCount) break;
    m = next; rounds++;
    if (rounds > 80) break;
    if (yieldFn) await yieldFn();
  }
  if (r.stats.islands > 1) r.warnings.push(`No one-piece net found down to ${m.faces.length} faces; showing the best ${r.stats.islands}-piece net. Lower the minimum faces to simplify further.`);
  return { result: r, mesh: m, simplifiedFrom: from, rounds };
}

/* ── Fold animation ──────────────────────────────────────────────────────── */

// Positions of every face's vertices at fold fraction t in [0, 1].
export function foldPositions(r, t) {
  const pose = new Array(r.flat3.length);
  for (const f of r.order) {
    const p = r.parent[f];
    if (r.hinge[f] === null) {
      const rp = r.rootPose[f], c = r.islandCentre[r.islandOf[f]];
      const q = Q.slerp(Q.id(), rp.q, t);
      const cTarget = T.apply(rp, c);
      const cNow = add3(mul3(c, 1 - t), mul3(cTarget, t));
      pose[f] = { q, t: sub3(cNow, Q.rot(q, c)) };
    } else {
      const h = r.hinge[f];
      pose[f] = T.compose(pose[p], T.hinge(h.A, h.k, h.angle * t));
    }
  }
  return r.flat3.map((poly, f) => poly.map(p => T.apply(pose[f], p)));
}

/* ── Patterns for export, one per sheet, in SVG space ────────────────────── */

export function toPatterns(r) {
  const { uW, uH, opts } = r;
  const outside = opts.scoreFace !== 'inside';
  const D = ([dx, dy]) => outside ? [dx, -dy] : [dx, dy];
  return r.sheets.map(sheet => {
    // Packing grows upward in math coordinates; after the flip the content
    // would sit at the bottom of the page, so anchor its top edge to y = 0.
    let top = 0;
    for (const ii of sheet.islands) for (const loop of r.islands[ii].pLoops) for (const [, y] of loop) top = Math.max(top, y);
    const P = ([x, y]) => outside ? [x, top - y] : [x, y];
    const cuts = [], mountains = [], valleys = [], labels = [], tabPolys = [];
    for (const ii of sheet.islands) {
      const isl = r.islands[ii];
      for (const loop of isl.pLoops) cuts.push({ k: 'P', pts: loop.map(P), closed: true });
      for (const f of isl.pFolds) {
        const [x1, y1] = P(f.a), [x2, y2] = P(f.b);
        const m = outside ? f.mountain : !f.mountain;
        (m ? mountains : valleys).push({ k: 'L', x1, y1, x2, y2 });
        // Small m/v mark beside each real fold, on the scored face, so one
        // crease colour is still unambiguous on the sheet.
        if (opts.mvMarks !== false && !f.tab) {
          const L = Math.hypot(x2 - x1, y2 - y1);
          if (L > 4) {
            const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
            // Left of the directed edge in the source frame is inside the face; the
            // y-flip for outside scoring reverses handedness.
            const sgn = outside ? 1 : -1;
            const nx = sgn * uy, ny = -sgn * ux;
            const size = Math.max(1.4, Math.min(2.2, L * 0.15));
            let angle = Math.atan2(uy, ux) * 180 / Math.PI;
            if (angle > 90) angle -= 180; else if (angle <= -90) angle += 180;
            labels.push({ k: 'T', x: (x1 + x2) / 2 + nx * size * 0.75, y: (y1 + y2) / 2 + ny * size * 0.75, text: m ? 'm' : 'v', size, angle });
          }
        }
      }
      for (const l of isl.pLabels) {
        const [x, y] = P([l.x, l.y]), [dx, dy] = D([l.dx, l.dy]);
        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        if (angle > 90) angle -= 180; else if (angle <= -90) angle += 180;
        labels.push({ k: 'T', x, y, text: l.text, size: l.size, angle });
      }
      for (const tp of isl.pTabs) tabPolys.push(tp.map(P));
    }
    return { cuts, mountains, valleys, labels, tabPolys, w: uW, h: uH };
  });
}
