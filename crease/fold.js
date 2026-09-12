// crease/fold.js — folds a crease pattern in 3D.
//
// Pure, no DOM. Two halves:
//   1. planar graph -> faces -> triangles (buildFoldModel)
//   2. a spring-mass simulation with hinge targets (FoldSim), after Ghassaei's
//      Origami Simulator, using the Bridson 2003 bending element.
//
// The crease pattern is scored on the front face (+z toward the viewer). A
// mountain crease has a positive dihedral in the sign convention of
// dihedral() below, a valley a negative one.

/* ── Planar graph ────────────────────────────────────────────────────────── */

// Breaks the pattern's straight items into segments tagged with their type.
// Circles are refused: curved creases need facet bending this model lacks.
export function patternSegments(pattern) {
  const segs = [];
  const add = (type, x1, y1, x2, y2) => segs.push({ type, x1, y1, x2, y2 });
  for (const s of pattern.cuts) {
    if (s.k === 'C') return null;
    if (s.k === 'P') {
      const n = s.pts.length;
      for (let i = 0; i < n - (s.closed ? 0 : 1); i++) {
        const a = s.pts[i], b = s.pts[(i + 1) % n];
        add('B', a[0], a[1], b[0], b[1]);
      }
    } else if (s.k === 'L') add('B', s.x1, s.y1, s.x2, s.y2);
  }
  for (const s of pattern.mountains) { if (s.k !== 'L') return null; add('M', s.x1, s.y1, s.x2, s.y2); }
  for (const s of pattern.valleys)   { if (s.k !== 'L') return null; add('V', s.x1, s.y1, s.x2, s.y2); }
  return segs;
}

// Welds endpoints, splits every segment at every vertex lying on its interior
// (T-junctions), and traces the faces of the resulting planar graph.
export function planarGraph(segs, eps = 1e-5) {
  const verts = [];
  const index = new Map();
  const vid = (x, y) => {
    const k = `${Math.round(x / eps)},${Math.round(y / eps)}`;
    if (!index.has(k)) { index.set(k, verts.length); verts.push([x, y]); }
    return index.get(k);
  };
  const raw = segs.map(s => ({ type: s.type, a: vid(s.x1, s.y1), b: vid(s.x2, s.y2) })).filter(s => s.a !== s.b);

  // Split at T-junctions.
  const edgeKey = new Map();
  const edges = [];
  const pushEdge = (a, b, type) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (edgeKey.has(k)) return;
    edgeKey.set(k, edges.length);
    edges.push({ a, b, type });
  };
  for (const s of raw) {
    const [ax, ay] = verts[s.a], [bx, by] = verts[s.b];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const on = [];
    for (let v = 0; v < verts.length; v++) {
      if (v === s.a || v === s.b) continue;
      const [px, py] = verts[v];
      const t = ((px - ax) * dx + (py - ay) * dy) / L2;
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      const qx = ax + t * dx, qy = ay + t * dy;
      if (Math.hypot(px - qx, py - qy) < eps * 10) on.push({ t, v });
    }
    on.sort((p, q) => p.t - q.t);
    let prev = s.a;
    for (const { v } of on) { pushEdge(prev, v, s.type); prev = v; }
    pushEdge(prev, s.b, s.type);
  }

  // Half-edge face walk. At each vertex the outgoing edges are sorted by
  // angle; arriving along u->v we leave by the neighbour just clockwise of
  // the way back, which keeps the face on one consistent side.
  const adj = verts.map(() => []);
  edges.forEach((e, i) => { adj[e.a].push({ to: e.b, e: i }); adj[e.b].push({ to: e.a, e: i }); });
  for (let v = 0; v < verts.length; v++) {
    adj[v].sort((p, q) => Math.atan2(verts[p.to][1] - verts[v][1], verts[p.to][0] - verts[v][0])
                        - Math.atan2(verts[q.to][1] - verts[v][1], verts[q.to][0] - verts[v][0]));
  }
  const seen = new Set();
  const faces = [];
  for (let i = 0; i < edges.length; i++) {
    for (const [u0, v0] of [[edges[i].a, edges[i].b], [edges[i].b, edges[i].a]]) {
      if (seen.has(`${u0}>${v0}`)) continue;
      const loop = [];
      let u = u0, v = v0, guard = 0;
      while (!seen.has(`${u}>${v}`) && guard++ < 100000) {
        seen.add(`${u}>${v}`);
        loop.push(u);
        const list = adj[v];
        const k = list.findIndex(n => n.to === u);
        const next = list[(k - 1 + list.length) % list.length];
        u = v; v = next.to;
      }
      if (loop.length >= 3) faces.push(loop);
    }
  }
  const area = loop => {
    let s = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = verts[loop[i]], q = verts[loop[(i + 1) % loop.length]];
      s += p[0] * q[1] - q[0] * p[1];
    }
    return s / 2;
  };
  // The outer face is the one with the largest magnitude; interior faces all
  // share the opposite sign.
  let outer = 0;
  faces.forEach((f, i) => { if (Math.abs(area(f)) > Math.abs(area(faces[outer]))) outer = i; });
  const outerSign = Math.sign(area(faces[outer]));
  const inner = faces.filter((f, i) => i !== outer && Math.sign(area(f)) === -outerSign);
  // Orient every face counter-clockwise in y-up terms (negative signed area in
  // SVG's y-down coordinates) so triangle normals point +z consistently.
  const oriented = inner.map(f => area(f) > 0 ? f.slice().reverse() : f);
  return { verts, edges, faces: oriented, faceArea: f => Math.abs(area(f)) };
}

