// The places you fight in. An arena is a grid of floor cells over a drop,
// plus what sits on it and what takes it away:
//
//   The Quarry     a dirt platform with a bowl, pits, ramps and four
//                  crushers. From 45 s the edge crumbles, a ring at a time.
//   Frozen lake    a round sheet of ice, low on grip and with no crushers.
//                  The ice cracks under the cars that drive over it and
//                  drops them into the water.
//
// `makeArena(id)` returns everything the sim and the renderer need, so both
// work from the same numbers and neither needs to know which arena it is.

export const ARENAS = {
  quarry: {
    id: 'quarry', name: 'The Quarry', note: 'dirt, crushers and a crumbling edge',
    N: 30, CELL: 4, fallY: -8, theme: 'quarry', grip: 1, floorFriction: 1,
    bowl: { r: 18, depth: 2.2 },
    pits: [[-36, -36], [36, -36], [-36, 36], [36, 36]],
    ramps: [{ x: 38, z: 0, dir: [-1, 0] }, { x: -38, z: 0, dir: [1, 0] }, { x: 0, z: 38, dir: [0, -1] }, { x: 0, z: -38, dir: [0, 1] }],
    crushers: [[20, 20], [-20, 20], [20, -20], [-20, -20]],
    drops: true,
    wear: null,
    crumble: { start: 45, every: 11, warn: 3, minRing: 9 },
    spawnR: 30,
  },
  lake: {
    id: 'lake', name: 'Frozen lake', note: 'slippery, and the ice gives way',
    N: 30, CELL: 4, fallY: -6, theme: 'ice', grip: 0.6, floorFriction: 0.4,
    bowl: { r: 0, depth: 0 },
    round: 56,                       // a round sheet, not a square one
    pits: [],
    ramps: [{ x: 32, z: 32, dir: [-0.7, -0.7] }, { x: -32, z: -32, dir: [0.7, 0.7] }],
    crushers: [],
    drops: true,
    // Ice thins where cars drive: seconds of driving a cell can take.
    wear: { takes: 4, crack: 0.45, spread: 0.3 },
    crumble: null,
    spawnR: 34,
  },
};
export const ARENA_IDS = Object.keys(ARENAS);

// One cycle of a crusher, in seconds: idle up top, shake, slam, hold, rise.
export const CRUSH_CYCLE = { idle: 6.5, warn: 1.3, slam: 0.22, hold: 1.1, rise: 1.6 };
const CYCLE = Object.values(CRUSH_CYCLE).reduce((a, b) => a + b, 0);
export const CRUSH_START = 8;
export const PLATE = { half: 3.4, top: 10, bottom: 1.05, thick: 0.9 };
export const RAMP = { L: 9, W: 6, H: 1.7 };
const SUB = 2;                        // how finely each cell is split for the mesh

