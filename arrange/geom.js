// arrange/geom.js — polygon geometry for nesting. Pure, no DOM.
//
// A polygon is a flat array of alternating coordinates: [x0,y0, x1,y1, ...].
// Rings are implicitly closed; the last point is never repeated.

import earcut from './vendor/earcut.js';

export const EPS = 1e-9;

// ── basics ──────────────────────────────────────────────────────────

export function area(poly) {
  let a = 0;
  for (let i = 0, n = poly.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1];
  }
  return a / 2;
}

export const isCCW = poly => area(poly) > 0;

export function reverse(poly) {
  const out = new Float64Array(poly.length);
  for (let i = 0, n = poly.length / 2; i < n; i++) {
    out[i * 2] = poly[(n - 1 - i) * 2];
    out[i * 2 + 1] = poly[(n - 1 - i) * 2 + 1];
  }
  return out;
}

export const toCCW = poly => (isCCW(poly) ? poly : reverse(poly));

export function bounds(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    if (poly[i] < minX) minX = poly[i];
    if (poly[i] > maxX) maxX = poly[i];
    if (poly[i + 1] < minY) minY = poly[i + 1];
    if (poly[i + 1] > maxY) maxY = poly[i + 1];
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function translate(poly, dx, dy) {
  const out = new Float64Array(poly.length);
  for (let i = 0; i < poly.length; i += 2) {
    out[i] = poly[i] + dx;
    out[i + 1] = poly[i + 1] + dy;
  }
  return out;
}

export function rotate(poly, rad, cx = 0, cy = 0) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const out = new Float64Array(poly.length);
  for (let i = 0; i < poly.length; i += 2) {
    const x = poly[i] - cx, y = poly[i + 1] - cy;
    out[i] = cx + x * c - y * s;
    out[i + 1] = cy + x * s + y * c;
  }
  return out;
}

// Drop points that add nothing: duplicates and collinear runs.
export function clean(poly, tol = 1e-7) {
  const pts = [];
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const x = poly[i * 2], y = poly[i * 2 + 1];
    const m = pts.length;
    if (m && Math.abs(pts[m - 2] - x) < tol && Math.abs(pts[m - 1] - y) < tol) continue;
    pts.push(x, y);
  }
  // close-up duplicate
  if (pts.length >= 4) {
    const m = pts.length;
    if (Math.abs(pts[0] - pts[m - 2]) < tol && Math.abs(pts[1] - pts[m - 1]) < tol) pts.length = m - 2;
  }
  // collinear removal
  const out = [];
  const k = pts.length / 2;
  for (let i = 0; i < k; i++) {
    const px = pts[((i - 1 + k) % k) * 2], py = pts[((i - 1 + k) % k) * 2 + 1];
    const cx = pts[i * 2], cy = pts[i * 2 + 1];
    const nx = pts[((i + 1) % k) * 2], ny = pts[((i + 1) % k) * 2 + 1];
    const cross = (cx - px) * (ny - py) - (cy - py) * (nx - px);
    const scale = Math.hypot(cx - px, cy - py) * Math.hypot(nx - cx, ny - cy);
    if (scale > 0 && Math.abs(cross) / scale < tol) continue;
    out.push(cx, cy);
  }
  return new Float64Array(out.length >= 6 ? out : pts);
}