/* ── Fold model ──────────────────────────────────────────────────────────── */

export function buildFoldModel(pattern) {
  const segs = patternSegments(pattern);
  if (!segs) return { ok: false, reason: 'Curved creases are not simulated.' };
  const g = planarGraph(segs);
  if (!g.faces.length) return { ok: false, reason: 'No faces found.' };

  // Fan triangulation; every face in the straight-line patterns is convex.
  // A face can carry a T-junction vertex in the middle of a straight side,
  // so the apex is chosen to keep the thinnest fan triangle as fat as possible.
  const tris = [];
  const triArea = (a, b, c) => {
    const [ax, ay] = g.verts[a], [bx, by] = g.verts[b], [cx, cy] = g.verts[c];
    return Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
  };
  for (const f of g.faces) {
    let best = null, bestMin = -1;
    for (let s = 0; s < f.length; s++) {
      const rot = f.slice(s).concat(f.slice(0, s));
      let minA = Infinity;
      for (let i = 1; i < rot.length - 1; i++) minA = Math.min(minA, triArea(rot[0], rot[i], rot[i + 1]));
      if (minA > bestMin) { bestMin = minA; best = rot; }
    }
    for (let i = 1; i < best.length - 1; i++) tris.push([best[0], best[i], best[i + 1]]);
  }

  // Hinges: every edge shared by two triangles. tri (a,b,c) lists the edge as
  // a->b; the other triangle lists it b->a.
  const triOfEdge = new Map();
  tris.forEach((t, ti) => {
    for (let i = 0; i < 3; i++) {
      const a = t[i], b = t[(i + 1) % 3], c = t[(i + 2) % 3];
      triOfEdge.set(`${a}>${b}`, { ti, c });
    }
  });
  const typeOf = new Map(g.edges.map(e => [e.a < e.b ? `${e.a},${e.b}` : `${e.b},${e.a}`, e.type]));
  const hinges = [];
  const done = new Set();
  for (const [k, h1] of triOfEdge) {
    const [a, b] = k.split('>').map(Number);
    const rk = `${b}>${a}`;
    const uk = a < b ? `${a},${b}` : `${b},${a}`;
    if (done.has(uk) || !triOfEdge.has(rk)) continue;
    done.add(uk);
    const h2 = triOfEdge.get(rk);
    const type = typeOf.get(uk) || 'F';
    if (type === 'B') continue;
    hinges.push({ a, b, c: h1.c, d: h2.c, type });
  }
  const springs = [];
  const sk = new Set();
  for (const t of tris) for (let i = 0; i < 3; i++) {
    const a = t[i], b = t[(i + 1) % 3];
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (sk.has(k)) continue;
    sk.add(k); springs.push([a, b]);
  }
  return { ok: true, verts: g.verts, faces: g.faces, tris, springs, hinges, edges: g.edges };
}

/* ── Geometry ────────────────────────────────────────────────────────────── */

const sub = (P, i, j, o) => { o[0] = P[3 * i] - P[3 * j]; o[1] = P[3 * i + 1] - P[3 * j + 1]; o[2] = P[3 * i + 2] - P[3 * j + 2]; return o; };
const cross = (u, v, o) => { o[0] = u[1] * v[2] - u[2] * v[1]; o[1] = u[2] * v[0] - u[0] * v[2]; o[2] = u[0] * v[1] - u[1] * v[0]; return o; };
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const len = u => Math.hypot(u[0], u[1], u[2]);

// Signed dihedral at hinge h. Positive when the two apexes c, d fold away
// from +z, which is a mountain seen from the front.
export function dihedral(P, h) {
  const ab = sub(P, h.b, h.a, [0, 0, 0]);
  const n1 = cross(ab, sub(P, h.c, h.a, [0, 0, 0]), [0, 0, 0]);
  const n2 = cross(sub(P, h.d, h.b, [0, 0, 0]), sub(P, h.d, h.a, [0, 0, 0]), [0, 0, 0]);
  const e = len(ab);
  const x = cross(n1, n2, [0, 0, 0]);
  return Math.atan2(dot(x, ab) / e, dot(n1, n2));
}

