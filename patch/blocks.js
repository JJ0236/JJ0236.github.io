// patch/blocks.js — quilt blocks as unit grids.
//
// A block lives on an N x N grid of *finished* units. Every unit contributes
// one or more regions, each of which gets a fabric. Nothing here knows about
// millimetres or seam allowance: that is pieces.js.

// Region roles let a block seed sensible default fabrics without the user
// clicking thirty triangles. 'a' background, 'b' feature, 'c' accent.
export const ROLES = ['a', 'b', 'c', 'd'];

const rot90 = (pts, cw, ch) => pts.map(([x, y]) => [ch - y, x]);

function rotatePolys(polys, r, cw, ch) {
  let out = polys, w = cw, h = ch;
  for (let i = 0; i < ((r % 4) + 4) % 4; i++) {
    out = out.map(p => rot90(p, w, h));
    [w, h] = [h, w];
  }
  return { polys: out, w, h };
}

// Each generator returns regions in a canonical box, plus that box's size.
const GENERATORS = {
  plain: () => ({ w: 1, h: 1, regions: [{ poly: [[0,0],[1,0],[1,1],[0,1]], role: 'a' }] }),

  // Half-square triangle: one square, one diagonal, two fabrics.
  hst: () => ({ w: 1, h: 1, regions: [
    { poly: [[0,0],[1,0],[0,1]], role: 'b' },
    { poly: [[1,0],[1,1],[0,1]], role: 'a' },
  ]}),

  // Quarter-square triangle: both diagonals, four triangles meeting at centre.
  qst: () => ({ w: 1, h: 1, regions: [
    { poly: [[0,0],[1,0],[0.5,0.5]], role: 'b' },
    { poly: [[1,0],[1,1],[0.5,0.5]], role: 'a' },
    { poly: [[1,1],[0,1],[0.5,0.5]], role: 'b' },
    { poly: [[0,1],[0,0],[0.5,0.5]], role: 'a' },
  ]}),

  // Flying geese: 2 wide, 1 tall, apex at top centre.
  geese: () => ({ w: 2, h: 1, regions: [
    { poly: [[0,1],[2,1],[1,0]], role: 'b' },
    { poly: [[0,0],[1,0],[0,1]], role: 'a' },
    { poly: [[1,0],[2,0],[2,1]], role: 'a' },
  ]}),

  // Two stripes — the rails of a Churn Dash.
  bar: () => ({ w: 1, h: 1, regions: [
    { poly: [[0,0],[1,0],[1,0.5],[0,0.5]], role: 'b' },
    { poly: [[0,0.5],[1,0.5],[1,1],[0,1]], role: 'a' },
  ]}),

  // Square in a square: a diamond with four corner triangles.
  sis: () => ({ w: 1, h: 1, regions: [
    { poly: [[0.5,0],[1,0.5],[0.5,1],[0,0.5]], role: 'b' },
    { poly: [[0,0],[0.5,0],[0,0.5]], role: 'a' },
    { poly: [[0.5,0],[1,0],[1,0.5]], role: 'a' },
    { poly: [[1,0.5],[1,1],[0.5,1]], role: 'a' },
    { poly: [[0,0.5],[0.5,1],[0,1]], role: 'a' },
  ]}),

  fourpatch: () => ({ w: 1, h: 1, regions: [
    { poly: [[0,0],[0.5,0],[0.5,0.5],[0,0.5]], role: 'b' },
    { poly: [[0.5,0],[1,0],[1,0.5],[0.5,0.5]], role: 'a' },
    { poly: [[0,0.5],[0.5,0.5],[0.5,1],[0,1]], role: 'a' },
    { poly: [[0.5,0.5],[1,0.5],[1,1],[0.5,1]], role: 'b' },
  ]}),
};

export const UNIT_TYPES = Object.keys(GENERATORS);
export const UNIT_LABELS = {
  plain: 'plain', hst: 'half-square', qst: 'quarter-square',
  geese: 'flying geese', bar: 'rails', sis: 'square in square', fourpatch: 'four patch',
};

/**
 * Expand a unit into regions in BLOCK grid coordinates.
 * unit: { type, x, y, scale = 1, rot = 0, roles? }
 */