export function makeArena(id) {
  const D = ARENAS[id] || ARENAS.quarry;
  const N = D.N, CELL = D.CELL, HALF = (N * CELL) / 2;
  const A = {
    ...D,
    N, CELL, HALF,
    FALL_Y: D.fallY,
    BOWL_R: D.bowl.r,
    PLATE, RAMP, CRUSH_CYCLE, CRUSH_START,
    RAMPS: D.ramps,
    PITS: D.pits,
    CRUSHERS: D.crushers.map(([x, z], k) => ({ x, z, k })),
    MIN_RING: D.crumble ? D.crumble.minRing : 0,
    CRUMBLE_START: D.crumble ? D.crumble.start : Infinity,
    CRUMBLE_EVERY: D.crumble ? D.crumble.every : 0,
    CRUMBLE_WARN: D.crumble ? D.crumble.warn : 0,
  };

  A.heightAt = (x, z) => {
    if (!D.bowl.r) return 0;
    const r = Math.hypot(x, z);
    if (r >= D.bowl.r) return 0;
    const t = r / D.bowl.r;
    return -D.bowl.depth * (1 - t * t * (3 - 2 * t));
  };
  A.cellOf = v => Math.floor((v + HALF) / CELL);
  A.cellCentre = i => -HALF + (i + 0.5) * CELL;
  A.ringOf = (i, j) => Math.min(i, j, N - 1 - i, N - 1 - j);

  A.startCells = () => {
    const cells = new Uint8Array(N * N).fill(1);
    if (D.round) {
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        if (Math.hypot(A.cellCentre(i), A.cellCentre(j)) > D.round) cells[j * N + i] = 0;
      }
    }
    for (const [x, z] of D.pits) {
      const i0 = A.cellOf(x - 0.1), j0 = A.cellOf(z - 0.1);
      for (const i of [i0, i0 + (x > 0 ? 1 : -1)]) for (const j of [j0, j0 + (z > 0 ? 1 : -1)]) {
        if (i >= 0 && j >= 0 && i < N && j < N) cells[j * N + i] = 0;
      }
    }
    return cells;
  };

  A.dropRings = (cells, ring) => {
    const gone = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (cells[j * N + i] && A.ringOf(i, j) <= ring) { cells[j * N + i] = 0; gone.push(j * N + i); }
    }
    return gone;
  };

  A.cellAlive = (cells, x, z) => {
    const i = A.cellOf(x), j = A.cellOf(z);
    return i >= 0 && j >= 0 && i < N && j < N && cells[j * N + i] === 1;
  };
  A.cellIndex = (x, z) => {
    const i = A.cellOf(x), j = A.cellOf(z);
    return i >= 0 && j >= 0 && i < N && j < N ? j * N + i : -1;
  };
  A.cellPos = k => [A.cellCentre(k % N), A.cellCentre((k / N) | 0)];
  A.neighbours = k => {
    const i = k % N, j = (k / N) | 0;
    const out = [];
    if (i > 0) out.push(k - 1);
    if (i < N - 1) out.push(k + 1);
    if (j > 0) out.push(k - N);
    if (j < N - 1) out.push(k + N);
    return out;
  };

  /** Which ring (if any) is cracking or has fallen by time t. */
  A.crumbleRing = t => {
    if (!D.crumble || t < D.crumble.start) return { fallen: -1, cracking: -1 };
    const k = Math.floor((t - D.crumble.start) / D.crumble.every);
    const into = (t - D.crumble.start) - k * D.crumble.every;
    const fallen = Math.min(D.crumble.minRing - 1, into >= D.crumble.warn ? k : k - 1);
    const cracking = k < D.crumble.minRing && into < D.crumble.warn ? k : -1;
    return { fallen, cracking };
  };

  /** Where a crusher's plate is at time t, and what it is doing. */
  A.crusherState = (k, t) => {
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
  };
  A.firstSlam = k => CRUSH_START + k * (CYCLE / 4) * 0.85 + CRUSH_CYCLE.idle + CRUSH_CYCLE.warn + CRUSH_CYCLE.slam;

  /** The floor as a triangle mesh: every live cell split, vertices shared. */
  A.floorMesh = cells => {
    const G = N * SUB + 1;
    const step = CELL / SUB;
    const vertices = new Float32Array(G * G * 3);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = -HALF + i * step, z = -HALF + j * step;
      const o = (j * G + i) * 3;
      vertices[o] = x; vertices[o + 1] = A.heightAt(x, z); vertices[o + 2] = z;
    }
    const idx = [];
    for (let cj = 0; cj < N; cj++) for (let ci = 0; ci < N; ci++) {
      if (!cells[cj * N + ci]) continue;
      for (let b = 0; b < SUB; b++) for (let a = 0; a < SUB; a++) {
        const i = ci * SUB + a, j = cj * SUB + b;
        const v00 = j * G + i, v10 = v00 + 1, v01 = v00 + G, v11 = v01 + 1;
        idx.push(v00, v01, v10, v10, v01, v11);          // wound so the face points up
      }
    }
    return { vertices, indices: new Uint32Array(idx) };
  };

  A.rampPoints = r => {
    const { L, W, H } = RAMP;
    const len = Math.hypot(r.dir[0], r.dir[1]) || 1;
    const dx = r.dir[0] / len, dz = r.dir[1] / len;
    const px = -dz, pz = dx;
    const pts = [];
    for (const s of [-1, 1]) {
      const lo = [r.x - dx * L / 2 + px * s * W / 2, r.z - dz * L / 2 + pz * s * W / 2];
      const hi = [r.x + dx * L / 2 + px * s * W / 2, r.z + dz * L / 2 + pz * s * W / 2];
      pts.push([lo[0], -0.3, lo[1]], [hi[0], -0.3, hi[1]], [hi[0], H, hi[1]], [lo[0], 0.02, lo[1]]);
    }
    return pts;
  };

  /** Starting spots on a ring, each facing the middle. */
  A.spawnPoints = n => {
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.PI / 6;
      const x = Math.cos(a) * D.spawnR, z = Math.sin(a) * D.spawnR;
      out.push({ x, z, yaw: Math.atan2(z, -x) });
    }
    return out;
  };

  return A;
}
