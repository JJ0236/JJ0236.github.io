// terra/geometry.js — turns elevation + OSM features into printable solids.
//
// Everything here is pure: no DOM, no network. Runs inside the worker.
//
// The central idea is `solidify()`. Every layer is authored as a *top surface*
// only — a single-valued heightfield triangle soup — and solidify() closes it
// into a watertight solid by welding vertices, finding the edges that appear
// only once, and stitching those boundary loops down to a bottom surface.
// Terrain, buildings, roads, water, greenery and the frame all go through it,
// so watertightness is a property of one well-tested routine rather than six
// hand-written special cases.

import earcut from './earcut.js';
import { demSampler } from './sources.js';

export const LAYERS = [
  { id: 'terrain',   name: 'Terrain',   color: '#8B6340' },
  { id: 'water',     name: 'Water',     color: '#4C6A70' },
  { id: 'greenery',  name: 'Greenery',  color: '#5C7A4E' },
  { id: 'roads',     name: 'Roads',     color: '#5A6068' },
  { id: 'buildings', name: 'Buildings', color: '#D4CDB8' },
  { id: 'frame',     name: 'Frame',     color: '#3A4A2C' }
];

export const DEFAULTS = {
  widthMm: 180,
  baseThicknessMm: 3,
  exaggeration: 1.5,
  quality: 320,               // grid samples along the longer axis
  buildingScale: 1.0,
  defaultBuildingHeightM: 6,
  minBuildingMm: 0.8,
  includeMinorRoads: false,
  flattenWater: true,
  roadRaiseMm: 0.6,
  greeneryRaiseMm: 0.4,
  waterRaiseMm: 0.25,
  slabDepthMm: 1.2,
  frameWidthMm: 3,
  frameRaiseMm: 2,
  enabled: { terrain: true, buildings: true, roads: true, water: true, greenery: true, frame: false }
};

/* ── Growable triangle buffer ──────────────────────────────────────────── */

class MeshBuf {
  constructor(triCapacity = 512) {
    this.a = new Float32Array(triCapacity * 9);
    this.n = 0;      // floats used
    this.parts = []; // [start, end) float ranges, one per closed solid
  }
  _room(floats) {
    if (this.n + floats <= this.a.length) return;
    let cap = this.a.length || 9;
    while (cap < this.n + floats) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.a.subarray(0, this.n));
    this.a = next;
  }
  tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
    this._room(9);
    const a = this.a; let n = this.n;
    a[n++] = ax; a[n++] = ay; a[n++] = az;
    a[n++] = bx; a[n++] = by; a[n++] = bz;
    a[n++] = cx; a[n++] = cy; a[n++] = cz;
    this.n = n;
  }
  get triangles() { return this.n / 9; }
  toArray() { return this.a.slice(0, this.n); }
}

/* ── Vertex welding ────────────────────────────────────────────────────── */

// Quantise to 1/256 mm (~4 µm) — far below any printer's resolution, and far
// above float noise, so coincident vertices always collapse to one index.
const Q = 256;
const KEY_STRIDE = 8388608; // 2^23; safe while |y * Q| < 2^22

function vkey(x, y) {
  return Math.round(x * Q) * KEY_STRIDE + Math.round(y * Q);
}

/**
 * Close a top surface into a watertight solid.
 *
 * @param {Float32Array} src   flat xyz triangles, wound CCW seen from +Z
 * @param {number} count       floats in use
 * @param {number|function} bottom  z of the underside, or (x,y,zTop)=>z
 * @param {MeshBuf} out
 */
