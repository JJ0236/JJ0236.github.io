// umbra/mesh.js — contours to a solid whose shadow is the art.
//
// The build is: normalise the art into clean polygons, cut or keep it against a
// plate, bridge whatever came out disconnected, then project every ring through
// the lamp onto its group's plane and extrude it ALONG THE RAYS. That last part
// is the whole trick — see project.js backVertex().

import pc from './vendor/polygon-clipping.js';
import earcut from './vendor/earcut.js';
import { ringArea, ringPerimeter, boundsOf } from './svg.js';
import {
  V, makeSurface, rayToPlane, backVertex, spreadDepths
} from './project.js';

const closeRing = r => {
  const a = r[0], b = r[r.length - 1];
  return (a[0] === b[0] && a[1] === b[1]) ? r : [...r, [a[0], a[1]]];
};
const asGeom = rings => [rings.map(closeRing)];

// polygon-clipping throws "Unable to complete output ring" when many pieces meet
// at exactly coincident points — which is precisely what a stroke outline looks
// like. Batch first for speed, then fall back to accumulating one at a time so a
// single awkward piece cannot lose the whole shape.
function safeUnion(parts) {
  const list = parts.filter(p => p && p.length);
  if (!list.length) return [];
  if (list.length === 1) return list[0];
  try {
    return pc.union(list[0], ...list.slice(1));
  } catch {
    let acc = list[0];
    for (let i = 1; i < list.length; i++) {
      try { acc = pc.union(acc, list[i]); } catch { /* skip the awkward piece */ }
    }
    return acc;
  }
}

/* ── Art to clean polygons ───────────────────────────────────────────────── */

// Even-odd is an XOR of the rings. Nonzero is handled as positive rings minus
// negative ones, which is exact for font outlines and simple nested shapes.
function resolveFill(rings, fillRule) {
  if (!rings.length) return [];
  if (fillRule === 'evenodd') {
    let mp = [];
    for (const r of rings) {
      if (r.length < 3) continue;
      try { mp = mp.length ? pc.xor(mp, asGeom([r])) : pc.union(asGeom([r])); } catch { /* skip */ }
    }
    return mp;
  }
  let pos = rings.filter(r => r.length >= 3 && ringArea(r) > 0);
  let neg = rings.filter(r => r.length >= 3 && ringArea(r) < 0);
  if (!pos.length) { pos = neg; neg = []; }     // uniformly-wound art: keep it all
  if (!pos.length) return [];
  let mp = safeUnion(pos.map(r => asGeom([r])));
  if (neg.length && mp.length) {
    try { mp = pc.difference(mp, ...neg.map(r => asGeom([r]))); } catch { /* keep the filled form */ }
  }
  return mp;
}

// Line art is usually strokes with no fill, which would otherwise build nothing
// at all. Each segment becomes a quad and each vertex a round join, unioned.
function outlineStroke(ring, closed, width) {
  const w = width / 2;
  if (!(w > 0) || ring.length < 2) return [];
  const parts = [];
  const step = Math.max(1, Math.floor(ring.length / 1200));   // cap the union size
  const pts = step > 1 ? ring.filter((_, i) => i % step === 0) : ring;
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    if (l < 1e-9) continue;
    const nx = -dy / l * w, ny = dx / l * w;
    parts.push(asGeom([[
      [a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]
    ]]));
  }
  // Joins overlap the quads slightly instead of meeting them tangentially, and
  // start off-phase, so no two pieces share an exact touch point.
  const SIDES = 12, jr = w * 1.04, phase = 0.37;
  for (const p of pts) {
    const c = [];
    for (let s = 0; s < SIDES; s++) {
      const t = phase + s / SIDES * Math.PI * 2;
      c.push([p[0] + Math.cos(t) * jr, p[1] + Math.sin(t) * jr]);
    }
    parts.push(asGeom([c]));
  }
  return safeUnion(parts);
}

// Shapes (from svg.js) to one MultiPolygon in SVG units.
export function shapesToPolygons(shapes, { strokeOverride = 0, forceStroke = false } = {}) {
  const pieces = [];
  for (const sh of shapes) {
    const wantStroke = forceStroke || (!sh.filled && sh.strokeWidth > 0);
    if (wantStroke) {
      const w = strokeOverride > 0 ? strokeOverride : (sh.strokeWidth || 1);
      sh.rings.forEach((r, i) => {
        const mp = outlineStroke(r, sh.closed[i] ?? false, w);
        if (mp.length) pieces.push(mp);
      });
    }
    if (sh.filled) {
      const closedRings = sh.rings.filter((r, i) => r.length >= 3);
      const mp = resolveFill(closedRings, sh.fillRule);
      if (mp.length) pieces.push(mp);
    }
  }
  return safeUnion(pieces);
}

