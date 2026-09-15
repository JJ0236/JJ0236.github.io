// arrange/svgin.js — SVG in, nestable parts out.
//
// The path parser is hand-rolled rather than leaning on the browser so the
// same code runs under node for the verification script.

import { area, bounds, clean, pointInPoly, toCCW } from './geom.js';

const NUM = /[+-]?(\d*\.\d+|\d+\.?)([eE][+-]?\d+)?/g;

function numbers(str) {
  const out = [];
  let m;
  NUM.lastIndex = 0;
  while ((m = NUM.exec(str))) out.push(parseFloat(m[0]));
  return out;
}

// ── Curve flattening ────────────────────────────────────────────────

// Adaptive subdivision: straight runs stay cheap, tight curves stay round.
function cubic(out, x0, y0, x1, y1, x2, y2, x3, y3, tol, depth = 0) {
  if (depth > 16) { out.push(x3, y3); return; }
  // flatness = distance of the control points from the chord
  const ux = 3 * x1 - 2 * x0 - x3, uy = 3 * y1 - 2 * y0 - y3;
  const vx = 3 * x2 - 2 * x3 - x0, vy = 3 * y2 - 2 * y3 - y0;
  const flat = Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy);
  if (flat <= 16 * tol * tol) { out.push(x3, y3); return; }
  const x01 = (x0 + x1) / 2, y01 = (y0 + y1) / 2;
  const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2;
  const x23 = (x2 + x3) / 2, y23 = (y2 + y3) / 2;
  const a = (x01 + x12) / 2, b = (y01 + y12) / 2;
  const c = (x12 + x23) / 2, d = (y12 + y23) / 2;
  const mx = (a + c) / 2, my = (b + d) / 2;
  cubic(out, x0, y0, x01, y01, a, b, mx, my, tol, depth + 1);
  cubic(out, mx, my, c, d, x23, y23, x3, y3, tol, depth + 1);
}

const quad = (out, x0, y0, cx, cy, x1, y1, tol) =>
  cubic(out, x0, y0, x0 + (2 / 3) * (cx - x0), y0 + (2 / 3) * (cy - y0),
        x1 + (2 / 3) * (cx - x1), y1 + (2 / 3) * (cy - y1), x1, y1, tol);

// Endpoint-parameterised arc -> cubics (SVG implementation notes F.6.5).
function arc(out, x0, y0, rx, ry, phi, largeArc, sweep, x, y, tol) {
  if (rx === 0 || ry === 0) { out.push(x, y); return; }
  rx = Math.abs(rx); ry = Math.abs(ry);
  const rad = (phi * Math.PI) / 180;
  const cosP = Math.cos(rad), sinP = Math.sin(rad);
  const dx2 = (x0 - x) / 2, dy2 = (y0 - y) / 2;
  const x1 = cosP * dx2 + sinP * dy2, y1 = -sinP * dx2 + cosP * dy2;

  let lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }

  const sign = largeArc === sweep ? -1 : 1;
  let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num) / (den || 1));
  const cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx;
  const cx = cosP * cx1 - sinP * cy1 + (x0 + x) / 2;
  const cy = sinP * cx1 + cosP * cy1 + (y0 + y) / 2;

  const ang = (ux, uy, vx, vy) => {
    const d = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy)) || 1;
    let c = (ux * vx + uy * vy) / d;
    c = Math.min(1, Math.max(-1, c));
    return (ux * vy - uy * vx < 0 ? -1 : 1) * Math.acos(c);
  };
  const theta = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const segs = Math.ceil(Math.abs(delta) / (Math.PI / 2));
  const step = delta / segs;
  const t = (4 / 3) * Math.tan(step / 4);
  let px = x0, py = y0, a1 = theta;
  for (let i = 0; i < segs; i++) {
    const a2 = a1 + step;
    const cosA1 = Math.cos(a1), sinA1 = Math.sin(a1);
    const cosA2 = Math.cos(a2), sinA2 = Math.sin(a2);
    const e = (ca, sa) => [cosP * rx * ca - sinP * ry * sa + cx, sinP * rx * ca + cosP * ry * sa + cy];
    const [ex1, ey1] = e(cosA1, sinA1);
    const [ex2, ey2] = e(cosA2, sinA2);
    const d1 = [cosP * rx * -sinA1 - sinP * ry * cosA1, sinP * rx * -sinA1 + cosP * ry * cosA1];
    const d2 = [cosP * rx * -sinA2 - sinP * ry * cosA2, sinP * rx * -sinA2 + cosP * ry * cosA2];
    cubic(out, ex1, ey1, ex1 + t * d1[0], ey1 + t * d1[1], ex2 - t * d2[0], ey2 - t * d2[1], ex2, ey2, tol);
    px = ex2; py = ey2; a1 = a2;
  }
}