export function solidify(src, count, bottom, out) {
  const partStart = out.n;
  const index = new Map();
  const vx = [], vy = [], vz = [];
  const tris = [];

  const weld = (x, y, z) => {
    const k = vkey(x, y);
    let i = index.get(k);
    if (i === undefined) {
      i = vx.length;
      index.set(k, i);
      vx.push(x); vy.push(y); vz.push(z);
    }
    return i;
  };

  for (let i = 0; i < count; i += 9) {
    const a = weld(src[i],     src[i + 1], src[i + 2]);
    const b = weld(src[i + 3], src[i + 4], src[i + 5]);
    const c = weld(src[i + 6], src[i + 7], src[i + 8]);
    if (a === b || b === c || c === a) continue; // collapsed by quantisation
    tris.push(a, b, c);
  }
  if (!tris.length) return;

  const V = vx.length;

  // Belt and braces: reject any triangle that repeats a directed edge already
  // used. Two same-facing triangles on one edge is the signature of an
  // overlapping triangulation, and it would survive into the export as a
  // non-manifold solid. Dropping the duplicate leaves a rim instead, and the
  // wall pass below closes it — so the result stays watertight either way.
  {
    const used = new Set();
    const kept = [];
    let dropped = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const e0 = a * V + b, e1 = b * V + c, e2 = c * V + a;
      if (used.has(e0) || used.has(e1) || used.has(e2)) { dropped++; continue; }
      used.add(e0); used.add(e1); used.add(e2);
      kept.push(a, b, c);
    }
    if (dropped) tris.length = 0, tris.push(...kept);
  }
  if (!tris.length) return;
  const bz = new Float64Array(V);
  if (typeof bottom === 'function') {
    for (let i = 0; i < V; i++) bz[i] = bottom(vx[i], vy[i], vz[i]);
  } else {
    bz.fill(bottom);
  }

  // Top surface, then the same triangles reversed underneath.
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    out.tri(vx[a], vy[a], vz[a], vx[b], vy[b], vz[b], vx[c], vy[c], vz[c]);
    out.tri(vx[a], vy[a], bz[a], vx[c], vy[c], bz[c], vx[b], vy[b], bz[b]);
  }

  // Edges seen once are the rim. Their direction keeps material on the left,
  // which is what makes the wall winding below correct for outer loops and
  // interior holes alike.
  const seen = new Set();
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    seen.add(a * V + b); seen.add(b * V + c); seen.add(c * V + a);
  }
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      if (seen.has(v * V + u)) continue;
      // Wall quad, normal pointing away from the material.
      out.tri(vx[u], vy[u], vz[u], vx[u], vy[u], bz[u], vx[v], vy[v], bz[v]);
      out.tri(vx[u], vy[u], vz[u], vx[v], vy[v], bz[v], vx[v], vy[v], vz[v]);
    }
  }

  if (out.parts && out.n > partStart) out.parts.push(partStart, out.n);
}

/**
 * Development check: in a closed manifold every edge appears exactly twice,
 * once in each direction.
 *
 * A layer usually holds many independent solids — every building, every road.
 * Those legitimately touch and overlap, so check each solid's range on its own;
 * running this across a whole layer at once reports shared vertices between
 * neighbouring solids as defects.
 */
export function checkManifold(arr, parts) {
  if (parts && parts.length) {
    const total = { ok: true, openEdges: 0, duplicateEdges: 0, vertices: 0, solids: parts.length / 2, badSolids: 0 };
    for (let i = 0; i < parts.length; i += 2) {
      const r = checkRange(arr, parts[i], parts[i + 1]);
      total.openEdges += r.openEdges;
      total.duplicateEdges += r.duplicateEdges;
      total.vertices += r.vertices;
      if (!r.ok) { total.ok = false; total.badSolids++; }
    }
    return total;
  }
  return checkRange(arr, 0, arr.length);
}

function checkRange(arr, from, to) {
  const index = new Map();
  const verts = [];
  const dir = new Map();
  const weldKey = (x, y, z) =>
    `${Math.round(x * Q)},${Math.round(y * Q)},${Math.round(z * Q)}`;

  for (let i = from; i < to; i += 9) {
    const ids = [];
    for (let v = 0; v < 3; v++) {
      const k = weldKey(arr[i + v * 3], arr[i + v * 3 + 1], arr[i + v * 3 + 2]);
      let id = index.get(k);
      if (id === undefined) { id = verts.length; index.set(k, id); verts.push(k); }
      ids.push(id);
    }
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
    for (const [u, v] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
      const k = `${u}>${v}`;
      dir.set(k, (dir.get(k) || 0) + 1);
    }
  }

  let open = 0, dupes = 0;
  for (const [k, n] of dir) {
    if (n > 1) dupes++;
    const [u, v] = k.split('>');
    if (!dir.has(`${v}>${u}`)) open++;
  }
  return { ok: open === 0 && dupes === 0, openEdges: open, duplicateEdges: dupes, vertices: verts.length };
}

/* ── Planar helpers ────────────────────────────────────────────────────── */

function signedArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return s / 2;
}

/**
 * Sutherland–Hodgman, against a *convex* clip region — which is why selections
 * are limited to rectangles and circles.
 *
 * Only ever call this with a CONVEX subject. Given a concave one it returns a
 * polygon joined by zero-width bridges wherever the result should have split
 * into separate pieces; earcut then emits overlapping triangles and the solid
 * is no longer manifold. Real OSM courtyards and L-shaped blocks hit this
 * constantly. clipSurface() below is the safe entry point: it triangulates
 * first, so every subject handed here is a triangle.
 */
