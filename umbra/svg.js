// umbra/svg.js — SVG to polygon contours.
//
// Split in two halves on purpose. Everything above the DOM section is pure
// geometry: no document, no DOMParser, so scripts/verify-umbra.mjs can test the
// path parser directly under node. Only readSvgDocument() touches the DOM.
//
// Output shape: { rings: [[[x,y], ...], ...], fillRule, strokeWidth }
// Rings are closed implicitly (last point is not repeated).

/* ── Matrices: [a, b, c, d, e, f], x' = ax + cy + e, y' = bx + dy + f ─────── */

export const mIdent = () => [1, 0, 0, 1, 0, 0];

export function mMul(A, B) {           // A after B
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5]
  ];
}

export const mApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// Mean scale factor, used to keep flattening tolerance constant in output units.
export const mScale = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

export function parseTransform(str) {
  let m = mIdent();
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let hit;
  while ((hit = re.exec(str))) {
    const n = hit[2].split(/[\s,]+/).filter(s => s !== '').map(Number);
    let t = mIdent();
    switch (hit[1]) {
      case 'matrix':    t = [n[0], n[1], n[2], n[3], n[4], n[5]]; break;
      case 'translate': t = [1, 0, 0, 1, n[0] || 0, n[1] || 0]; break;
      case 'scale':     t = [n[0], 0, 0, n.length > 1 ? n[1] : n[0], 0, 0]; break;
      case 'rotate': {
        const r = (n[0] || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
        t = [c, s, -s, c, 0, 0];
        if (n.length >= 3) {
          t = mMul([1, 0, 0, 1, n[1], n[2]], mMul(t, [1, 0, 0, 1, -n[1], -n[2]]));
        }
        break;
      }
      case 'skewX': t = [1, 0, Math.tan((n[0] || 0) * Math.PI / 180), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan((n[0] || 0) * Math.PI / 180), 0, 1, 0, 0]; break;
    }
    m = mMul(m, t);
  }
  return m;
}

/* ── Path data ───────────────────────────────────────────────────────────── */

// Tokenizes SVG number soup: "10.5.5" is two numbers, "1e-3" is one, and
// separators are optional around signs.
export function tokenizePath(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;
  let hit;
  while ((hit = re.exec(d))) out.push(hit[1] !== undefined ? hit[1] : parseFloat(hit[2]));
  return out;
}

const ARG_COUNT = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

// Flattens to subpaths of points. `tol` is max sagitta error in path units.
export function parsePathData(d, tol = 0.15) {
  const toks = tokenizePath(d);
  const subpaths = [];
  let pts = null;
  let cx = 0, cy = 0, sx = 0, sy = 0;   // current point, subpath start
  let prevCtrl = null, prevQCtrl = null, prevCmd = '';
  let i = 0, cmd = '';

  const start = () => { pts = [[cx, cy]]; subpaths.push({ points: pts, closed: false }); };
  const push  = (x, y) => { if (!pts) start(); pts.push([x, y]); cx = x; cy = y; };

  while (i < toks.length) {
    if (typeof toks[i] === 'string') { cmd = toks[i]; i++; }
    else if (!cmd) { i++; continue; }
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';

    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    const n = ARG_COUNT[up];
    if (n === undefined) { i++; continue; }
    const a = toks.slice(i, i + n);
    if (a.length < n && up !== 'Z') break;
    i += n;

    switch (up) {
      case 'M': {
        cx = rel ? cx + a[0] : a[0];
        cy = rel ? cy + a[1] : a[1];
        sx = cx; sy = cy;
        pts = null; start();
        break;
      }
      case 'L': push(rel ? cx + a[0] : a[0], rel ? cy + a[1] : a[1]); break;
      case 'H': push(rel ? cx + a[0] : a[0], cy); break;
      case 'V': push(cx, rel ? cy + a[0] : a[0]); break;
      case 'C': case 'S': {
        let x1, y1, x2, y2, x, y;
        if (up === 'C') {
          x1 = rel ? cx + a[0] : a[0]; y1 = rel ? cy + a[1] : a[1];
          x2 = rel ? cx + a[2] : a[2]; y2 = rel ? cy + a[3] : a[3];
          x  = rel ? cx + a[4] : a[4]; y  = rel ? cy + a[5] : a[5];
        } else {
          const sm = 'CS'.includes(prevCmd.toUpperCase());
          x1 = sm && prevCtrl ? 2 * cx - prevCtrl[0] : cx;
          y1 = sm && prevCtrl ? 2 * cy - prevCtrl[1] : cy;
          x2 = rel ? cx + a[0] : a[0]; y2 = rel ? cy + a[1] : a[1];
          x  = rel ? cx + a[2] : a[2]; y  = rel ? cy + a[3] : a[3];
        }
        if (!pts) start();
        flattenCubic(cx, cy, x1, y1, x2, y2, x, y, tol, pts);
        prevCtrl = [x2, y2]; cx = x; cy = y;
        break;
      }
      case 'Q': case 'T': {
        let x1, y1, x, y;
        if (up === 'Q') {
          x1 = rel ? cx + a[0] : a[0]; y1 = rel ? cy + a[1] : a[1];
          x  = rel ? cx + a[2] : a[2]; y  = rel ? cy + a[3] : a[3];
        } else {
          const sm = 'QT'.includes(prevCmd.toUpperCase());
          x1 = sm && prevQCtrl ? 2 * cx - prevQCtrl[0] : cx;
          y1 = sm && prevQCtrl ? 2 * cy - prevQCtrl[1] : cy;
          x  = rel ? cx + a[0] : a[0]; y  = rel ? cy + a[1] : a[1];
        }
        if (!pts) start();
        // Degree-elevate to a cubic and reuse the same subdivision.
        flattenCubic(cx, cy,
          cx + 2 / 3 * (x1 - cx), cy + 2 / 3 * (y1 - cy),
          x + 2 / 3 * (x1 - x),   y + 2 / 3 * (y1 - y),
          x, y, tol, pts);
        prevQCtrl = [x1, y1]; cx = x; cy = y;
        break;
      }
      case 'A': {
        const x = rel ? cx + a[5] : a[5], y = rel ? cy + a[6] : a[6];
        if (!pts) start();
        flattenArc(cx, cy, a[0], a[1], a[2], !!a[3], !!a[4], x, y, tol, pts);
        cx = x; cy = y;
        break;
      }
      case 'Z': {
        if (pts) { pts.closed = true; subpaths[subpaths.length - 1].closed = true; }
        cx = sx; cy = sy; pts = null;
        break;
      }
    }
    if (up !== 'C' && up !== 'S') prevCtrl = null;
    if (up !== 'Q' && up !== 'T') prevQCtrl = null;
    prevCmd = cmd;
  }
  return subpaths.filter(sp => sp.points.length > 1);
}

// Recursive subdivision on flatness — control points' distance from the chord.
export function flattenCubic(x0, y0, x1, y1, x2, y2, x3, y3, tol, out, depth = 0) {
  const dx = x3 - x0, dy = y3 - y0;
  const d1 = Math.abs((x1 - x3) * dy - (y1 - y3) * dx);
  const d2 = Math.abs((x2 - x3) * dy - (y2 - y3) * dx);
  const dd = (d1 + d2) * (d1 + d2);
  if (depth > 18 || dd < tol * tol * (dx * dx + dy * dy) || (dx === 0 && dy === 0 && depth > 8)) {
    out.push([x3, y3]);
    return;
  }
  const x01 = (x0 + x1) / 2, y01 = (y0 + y1) / 2;
  const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2;
  const x23 = (x2 + x3) / 2, y23 = (y2 + y3) / 2;
  const xa = (x01 + x12) / 2, ya = (y01 + y12) / 2;
  const xb = (x12 + x23) / 2, yb = (y12 + y23) / 2;
  const xm = (xa + xb) / 2, ym = (ya + yb) / 2;
  flattenCubic(x0, y0, x01, y01, xa, ya, xm, ym, tol, out, depth + 1);
  flattenCubic(xm, ym, xb, yb, x23, y23, x3, y3, tol, out, depth + 1);
}

// Endpoint to center parameterization, per the SVG spec's implementation notes.
export function flattenArc(x0, y0, rx, ry, rot, largeArc, sweep, x, y, tol, out) {
  if (rx === 0 || ry === 0) { out.push([x, y]); return; }
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = rot * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx2 = (x0 - x) / 2, dy2 = (y0 - y) / 2;
  const x1 =  cp * dx2 + sp * dy2;
  const y1 = -sp * dx2 + cp * dy2;

  // Scale the radii up if they are too small to span the endpoints.
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }

  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cx1 =  co * rx * y1 / ry;
  const cy1 = -co * ry * x1 / rx;
  const cx = cp * cx1 - sp * cy1 + (x0 + x) / 2;
  const cy = sp * cx1 + cp * cy1 + (y0 + y) / 2;

  const ang = (ux, uy, vx, vy) => {
    const d = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy)) || 1;
    let a = Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / d)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt   = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;

  // Segment count from the sagitta of the larger radius.
  const r = Math.max(rx, ry);
  const steps = Math.max(2, Math.ceil(Math.abs(dt) / (2 * Math.acos(Math.max(-1, 1 - tol / r)) || 0.2)));
  for (let i = 1; i <= steps; i++) {
    const t = t1 + dt * (i / steps);
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    out.push([cp * ex - sp * ey + cx, sp * ex + cp * ey + cy]);
  }
}