// ── Path data ───────────────────────────────────────────────────────

// Returns an array of subpaths, each a flat [x,y,...] array.
export function parsePath(d, tol = 0.08) {
  const tokens = d.match(/[astvzqmhlcASTVZQMHLC]|[+-]?(\d*\.\d+|\d+\.?)([eE][+-]?\d+)?/g) || [];
  const subs = [];
  let cur = null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let px = 0, py = 0;            // previous control point, for S/T
  let cmd = '', prevCmd = '';
  let i = 0;

  const num = () => parseFloat(tokens[i++]);
  const start = () => { cur = [x, y]; subs.push(cur); };

  while (i < tokens.length) {
    if (/[astvzqmhlcASTVZQMHLC]/.test(tokens[i])) cmd = tokens[i++];
    if (i > tokens.length) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();

    if (C === 'M') {
      x = rel ? x + num() : num(); y = rel ? y + num() : num();
      sx = x; sy = y; start();
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L') {
      x = rel ? x + num() : num(); y = rel ? y + num() : num();
      if (!cur) start(); else cur.push(x, y);
    } else if (C === 'H') {
      x = rel ? x + num() : num();
      if (!cur) start(); else cur.push(x, y);
    } else if (C === 'V') {
      y = rel ? y + num() : num();
      if (!cur) start(); else cur.push(x, y);
    } else if (C === 'C' || C === 'S') {
      let c1x, c1y;
      if (C === 'S') {
        const mirror = /[CS]/.test(prevCmd.toUpperCase());
        c1x = mirror ? 2 * x - px : x;
        c1y = mirror ? 2 * y - py : y;
      } else {
        c1x = rel ? x + num() : num(); c1y = rel ? y + num() : num();
      }
      const c2x = rel ? x + num() : num(), c2y = rel ? y + num() : num();
      const ex = rel ? x + num() : num(), ey = rel ? y + num() : num();
      if (!cur) start();
      cubic(cur, x, y, c1x, c1y, c2x, c2y, ex, ey, tol);
      px = c2x; py = c2y; x = ex; y = ey;
    } else if (C === 'Q' || C === 'T') {
      let qx, qy;
      if (C === 'T') {
        const mirror = /[QT]/.test(prevCmd.toUpperCase());
        qx = mirror ? 2 * x - px : x;
        qy = mirror ? 2 * y - py : y;
      } else {
        qx = rel ? x + num() : num(); qy = rel ? y + num() : num();
      }
      const ex = rel ? x + num() : num(), ey = rel ? y + num() : num();
      if (!cur) start();
      quad(cur, x, y, qx, qy, ex, ey, tol);
      px = qx; py = qy; x = ex; y = ey;
    } else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), la = num(), sw = num();
      const ex = rel ? x + num() : num(), ey = rel ? y + num() : num();
      if (!cur) start();
      arc(cur, x, y, rx, ry, rot, la, sw, ex, ey, tol);
      x = ex; y = ey;
    } else if (C === 'Z') {
      if (cur) cur.closed = true;
      x = sx; y = sy;
      cur = null;
    } else {
      i++;                        // unknown token; skip rather than hang
      continue;
    }
    prevCmd = cmd;
  }
  return subs.filter(s => s.length >= 6);
}

