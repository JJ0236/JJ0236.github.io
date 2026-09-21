// The Quarry: a square platform of floor cells over a long drop. Pure data,
// shared by the sim (colliders) and the renderer (meshes).
//
// Cells are CELL metres square, N a side, centred on the origin. The floor
// is a height grid with a shallow bowl in the middle; pits are cells that
// were never there, and crumbling removes whole rings of cells from the
// outside in.

export const N = 24;
export const CELL = 4;
export const HALF = (N * CELL) / 2;          // 48 m from the middle to an edge
export const FALL_Y = -8;                    // below this a car is out
export const BOWL_R = 15;
export const BOWL_DEPTH = 2.2;
export const MIN_RING = 7;                   // rings 0..6 can crumble; 10x10 cells stay

/** Floor height at a point, ignoring holes. */
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  if (r >= BOWL_R) return 0;
  const t = r / BOWL_R;
  // A smooth dish: flat bottom, easing up to the rim.
  return -BOWL_DEPTH * (1 - t * t * (3 - 2 * t));
}

export const cellOf = v => Math.floor((v + HALF) / CELL);
export const cellCentre = i => -HALF + (i + 0.5) * CELL;
/** How many cells in from the nearest edge: 0 is the outer ring. */
export const ringOf = (i, j) => Math.min(i, j, N - 1 - i, N - 1 - j);

// Four 2x2 pits near the corners.
export const PITS = [[-28, -28], [28, -28], [-28, 28], [28, 28]];

// Four ramps facing the bowl, high end inward.
export const RAMPS = [
  { x: 31, z: 0, dir: [-1, 0] },
  { x: -31, z: 0, dir: [1, 0] },
  { x: 0, z: 31, dir: [0, -1] },
  { x: 0, z: -31, dir: [0, 1] },
];
export const RAMP = { L: 9, W: 6, H: 1.7 };

// Four hydraulic crushers on the diagonals, inside the rings that never crumble.
export const CRUSHERS = [[17, 17], [-17, 17], [17, -17], [-17, -17]].map(([x, z], k) => ({ x, z, k }));
export const PLATE = { half: 3.4, top: 10, bottom: 1.05, thick: 0.9 };
// One cycle, in seconds: idle up top, shake, slam, hold, rise.
export const CRUSH_CYCLE = { idle: 6.5, warn: 1.3, slam: 0.22, hold: 1.1, rise: 1.6 };
const CYCLE = Object.values(CRUSH_CYCLE).reduce((a, b) => a + b, 0);
export const CRUSH_START = 8;                // first slam no earlier than this

/**
 * Where a crusher's plate is at time t into the round: its underside height
 * above the floor, and the phase it is in. Pure time, so every client agrees.
 */
export function crusherState(k, t) {
  const C = CRUSH_CYCLE;
  const local = t - CRUSH_START - k * (CYCLE / 4) * 0.85;
  if (local < 0) return { phase: 'idle', y: PLATE.top, shake: 0 };
  let u = local % CYCLE;
  if (u < C.idle) return { phase: 'idle', y: PLATE.top, shake: 0 };
  u -= C.idle;
  if (u < C.warn) return { phase: 'warn', y: PLATE.top - 0.25 * (u / C.warn), shake: u / C.warn };
  u -= C.warn;
  if (u < C.slam) { const s = u / C.slam; return { phase: 'slam', y: PLATE.top - 0.25 - (PLATE.top - 0.25 - PLATE.bottom) * s * s, shake: 0 }; }
  u -= C.slam;
  if (u < C.hold) return { phase: 'hold', y: PLATE.bottom, shake: 0 };
  u -= C.hold;
  const s = u / C.rise;
  return { phase: 'rise', y: PLATE.bottom + (PLATE.top - PLATE.bottom) * (s * s * (3 - 2 * s)), shake: 0 };
}
/** Round time of the k-th slam's impact for crusher k, for tests. */
export const firstSlam = k => CRUSH_START + k * (CYCLE / 4) * 0.85 + CRUSH_CYCLE.idle + CRUSH_CYCLE.warn + CRUSH_CYCLE.slam;