/* ── Placing the art on the wall ─────────────────────────────────────────── */

// SVG y runs down, the wall runs up, so this flips as it scales and centres.
export function fitToWall(mp, wallArtWidth) {
  const allRings = mp.flat();
  if (!allRings.length) return { mp: [], bounds: null, scale: 1 };
  const b = boundsOf(allRings);
  const scale = b.w > 0 ? wallArtWidth / b.w : 1;
  const cx = b.x0 + b.w / 2, cy = b.y0 + b.h / 2;
  // The y-flip reverses every ring, which would leave outers clockwise and make
  // the extruded solid inside-out. Restore the convention explicitly.
  const out = mp.map(poly => poly
    .map(ring => ring.map(p => [(p[0] - cx) * scale, -(p[1] - cy) * scale]))
    .map((ring, i) => {
      const a = ringArea(ring);
      return (i === 0 ? a < 0 : a > 0) ? ring.slice().reverse() : ring;
    }));
  return { mp: out, scale, bounds: { w: b.w * scale, h: b.h * scale } };
}

export function polyStats(mp) {
  let area = 0, perimeter = 0;
  for (const poly of mp) {
    poly.forEach((ring, i) => {
      area += (i === 0 ? 1 : -1) * Math.abs(ringArea(ring));
      perimeter += ringPerimeter(ring);
    });
  }
  return { area, perimeter };
}

export function plateRect(mp, marginMm) {
  const b = boundsOf(mp.flat());
  return [[
    [b.x0 - marginMm, b.y0 - marginMm], [b.x1 + marginMm, b.y0 - marginMm],
    [b.x1 + marginMm, b.y1 + marginMm], [b.x0 - marginMm, b.y1 + marginMm],
    [b.x0 - marginMm, b.y0 - marginMm]
  ]];
}

/* ── Bridges ─────────────────────────────────────────────────────────────── */

// Connected components come free: polygon-clipping returns one polygon per
// component, so anything past the first needs joining to the body.
function nearestPair(polyA, polyB) {
  let best = { d: Infinity, a: null, b: null };
  const dec = ring => {
    const step = Math.max(1, Math.floor(ring.length / 260));
    return ring.filter((_, i) => i % step === 0);
  };
  for (const ringA of polyA) {
    const A = dec(ringA);
    for (const ringB of polyB) {
      const B = dec(ringB);
      for (const p of A) for (const q of B) {
        const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
        if (d < best.d) best = { d, a: p, b: q };
      }
    }
  }
  return best;
}

function barRect(a, b, width) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return null;
  const ux = dx / l, uy = dy / l;
  const ex = ux * width, ey = uy * width;            // overshoot so it bites in
  const nx = -uy * width / 2, ny = ux * width / 2;
  const p0 = [a[0] - ex, a[1] - ey], p1 = [b[0] + ex, b[1] + ey];
  return asGeom([[
    [p0[0] + nx, p0[1] + ny], [p1[0] + nx, p1[1] + ny],
    [p1[0] - nx, p1[1] - ny], [p0[0] - nx, p0[1] - ny]
  ]]);
}

// Joins every loose component to the largest one. Returns the bridged polygons
// plus the bars themselves, so the preview can show what shadow they added.
export function bridge(mp, widthMm) {
  if (mp.length <= 1 || !(widthMm > 0)) return { mp, bars: [], count: 0 };
  let cur = mp, bars = [];
  for (let pass = 0; pass < 12 && cur.length > 1; pass++) {
    const areas = cur.map(p => Math.abs(ringArea(p[0])));
    const main = areas.indexOf(Math.max(...areas));
    const rects = [];
    for (let i = 0; i < cur.length; i++) {
      if (i === main) continue;
      const { a, b } = nearestPair(cur[main], cur[i]);
      if (!a) continue;
      const r = barRect(a, b, widthMm);
      if (r) { rects.push(r); bars.push([a, b]); }
    }
    if (!rects.length) break;
    cur = safeUnion([cur, ...rects]);
  }
  return { mp: cur, bars, count: bars.length };
}