function clipToConvex(subject, clip) {
  let out = subject;
  const ccw = signedArea(clip) > 0;
  for (let i = 0, j = clip.length - 1; i < clip.length; j = i++) {
    if (!out.length) return out;
    const a = clip[j], b = clip[i];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const inside = p => {
      const cross = ex * (p[1] - a[1]) - ey * (p[0] - a[0]);
      return ccw ? cross >= 0 : cross <= 0;
    };
    const input = out;
    out = [];
    for (let m = 0, n = input.length - 1; m < input.length; n = m++) {
      const cur = input[m], prev = input[n];
      const cin = inside(cur), pin = inside(prev);
      if (cin) {
        if (!pin) out.push(lineCross(prev, cur, a, ex, ey));
        out.push(cur);
      } else if (pin) {
        out.push(lineCross(prev, cur, a, ex, ey));
      }
    }
  }
  return out;
}

function lineCross(p, q, a, ex, ey) {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const denom = ex * dy - ey * dx;
  if (Math.abs(denom) < 1e-12) return [q[0], q[1]];
  const t = (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / denom;
  return [p[0] - dx * t, p[1] - dy * t];
}

function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > py) !== (yj > py) &&
        px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Triangulate rings (outer first, then holes) into a MeshBuf at heights from zOf.
function fillRings(rings, zOf, out) {
  const outer = rings[0];
  if (!outer || outer.length < 3) return;

  const normalized = rings.map((r, i) => {
    const a = signedArea(r);
    if (Math.abs(a) < 1e-9) return null;
    // earcut inherits the outer ring's winding; force CCW so tops face +Z.
    const wantCcw = i === 0;
    return (a > 0) === wantCcw ? r : r.slice().reverse();
  });
  // A collapsed outer ring means no polygon at all — dropping it would
  // silently promote a hole into the outline.
  if (!normalized[0]) return;
  const usable = normalized.filter(Boolean);

  const coords = [];
  const holes = [];
  usable.forEach((r, i) => {
    if (i) holes.push(coords.length / 2);
    for (const p of r) coords.push(p[0], p[1]);
  });

  const idx = earcut(coords, holes, 2);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 2, b = idx[i + 1] * 2, c = idx[i + 2] * 2;
    const ax = coords[a], ay = coords[a + 1];
    const bx = coords[b], by = coords[b + 1];
    const cx = coords[c], cy = coords[c + 1];
    out.tri(ax, ay, zOf(ax, ay), bx, by, zOf(bx, by), cx, cy, zOf(cx, cy));
  }
}

/**
 * Refine a triangulation until no edge exceeds maxEdge, so draped surfaces
 * track the terrain instead of spanning a valley in one flat facet.
 *
 * Splitting decisions are made per *edge*, not per triangle, and applied to
 * both triangles sharing that edge. Refining each triangle independently is
 * the obvious approach and it is wrong: it leaves a midpoint sitting in the
 * middle of the neighbour's untouched edge, and solidify() then walls off
 * both versions of that edge and produces a non-manifold seam.
 *
 * Takes and returns a triangle soup in XY (z ignored); callers drape after.
 */