/* ── Primitive shapes ────────────────────────────────────────────────────── */

const CIRCLE_K = 0.5522847498307936;

export function ellipseRing(cx, cy, rx, ry, tol) {
  const pts = [[cx + rx, cy]];
  const kx = rx * CIRCLE_K, ky = ry * CIRCLE_K;
  flattenCubic(cx + rx, cy, cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry, tol, pts);
  flattenCubic(cx, cy + ry, cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy, tol, pts);
  flattenCubic(cx - rx, cy, cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry, tol, pts);
  flattenCubic(cx, cy - ry, cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy, tol, pts);
  pts.pop();
  return pts;
}

export function roundedRectRing(x, y, w, h, rx, ry, tol) {
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
  if (rx <= 0 || ry <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const kx = rx * (1 - CIRCLE_K), ky = ry * (1 - CIRCLE_K);
  const pts = [[x + rx, y]];
  const arc = (x0, y0, c1x, c1y, c2x, c2y, x1, y1) =>
    flattenCubic(x0, y0, c1x, c1y, c2x, c2y, x1, y1, tol, pts);
  pts.push([x + w - rx, y]);
  arc(x + w - rx, y, x + w - kx, y, x + w, y + ky, x + w, y + ry);
  pts.push([x + w, y + h - ry]);
  arc(x + w, y + h - ry, x + w, y + h - ky, x + w - kx, y + h, x + w - rx, y + h);
  pts.push([x + rx, y + h]);
  arc(x + rx, y + h, x + kx, y + h, x, y + h - ky, x, y + h - ry);
  pts.push([x, y + ry]);
  arc(x, y + ry, x, y + ky, x + kx, y, x + rx, y);
  pts.pop();
  return pts;
}

/* ── Ring helpers ────────────────────────────────────────────────────────── */

export function ringArea(ring) {                       // signed; CCW positive
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function ringPerimeter(ring) {
  let p = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

export function boundsOf(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/* ── DOM half — browser only ─────────────────────────────────────────────── */

const NUM = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

// Walks an already-parsed SVG document into flat shapes with baked transforms.
export function readSvgDocument(doc, { tol = 0.15 } = {}) {
  const svg = doc.documentElement;
  if (!svg || svg.nodeName === 'parsererror') throw new Error('Could not parse that SVG.');

  const shapes = [];
  const walk = (el, m, inherited) => {
    for (const child of el.children) {
      const tag = child.nodeName.toLowerCase();
      const cm = mMul(m, parseTransform(child.getAttribute('transform')));
      const style = {
        fill:       child.getAttribute('fill')         ?? inherited.fill,
        stroke:     child.getAttribute('stroke')       ?? inherited.stroke,
        strokeW:    child.getAttribute('stroke-width') ?? inherited.strokeW,
        fillRule:   child.getAttribute('fill-rule')    ?? inherited.fillRule
      };
      if (tag === 'g' || tag === 'svg') { walk(child, cm, style); continue; }
      if (tag === 'defs' || tag === 'clippath' || tag === 'mask') continue;

      const t = tol / mScale(cm);
      let subpaths = null;
      switch (tag) {
        case 'path':
          subpaths = parsePathData(child.getAttribute('d') || '', t);
          break;
        case 'rect': {
          const rx = child.hasAttribute('rx') ? NUM(child.getAttribute('rx'))
                   : NUM(child.getAttribute('ry'));
          const ry = child.hasAttribute('ry') ? NUM(child.getAttribute('ry')) : rx;
          subpaths = [{ points: roundedRectRing(
            NUM(child.getAttribute('x')), NUM(child.getAttribute('y')),
            NUM(child.getAttribute('width')), NUM(child.getAttribute('height')),
            rx, ry, t), closed: true }];
          break;
        }
        case 'circle': {
          const r = NUM(child.getAttribute('r'));
          subpaths = [{ points: ellipseRing(NUM(child.getAttribute('cx')), NUM(child.getAttribute('cy')), r, r, t), closed: true }];
          break;
        }
        case 'ellipse':
          subpaths = [{ points: ellipseRing(
            NUM(child.getAttribute('cx')), NUM(child.getAttribute('cy')),
            NUM(child.getAttribute('rx')), NUM(child.getAttribute('ry')), t), closed: true }];
          break;
        case 'line':
          subpaths = [{ points: [
            [NUM(child.getAttribute('x1')), NUM(child.getAttribute('y1'))],
            [NUM(child.getAttribute('x2')), NUM(child.getAttribute('y2'))]], closed: false }];
          break;
        case 'polyline': case 'polygon': {
          const n = (child.getAttribute('points') || '').split(/[\s,]+/).filter(s => s !== '').map(Number);
          const pts = [];
          for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
          subpaths = [{ points: pts, closed: tag === 'polygon' }];
          break;
        }
        default: continue;
      }
      if (!subpaths || !subpaths.length) continue;

      const rings = subpaths.map(sp => sp.points.map(p => mApply(cm, p[0], p[1])));
      const filled = style.fill !== 'none' && style.fill !== 'transparent';
      const strokeW = style.stroke && style.stroke !== 'none'
        ? NUM(style.strokeW ?? 1) * mScale(cm) : 0;
      shapes.push({
        rings,
        closed: subpaths.map(sp => sp.closed),
        fillRule: style.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
        filled, strokeWidth: strokeW
      });
    }
  };

  walk(svg, mIdent(), { fill: null, stroke: null, strokeW: null, fillRule: 'nonzero' });
  if (!shapes.length) throw new Error('No drawable shapes found in that SVG.');
  return shapes;
}

export function parseSvgText(text, opts) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  return readSvgDocument(doc, opts);
}