/* ── Grouping for depth ──────────────────────────────────────────────────── */

// Depth is what makes the object stop looking like the picture from any other
// angle. Each group gets re-projected onto its own plane, so the shadow is
// unchanged while the pieces physically separate.
export function groupPolygons(mp, granularity, bandCount = 5) {
  if (granularity === 'islands') return mp.map(p => [p]);
  if (granularity === 'bands') {
    const b = boundsOf(mp.flat());
    const out = [];
    for (let i = 0; i < bandCount; i++) {
      const y0 = b.y0 + b.h * i / bandCount, y1 = b.y0 + b.h * (i + 1) / bandCount;
      const band = asGeom([[[b.x0 - 1, y0], [b.x1 + 1, y0], [b.x1 + 1, y1], [b.x0 - 1, y1]]]);
      const clipped = pc.intersection(mp, band);
      if (clipped.length) out.push(clipped);
    }
    return out;
  }
  return [mp];
}

/* ── Mesh ────────────────────────────────────────────────────────────────── */

function pushTri(out, a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }

// One polygon (outer ring plus holes) to a closed ray-extruded solid.
//
// Triangulation happens in WALL space, before the rays are applied. A projective
// transform maps straight lines to straight lines, so a triangulation of the
// polygon is equally valid once projected — but the projected polygon is badly
// conditioned: the perspective divide squeezes parts of it into slivers that
// defeat earcut's ear clipping and leave triangles spanning straight across the
// holes. Same geometry, far better numbers: earcut's own deviation metric goes
// from 1.4e-1 on the projected polygon to 3.3e-16 on this one.
function extrudePolygon(poly, S, thickness, out) {
  const rings = [];
  for (const ring of poly) {
    const open = ring.length > 1 &&
      ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1) : ring;
    if (open.length < 3) return false;
    rings.push(open);
  }

  const flat = [];
  const holes = [];
  for (let i = 0; i < rings.length; i++) {
    if (i > 0) holes.push(flat.length / 2);
    for (const p of rings[i]) flat.push(p[0], p[1]);
  }
  const idx = earcut(flat, holes, 2);
  if (!idx.length) return false;

  const nVerts = flat.length / 2;
  const front = new Array(nVerts), back = new Array(nVerts);
  for (let i = 0; i < nVerts; i++) {
    const hit = rayToPlane(S.L, [flat[i * 2], flat[i * 2 + 1]], S.C, S.n);
    if (!hit) return false;                      // tilted past catching the image
    front[i] = hit.point;
    back[i] = backVertex(hit.point, S.L, thickness);
  }

  // Front cap faces the lamp: (u, v, n) is right-handed with n toward it, so a
  // CCW ring in surface space already winds outward.
  for (let i = 0; i < idx.length; i += 3) {
    pushTri(out, front[idx[i]], front[idx[i + 1]], front[idx[i + 2]]);
    pushTri(out, back[idx[i + 2]], back[idx[i + 1]], back[idx[i]]);
  }

  let base = 0;
  for (const r of rings) {
    const n = r.length;
    for (let i = 0; i < n; i++) {
      const a = base + i, b = base + (i + 1) % n;
      pushTri(out, front[a], back[b], front[b]);
      pushTri(out, front[a], back[a], back[b]);
    }
    base += n;
  }
  return true;
}

// A closed box along a segment, used to strut depth-separated islands. Kept as
// its own solid: overlapping closed solids still leave every edge paired, so the
// manifold check holds and slicers union them.
function strutBox(p, q, w, out) {
  const d = V.sub(q, p);
  const l = V.len(d);
  if (l < 1e-6) return;
  const ax = V.norm(d);
  let up = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const bx = V.norm(V.cross(up, ax)), cy = V.cross(ax, bx);
  const h = w / 2;
  const corner = (base, sb, sc) => V.add(base, V.add(V.mul(bx, sb * h), V.mul(cy, sc * h)));
  const A = [corner(p, -1, -1), corner(p, 1, -1), corner(p, 1, 1), corner(p, -1, 1)];
  const B = [corner(q, -1, -1), corner(q, 1, -1), corner(q, 1, 1), corner(q, -1, 1)];
  pushTri(out, A[0], A[2], A[1]); pushTri(out, A[0], A[3], A[2]);
  pushTri(out, B[0], B[1], B[2]); pushTri(out, B[0], B[2], B[3]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    pushTri(out, A[i], B[j], A[j]);
    pushTri(out, A[i], B[i], B[j]);
  }
}