function subdivide(buf, maxEdge, maxPasses = 7) {
  // Index the soup so shared edges are actually shared.
  const index = new Map();
  const xs = [], ys = [];
  const weld = (x, y) => {
    const k = vkey(x, y);
    let i = index.get(k);
    if (i === undefined) { i = xs.length; index.set(k, i); xs.push(x); ys.push(y); }
    return i;
  };

  let tris = [];
  for (let i = 0; i < buf.n; i += 9) {
    const a = weld(buf.a[i], buf.a[i + 1]);
    const b = weld(buf.a[i + 3], buf.a[i + 4]);
    const c = weld(buf.a[i + 6], buf.a[i + 7]);
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }

  const max2 = maxEdge * maxEdge;
  const long = (u, v) => (xs[u] - xs[v]) ** 2 + (ys[u] - ys[v]) ** 2 > max2;

  for (let pass = 0; pass < maxPasses; pass++) {
    const mids = new Map();
    const stride = xs.length;   // fixed for the pass; midpoints land past it
    const midOf = (u, v) => {
      const k = u < v ? u * stride + v : v * stride + u;
      let m = mids.get(k);
      if (m === undefined) {
        m = xs.length;
        xs.push((xs[u] + xs[v]) / 2);
        ys.push((ys[u] + ys[v]) / 2);
        mids.set(k, m);
      }
      return m;
    };

    // Mark first, split second — that is what keeps neighbours in agreement.
    const marked = [];
    let any = false;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const m = [long(a, b), long(b, c), long(c, a)];
      if (m[0] || m[1] || m[2]) any = true;
      marked.push(m);
    }
    if (!any) break;

    const next = [];
    const push = (...v) => next.push(...v);
    for (let t = 0, k = 0; t < tris.length; t += 3, k++) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const [e0, e1, e2] = marked[k];
      const m0 = e0 ? midOf(a, b) : -1;
      const m1 = e1 ? midOf(b, c) : -1;
      const m2 = e2 ? midOf(c, a) : -1;

      if (e0 && e1 && e2) push(a, m0, m2, m0, b, m1, m2, m1, c, m0, m1, m2);
      else if (e0 && e1)  push(m0, b, m1, a, m0, m1, a, m1, c);
      else if (e1 && e2)  push(m1, c, m2, a, b, m1, a, m1, m2);
      else if (e0 && e2)  push(a, m0, m2, m0, b, c, m0, c, m2);
      else if (e0)        push(a, m0, c, m0, b, c);
      else if (e1)        push(a, b, m1, a, m1, c);
      else if (e2)        push(a, b, m2, m2, b, c);
      else                push(a, b, c);
    }
    tris = next;

    if (tris.length > 3_000_000) break; // runaway guard
  }

  const out = new MeshBuf(tris.length / 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    out.tri(xs[a], ys[a], 0, xs[b], ys[b], 0, xs[c], ys[c], 0);
  }
  return out;
}

/* ── Projection ────────────────────────────────────────────────────────── */

// Local tangent plane at the selection centre. Avoids Web Mercator's latitude
// scale distortion, which at 60° would stretch the model 2:1.
function makeProjection(bbox, widthMm) {
  const lat0 = (bbox.north + bbox.south) / 2;
  const lon0 = (bbox.east + bbox.west) / 2;
  const mPerLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  const mPerLat = 110540;
  const widthM = (bbox.east - bbox.west) * mPerLon;
  const mmPerM = widthMm / widthM;

  return {
    lon0, lat0, mmPerM, widthM,
    heightM: (bbox.north - bbox.south) * mPerLat,
    x: lon => (lon - lon0) * mPerLon * mmPerM,
    y: lat => (lat - lat0) * mPerLat * mmPerM,
    lon: x => x / (mPerLon * mmPerM) + lon0,
    lat: y => y / (mPerLat * mmPerM) + lat0,
    ring: r => r.map(p => [(p[0] - lon0) * mPerLon * mmPerM, (p[1] - lat0) * mPerLat * mmPerM])
  };
}

/* ── Model build ───────────────────────────────────────────────────────── */