// ── Transforms ──────────────────────────────────────────────────────

export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function parseTransform(str) {
  let m = IDENTITY;
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(str))) {
    const v = numbers(t[2]);
    const rad = d => (d * Math.PI) / 180;
    let n = IDENTITY;
    switch (t[1]) {
      case 'matrix':    n = [v[0], v[1], v[2], v[3], v[4], v[5]]; break;
      case 'translate': n = [1, 0, 0, 1, v[0] || 0, v[1] || 0]; break;
      case 'scale':     n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const c = Math.cos(rad(v[0])), s = Math.sin(rad(v[0]));
        n = [c, s, -s, c, 0, 0];
        if (v.length >= 3) n = multiply(multiply([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
        break;
      }
      case 'skewX': n = [1, 0, Math.tan(rad(v[0])), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan(rad(v[0])), 0, 1, 0, 0]; break;
    }
    m = multiply(m, n);
  }
  return m;
}

export function applyMatrix(pts, m) {
  const out = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = m[0] * pts[i] + m[2] * pts[i + 1] + m[4];
    out[i + 1] = m[1] * pts[i] + m[3] * pts[i + 1] + m[5];
  }
  return out;
}

// ── Units ───────────────────────────────────────────────────────────

const UNIT_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };

export function lengthToMm(v) {
  if (v == null) return null;
  const m = String(v).trim().match(/^([+-]?[\d.]+(?:[eE][+-]?\d+)?)\s*([a-z%]*)$/);
  if (!m) return null;
  if (m[2] === '%') return null;
  const f = UNIT_MM[m[2]];
  return f == null ? null : parseFloat(m[1]) * f;
}

// User units -> mm, from width/height against viewBox.
export function unitScale(widthAttr, heightAttr, viewBox) {
  const vb = viewBox ? numbers(viewBox) : null;
  const wmm = lengthToMm(widthAttr), hmm = lengthToMm(heightAttr);
  if (vb && vb.length === 4 && vb[2] > 0 && wmm) return wmm / vb[2];
  if (vb && vb.length === 4 && vb[3] > 0 && hmm) return hmm / vb[3];
  return UNIT_MM.px;                     // unitless: assume 96 dpi
}

// ── Shapes -> contours ──────────────────────────────────────────────

export function shapeToContours(tag, attrs, tol) {
  const n = k => parseFloat(attrs[k] ?? '0') || 0;
  const pts = s => { const v = numbers(s || ''); const o = []; for (let i = 0; i + 1 < v.length; i += 2) o.push(v[i], v[i + 1]); return o; };
  switch (tag) {
    case 'path': return parsePath(attrs.d || '', tol);
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height');
      if (w <= 0 || h <= 0) return [];
      const rx = Math.min(n('rx') || n('ry') || 0, w / 2);
      const ry = Math.min(n('ry') || n('rx') || 0, h / 2);
      if (rx <= 0 || ry <= 0) return [[x, y, x + w, y, x + w, y + h, x, y + h]];
      const o = [x + rx, y];
      o.push(x + w - rx, y);
      arc(o, x + w - rx, y, rx, ry, 0, 0, 1, x + w, y + ry, tol);
      o.push(x + w, y + h - ry);
      arc(o, x + w, y + h - ry, rx, ry, 0, 0, 1, x + w - rx, y + h, tol);
      o.push(x + rx, y + h);
      arc(o, x + rx, y + h, rx, ry, 0, 0, 1, x, y + h - ry, tol);
      o.push(x, y + ry);
      arc(o, x, y + ry, rx, ry, 0, 0, 1, x + rx, y, tol);
      return [o];
    }
    case 'circle': case 'ellipse': {
      const cx = n('cx'), cy = n('cy');
      const rx = tag === 'circle' ? n('r') : n('rx');
      const ry = tag === 'circle' ? n('r') : n('ry');
      if (rx <= 0 || ry <= 0) return [];
      const o = [cx + rx, cy];
      arc(o, cx + rx, cy, rx, ry, 0, 0, 1, cx - rx, cy, tol);
      arc(o, cx - rx, cy, rx, ry, 0, 0, 1, cx + rx, cy, tol);
      return [o];
    }
    case 'polygon': case 'polyline': {
      const p = pts(attrs.points);
      return p.length >= 6 ? [p] : [];
    }
    case 'line': return [];          // a bare line encloses nothing
    default: return [];
  }
}