export function unitRegions(unit) {
  const g = GENERATORS[unit.type];
  if (!g) throw new Error(`unknown unit type: ${unit.type}`);
  const base = g();
  const { polys, w, h } = rotatePolys(base.regions.map(r => r.poly), unit.rot || 0, base.w, base.h);
  const s = unit.scale || 1;
  return polys.map((poly, i) => ({
    poly: poly.map(([x, y]) => [unit.x + x * s, unit.y + y * s]),
    role: (unit.roles && unit.roles[i]) || base.regions[i].role,
    unitType: unit.type,
  }));
}

// Grid footprint of a unit, after rotation and scaling.
export function unitBox(unit) {
  const base = GENERATORS[unit.type]();
  const { w, h } = rotatePolys([], unit.rot || 0, base.w, base.h);
  const s = unit.scale || 1;
  return { x: unit.x, y: unit.y, w: w * s, h: h * s };
}

export function blockRegions(block) {
  return block.units.flatMap(u => unitRegions(u));
}

const cell = (type, x, y, rot = 0, scale = 1, roles) => ({ type, x, y, rot, scale, roles });

// ── Library ─────────────────────────────────────────────────────────

export const LIBRARY = {
  'four-patch': {
    name: 'Four Patch', grid: 2,
    units: [cell('plain',0,0,0,1,['b']), cell('plain',1,0,0,1,['a']),
            cell('plain',0,1,0,1,['a']), cell('plain',1,1,0,1,['b'])],
  },
  'nine-patch': {
    name: 'Nine Patch', grid: 3,
    units: [0,1,2].flatMap(y => [0,1,2].map(x =>
      cell('plain', x, y, 0, 1, [(x + y) % 2 === 0 ? 'b' : 'a']))),
  },
  'half-square': {
    name: 'Half-Square Triangle', grid: 1,
    units: [cell('hst', 0, 0)],
  },
  pinwheel: {
    name: 'Pinwheel', grid: 2,
    units: [cell('hst',0,0,0), cell('hst',1,0,1), cell('hst',1,1,2), cell('hst',0,1,3)],
  },
  'sawtooth-star': {
    name: 'Sawtooth Star', grid: 4,
    units: [
      // The star points meet the centre square edge-to-edge and are
      // collinear with it, so a shared fabric reads as one plain diamond.
      // Quilters put a focus fabric in the centre; so does the default.
      cell('plain',1,1,0,2,['c']),                         // 2x2 centre
      cell('plain',0,0), cell('plain',3,0), cell('plain',0,3), cell('plain',3,3),
      cell('geese',1,0,0), cell('geese',3,1,1),
      cell('geese',1,3,2), cell('geese',0,1,3),
    ],
  },
  'ohio-star': {
    name: 'Ohio Star', grid: 3,
    units: [
      cell('plain',1,1,0,1,['c']),
      cell('plain',0,0), cell('plain',2,0), cell('plain',0,2), cell('plain',2,2),
      cell('qst',1,0,0), cell('qst',0,1,1), cell('qst',2,1,1), cell('qst',1,2,0),
    ],
  },
  'churn-dash': {
    name: 'Churn Dash', grid: 3,
    units: [
      cell('plain',1,1),
      cell('hst',0,0,0), cell('hst',2,0,1), cell('hst',2,2,2), cell('hst',0,2,3),
      cell('bar',1,0,0), cell('bar',0,1,1), cell('bar',2,1,1), cell('bar',1,2,0),
    ],
  },
  shoofly: {
    name: 'Shoofly', grid: 3,
    units: [
      cell('plain',1,1,0,1,['b']),
      cell('hst',0,0,0), cell('hst',2,0,1), cell('hst',2,2,2), cell('hst',0,2,3),
      cell('plain',1,0), cell('plain',0,1), cell('plain',2,1), cell('plain',1,2),
    ],
  },
};

// Build a block from an n x n array of { type, rot } — the custom editor.
export function gridBlock(n, cells) {
  return {
    name: `Custom ${n}×${n}`,
    grid: n,
    units: cells.map((c, i) =>
      cell(c.type || 'plain', i % n, Math.floor(i / n), c.rot || 0, 1, c.roles)),
  };
}