export function buildModel({ selection, dem, osm, params, onProgress }) {
  const p = { ...DEFAULTS, ...params };
  const enabled = { ...DEFAULTS.enabled, ...(params.enabled || {}) };
  const report = (stage, frac) => onProgress && onProgress(stage, frac);

  const bbox = selection.bbox;
  const proj = makeProjection(bbox, p.widthMm);
  const sampleElev = demSampler(dem);
  const outerRing = proj.ring(selection.ring);

  // With a frame on, everything else has to stop short of it — otherwise the
  // terrain fills the border band and the frame's colour never shows.
  const inset = enabled.frame ? insetRing(outerRing, p.frameWidthMm) : null;
  const clipRing = inset || outerRing;

  const x0 = proj.x(bbox.west), x1 = proj.x(bbox.east);
  const y0 = proj.y(bbox.south), y1 = proj.y(bbox.north);
  const spanX = x1 - x0, spanY = y1 - y0;

  const long = Math.max(spanX, spanY);
  const gw = Math.max(8, Math.round(p.quality * spanX / long));
  const gh = Math.max(8, Math.round(p.quality * spanY / long));
  const cellX = spanX / gw, cellY = spanY / gh;

  // Grid elevations, sampled once and reused by every layer.
  report('Sampling elevation', 0);
  const gz = new Float32Array((gw + 1) * (gh + 1));
  let minElev = Infinity, maxElev = -Infinity;
  for (let j = 0; j <= gh; j++) {
    const lat = proj.lat(y0 + j * cellY);
    for (let i = 0; i <= gw; i++) {
      const e = sampleElev(proj.lon(x0 + i * cellX), lat);
      gz[j * (gw + 1) + i] = e;
      if (e < minElev) minElev = e;
      if (e > maxElev) maxElev = e;
    }
  }
  if (!Number.isFinite(minElev)) { minElev = 0; maxElev = 0; }

  const vScale = proj.mmPerM * p.exaggeration;
  const zOfElev = e => p.baseThicknessMm + (e - minElev) * vScale;

  // Terrain height at any point in model space.
  const terrainZ = (x, y) => zOfElev(sampleElev(proj.lon(x), proj.lat(y)));

  // A rectangle selection with no frame means the grid already stops exactly
  // on the boundary, so every cell is whole and no clipping is needed at all.
  const wholeGrid = selection.type === 'rect' && !inset;
  const inside = wholeGrid
    ? () => true
    : (x, y) => pointInRing(x, y, clipRing);

  const layers = {};
  const put = (id, buf) => {
    if (buf && buf.n) layers[id] = buf;
  };

  /* Terrain ------------------------------------------------------------- */
  if (enabled.terrain) {
    report('Building terrain', 0);
    const top = new MeshBuf(gw * gh * 2);
    const inFlag = new Uint8Array((gw + 1) * (gh + 1));
    for (let j = 0; j <= gh; j++) {
      for (let i = 0; i <= gw; i++) {
        inFlag[j * (gw + 1) + i] = inside(x0 + i * cellX, y0 + j * cellY) ? 1 : 0;
      }
    }

    const zAtGrid = (i, j) => zOfElev(gz[j * (gw + 1) + i]);

    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const c00 = inFlag[j * (gw + 1) + i];
        const c10 = inFlag[j * (gw + 1) + i + 1];
        const c11 = inFlag[(j + 1) * (gw + 1) + i + 1];
        const c01 = inFlag[(j + 1) * (gw + 1) + i];
        const n = c00 + c10 + c11 + c01;
        if (n === 0) continue;

        const ax = x0 + i * cellX, ay = y0 + j * cellY;
        const bx = ax + cellX, by = ay + cellY;

        if (n === 4) {
          // Selections are convex, so four corners inside means the whole cell is.
          const z00 = zAtGrid(i, j), z10 = zAtGrid(i + 1, j);
          const z11 = zAtGrid(i + 1, j + 1), z01 = zAtGrid(i, j + 1);
          top.tri(ax, ay, z00, bx, ay, z10, bx, by, z11);
          top.tri(ax, ay, z00, bx, by, z11, ax, by, z01);
        } else {
          const poly = clipToConvex([[ax, ay], [bx, ay], [bx, by], [ax, by]], clipRing);
          if (poly.length < 3) continue;
          for (let k = 1; k < poly.length - 1; k++) {
            const q = poly[0], r = poly[k], s = poly[k + 1];
            top.tri(q[0], q[1], terrainZ(q[0], q[1]),
                    r[0], r[1], terrainZ(r[0], r[1]),
                    s[0], s[1], terrainZ(s[0], s[1]));
          }
        }
      }
      if ((j & 31) === 0) report('Building terrain', j / gh);
    }

    const solid = new MeshBuf(top.triangles * 3);
    solidify(top.a, top.n, 0, solid);
    put('terrain', solid);
  }

  const maxEdge = Math.max(cellX, cellY) * 1.5;

  // Every draped slab must keep a positive thickness. A flattened lake sitting
  // on a slope will otherwise have its underside (terrain - depth) rise through
  // its flat top along one contour, pinching the solid to nothing there — which
  // is both unprintable and non-manifold.
  const MIN_SLAB_MM = 0.6;
  const underside = (x, y, zTop) =>
    Math.min(terrainZ(x, y) - p.slabDepthMm, zTop - MIN_SLAB_MM);

  /* Slab layers (water, greenery) --------------------------------------- */
  const slab = (features, raise, flatten) => {
    const out = new MeshBuf(2048);
    for (const f of features) {
      if (f.line) {
        for (const piece of clipLineToSelection(proj.ring(f.line), clipRing)) {
          const strip = stripTop(piece, f.width * proj.mmPerM, maxEdge,
                                 (x, y) => terrainZ(x, y) + raise);
          if (!strip.n) continue;
          solidify(strip.a, strip.n, underside, out);
        }
        continue;
      }
      const clipped = surfaceFromRings(f.rings, proj, clipRing, true);
      if (!clipped) continue;
      // A flattened surface is a plane — refining it buys nothing, and its
      // underside is buried in the terrain where nobody will see the coarseness.
      const dense = subdivide(clipped, flatten ? maxEdge * 4 : maxEdge);

      let zOf;
      if (flatten) {
        // A lake draped over terrain looks like a hill. Use one level surface
        // at the median height under the polygon instead.
        const samples = [];
        for (let i = 0; i < dense.n; i += 9) {
          samples.push(terrainZ(dense.a[i], dense.a[i + 1]));
        }
        samples.sort((a, b) => a - b);
        const level = samples[Math.floor(samples.length / 2)] + raise;
        zOf = () => level;
      } else {
        zOf = (x, y) => terrainZ(x, y) + raise;
      }

      const top = new MeshBuf(dense.triangles);
      for (let i = 0; i < dense.n; i += 9) {
        top.tri(dense.a[i],     dense.a[i + 1], zOf(dense.a[i],     dense.a[i + 1]),
                dense.a[i + 3], dense.a[i + 4], zOf(dense.a[i + 3], dense.a[i + 4]),
                dense.a[i + 6], dense.a[i + 7], zOf(dense.a[i + 6], dense.a[i + 7]));
      }
      solidify(top.a, top.n, underside, out);
    }
    return out;
  };

  if (enabled.water && osm) {
    report('Building water', 0);
    put('water', slab(osm.water, p.waterRaiseMm, p.flattenWater));
  }
  if (enabled.greenery && osm) {
    report('Building greenery', 0);
    put('greenery', slab(osm.greenery, p.greeneryRaiseMm, false));
  }

  /* Roads ---------------------------------------------------------------- */
  if (enabled.roads && osm) {
    report('Building roads', 0);
    const out = new MeshBuf(4096);
    const list = osm.roads.filter(r => p.includeMinorRoads || !r.minor);
    list.forEach((r, n) => {
      const line = clipLineToSelection(proj.ring(r.line), clipRing);
      for (const piece of line) {
        if (piece.length < 2) continue;
        const strip = stripTop(piece, r.width * proj.mmPerM, maxEdge,
                               (x, y) => terrainZ(x, y) + p.roadRaiseMm);
        if (!strip.n) continue;
        solidify(strip.a, strip.n, underside, out);
      }
      if ((n & 255) === 0) report('Building roads', n / list.length);
    });
    put('roads', out);
  }

  /* Buildings ------------------------------------------------------------ */
  if (enabled.buildings && osm) {
    report('Building structures', 0);
    const out = new MeshBuf(4096);
    osm.buildings.forEach((b, n) => {
      const roof = surfaceFromRings(b.rings, proj, clipRing, true);
      if (!roof) return;

      // Sit the base at the lowest terrain under the footprint and sink it
      // slightly, so the slicer unions it with the ground instead of leaving
      // a hairline gap on a slope.
      let groundZ = Infinity;
      for (let i = 0; i < roof.n; i += 3) {
        const z = terrainZ(roof.a[i], roof.a[i + 1]);
        if (z < groundZ) groundZ = z;
      }
      if (!Number.isFinite(groundZ)) return;

      const hM = b.height ?? p.defaultBuildingHeightM;
      const hMm = Math.max(p.minBuildingMm, hM * proj.mmPerM * p.buildingScale);
      const topZ = groundZ + hMm;
      for (let i = 2; i < roof.n; i += 3) roof.a[i] = topZ;

      solidify(roof.a, roof.n, groundZ - 0.3, out);

      if ((n & 511) === 0) report('Building structures', n / osm.buildings.length);
    });
    put('buildings', out);
  }

  /* Frame ---------------------------------------------------------------- */
  if (enabled.frame && inset) {
    report('Building frame', 0);
    // The frame is the border band the terrain was inset out of, so it follows
    // the same surface and stands slightly proud of it. Giving it one flat top
    // at the highest point instead turns a mountain tile into a deep bucket.
    // insetRing keeps one vertex per input vertex, so the band can be meshed
    // directly as a grid — along the perimeter and across the width. Earcutting
    // the annulus and refining instead produces slivers spanning the whole
    // perimeter, and uniform refinement splits their short side far past what
    // it needs, ballooning a 3 mm border into tens of thousands of triangles.
    const band = new MeshBuf(256);
    const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const across = Math.max(1, Math.ceil(p.frameWidthMm / maxEdge));

    if (inset.length === outerRing.length) {
      for (let i = 0; i < outerRing.length; i++) {
        const j = (i + 1) % outerRing.length;
        const len = Math.hypot(outerRing[j][0] - outerRing[i][0],
                               outerRing[j][1] - outerRing[i][1]);
        const along = Math.max(1, Math.ceil(len / maxEdge));
        for (let s = 0; s < along; s++) {
          const t0 = s / along, t1 = (s + 1) / along;
          const o0 = lerp(outerRing[i], outerRing[j], t0);
          const o1 = lerp(outerRing[i], outerRing[j], t1);
          const n0 = lerp(inset[i], inset[j], t0);
          const n1 = lerp(inset[i], inset[j], t1);
          for (let k = 0; k < across; k++) {
            const u0 = k / across, u1 = (k + 1) / across;
            const a = lerp(o0, n0, u0), b = lerp(o1, n1, u0);
            const c = lerp(o1, n1, u1), d = lerp(o0, n0, u1);
            band.tri(a[0], a[1], 0, b[0], b[1], 0, c[0], c[1], 0);
            band.tri(a[0], a[1], 0, c[0], c[1], 0, d[0], d[1], 0);
          }
        }
      }
    } else {
      fillRings([outerRing, inset], () => 0, band);
    }
    const dense = subdivide(band, maxEdge);

    const top = new MeshBuf(dense.triangles);
    const lift = (x, y) => terrainZ(x, y) + p.frameRaiseMm;
    for (let i = 0; i < dense.n; i += 9) {
      top.tri(dense.a[i],     dense.a[i + 1], lift(dense.a[i],     dense.a[i + 1]),
              dense.a[i + 3], dense.a[i + 4], lift(dense.a[i + 3], dense.a[i + 4]),
              dense.a[i + 6], dense.a[i + 7], lift(dense.a[i + 6], dense.a[i + 7]));
    }

    const out = new MeshBuf(top.triangles * 3);
    solidify(top.a, top.n, 0, out);
    put('frame', out);
  }

  /* Assemble ------------------------------------------------------------- */
  const result = [];
  let triangles = 0;
  let minZ = Infinity, maxZ = -Infinity;
  for (const def of LAYERS) {
    const buf = layers[def.id];
    if (!buf) continue;
    const positions = buf.toArray();
    for (let i = 2; i < positions.length; i += 3) {
      if (positions[i] < minZ) minZ = positions[i];
      if (positions[i] > maxZ) maxZ = positions[i];
    }
    triangles += positions.length / 9;
    result.push({ ...def, positions, parts: buf.parts });
  }

  return {
    layers: result,
    stats: {
      triangles,
      widthMm: spanX,
      depthMm: spanY,
      heightMm: Number.isFinite(maxZ) ? maxZ : 0,
      minElev, maxElev,
      reliefM: maxElev - minElev,
      areaKm2: (proj.widthM / 1000) * (proj.heightM / 1000),
      scaleDenominator: Math.round(1 / (proj.mmPerM / 1000)),
      gridW: gw, gridH: gh,
      buildings: osm ? osm.buildings.length : 0,
      roads: osm ? osm.roads.length : 0
    }
  };
}

