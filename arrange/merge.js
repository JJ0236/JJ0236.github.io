// arrange/merge.js — merge common lines so the laser cuts a shared edge once.
//
// Two parts butted against each other have a coincident edge. Cutting it twice
// wastes time and, worse, burns the same kerf twice, which warps the material
// and widens the cut. Deepnest's headline feature, and the thing that makes a
// nester a laser tool rather than a generic packer.
//
// Note this only fires when parts actually touch, so it needs spacing near 0.

const ANG_TOL = 1e-3;     // radians
const OFF_TOL = 0.05;     // mm

// Every segment of every ring, in sheet coordinates.
export function segmentsOf(rings) {
  const segs = [];
  for (const ring of rings) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2], ay = ring[i * 2 + 1];
      const bx = ring[j * 2], by = ring[j * 2 + 1];
      if (Math.hypot(bx - ax, by - ay) > 1e-9) segs.push([ax, ay, bx, by]);
    }
  }
  return segs;
}

// Key a segment by the infinite line it lies on, direction-agnostic.
function lineKey(ax, ay, bx, by) {
  let dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  dx /= len; dy /= len;
  if (dx < 0 || (Math.abs(dx) < 1e-12 && dy < 0)) { dx = -dx; dy = -dy; }
  const off = -dy * ax + dx * ay;                     // signed perpendicular offset
  const angle = Math.atan2(dy, dx);
  return {
    key: `${Math.round(angle / ANG_TOL)}:${Math.round(off / OFF_TOL)}`,
    dx, dy,
    t0: ax * dx + ay * dy,
    t1: bx * dx + by * dy,
    ox: ax - (ax * dx + ay * dy) * dx,
    oy: ay - (ax * dx + ay * dy) * dy,
  };
}

/**
 * Collapse coincident and collinear-touching segments into one set.
 * Returns { polylines, sharedLength, originalLength }.
 */
export function mergeCommonLines(rings) {
  const segs = segmentsOf(rings);
  const originalLength = segs.reduce((s, [ax, ay, bx, by]) => s + Math.hypot(bx - ax, by - ay), 0);

  const lines = new Map();
  for (const [ax, ay, bx, by] of segs) {
    const L = lineKey(ax, ay, bx, by);
    let e = lines.get(L.key);
    if (!e) lines.set(L.key, (e = { dx: L.dx, dy: L.dy, ox: L.ox, oy: L.oy, spans: [] }));
    e.spans.push(L.t0 < L.t1 ? [L.t0, L.t1] : [L.t1, L.t0]);
  }

  const out = [];
  let mergedLength = 0;

  for (const e of lines.values()) {
    e.spans.sort((a, b) => a[0] - b[0]);
    const union = [];
    for (const s of e.spans) {
      const last = union[union.length - 1];
      if (last && s[0] <= last[1] + OFF_TOL) last[1] = Math.max(last[1], s[1]);
      else union.push([s[0], s[1]]);
    }
    for (const [t0, t1] of union) {
      mergedLength += t1 - t0;
      out.push([
        e.ox + e.dx * t0, e.oy + e.dy * t0,
        e.ox + e.dx * t1, e.oy + e.dy * t1,
      ]);
    }
  }

  return {
    polylines: chain(out),
    sharedLength: originalLength - mergedLength,
    originalLength,
    mergedLength,
  };
}

// Stitch segments that share an endpoint into longer runs, so the laser head
// lifts as rarely as possible.
export function chain(segs, tol = 0.02) {
  const key = (x, y) => `${Math.round(x / tol)},${Math.round(y / tol)}`;
  const ends = new Map();
  const add = (k, i) => { let a = ends.get(k); if (!a) ends.set(k, (a = [])); a.push(i); };
  segs.forEach(([ax, ay, bx, by], i) => { add(key(ax, ay), i); add(key(bx, by), i); });

  const used = new Array(segs.length).fill(false);
  const runs = [];

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const [ax, ay, bx, by] = segs[i];
    const run = [ax, ay, bx, by];

    // extend forward, then backward
    for (const dir of [0, 1]) {
      for (;;) {
        const n = run.length;
        const hx = dir === 0 ? run[n - 2] : run[0];
        const hy = dir === 0 ? run[n - 1] : run[1];
        const cands = ends.get(key(hx, hy)) || [];
        let next = -1;
        for (const c of cands) if (!used[c]) { next = c; break; }
        if (next < 0) break;
        used[next] = true;
        const [cx, cy, dx2, dy2] = segs[next];
        const far = Math.hypot(cx - hx, cy - hy) <= tol ? [dx2, dy2] : [cx, cy];
        if (dir === 0) run.push(far[0], far[1]);
        else run.unshift(far[0], far[1]);
      }
    }
    runs.push(run);
  }
  return runs;
}
