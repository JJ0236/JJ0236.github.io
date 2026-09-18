// Maps. Each hand-built map is drawn as its top-left quarter (8 rows by 11
// columns, centre row and column included) and mirrored both ways, so every
// arena is fair by construction and every row is the right length.
//
//   #  wall     x  crate (breaks when shot)     .  floor     1  spawn

export const COLS = 21;
export const ROWS = 15;

export const FLOOR = 0, WALL = 1, CRATE = 2;

const QUARTERS = {
  meadow: {
    name: 'Meadow',
    note: 'Open ground and a few crates. Somewhere to learn the controls.',
    q: [
      '###########',
      '#1.........',
      '#..........',
      '#...##.....',
      '#...#......',
      '#.......x..',
      '#.......x..',
      '#.....x....',
    ],
  },
  crossroads: {
    name: 'Crossroads',
    note: 'Four rooms and a busy junction in the middle.',
    q: [
      '###########',
      '#1....#....',
      '#.....#....',
      '#..x..#....',
      '#........x.',
      '#####x.....',
      '#..........',
      '#..........',
    ],
  },
  pillars: {
    name: 'Pillars',
    note: 'A grid of posts to duck behind.',
    q: [
      '###########',
      '#1.........',
      '#..#...#...',
      '#..........',
      '#..#...#...',
      '#..........',
      '#..#...#...',
      '#.........#',
    ],
  },
  bunkers: {
    name: 'Bunkers',
    note: 'Each spawn sits in its own dugout.',
    q: [
      '###########',
      '#1...#.....',
      '#....#..x..',
      '#.####..x..',
      '#.......x..',
      '#xxx.......',
      '#......###.',
      '#......#...',
    ],
  },
  lumberyard: {
    name: 'Lumberyard',
    note: 'Mostly crates. It will not look like this for long.',
    q: [
      '###########',
      '#1..x.x....',
      '#...x.x.xx.',
      '#xx.......x',
      '#...xx.x...',
      '#.x....x.xx',
      '#.x.xx.....',
      '#....x..x..',
    ],
  },
  hallways: {
    name: 'Hallways',
    note: 'Long corridors that suit a ricochet.',
    q: [
      '###########',
      '#1.#.......',
      '#..#.#####.',
      '#..#.#.....',
      '#....#.###.',
      '####.......',
      '#....#.#...',
      '#..x.#.#.x.',
    ],
  },
  moat: {
    name: 'Moat',
    note: 'A ring road around a crate fort.',
    q: [
      '###########',
      '#1.........',
      '#.#######..',
      '#.#........',
      '#.#..xxx...',
      '#.#..x.....',
      '#....x..#..',
      '#.......#..',
    ],
  },
  arena: {
    name: 'Arena',
    note: 'A walled pit in the middle with four ways in.',
    q: [
      '###########',
      '#1.........',
      '#..........',
      '#...######.',
      '#...#......',
      '#...#..x...',
      '#......x...',
      '#...x......',
    ],
  },
  switchback: {
    name: 'Switchback',
    note: 'Walls that make you zig-zag to get anywhere.',
    q: [
      '###########',
      '#1.....#...',
      '#......#...',
      '#..#####...',
      '#..........',
      '#.....#####',
      '#..........',
      '###....x...',
    ],
  },
  checkers: {
    name: 'Checkers',
    note: 'Alternating posts and crates, and a crate dead centre.',
    q: [
      '###########',
      '#1.........',
      '#.x.#.x.#..',
      '#..........',
      '#.#.x.#.x..',
      '#..........',
      '#.x.#.x.#..',
      '#.........x',
    ],
  },
};

export const MAPS = [
  ...Object.entries(QUARTERS).map(([id, m]) => ({ id, name: m.name, note: m.note })),
  { id: 'maze', name: 'Maze', note: 'A new labyrinth every round.' },
];

// Rotation interleaves a fresh maze every few hand-built maps.
export const ROTATION = [
  'meadow', 'crossroads', 'pillars', 'maze', 'bunkers', 'lumberyard',
  'hallways', 'maze', 'moat', 'arena', 'switchback', 'maze', 'checkers',
];