/* ── Feature helpers ───────────────────────────────────────────────────── */

/**
 * Triangulate a feature's rings in model space, then clip the triangles to the
 * selection. Returns a flat top surface at z=0, or null if nothing survives.
 *
 * Clipping after triangulation rather than before is what keeps concave
 * features correct: a triangle is convex by definition, so clipToConvex()
 * never has to bridge disjoint pieces. Adjacent triangles sharing an edge that
 * crosses the boundary both cut it at the same intersection point, so the
 * result stays free of T-junctions too.
 */
function surfaceFromRings(rings, proj, clipRing, needsClip) {
  const flat = new MeshBuf(64);
  fillRings(rings.map(r => proj.ring(r)), () => 0, flat);
  if (!flat.n) return null;
  const out = needsClip ? clipSurface(flat, clipRing) : flat;
  return out.n ? out : null;
}

function clipSurface(buf, clipRing) {
  const out = new MeshBuf(buf.triangles);
  for (let i = 0; i < buf.n; i += 9) {
    const tri = [
      [buf.a[i], buf.a[i + 1]],
      [buf.a[i + 3], buf.a[i + 4]],
      [buf.a[i + 6], buf.a[i + 7]]
    ];
    const poly = clipToConvex(tri, clipRing);
    if (poly.length < 3) continue;
    for (let k = 1; k < poly.length - 1; k++) {
      out.tri(poly[0][0], poly[0][1], 0,
              poly[k][0], poly[k][1], 0,
              poly[k + 1][0], poly[k + 1][1], 0);
    }
  }
  return out;
}