// Crumbling: the outer ring starts cracking at CRUMBLE_START, falls
// CRUMBLE_WARN later, and the next ring follows every CRUMBLE_EVERY.
export const CRUMBLE_START = 45;
export const CRUMBLE_EVERY = 12;
export const CRUMBLE_WARN = 3;

/** Which ring (if any) is cracking or has fallen by time t. */
export function crumbleRing(t) {
  if (t < CRUMBLE_START) return { fallen: -1, cracking: -1 };
  const k = Math.floor((t - CRUMBLE_START) / CRUMBLE_EVERY);
  const into = (t - CRUMBLE_START) - k * CRUMBLE_EVERY;
  const fallen = Math.min(MIN_RING - 1, into >= CRUMBLE_WARN ? k : k - 1);
  const cracking = k < MIN_RING && into < CRUMBLE_WARN ? k : -1;
  return { fallen, cracking };
}

/** The starting floor: 1 where there is a cell, 0 for pits. */
export function startCells() {
  const cells = new Uint8Array(N * N).fill(1);
  for (const [x, z] of PITS) {
    const i0 = cellOf(x - 0.1) , j0 = cellOf(z - 0.1);
    for (const i of [i0, i0 + (x > 0 ? 1 : -1)]) for (const j of [j0, j0 + (z > 0 ? 1 : -1)]) {
      if (i >= 0 && j >= 0 && i < N && j < N) cells[j * N + i] = 0;
    }
  }
  return cells;
}

/** Remove every cell in rings up to `ring`. Returns the cells removed. */
export function dropRings(cells, ring) {
  const gone = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (cells[j * N + i] && ringOf(i, j) <= ring) { cells[j * N + i] = 0; gone.push(j * N + i); }
  }
  return gone;
}

export function cellAlive(cells, x, z) {
  const i = cellOf(x), j = cellOf(z);
  return i >= 0 && j >= 0 && i < N && j < N && cells[j * N + i] === 1;
}

/**
 * The floor as a triangle mesh: every live cell is split 2x2 so the bowl
 * reads as a curve. Vertices are shared across the whole grid.
 */
const SUB = 2;
export function floorMesh(cells) {
  const G = N * SUB + 1;
  const step = CELL / SUB;
  const vertices = new Float32Array(G * G * 3);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = -HALF + i * step, z = -HALF + j * step;
    const o = (j * G + i) * 3;
    vertices[o] = x; vertices[o + 1] = heightAt(x, z); vertices[o + 2] = z;
  }
  const idx = [];
  for (let cj = 0; cj < N; cj++) for (let ci = 0; ci < N; ci++) {
    if (!cells[cj * N + ci]) continue;
    for (let b = 0; b < SUB; b++) for (let a = 0; a < SUB; a++) {
      const i = ci * SUB + a, j = cj * SUB + b;
      const v00 = j * G + i, v10 = v00 + 1, v01 = v00 + G, v11 = v01 + 1;
      // Wound so the face normal points up.
      idx.push(v00, v01, v10, v10, v01, v11);
    }
  }
  return { vertices, indices: new Uint32Array(idx) };
}

/** Ramp wedge corners, in world space: a slope rising toward `dir`. */
export function rampPoints(r) {
  const { L, W, H } = RAMP;
  const [dx, dz] = r.dir;
  const px = -dz, pz = dx;                  // across the ramp
  const pts = [];
  for (const s of [-1, 1]) {
    const lo = [r.x - dx * L / 2 + px * s * W / 2, r.z - dz * L / 2 + pz * s * W / 2];
    const hi = [r.x + dx * L / 2 + px * s * W / 2, r.z + dz * L / 2 + pz * s * W / 2];
    pts.push([lo[0], -0.3, lo[1]], [hi[0], -0.3, hi[1]], [hi[0], H, hi[1]], [lo[0], 0.02, lo[1]]);
  }
  return pts;
}

/** Six starting spots on a ring, each facing the middle. */
export function spawnPoints(n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 24, z = Math.sin(a) * 24;
    out.push({ x, z, yaw: Math.atan2(z, -x) });
  }
  return out;
}
