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

  // Three rails — the classic fence has three or four, not two.
  rails3: () => ({ w: 1, h: 1, regions: [
    { poly: [[0,0],[1,0],[1,1/3],[0,1/3]], role: 'b' },
    { poly: [[0,1/3],[1,1/3],[1,2/3],[0,2/3]], role: 'a' },
    { poly: [[0,2/3],[1,2/3],[1,1],[0,1]], role: 'c' },
  ]}),

  // Half plus two quarters — the side unit of a Card Trick, where one card
  // lies flat and two others meet it edge on.
  hqq: () => ({ w: 1, h: 1, regions: [
    { poly: [[0,0],[1,0],[0,1]], role: 'a' },
    { poly: [[1,0],[1,1],[0.5,0.5]], role: 'b' },
    { poly: [[1,1],[0,1],[0.5,0.5]], role: 'c' },
  ]}),

  // A square with one corner folded off — Bow Tie, and stitch-and-flip corners.
  corner: (k = 0.5) => ({ w: 1, h: 1, regions: [
    { poly: [[k,0],[1,0],[1,1],[0,1],[0,k]], role: 'b' },
    { poly: [[0,0],[k,0],[0,k]], role: 'a' },
  ]}),

  // A square with all four corners cut back. Classic partner to a Nine Patch.
  snowball: (k = 1 / 3) => ({ w: 1, h: 1, regions: [
    { poly: [[k,0],[1-k,0],[1,k],[1,1-k],[1-k,1],[k,1],[0,1-k],[0,k]], role: 'b' },
    { poly: [[0,0],[k,0],[0,k]], role: 'a' },
    { poly: [[1-k,0],[1,0],[1,k]], role: 'a' },
    { poly: [[1,1-k],[1,1],[1-k,1]], role: 'a' },
    { poly: [[0,1-k],[k,1],[0,1]], role: 'a' },
  ]}),

  ninepatch: () => ({ w: 1, h: 1, regions: Array.from({ length: 9 }, (_, i) => {
    const x = (i % 3) / 3, y = Math.floor(i / 3) / 3, t = 1 / 3;
    return { poly: [[x,y],[x+t,y],[x+t,y+t],[x,y+t]], role: (i % 2 === 0) ? 'b' : 'a' };
  })}),

  // A diagonal band across a square — the stem of a Maple Leaf.
  stem: (t = 0.18) => ({ w: 1, h: 1, regions: [
    { poly: [[0,0],[t,0],[1,1-t],[1,1],[1-t,1],[0,t]], role: 'b' },
    { poly: [[t,0],[1,0],[1,1-t]], role: 'a' },
    { poly: [[0,t],[1-t,1],[0,1]], role: 'a' },
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
  geese: 'flying geese', bar: 'two rails', rails3: 'three rails',
  sis: 'square in square', hqq: 'split quarter-square', corner: 'folded corner',
  snowball: 'snowball', ninepatch: 'nine patch', stem: 'stem', fourpatch: 'four patch',
};

/**
 * Expand a unit into regions in BLOCK grid coordinates.
 *
 * unit: { type, x, y, rot = 0, roles?, and a size as either
 *         scale (uniform) or explicit w / h }
 *
 * Explicit w/h stretch the unit independently on each axis, which is what
 * log cabin logs and bear paw sashing need — they are long thin rectangles,
 * not scaled squares.
 */
export function unitRegions(unit) {
  const g = GENERATORS[unit.type];
  if (!g) throw new Error(`unknown unit type: ${unit.type}`);
  const base = g(unit.k);
  const { polys, w: rw, h: rh } = rotatePolys(base.regions.map(r => r.poly), unit.rot || 0, base.w, base.h);
  const box = unitBox(unit);
  const sx = box.w / rw, sy = box.h / rh;
  return polys.map((poly, i) => ({
    poly: poly.map(([x, y]) => [unit.x + x * sx, unit.y + y * sy]),
    role: (unit.roles && unit.roles[i]) || base.regions[i].role,
    unitType: unit.type,
  }));
}

// Grid footprint of a unit, after rotation and sizing.
export function unitBox(unit) {
  const base = GENERATORS[unit.type](unit.k);
  const { w, h } = rotatePolys([], unit.rot || 0, base.w, base.h);
  const s = unit.scale || 1;
  return {
    x: unit.x, y: unit.y,
    w: unit.w ?? w * s,
    h: unit.h ?? h * s,
  };
}

/**
 * Rotate a group of units a quarter turn at a time about an n x n block's
 * centre. Symmetric blocks — bear paws, maple leaves — are far easier to read
 * as "one motif, placed four ways" than as a hand-written list of every unit.
 */
export function rotateUnits(units, times, n) {
  let out = units.map(u => ({ ...u }));
  for (let t = 0; t < ((times % 4) + 4) % 4; t++) {
    out = out.map(u => {
      const b = unitBox(u);
      return { ...u, x: n - b.y - b.h, y: b.x, w: b.h, h: b.w, rot: ((u.rot || 0) + 1) % 4 };
    });
  }
  return out;
}

export function blockRegions(block) {
  return block.units.flatMap(u => unitRegions(u));
}

const cell = (type, x, y, rot = 0, scale = 1, roles) => ({ type, x, y, rot, scale, roles });

// A rectangular unit: size given outright rather than as a uniform scale.
const box = (type, x, y, w, h, rot = 0, roles) => ({ type, x, y, w, h, rot, roles });

// ── Log Cabin ───────────────────────────────────────────────────────
//
// Not a grid of units: a centre square with logs added round it in turn, each
// one as long as the side it lands on. Light on two sides, dark on the other
// two, which is what gives a Log Cabin quilt its diagonal bands.
function logCabin(n = 5) {
  const c = (n - 1) / 2;
  const units = [ { type: 'plain', x: c, y: c, w: 1, h: 1, rot: 0, roles: ['c'] } ];
  const r = { x: c, y: c, w: 1, h: 1 };
  const sides = ['up', 'right', 'down', 'left'];

  for (let i = 0; (r.w < n || r.h < n) && i < 4 * n; i++) {
    const side = sides[i % 4];
    const light = side === 'up' || side === 'right';
    let log;
    if (side === 'up')         { log = { x: r.x, y: r.y - 1, w: r.w, h: 1 }; r.y--; r.h++; }
    else if (side === 'right') { log = { x: r.x + r.w, y: r.y, w: 1, h: r.h }; r.w++; }
    else if (side === 'down')  { log = { x: r.x, y: r.y + r.h, w: r.w, h: 1 }; r.h++; }
    else                       { log = { x: r.x - 1, y: r.y, w: 1, h: r.h }; r.x--; r.w++; }
    units.push({ type: 'plain', ...log, rot: 0, roles: [light ? 'a' : 'b'] });
  }
  return { name: `Log Cabin`, grid: n, units };
}

// ── Bear's Paw ──────────────────────────────────────────────────────
//
// One paw motif placed four ways: a 2x2 pad, four claws along two sides, and a
// small square in the outer corner.
function bearsPaw() {
  const n = 7;
  const paw = [
    box('plain', 0, 0, 1, 1, 0, ['a']),              // outer corner square
    { type: 'hst', x: 1, y: 0, rot: 0, roles: ['b', 'a'] },
    { type: 'hst', x: 2, y: 0, rot: 0, roles: ['b', 'a'] },
    { type: 'hst', x: 0, y: 1, rot: 1, roles: ['b', 'a'] },
    { type: 'hst', x: 0, y: 2, rot: 1, roles: ['b', 'a'] },
    box('plain', 1, 1, 2, 2, 0, ['b']),              // the pad
  ];
  const units = [
    ...paw,
    ...rotateUnits(paw, 1, n),
    ...rotateUnits(paw, 2, n),
    ...rotateUnits(paw, 3, n),
    box('plain', 3, 0, 1, 3, 0, ['a']),              // sashing
    box('plain', 4, 3, 3, 1, 0, ['a']),
    box('plain', 3, 4, 1, 3, 0, ['a']),
    box('plain', 0, 3, 3, 1, 0, ['a']),
    box('plain', 3, 3, 1, 1, 0, ['c']),              // centre
  ];
  return { name: "Bear's Paw", grid: n, units };
}

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
  'friendship-star': {
    name: 'Friendship Star', grid: 3,
    units: [
      cell('plain',1,1,0,1,['b']),
      cell('plain',0,0,0,1,['a']), cell('plain',2,0,0,1,['a']),
      cell('plain',0,2,0,1,['a']), cell('plain',2,2,0,1,['a']),
      cell('hst',1,0,1), cell('hst',2,1,2), cell('hst',1,2,3), cell('hst',0,1,0),
    ],
  },
  'card-trick': {
    name: 'Card Trick', grid: 3,
    units: [
      // Corners: each card shows one half-square triangle in its own corner.
      cell('hst',0,0,0,1,['b','a']), cell('hst',2,0,1,1,['c','a']),
      cell('hst',2,2,2,1,['b','a']), cell('hst',0,2,3,1,['c','a']),
      // Sides: background sits against the outer edge with its point inward,
      // and the two neighbouring cards fill the corners beside it. That is a
      // flying-geese shape in a square cell, not a half cut off a diagonal.
      box('geese',1,0,1,1,2,['a','b','c']),
      box('geese',2,1,1,1,3,['a','c','b']),
      box('geese',1,2,1,1,0,['a','b','c']),
      box('geese',0,1,1,1,1,['a','c','b']),
      // Centre: all four cards overlap.
      cell('qst',1,1,0,1,['b','c','b','c']),
    ],
  },
  'jacobs-ladder': {
    name: "Jacob's Ladder", grid: 3,
    units: [
      cell('fourpatch',0,0,0), cell('fourpatch',2,0,0), cell('fourpatch',1,1,0),
      cell('fourpatch',0,2,0), cell('fourpatch',2,2,0),
      cell('hst',1,0,1), cell('hst',0,1,0), cell('hst',2,1,2), cell('hst',1,2,3),
    ],
  },
  'maple-leaf': {
    name: 'Maple Leaf', grid: 3,
    units: [
      cell('plain',1,0,0,2,['b']),                    // 2x2 leaf body
      cell('hst',0,0,0,1,['b','a']), cell('hst',0,1,0,1,['b','a']),
      cell('hst',1,2,3,1,['b','a']), cell('hst',2,2,3,1,['b','a']),
      cell('stem',0,2,0,1,['c','a','a']),
    ],
  },
  'double-nine-patch': {
    name: 'Double Nine Patch', grid: 3,
    units: [0,1,2].flatMap(y => [0,1,2].map(x =>
      (x + y) % 2 === 0 ? cell('ninepatch', x, y, 0) : cell('plain', x, y, 0, 1, ['a']))),
  },
  hourglass: { name: 'Hourglass', grid: 1, units: [cell('qst',0,0,0)] },
  'square-in-square': { name: 'Square in a Square', grid: 1, units: [cell('sis',0,0,0)] },
  snowball: { name: 'Snowball', grid: 1, units: [cell('snowball',0,0,0)] },
  'broken-dishes': {
    name: 'Broken Dishes', grid: 2,
    units: [cell('hst',0,0,0), cell('hst',1,0,2), cell('hst',0,1,2), cell('hst',1,1,0)],
  },
  'bow-tie': {
    name: 'Bow Tie', grid: 2,
    units: [
      cell('plain',0,0,0,1,['b']), cell('plain',1,1,0,1,['b']),
      // A bow tie's knot corners are small, and they face the centre.
      { type: 'corner', x: 1, y: 0, rot: 3, roles: ['a','b'], k: 0.4 },
      { type: 'corner', x: 0, y: 1, rot: 1, roles: ['a','b'], k: 0.4 },
    ],
  },
  'dutchmans-puzzle': (() => {
    const q = [
      { type: 'geese', x: 0, y: 0, w: 2, h: 1, rot: 0 },
      { type: 'geese', x: 0, y: 1, w: 2, h: 1, rot: 0 },
    ];
    return {
      name: "Dutchman's Puzzle", grid: 4,
      units: [...q, ...rotateUnits(q, 1, 4), ...rotateUnits(q, 2, 4), ...rotateUnits(q, 3, 4)],
    };
  })(),
  'rail-fence': {
    name: 'Rail Fence', grid: 4,
    units: [0,1,2,3].flatMap(y => [0,1,2,3].map(x =>
      cell('rails3', x, y, (x + y) % 2 ? 1 : 0))),
  },
  'flying-geese': {
    name: 'Flying Geese', grid: 4,
    units: [0,1,2,3].flatMap(y =>
      [0,2].map(x => ({ type: 'geese', x, y, w: 2, h: 1, rot: 0 }))),
  },
  'log-cabin': logCabin(5),
  'bears-paw': bearsPaw(),

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