/**
 * Split a polyline where it leaves the selection, keeping the inside pieces.
 *
 * Clipping is per segment and parametric (Cyrus–Beck against the convex
 * region). Testing the vertices instead would silently drop any segment that
 * crosses clean through with both endpoints outside — a long motorway across
 * a small selection is exactly that shape.
 */
function clipLineToSelection(line, clipRing) {
  const ccw = signedArea(clipRing) > 0;
  const pieces = [];
  let current = null;

  for (let i = 0; i < line.length - 1; i++) {
    const seg = clipSegment(line[i], line[i + 1], clipRing, ccw);
    if (!seg) {
      if (current) { pieces.push(current); current = null; }
      continue;
    }
    const [s, e] = seg;
    if (current && Math.hypot(
          current[current.length - 1][0] - s[0],
          current[current.length - 1][1] - s[1]) < 1e-6) {
      current.push(e);
    } else {
      if (current) pieces.push(current);
      current = [s, e];
    }
  }
  if (current) pieces.push(current);

  return pieces.filter(p => {
    if (p.length < 2) return false;
    let len = 0;
    for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    return len > 1e-4;
  });
}

function clipSegment(a, b, ring, ccw) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let t0 = 0, t1 = 1;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j], q = ring[i];
    const ex = q[0] - p[0], ey = q[1] - p[1];
    // Outward normal: right of travel for a CCW ring.
    const nx = ccw ? ey : -ey;
    const ny = ccw ? -ex : ex;

    const denom = nx * dx + ny * dy;
    const num = nx * (a[0] - p[0]) + ny * (a[1] - p[1]);
    if (Math.abs(denom) < 1e-12) {
      if (num > 1e-9) return null;   // parallel and outside
      continue;
    }
    const t = -num / denom;
    if (denom < 0) { if (t > t0) t0 = t; }   // entering
    else { if (t < t1) t1 = t; }             // leaving
    if (t0 > t1) return null;
  }
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}

