// patch/pieces.js — finished block regions -> cut pieces.
//
// The one rule that matters in quilting: a piece is cut larger than it
// finishes, by the seam allowance, on every edge. Patterns usually state that
// as a per-unit rule ("half-square triangle = finished + 7/8 inch"), but those
// rules are all the same operation underneath — offset the finished polygon
// outward by the seam allowance — so that is what this does. It reproduces the
// traditional numbers and also works for geometry no rule book covers.

import { blockRegions } from './blocks.js';

export const INCH = 25.4;
export const DEFAULT_SEAM = INCH / 4;          // quilting standard

const area = p => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i][0] * p[j][1] - p[j][0] * p[i][1];
  }
  return a / 2;
};

/**
 * Offset a CONVEX polygon outward by d.
 *
 * `miterLimit` is what trims dog ears. An acute corner's mitre runs out to
 * d/sin(theta/2) — on a 45-degree quilt triangle that is 2.6x the seam
 * allowance, a long fragile spike. Real patterns cut those points off, and
 * clamping the mitre does exactly that, leaving the blunt end quilters expect.
 */
export function offsetConvex(poly, d, miterLimit = Infinity) {
  if (d === 0) return poly.map(p => p.slice());
  const n = poly.length;
  // Outward is whichever normal grows the polygon; do not assume a winding.
  const sign = area(poly) > 0 ? 1 : -1;

  const lines = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % n];
    const ex = bx - ax, ey = by - ay;
    const len = Math.hypot(ex, ey) || 1;
    const nx = (ey / len) * sign, ny = (-ex / len) * sign;
    lines.push({ px: ax + nx * d, py: ay + ny * d, dx: ex / len, dy: ey / len, nx, ny });
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n], cur = lines[i];
    const v = poly[i];
    const den = prev.dx * cur.dy - prev.dy * cur.dx;

    if (Math.abs(den) < 1e-12) {            // parallel edges: no corner to cut
      out.push([v[0] + cur.nx * d, v[1] + cur.ny * d]);
      continue;
    }
    const t = ((cur.px - prev.px) * cur.dy - (cur.py - prev.py) * cur.dx) / den;
    const mx = prev.px + prev.dx * t, my = prev.py + prev.dy * t;
    const reach = Math.hypot(mx - v[0], my - v[1]);

    if (reach <= miterLimit * Math.abs(d) + 1e-9) {
      out.push([mx, my]);
    } else {
      // Bevel: cut the point off square across the corner.
      const bx = (mx - v[0]) / reach, by = (my - v[1]) / reach;
      const cx = v[0] + bx * miterLimit * Math.abs(d);
      const cy = v[1] + by * miterLimit * Math.abs(d);
      // slide back along each offset edge to meet the cut
      const back = Math.sqrt(Math.max(0, reach * reach - (miterLimit * d) ** 2));
      out.push([mx - prev.dx * back, my - prev.dy * back]);
      out.push([mx + cur.dx * back, my + cur.dy * back]);
      void cx; void cy;
    }
  }
  return out;
}

// Congruence key: same edge lengths in the same cyclic order, same area.
// Enough to group "three of these triangles" without comparing coordinates.
function shapeKey(poly) {
  const n = poly.length;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    edges.push(Math.hypot(poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]));
  }
  const rounded = edges.map(e => e.toFixed(2));
  // canonical rotation of the edge cycle, and its reverse, so mirrored and
  // rotated copies of one shape group together
  const cycles = [];
  for (let s = 0; s < n; s++) {
    cycles.push(rounded.slice(s).concat(rounded.slice(0, s)).join(','));
    const rev = rounded.slice().reverse();
    cycles.push(rev.slice(s).concat(rev.slice(0, s)).join(','));
  }
  cycles.sort();
  return `${n}|${Math.abs(area(poly)).toFixed(2)}|${cycles[0]}`;
}

export function bounds(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Turn a block into cut pieces.
 *
 * block        from blocks.js
 * finishedMm   finished size of the whole block
 * fabricFor    (regionIndex, region) -> fabric id; defaults to the region's
 *              own role, so a block arrives with its intended light/dark
 *              layout instead of one flat colour
 * seamMm       seam allowance, default 1/4 inch
 * trimPoints   clamp the mitre so dog ears are cut off (default false, which
 *              matches what a pattern gives you: the points are left on)
 */
export function blockPieces(block, finishedMm, {
  fabricFor = (i, r) => r.role, seamMm = DEFAULT_SEAM, trimPoints = false,
} = {}) {
  const scale = finishedMm / block.grid;
  const regions = blockRegions(block).map((r, i) => ({
    index: i,
    role: r.role,
    unitType: r.unitType,
    fabric: fabricFor(i, r),
    finished: r.poly.map(([x, y]) => [x * scale, y * scale]),
  }));

  const miter = trimPoints ? 1.6 : Infinity;
  const groups = new Map();

  for (const r of regions) {
    r.cut = offsetConvex(r.finished, seamMm, miter);
    const key = `${r.fabric}|${shapeKey(r.finished)}`;
    let g = groups.get(key);
    if (!g) {
      const b = bounds(r.cut);
      groups.set(key, (g = {
        key, fabric: r.fabric, unitType: r.unitType,
        finished: r.finished, cut: r.cut,
        cutW: b.w, cutH: b.h,
        finishedArea: Math.abs(area(r.finished)),
        count: 0, regions: [],
      }));
    }
    g.count++;
    g.regions.push(r.index);
  }

  return { regions, pieces: [...groups.values()].sort((a, b) => b.finishedArea - a.finishedArea), scale };
}

// Fabric needed, as the summed area of the cut pieces. Real yardage is higher
// once the pieces are nested, so this is the floor, not a shopping list.
export function fabricTotals(pieces) {
  const by = new Map();
  for (const p of pieces) {
    const a = Math.abs(area(p.cut)) * p.count;
    by.set(p.fabric, (by.get(p.fabric) || 0) + a);
  }
  return by;
}