/* ── Simulation ──────────────────────────────────────────────────────────── */

export class FoldSim {
  constructor(model, opts = {}) {
    this.model = model;
    const n = model.verts.length;
    // Normalise the sheet to unit size so stiffness and dt are pattern-independent.
    let maxX = 0, maxY = 0;
    for (const [x, y] of model.verts) { maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    this.scale = 1 / Math.max(maxX, maxY);
    const s = this.scale;
    this.P = new Float64Array(n * 3);
    this.V = new Float64Array(n * 3);
    this.F = new Float64Array(n * 3);
    model.verts.forEach(([x, y], i) => { this.P[3 * i] = (x - maxX / 2) * s; this.P[3 * i + 1] = (maxY / 2 - y) * s; this.P[3 * i + 2] = 0; });
    this.springs = model.springs.map(([a, b]) => ({ a, b, L0: Math.hypot(this.P[3 * a] - this.P[3 * b], this.P[3 * a + 1] - this.P[3 * b + 1]) }));
    this.hinges = model.hinges.map(h => ({ ...h, target: 0, goal: 0 }));
    this.kAxial = opts.kAxial ?? 20;
    this.kCrease = opts.kCrease ?? 0.7;
    this.kFacet = opts.kFacet ?? 3;
    this.kHingeDamp = opts.kHingeDamp ?? 0.05;
    this.damping = opts.damping ?? 0.07;
    this.maxAngle = (opts.maxAngle ?? 160) * Math.PI / 180;
    // Fixed step in normalised units. Stiff facets need a fine step; the
    // easing below keeps hinge targets from jumping so this stays stable.
    this.dt = opts.dt ?? 0.012;
    this.ease = opts.ease ?? this.maxAngle / 2000;
    // Optional kinematics: goal(hinge, t, verts) returns the signed target for
    // a crease hinge when the pattern's primary creases sit at angle t.
    this.goalFn = opts.goal || null;
    this.maxSpeed = 0.02 / this.dt;
    this.fold = 0;
    this.setFold(0);
  }

  // Requested fold; hinge targets ease toward it a little each step.
  setFold(pct) {
    this.fold = pct;
    const t = pct / 100 * this.maxAngle;
    for (const h of this.hinges) {
      if (h.type === 'F') { h.goal = 0; continue; }
      h.goal = this.goalFn ? this.goalFn(h, t, this.model.verts) : (h.type === 'M' ? t : -t);
    }
  }

  // Jump every hinge straight to its goal (tests and fresh builds).
  snapTargets() { for (const h of this.hinges) h.target = h.goal; }

  settled() { return this.hinges.every(h => Math.abs(h.target - h.goal) < 1e-9); }

  step(iterations = 1) {
    const { P, V, F, dt } = this;
    const n = P.length / 3;
    const ab = [0, 0, 0], ca = [0, 0, 0], cb = [0, 0, 0], db = [0, 0, 0], da = [0, 0, 0];
    const N1 = [0, 0, 0], N2 = [0, 0, 0], X = [0, 0, 0];
    const u1 = [0, 0, 0], u2 = [0, 0, 0], u3 = [0, 0, 0], u4 = [0, 0, 0];
    for (let it = 0; it < iterations; it++) {
      for (const h of this.hinges) {
        const d = h.goal - h.target;
        h.target += Math.abs(d) < this.ease ? d : Math.sign(d) * this.ease;
      }
      F.fill(0);
      for (const sp of this.springs) {
        const dx = P[3 * sp.b] - P[3 * sp.a], dy = P[3 * sp.b + 1] - P[3 * sp.a + 1], dz = P[3 * sp.b + 2] - P[3 * sp.a + 2];
        const L = Math.hypot(dx, dy, dz) || 1e-12;
        const f = this.kAxial / sp.L0 * (L - sp.L0) / L;
        F[3 * sp.a] += f * dx; F[3 * sp.a + 1] += f * dy; F[3 * sp.a + 2] += f * dz;
        F[3 * sp.b] -= f * dx; F[3 * sp.b + 1] -= f * dy; F[3 * sp.b + 2] -= f * dz;
      }
      for (const h of this.hinges) {
        // Bridson et al. 2003: shared edge a-b, apexes c (tri abc) and d (tri bad).
        sub(P, h.b, h.a, ab);
        sub(P, h.c, h.a, ca); sub(P, h.c, h.b, cb);
        sub(P, h.d, h.b, db); sub(P, h.d, h.a, da);
        cross(ca, cb, N1); cross(db, da, N2);
        const e = len(ab), n1 = dot(N1, N1), n2 = dot(N2, N2);
        if (e < 1e-12 || n1 < 1e-18 || n2 < 1e-18) continue;
        const l1 = Math.sqrt(n1), l2 = Math.sqrt(n2);
        cross(N1, N2, X);
        const theta = Math.atan2(dot(X, ab) / (e * l1 * l2), dot(N1, N2) / (l1 * l2));
        const k = h.type === 'F' ? this.kFacet : this.kCrease;
        for (let i = 0; i < 3; i++) {
          u1[i] = e * N1[i] / n1;
          u2[i] = e * N2[i] / n2;
          u3[i] = (dot(cb, ab) / e) * N1[i] / n1 + (dot(db, ab) / e) * N2[i] / n2;
          u4[i] = -(dot(ca, ab) / e) * N1[i] / n1 - (dot(da, ab) / e) * N2[i] / n2;
        }
        const dtheta = dot(u1, V.subarray(3 * h.c, 3 * h.c + 3)) + dot(u2, V.subarray(3 * h.d, 3 * h.d + 3))
                     + dot(u3, V.subarray(3 * h.a, 3 * h.a + 3)) + dot(u4, V.subarray(3 * h.b, 3 * h.b + 3));
        // Elastic term restores toward the target; damping term opposes dθ/dt.
        const mag = k * e * e / (l1 + l2) * (Math.sin(theta / 2) - Math.sin(h.target / 2)) - this.kHingeDamp * e * dtheta;
        for (let i = 0; i < 3; i++) {
          F[3 * h.c + i] += mag * u1[i];
          F[3 * h.d + i] += mag * u2[i];
          F[3 * h.a + i] += mag * u3[i];
          F[3 * h.b + i] += mag * u4[i];
        }
      }
      const keep = 1 - this.damping, vmax = this.maxSpeed;
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 3; j++) V[3 * i + j] = (V[3 * i + j] + F[3 * i + j] * dt) * keep;
        const sp = Math.hypot(V[3 * i], V[3 * i + 1], V[3 * i + 2]);
        if (sp > vmax) for (let j = 0; j < 3; j++) V[3 * i + j] *= vmax / sp;
        for (let j = 0; j < 3; j++) P[3 * i + j] += V[3 * i + j] * dt;
        cx += P[3 * i]; cy += P[3 * i + 1]; cz += P[3 * i + 2];
      }
      cx /= n; cy /= n; cz /= n;
      for (let i = 0; i < n; i++) { P[3 * i] -= cx; P[3 * i + 1] -= cy; P[3 * i + 2] -= cz; }
    }
  }

  // Largest crease error in degrees, for the tests and the readout.
  creaseError() {
    let worst = 0;
    for (const h of this.hinges) {
      if (h.type === 'F') continue;
      worst = Math.max(worst, Math.abs(dihedral(this.P, h) - h.target));
    }
    return worst * 180 / Math.PI;
  }

  maxStrain() {
    let worst = 0;
    for (const sp of this.springs) {
      const L = Math.hypot(this.P[3 * sp.b] - this.P[3 * sp.a], this.P[3 * sp.b + 1] - this.P[3 * sp.a + 1], this.P[3 * sp.b + 2] - this.P[3 * sp.a + 2]);
      worst = Math.max(worst, Math.abs(L - sp.L0) / sp.L0);
    }
    return worst;
  }
}

/* ── Per-pattern kinematics ──────────────────────────────────────────────── */

// Miura-ori is a one-degree-of-freedom mechanism. With the zigzag creases at
// fold angle ρ, the straight vertical creases sit at 2·atan(cos β · tan(ρ/2)),
// where β is the sector angle between a vertical crease and the zigzag. Driving
// both families with that relation folds the sheet rigidly: no facet strain.
export function miuraKinematics(angleDeg) {
  const beta = Math.PI / 2 - angleDeg * Math.PI / 180;
  const c = Math.cos(beta);
  return (h, t, verts) => {
    const vertical = Math.abs(verts[h.a][0] - verts[h.b][0]) < 1e-9;
    const mag = vertical ? 2 * Math.atan(c * Math.tan(t / 2)) : t;
    return h.type === 'M' ? mag : -mag;
  };
}

// Ceiling for the fold slider per pattern. Miura flat-folds, so it can go
// nearly closed. Yoshimura and waterbomb are not rigid-foldable as flat
// sheets and stretch their facets past these angles.
export const FOLD_LIMITS = { miura: 165, yoshimura: 100, waterbomb: 60 };