const centroidOf = poly => {
  const b = boundsOf(poly[0] ? [poly[0]] : []);
  return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
};

/**
 * Builds the solid.
 *
 * `art` is a MultiPolygon already placed in wall millimetres (y up, centred).
 * Returns { positions, groups, bars, warnings }.
 */
export function buildSolid(art, opts) {
  const {
    L, objectDist, yaw, pitch, thickness,
    polarity = 'negative', marginMm = 8, bridgeMm = 2,
    spreadMm = 0, granularity = 'plate', bandCount = 5, seed = 1, magnification = 1
  } = opts;

  const warnings = [];
  let material = polarity === 'negative'
    ? pc.difference([plateRect(art, marginMm)], art)
    : art;
  if (!material.length) throw new Error('Nothing left to build — check polarity and margin.');

  // A plate is one rigid piece, so depth spread only means anything for positive
  // art made of separate islands.
  const spread = polarity === 'negative' ? 0 : spreadMm;
  const flatBuild = spread <= 0;

  let bars = [];
  if (flatBuild) {
    const br = bridge(material, bridgeMm * magnification);
    material = br.mp;
    bars = br.bars;
    if (material.length > 1) warnings.push(`${material.length} pieces could not be bridged.`);
  }

  const groups = flatBuild ? [material] : groupPolygons(material, granularity, bandCount);
  const depths = flatBuild ? [0] : spreadDepths(groups.length, spread, seed);

  const out = [];
  const anchors = [];
  let skipped = 0;
  for (let g = 0; g < groups.length; g++) {
    const S = makeSurface({ L, objectDist, yaw, pitch, delta: depths[g] });
    let placed = 0;
    for (const poly of groups[g]) {
      if (extrudePolygon(poly, S, thickness, out)) placed++;
      else skipped++;
    }
    if (placed && groups[g][0]) {
      const hit = rayToPlane(S.L, centroidOf(groups[g][0]), S.C, S.n);
      if (hit) anchors.push(hit.point);
    }
  }
  if (skipped) warnings.push(`${skipped} contour${skipped > 1 ? 's' : ''} fell outside the light cone — reduce tilt.`);

  const artFloatCount = out.length;

  // Depth-separated groups are physically loose, so strut them together.
  if (!flatBuild && anchors.length > 1 && bridgeMm > 0) {
    for (let i = 1; i < anchors.length; i++) strutBox(anchors[i - 1], anchors[i], bridgeMm, out);
    warnings.push(`${anchors.length - 1} strut${anchors.length > 2 ? 's' : ''} added between depth groups — these cast their own shadow.`);
  }

  if (!out.length) throw new Error('No geometry produced — try less tilt or a smaller object distance.');
  return { positions: new Float32Array(out), artFloatCount, groupCount: groups.length, bars, warnings, material };
}

/* ── Checks (shared with the verify script) ──────────────────────────────── */

export function checkManifold(arr) {
  const edges = new Map();
  const key = (a, b) => `${a}|${b}`;
  const vkey = i => `${Math.round(arr[i] * 1e4)},${Math.round(arr[i + 1] * 1e4)},${Math.round(arr[i + 2] * 1e4)}`;
  for (let i = 0; i < arr.length; i += 9) {
    const v = [vkey(i), vkey(i + 3), vkey(i + 6)];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      const k = a < b ? key(a, b) : key(b, a);
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  let bad = 0;
  for (const c of edges.values()) if (c !== 2) bad++;
  return { ok: bad === 0, badEdges: bad, edges: edges.size };
}

export function signedVolume(arr) {
  let v = 0;
  for (let i = 0; i < arr.length; i += 9) {
    v += (arr[i] * (arr[i + 4] * arr[i + 8] - arr[i + 5] * arr[i + 7])
        - arr[i + 1] * (arr[i + 3] * arr[i + 8] - arr[i + 5] * arr[i + 6])
        + arr[i + 2] * (arr[i + 3] * arr[i + 7] - arr[i + 4] * arr[i + 6])) / 6;
  }
  return v;
}

export function boundingBox(arr) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < arr.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      if (arr[i + a] < lo[a]) lo[a] = arr[i + a];
      if (arr[i + a] > hi[a]) hi[a] = arr[i + a];
    }
  }
  return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}
