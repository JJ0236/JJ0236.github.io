// crease/patterns.js — parametric origami tessellations as crease geometry.
//
// Pure functions, no DOM, so scripts/verify-crease.mjs can check them under node.
//
// Every pattern builds { cuts, mountains, valleys, w, h } in millimetres.
// Items are one of:
//   { k: 'L', x1, y1, x2, y2 }        straight crease or cut segment
//   { k: 'C', cx, cy, r }             full circle (curved crease or cut)
//   { k: 'P', pts: [[x,y],...], closed }  polyline, used for outlines
//
// Fold assignments are chosen for the front face of the sheet. The mountain /
// valley labels follow the convention that a mountain crease points toward the
// viewer of the front face.

const L = (x1, y1, x2, y2) => ({ k: 'L', x1, y1, x2, y2 });
const C = (cx, cy, r) => ({ k: 'C', cx, cy, r });
const P = (pts, closed = true) => ({ k: 'P', pts, closed });

// Liang-Barsky clip of a segment to the rectangle [0,W]x[0,H]. Returns null
// when nothing of the segment lies inside.
export function clipSegment(x1, y1, x2, y2, W, H) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const edges = [[-dx, x1], [dx, W - x1], [-dy, y1], [dy, H - y1]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else       { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  if (t1 - t0 < 1e-9) return null;
  return L(x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy);
}

/* ── Miura-ori ───────────────────────────────────────────────────────────── */

// Parallelogram cells. P(i,j) = (i·w, j·h + d·(i mod 2)) with d = w·tan(angle).
// Each horizontal zigzag is uniformly one type, alternating by row: it is the
// primary accordion pleat. Vertical creases flip type every time they cross a
// pleat, giving a checkerboard, so every interior vertex is 3:1.
function miura({ cols, rows, w, h, angle }) {
  const d = w * Math.tan(angle * Math.PI / 180);
  const pt = (i, j) => [i * w, j * h + (i % 2 ? d : 0)];
  const mountains = [], valleys = [];
  const put = (isM, a, b) => (isM ? mountains : valleys).push(L(a[0], a[1], b[0], b[1]));

  for (let j = 1; j < rows; j++) {
    const isM = j % 2 === 1;
    for (let i = 0; i < cols; i++) put(isM, pt(i, j), pt(i + 1, j));
  }
  for (let i = 1; i < cols; i++) {
    for (let j = 0; j < rows; j++) put((i + j) % 2 === 0, pt(i, j), pt(i, j + 1));
  }

  const outline = [];
  for (let i = 0; i <= cols; i++) outline.push(pt(i, 0));
  for (let i = cols; i >= 0; i--) outline.push(pt(i, rows));
  return { cuts: [P(outline)], mountains, valleys, w: cols * w, h: rows * h + d };
}

/* ── Yoshimura ───────────────────────────────────────────────────────────── */

// Diamonds between straight row lines. Strip j zigzags between row j and row
// j+1, and consecutive strips are mirrored so the diagonals meet in diamonds.
// Rows are mountains, diagonals valleys. The sheet is a plain rectangle with
// half-diamonds along the left and right edges, the way Yoshimura sheets are
// normally cut for rolling into a cylinder.
function yoshimura({ cols, rows, w, h }) {
  const mountains = [], valleys = [];
  const W = cols * w, H = rows * h;
  for (let j = 1; j < rows; j++) mountains.push(L(0, j * h, W, j * h));
  for (let j = 0; j < rows; j++) {
    const top = j * h, bot = (j + 1) * h;
    // Even strips peak on the top row at whole cells; odd strips are mirrored.
    const yA = j % 2 === 0 ? top : bot, yB = j % 2 === 0 ? bot : top;
    for (let i = 0; i < cols; i++) {
      const x0 = i * w, xm = x0 + w / 2, x1 = x0 + w;
      valleys.push(L(x0, yA, xm, yB));
      valleys.push(L(xm, yB, x1, yA));
    }
  }
  return { cuts: [P([[0, 0], [W, 0], [W, H], [0, H]])], mountains, valleys, w: W, h: H };
}

/* ── Waterbomb tessellation (magic ball) ─────────────────────────────────── */

// Horizontal accordion pleats every half unit: unit midlines are valleys and
// unit boundaries are mountains. Each unit carries an X of mountain diagonals.
// Alternate rows are staggered by half a unit, which is what lets the sheet
// curl into a ball, and the stagger leaves half units at the sheet edges.
function waterbomb({ cols, rows, w, h }) {
  const mountains = [], valleys = [];
  const W = cols * w, H = rows * h;
  for (let j = 1; j < rows; j++) mountains.push(L(0, j * h, W, j * h));
  for (let j = 0; j < rows; j++) {
    const ox = j % 2 ? -w / 2 : 0;
    const y0 = j * h, y1 = y0 + h, ym = y0 + h / 2;
    // Midline as segments between unit centres, so each centre is a real
    // degree-6 vertex. The chain pass rejoins them for the laser.
    const xs = [];
    for (let i = 0; i <= cols; i++) {
      const xc = ox + (i + 0.5) * w;
      if (xc > 0 && xc < W) xs.push(xc);
    }
    let prev = 0;
    for (const xc of xs) { valleys.push(L(prev, ym, xc, ym)); prev = xc; }
    valleys.push(L(prev, ym, W, ym));
    for (let i = 0; i <= cols; i++) {
      const x0 = ox + i * w, x1 = x0 + w, xc = x0 + w / 2;
      if (x1 <= 0 || x0 >= W) continue;
      for (const [ax, ay] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
        const s = clipSegment(xc, ym, ax, ay, W, H);
        if (s) mountains.push(s);
      }
    }
  }
  return { cuts: [P([[0, 0], [W, 0], [W, H], [0, H]])], mountains, valleys, w: W, h: H };
}

/* ── Concentric circles ──────────────────────────────────────────────────── */

// The Bauhaus curved-crease model. Rings alternate mountain and valley from
// the inside out. The centre disc is removed so the annulus can twist into a
// saddle. Scoring curved creases is the one thing a laser does far better
// than a bone folder.
function circles({ rings, inner, spacing }) {
  const outer = inner + (rings + 1) * spacing;
  const c = outer;
  const mountains = [], valleys = [];
  for (let k = 1; k <= rings; k++) (k % 2 ? mountains : valleys).push(C(c, c, inner + k * spacing));
  return { cuts: [C(c, c, inner), C(c, c, outer)], mountains, valleys, w: 2 * outer, h: 2 * outer };
}

/* ── Registry ────────────────────────────────────────────────────────────── */

const int = (key, label, def, min, max) => ({ key, label, def, min, max, step: 1 });
const mm  = (key, label, def, min, max, step = 0.5) => ({ key, label, def, min, max, step, unit: 'mm', scales: true });

export const PATTERNS = {
  miura: {
    name: 'Miura-ori',
    blurb: 'Rigid-foldable parallelogram pleats. Collapses in one motion once the creases are set.',
    params: [
      int('cols', 'Columns', 8, 2, 80),
      int('rows', 'Rows', 10, 2, 80),
      mm('w', 'Cell width', 20, 4, 200),
      mm('h', 'Cell height', 20, 4, 200),
      { key: 'angle', label: 'Zigzag angle', def: 30, min: 5, max: 65, step: 1, unit: '°' },
    ],
    build: miura,
  },
  yoshimura: {
    name: 'Yoshimura',
    blurb: 'Diamond pattern that rolls into a buckled cylinder. Rows are mountains, diagonals valleys.',
    params: [
      int('cols', 'Columns', 6, 2, 80),
      int('rows', 'Rows', 8, 2, 80),
      mm('w', 'Diamond width', 30, 4, 200),
      mm('h', 'Row height', 20, 4, 200),
    ],
    build: yoshimura,
  },
  waterbomb: {
    name: 'Waterbomb',
    blurb: 'Staggered waterbomb units. Curls into the magic ball and stretches like a lattice.',
    params: [
      int('cols', 'Columns', 6, 2, 60),
      int('rows', 'Rows', 8, 2, 60),
      mm('w', 'Unit width', 30, 4, 200),
      mm('h', 'Unit height', 30, 4, 200),
    ],
    build: waterbomb,
  },
  circles: {
    name: 'Concentric circles',
    blurb: 'Curved creases on an annulus. Alternating rings pull the sheet into a saddle.',
    params: [
      int('rings', 'Rings', 8, 2, 40),
      mm('inner', 'Inner radius', 20, 2, 200),
      mm('spacing', 'Ring spacing', 8, 2, 60),
    ],
    build: circles,
  },
};

export function defaults(id) {
  const out = {};
  for (const p of PATTERNS[id].params) out[p.key] = p.def;
  return out;
}

export function build(id, params) {
  return PATTERNS[id].build({ ...defaults(id), ...params });
}

/* ── Analysis helpers (used by the verify script and the stats readout) ──── */

export const segLength = s => s.k === 'L' ? Math.hypot(s.x2 - s.x1, s.y2 - s.y1)
  : s.k === 'C' ? 2 * Math.PI * s.r
  : s.k === 'A' ? Math.abs(s.a1 - s.a0) * s.r
  : s.pts.reduce((acc, p, i, a) => i ? acc + Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0, 0)
    + (s.closed && s.pts.length > 1 ? Math.hypot(s.pts[0][0] - s.pts.at(-1)[0], s.pts[0][1] - s.pts.at(-1)[1]) : 0);

export const totalLength = items => items.reduce((a, s) => a + segLength(s), 0);

// Groups straight creases by shared endpoint. Returns a map from "x,y" to the
// list of { type, dx, dy } directions leaving that vertex.
export function vertexMap(mountains, valleys, tol = 1e-6) {
  const map = new Map();
  const key = (x, y) => `${Math.round(x / tol) * tol},${Math.round(y / tol) * tol}`;
  const add = (type, s) => {
    if (s.k !== 'L') return;
    const ends = [[s.x1, s.y1, s.x2 - s.x1, s.y2 - s.y1], [s.x2, s.y2, s.x1 - s.x2, s.y1 - s.y2]];
    for (const [x, y, dx, dy] of ends) {
      const k = key(x, y);
      if (!map.has(k)) map.set(k, { x, y, creases: [] });
      map.get(k).creases.push({ type, dx, dy });
    }
  };
  mountains.forEach(s => add('M', s));
  valleys.forEach(s => add('V', s));
  return map;
}

// Kawasaki: alternating sums of sector angles around a vertex are both π.
export function kawasakiDefect(vertex) {
  const angs = vertex.creases.map(c => Math.atan2(c.dy, c.dx)).sort((a, b) => a - b);
  let alt = 0;
  for (let i = 0; i < angs.length; i++) {
    const next = i + 1 < angs.length ? angs[i + 1] : angs[0] + 2 * Math.PI;
    alt += (i % 2 ? -1 : 1) * (next - angs[i]);
  }
  return Math.abs(alt);
}