export function pointInPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, n = poly.length / 2, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], yi = poly[i * 2 + 1];
    const xj = poly[j * 2], yj = poly[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Distance from a point to a segment.
export function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distPointPolyEdge(poly, x, y) {
  let best = Infinity;
  for (let i = 0, n = poly.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    const d = distPointSeg(x, y, poly[i * 2], poly[i * 2 + 1], poly[j * 2], poly[j * 2 + 1]);
    if (d < best) best = d;
  }
  return best;
}

// ── circles ─────────────────────────────────────────────────────────

// Smallest enclosing circle, Welzl with a shuffled incremental pass.
export function boundingCircle(poly) {
  const pts = [];
  for (let i = 0; i < poly.length; i += 2) pts.push([poly[i], poly[i + 1]]);
  for (let i = pts.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [pts[i], pts[j]] = [pts[j], pts[i]];
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const from2 = (a, b) => ({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, r: dist(a, b) / 2 });
  const from3 = (a, b, c) => {
    const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < EPS) {
      // degenerate: fall back to the widest pair
      const pairs = [from2(a, b), from2(a, c), from2(b, c)];
      return pairs.reduce((m, p) => (p.r > m.r ? p : m));
    }
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return { x: ux, y: uy, r: Math.hypot(ax - ux, ay - uy) };
  };
  const has = (c, p) => c && dist([c.x, c.y], p) <= c.r + 1e-9;

  let c = null;
  for (let i = 0; i < pts.length; i++) {
    if (has(c, pts[i])) continue;
    c = { x: pts[i][0], y: pts[i][1], r: 0 };
    for (let j = 0; j < i; j++) {
      if (has(c, pts[j])) continue;
      c = from2(pts[i], pts[j]);
      for (let k = 0; k < j; k++) {
        if (has(c, pts[k])) continue;
        c = from3(pts[i], pts[j], pts[k]);
      }
    }
  }
  return c || { x: 0, y: 0, r: 0 };
}

// Pole of inaccessibility: the interior point furthest from the boundary.
// Quadtree subdivision with a best-first queue (Vladimir Agafonkin's method).
export function inscribedCircle(poly, holes = [], precision = null) {
  const b = bounds(poly);
  const size = Math.min(b.w, b.h);
  if (size <= 0) return { x: b.minX, y: b.minY, r: 0 };
  const prec = precision || size / 100;

  const signedDist = (x, y) => {
    let inside = pointInPoly(poly, x, y);
    let d = distPointPolyEdge(poly, x, y);
    for (const h of holes) {
      if (pointInPoly(h, x, y)) inside = false;
      d = Math.min(d, distPointPolyEdge(h, x, y));
    }
    return inside ? d : -d;
  };

  const SQ2 = Math.SQRT2;
  const cell = (x, y, h) => {
    const d = signedDist(x, y);
    return { x, y, h, d, max: d + h * SQ2 };
  };

  let h = size / 2;
  const queue = [];
  for (let x = b.minX; x < b.maxX; x += h)
    for (let y = b.minY; y < b.maxY; y += h) queue.push(cell(x + h / 2, y + h / 2, h / 2));

  let best = cell(b.minX + b.w / 2, b.minY + b.h / 2, 0);
  // centroid is often better than the bbox centre for odd shapes
  let cx = 0, cy = 0, aSum = 0;
  for (let i = 0, n = poly.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    const f = poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1];
    cx += (poly[i * 2] + poly[j * 2]) * f;
    cy += (poly[i * 2 + 1] + poly[j * 2 + 1]) * f;
    aSum += f * 3;
  }
  if (aSum !== 0) {
    const cand = cell(cx / aSum, cy / aSum, 0);
    if (cand.d > best.d) best = cand;
  }

  let guard = 0;
  while (queue.length && guard++ < 100000) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[bi].max) bi = i;
    const c = queue[bi];
    queue[bi] = queue[queue.length - 1];
    queue.pop();

    if (c.d > best.d) best = c;
    if (c.max - best.d <= prec) continue;

    const nh = c.h / 2;
    queue.push(cell(c.x - nh, c.y - nh, nh), cell(c.x + nh, c.y - nh, nh),
               cell(c.x - nh, c.y + nh, nh), cell(c.x + nh, c.y + nh, nh));
  }
  return { x: best.x, y: best.y, r: Math.max(0, best.d) };
}

// ── convex decomposition ────────────────────────────────────────────