// Widen a polyline into a draped ribbon (top surface only).
function stripTop(pts, width, maxEdge, zOf) {
  const buf = new MeshBuf(64);
  const half = Math.max(width, 0.4) / 2;

  // Drop repeated points, then densify so the ribbon follows the ground.
  const clean = [];
  for (const pt of pts) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 1e-4) clean.push(pt);
  }
  if (clean.length < 2) return buf;

  const dense = [clean[0]];
  for (let i = 1; i < clean.length; i++) {
    const a = dense[dense.length - 1], b = clean[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(d / maxEdge));
    for (let s = 1; s <= steps; s++) {
      dense.push([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps]);
    }
  }

  const L = [], R = [];
  for (let i = 0; i < dense.length; i++) {
    const prev = dense[Math.max(0, i - 1)];
    const next = dense[Math.min(dense.length - 1, i + 1)];
    let dx = next[0] - prev[0], dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    L.push([dense[i][0] + nx * half, dense[i][1] + ny * half]);
    R.push([dense[i][0] - nx * half, dense[i][1] - ny * half]);
  }

  for (let i = 0; i < dense.length - 1; i++) {
    const l0 = L[i], r0 = R[i], l1 = L[i + 1], r1 = R[i + 1];
    buf.tri(l0[0], l0[1], zOf(l0[0], l0[1]),
            r0[0], r0[1], zOf(r0[0], r0[1]),
            r1[0], r1[1], zOf(r1[0], r1[1]));
    buf.tri(l0[0], l0[1], zOf(l0[0], l0[1]),
            r1[0], r1[1], zOf(r1[0], r1[1]),
            l1[0], l1[1], zOf(l1[0], l1[1]));
  }
  return buf;
}

// Inward offset by mitred vertex normals. Selections are convex, so this
// cannot self-intersect.
function insetRing(ring, dist) {
  const ccw = signedArea(ring) > 0;
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n], cur = ring[i], next = ring[(i + 1) % n];
    const n1 = normalOf(prev, cur, ccw);
    const n2 = normalOf(cur, next, ccw);
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const mlen = Math.hypot(mx, my);
    if (mlen < 1e-9) continue;
    mx /= mlen; my /= mlen;
    const cos = mx * n1[0] + my * n1[1];
    const scale = Math.min(dist / Math.max(cos, 0.2), dist * 5);
    out.push([cur[0] + mx * scale, cur[1] + my * scale]);
  }
  return signedArea(out) * (ccw ? 1 : -1) > 0 ? out : null;
}

function normalOf(a, b, ccw) {
  let dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  // Inward normal: left of travel for a CCW ring.
  return ccw ? [-dy, dx] : [dy, -dx];
}