// ── Whole document ──────────────────────────────────────────────────

/**
 * Turn SVG text into nestable parts.
 * Returns { parts: [{ id, name, outer, holes }], scale, warnings }
 */
export function parseSVG(text, { name = 'part', tolerance = 0.08, scale: forced = null } = {}) {
  if (typeof DOMParser === 'undefined') throw new Error('parseSVG needs a DOM; use parsePath directly under node');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  const warnings = [];
  if (!svg || svg.nodeName === 'parsererror' || doc.getElementsByTagName('parsererror').length)
    throw new Error('that file is not valid SVG');

  const scale = forced ?? unitScale(svg.getAttribute('width'), svg.getAttribute('height'), svg.getAttribute('viewBox'));

  // viewBox origin offset
  const vb = svg.getAttribute('viewBox') ? numbers(svg.getAttribute('viewBox')) : null;
  const base = vb && vb.length === 4 ? [1, 0, 0, 1, -vb[0], -vb[1]] : IDENTITY;

  const rings = [];
  const walk = (el, m) => {
    for (const child of Array.from(el.children || [])) {
      const tag = child.nodeName.toLowerCase();
      if (tag === 'defs' || tag === 'clippath' || tag === 'mask' || tag === 'symbol') continue;
      const local = multiply(m, parseTransform(child.getAttribute('transform')));
      if (tag === 'g' || tag === 'svg' || tag === 'a') { walk(child, local); continue; }
      if (tag === 'use') { warnings.push('<use> elements were skipped'); continue; }
      if (tag === 'text') { warnings.push('text was skipped — convert it to paths first'); continue; }
      const attrs = {};
      for (const a of Array.from(child.attributes || [])) attrs[a.name] = a.value;
      for (const c of shapeToContours(tag, attrs, tolerance / scale)) {
        const ring = clean(applyMatrix(Float64Array.from(c), multiply(local, [scale, 0, 0, scale, 0, 0])));
        if (ring.length >= 6 && Math.abs(area(ring)) > 1e-6) rings.push(ring);
      }
    }
  };
  walk(svg, multiply([scale, 0, 0, scale, 0, 0], base));

  return { parts: ringsToParts(rings, name), scale, warnings: [...new Set(warnings)] };
}

// Largest-first containment: a ring inside another becomes its hole.
export function ringsToParts(rings, name = 'part') {
  const sorted = rings.map(r => ({ r, a: Math.abs(area(r)), b: bounds(r) }))
                      .sort((p, q) => q.a - p.a);
  const parts = [];
  const taken = new Set();

  for (let i = 0; i < sorted.length; i++) {
    if (taken.has(i)) continue;
    const outer = sorted[i];
    const holes = [];
    for (let j = i + 1; j < sorted.length; j++) {
      if (taken.has(j)) continue;
      const c = sorted[j];
      if (c.b.minX < outer.b.minX - 1e-6 || c.b.maxX > outer.b.maxX + 1e-6 ||
          c.b.minY < outer.b.minY - 1e-6 || c.b.maxY > outer.b.maxY + 1e-6) continue;
      if (!pointInPoly(outer.r, c.r[0], c.r[1])) continue;
      holes.push(toCCW(c.r));
      taken.add(j);
    }
    taken.add(i);
    parts.push({
      id: `${name}-${parts.length + 1}`,
      name: parts.length === 0 ? name : `${name} ${parts.length + 1}`,
      outer: toCCW(outer.r),
      holes,
    });
  }
  return parts;
}