/** Mirror a quarter into a full 21 × 15 array of strings. */
export function mirror(q) {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    const qr = q[Math.min(r, ROWS - 1 - r)];
    let line = '';
    for (let c = 0; c < COLS; c++) {
      let ch = qr[Math.min(c, COLS - 1 - c)];
      if (ch === '1') {
        const right = c > COLS / 2, bottom = r > ROWS / 2;
        ch = String(1 + (right ? 1 : 0) + (bottom ? 2 : 0));
      }
      line += ch;
    }
    rows.push(line);
  }
  return rows;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A braided maze: carved by backtracking, then opened up so it has loops and
 *  a few plazas, with some of the remaining walls swapped for crates. */
export function mazeRows(seed) {
  const rand = rng(seed);
  const g = Array.from({ length: ROWS }, () => Array(COLS).fill('#'));
  const cw = (COLS - 1) / 2, ch = (ROWS - 1) / 2;
  const seen = new Set();
  const stack = [[0, 0]];
  seen.add('0,0');
  g[1][1] = '.';
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => [cx + dx, cy + dy, dx, dy])
      .filter(([x, y]) => x >= 0 && y >= 0 && x < cw && y < ch && !seen.has(x + ',' + y));
    if (!next.length) { stack.pop(); continue; }
    const [nx, ny, dx, dy] = next[Math.floor(rand() * next.length)];
    seen.add(nx + ',' + ny);
    g[1 + cy * 2 + dy][1 + cx * 2 + dx] = '.';
    g[1 + ny * 2][1 + nx * 2] = '.';
    stack.push([nx, ny]);
  }
  // Braid: knock out a share of the walls that sit between two cells.
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      if (g[r][c] !== '#') continue;
      const between = (r % 2 === 1) !== (c % 2 === 1);
      if (between && rand() < 0.3) g[r][c] = '.';
    }
  }
  // Plazas: three 3 × 3 clearings so fights are not only down corridors.
  for (let i = 0; i < 3; i++) {
    const pc = 3 + Math.floor(rand() * (COLS - 6));
    const pr = 3 + Math.floor(rand() * (ROWS - 6));
    for (let r = pr - 1; r <= pr + 1; r++) for (let c = pc - 1; c <= pc + 1; c++) g[r][c] = '.';
  }
  // Some walls become crates.
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      if (g[r][c] === '#' && rand() < 0.14) g[r][c] = 'x';
    }
  }
  // Corner spawns, with a little room to turn.
  const corners = [[1, 1, '1'], [COLS - 2, 1, '2'], [1, ROWS - 2, '3'], [COLS - 2, ROWS - 2, '4']];
  for (const [c, r, d] of corners) {
    g[r][c] = d;
    const sx = c === 1 ? 1 : -1, sy = r === 1 ? 1 : -1;
    if (g[r][c + sx] !== '.') g[r][c + sx] = '.';
    if (g[r + sy][c] !== '.') g[r + sy][c] = '.';
  }
  return g.map(row => row.join(''));
}

export function mapRows(id, seed = 1) {
  if (id === 'maze') return mazeRows(seed);
  const m = QUARTERS[id];
  if (!m) throw new Error('unknown map ' + id);
  return mirror(m.q);
}

export function mapName(id) {
  const m = MAPS.find(m => m.id === id);
  return m ? m.name : id;
}

/** Parse rows into a tile grid plus spawn points (in spawn-number order). */
export function buildMap(id, seed = 1) {
  const rows = mapRows(id, seed);
  const grid = new Uint8Array(COLS * ROWS);
  const spawns = [];
  rows.forEach((line, r) => {
    for (let c = 0; c < COLS; c++) {
      const ch = line[c];
      grid[r * COLS + c] = ch === '#' ? WALL : ch === 'x' ? CRATE : FLOOR;
      if (ch >= '1' && ch <= '4') spawns[+ch - 1] = { c, r };
    }
  });
  return { id, seed, grid, spawns, rows };
}