// Hertel-Mehlhorn: triangulate, then delete diagonals that keep convexity.
// Guarantees at most 4x the optimal number of convex pieces, and is fast.
export function convexDecompose(poly) {
  const cleaned = toCCW(clean(poly));
  const n = cleaned.length / 2;
  if (n < 3) return [];
  if (n === 3 || isConvex(cleaned)) return [cleaned];

  const coords = Array.from(cleaned);
  const tris = earcut(coords);
  if (!tris.length) return [cleaned];

  // Build polygons from triangles, then greedily merge neighbours.
  let pieces = [];
  for (let i = 0; i < tris.length; i += 3) {
    pieces.push([tris[i], tris[i + 1], tris[i + 2]]);
  }

  const px = i => coords[i * 2], py = i => coords[i * 2 + 1];

  const merged = (a, b) => {
    // find a shared edge (u,v) appearing in opposite orientations
    for (let i = 0; i < a.length; i++) {
      const u = a[i], v = a[(i + 1) % a.length];
      for (let j = 0; j < b.length; j++) {
        const s = b[j], t = b[(j + 1) % b.length];
        if (u === t && v === s) {
          // `a` walked from v round to u, then `b`'s vertices strictly between
          // u and v. The upper bound is b.length - 1, not b.length: the last
          // step would re-add the shared vertex v and close a zero-width slit.
          const out = [];
          for (let k = 0; k < a.length; k++) out.push(a[(i + 1 + k) % a.length]);
          for (let k = 1; k < b.length - 1; k++) out.push(b[(j + 1 + k) % b.length]);
          // Two pieces can share more than one edge. Merging across just one of
          // them leaves a ring that revisits a vertex — a zero-width slit that
          // passes a per-triple convexity test while not being convex at all.
          // SAT on such a piece is unsound, so refuse the merge.
          if (new Set(out).size !== out.length) return null;
          return out;
        }
      }
    }
    return null;
  };

  const ringCoords = ring => {
    const out = new Float64Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) { out[i * 2] = px(ring[i]); out[i * 2 + 1] = py(ring[i]); }
    return out;
  };

  // Judge a candidate merge on its real geometry, not on an index-triple test.
  // A ring that revisits a vertex can satisfy the triple test at every corner
  // and still not be convex, and SAT on such a piece is unsound.
  const acceptable = ring => {
    if (ring.length < 3) return false;
    if (new Set(ring).size !== ring.length) return false;
    const c = ringCoords(ring);
    return isConvex(c) && Math.abs(area(c)) > 1e-12;   // winding may be either way
  };

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 10000) {
    changed = false;
    outer:
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const m = merged(pieces[i], pieces[j]);
        if (m && acceptable(m)) {
          pieces[i] = m;
          pieces.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  const built = pieces.map(ringCoords).filter(p => Math.abs(area(p)) > 1e-12);

  // Everything downstream assumes these are convex. If a merge slipped a
  // non-convex piece through, fall back to the raw triangles, which cannot be.
  if (!built.every(p => isConvex(p))) {
    const tri = [];
    for (let i = 0; i < tris.length; i += 3) {
      const t = new Float64Array([
        px(tris[i]), py(tris[i]), px(tris[i + 1]), py(tris[i + 1]), px(tris[i + 2]), py(tris[i + 2]),
      ]);
      if (Math.abs(area(t)) > 1e-12) tri.push(toCCW(t));
    }
    return tri;
  }
  return built;
}

export function isConvex(poly) {
  const n = poly.length / 2;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const ax = poly[i * 2], ay = poly[i * 2 + 1];
    const bx = poly[((i + 1) % n) * 2], by = poly[((i + 1) % n) * 2 + 1];
    const cx = poly[((i + 2) % n) * 2], cy = poly[((i + 2) % n) * 2 + 1];
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(cross) < 1e-12) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// ── convex separation ───────────────────────────────────────────────

// Minimum distance between two disjoint CONVEX polygons, with `b` displaced by
// (dx, dy). The offset is a parameter rather than a pre-translated copy because
// this runs in the nester's innermost loop; allocating a translated polygon per
// call dominated the profile.
export function convexDistance(a, b, dx = 0, dy = 0) {
  let best = Infinity;
  for (let pass = 0; pass < 2; pass++) {
    const p = pass === 0 ? a : b, q = pass === 0 ? b : a;
    const pox = pass === 0 ? 0 : dx, poy = pass === 0 ? 0 : dy;
    const qox = pass === 0 ? dx : 0, qoy = pass === 0 ? dy : 0;
    for (let i = 0; i < p.length; i += 2) {
      const vx = p[i] + pox, vy = p[i + 1] + poy;
      for (let j = 0, n = q.length / 2; j < n; j++) {
        const k = (j + 1) % n;
        const d = distPointSeg(vx, vy,
                               q[j * 2] + qox, q[j * 2 + 1] + qoy,
                               q[k * 2] + qox, q[k * 2 + 1] + qoy);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

// Signed separation between two CONVEX polygons, `b` displaced by (dx, dy).
// > 0 when disjoint (the true Euclidean gap), <= 0 when overlapping
// (-penetration depth). SAT settles the sign and, when they overlap, gives the
// exact penetration. It cannot give the gap when they are apart: its
// edge-normal maximum is only a LOWER bound on true distance, because the
// closest approach may be vertex-to-vertex along no edge normal. Using that
// bound directly made the nester over-separate parts and waste sheet.
// `exactBelow` is an optimisation for callers that only need to know whether
// the gap clears a threshold. SAT's edge-normal maximum is a valid LOWER bound
// on true distance, so once it reaches the threshold the caller's question is
// already answered and the O(n*m) exact measurement can be skipped. Leave it at
// Infinity to always get the true distance back.
export function convexSeparation(a, b, dx = 0, dy = 0, exactBelow = Infinity) {
  let best = -Infinity;
  for (let pass = 0; pass < 2; pass++) {
    const p = pass === 0 ? a : b, q = pass === 0 ? b : a;
    // how much further along a normal q sits than p, from the displacement
    const sx = pass === 0 ? dx : -dx, sy = pass === 0 ? dy : -dy;
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = p[j * 2] - p[i * 2], ay = p[j * 2 + 1] - p[i * 2 + 1];
      const len = Math.hypot(ax, ay);
      if (len < EPS) continue;
      const nx = ay / len, ny = -ax / len;   // outward normal of a CCW ring
      let maxP = -Infinity;
      for (let k = 0; k < p.length; k += 2) {
        const d = p[k] * nx + p[k + 1] * ny;
        if (d > maxP) maxP = d;
      }
      let minQ = Infinity;
      for (let k = 0; k < q.length; k += 2) {
        const d = q[k] * nx + q[k + 1] * ny;
        if (d < minQ) minQ = d;
      }
      const gap = (minQ + sx * nx + sy * ny) - maxP;
      if (gap > best) best = gap;
      if (best >= exactBelow) return best;                // already clears it
      if (best > 0) return convexDistance(a, b, dx, dy);   // apart: measure properly
    }
  }
  return best;
}
