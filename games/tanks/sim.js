// The rules. Pure state in, state out: no DOM, no network, no clock. The host
// (or a solo game) calls step() sixty times a second with everyone's input;
// clients only ever see snapshots of this state.

import { COLS, ROWS, FLOOR, WALL, CRATE, ROTATION, MAPS, buildMap } from './maps.js';

export const TILE = 40;
export const W = COLS * TILE;
export const H = ROWS * TILE;
export const DT = 1 / 60;

export const TANK_R = 14;
const SPEED = 125;
const TURN = 3.4;
const SHELL_SPEED = 250;
const SHELL_R = 4;
const MAX_SHELLS = 5;
const COOLDOWN = 0.22;
const SHELL_LIFE = 5;
const MINE_TRIGGER = TANK_R + 8;
const BLAST = 52;
const COUNTDOWN = 1.6;
const ENDING = 1.2;
const ROUND_END = 2.4;
const ROUND_LIMIT = 150;

export const COLORS = ['#5C7A4E', '#A8553A', '#3F6E9A', '#B8892E'];
export const TEAM = {
  red:  { name: 'Red',  color: '#A8453A' },
  blue: { name: 'Blue', color: '#3F6E9A' },
};

// Weapons occupy one slot and are spent a charge per trigger pull. Buffs run
// on a timer and stack with whatever weapon you hold.
export const POWERUPS = {
  ricochet: { group: 'weapon', buff: 12, name: 'Ricochet',  note: 'shells bounce off walls' },
  laser:    { group: 'weapon', charges: 1, name: 'Laser',   note: 'a beam that reflects, after a short charge' },
  shotgun:  { group: 'weapon', charges: 3, name: 'Shotgun', note: 'five pellets, short range' },
  homing:   { group: 'weapon', charges: 2, name: 'Homing',  note: 'a missile that steers at the nearest enemy' },
  mines:    { group: 'weapon', charges: 3, name: 'Mines',   note: 'dropped behind you; arm after a second' },
  triple:   { group: 'weapon', charges: 6, name: 'Triple',  note: 'three shells in a fan' },
  shield:   { group: 'defense', buff: 15, name: 'Shield',   note: 'absorbs one hit' },
  speed:    { group: 'defense', buff: 8,  name: 'Speed',    note: 'half again as fast' },
  invis:    { group: 'defense', buff: 8,  name: 'Cloak',    note: 'nearly invisible to everyone else' },
  giant:    { group: 'chaos', charges: 3, name: 'Giant',    note: 'huge slow shells that plough through crates' },
  freeze:   { group: 'chaos', charges: 2, name: 'Freeze',   note: 'locks a tank in place for a few seconds' },
  teleport: { group: 'chaos', charges: 2, name: 'Teleport', note: 'jump to where you are aiming' },
};
export const POWERUP_IDS = Object.keys(POWERUPS);
const PICKUP_RATE = { off: 0, low: 13, normal: 8, high: 4 };

export const DEFAULT_SETTINGS = {
  mode: 'ffa',          // 'ffa' | 'teams'
  map: 'rotation',      // 'rotation' | 'random' | a map id
  rounds: 5,
  pickups: 'normal',    // 'off' | 'low' | 'normal' | 'high'
  ff: false,            // teammates can hurt each other
  bots: 1,
  botLevel: 'normal',   // 'easy' | 'normal' | 'hard'
};

// ── Helpers ────────────────────────────────────────────────

export function rand(g) {
  g.seed = (g.seed + 0x6D2B79F5) | 0;
  let t = g.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const wrap = a => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

export function tileAt(grid, x, y) {
  const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return WALL;
  return grid[r * COLS + c];
}

const solid = t => t === WALL || t === CRATE;

/** Every solid tile a circle overlaps, as tile indices. */
function overlaps(grid, x, y, r) {
  const out = [];
  const c0 = Math.floor((x - r) / TILE), c1 = Math.floor((x + r) / TILE);
  const r0 = Math.floor((y - r) / TILE), r1 = Math.floor((y + r) / TILE);
  for (let tr = r0; tr <= r1; tr++) {
    for (let tc = c0; tc <= c1; tc++) {
      const inside = tc >= 0 && tr >= 0 && tc < COLS && tr < ROWS;
      const t = inside ? grid[tr * COLS + tc] : WALL;
      if (!solid(t)) continue;
      const nx = Math.max(tc * TILE, Math.min(x, (tc + 1) * TILE));
      const ny = Math.max(tr * TILE, Math.min(y, (tr + 1) * TILE));
      if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) out.push(inside ? tr * COLS + tc : -1);
    }
  }
  return out;
}

export function circleFree(grid, x, y, r) {
  return overlaps(grid, x, y, r).length === 0;
}

/** Push a circle out of any wall or crate it overlaps. */
export function pushOut(grid, o, r) {
  for (let it = 0; it < 3; it++) {
    let moved = false;
    const c0 = Math.floor((o.x - r) / TILE), c1 = Math.floor((o.x + r) / TILE);
    const r0 = Math.floor((o.y - r) / TILE), r1 = Math.floor((o.y + r) / TILE);
    for (let tr = r0; tr <= r1; tr++) {
      for (let tc = c0; tc <= c1; tc++) {
        const inside = tc >= 0 && tr >= 0 && tc < COLS && tr < ROWS;
        if (!solid(inside ? grid[tr * COLS + tc] : WALL)) continue;
        const nx = Math.max(tc * TILE, Math.min(o.x, (tc + 1) * TILE));
        const ny = Math.max(tr * TILE, Math.min(o.y, (tr + 1) * TILE));
        let dx = o.x - nx, dy = o.y - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) {
          // Centre inside the tile: leave by the nearest face.
          const cx = (tc + 0.5) * TILE, cy = (tr + 0.5) * TILE;
          dx = o.x - cx; dy = o.y - cy;
          if (Math.abs(dx) > Math.abs(dy)) { dx = Math.sign(dx) || 1; dy = 0; } else { dy = Math.sign(dy) || 1; dx = 0; }
          d = 0;
          o.x += dx * (TILE / 2 + r - Math.abs(o.x - cx) * Math.abs(dx));
          o.y += dy * (TILE / 2 + r - Math.abs(o.y - cy) * Math.abs(dy));
        } else {
          o.x += (dx / d) * (r - d);
          o.y += (dy / d) * (r - d);
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** Drive one tank for dt seconds. Shared with client-side prediction. */
export function drive(grid, t, inp, dt) {
  const fast = t.buffs && t.buffs.speed > 0 ? 1.5 : 1;
  t.a = wrap(t.a + (inp.tu || 0) * TURN * Math.min(fast, 1.25) * dt);
  const th = inp.th || 0;
  const v = th * SPEED * fast * (th < 0 ? 0.7 : 1);
  t.x += Math.cos(t.a) * v * dt;
  t.y += Math.sin(t.a) * v * dt;
  pushOut(grid, t, TANK_R);
}

export function teamOf(g, id) {
  const p = g.players.find(p => p.id === id);
  return p ? p.team : null;
}

function isFriend(g, a, b) {
  return g.settings.mode === 'teams' && a !== b && teamOf(g, a) === teamOf(g, b);
}

function ev(g, type, data) {
  g.events.push({ id: g.nextEvent++, type, ...data });
}

// ── Game lifecycle ─────────────────────────────────────────

/**
 * players: [{ id, name, team?, color?, bot? }]
 */
export function createGame(settings, players, seed = (Math.random() * 2 ** 31) | 0) {
  const g = {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    players: players.map(p => ({ ...p })),
    seed,
    tick: 0,
    phase: 'countdown',
    timer: COUNTDOWN,
    round: 0,
    roundTime: 0,
    scores: {},
    kills: {},
    lastWinner: null,
    matchWinner: null,
    map: null,
    grid: null,
    tanks: [],
    shells: [],
    mines: [],
    pickups: [],
    beams: [],
    events: [],
    nextEvent: 1,
    nextId: 1,
    pickupTimer: 0,
    rotationStart: 0,
    destroyed: [],
  };
  g.rotationStart = Math.floor(rand(g) * ROTATION.length);
  for (const p of g.players) g.kills[p.id] = 0;
  startRound(g);
  return g;
}

function scoreKey(g, id) {
  return g.settings.mode === 'teams' ? teamOf(g, id) : id;
}

function pickMap(g) {
  const s = g.settings.map;
  if (s === 'rotation') return ROTATION[(g.rotationStart + g.round - 1) % ROTATION.length];
  if (s === 'random') {
    const ids = MAPS.map(m => m.id);
    return ids[Math.floor(rand(g) * ids.length)];
  }
  return s;
}

export function startRound(g) {
  g.round++;
  const id = pickMap(g);
  const seed = (rand(g) * 2 ** 31) | 0;
  const m = buildMap(id, seed);
  g.map = { id, seed };
  g.grid = m.grid;
  g.destroyed = [];
  g.shells = [];
  g.mines = [];
  g.pickups = [];
  g.beams = [];
  g.phase = 'countdown';
  g.timer = COUNTDOWN;
  g.roundTime = 0;
  // The first power-up lands early so short rounds still see one.
  g.pickupTimer = Math.min(3, PICKUP_RATE[g.settings.pickups] || 0);

  // Spawn order: diagonal first so a two-tank game starts far apart. Teams
  // take a side each: red on the left spawns, blue on the right.
  const order = [0, 3, 1, 2];
  const slots = g.settings.mode === 'teams'
    ? { red: [0, 2], blue: [1, 3] }
    : null;
  const used = new Set();
  const active = g.players.filter(p => !p.left);
  g.tanks = active.map((p, i) => {
    let si;
    if (slots && slots[p.team]) si = slots[p.team].find(s => !used.has(s));
    if (si === undefined) si = order.find(s => !used.has(s));
    used.add(si);
    const sp = m.spawns[si];
    const x = (sp.c + 0.5) * TILE, y = (sp.r + 0.5) * TILE;
    const a = Math.atan2(H / 2 - y, W / 2 - x);
    const snapped = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
    return {
      id: p.id, x, y, a: snapped, ta: a, alive: true,
      cool: 0, weapon: null, charges: 0, charging: 0,
      buffs: { ricochet: 0, shield: 0, speed: 0, invis: 0 },
      frozen: 0, grace: 0, lastFs: null, queued: 0,
    };
  });
  ev(g, 'round', { round: g.round, map: id });
}

// ── The step ───────────────────────────────────────────────

/** inputs: { [playerId]: { th, tu, ax, ay, fs } } */
export function step(g, inputs) {
  g.tick++;
  const dt = DT;

  if (g.phase === 'matchEnd') return;
  if (g.phase === 'roundEnd') {
    g.timer -= dt;
    if (g.timer <= 0) startRound(g);
    return;
  }
  if (g.phase === 'countdown') {
    g.timer -= dt;
    for (const t of g.tanks) {
      const inp = inputs[t.id];
      if (inp) aim(t, inp);
      // Clicks during the countdown do not bank shots for the first frame.
      if (inp && inp.fs !== undefined) t.lastFs = inp.fs;
    }
    if (g.timer <= 0) { g.phase = 'play'; ev(g, 'go', {}); }
    return;
  }

  g.roundTime += dt;
  for (const t of g.tanks) updateTank(g, t, inputs[t.id] || {}, dt);
  separateTanks(g);
  updateShells(g, dt);
  updateMines(g, dt);
  updatePickups(g, dt);
  g.beams = g.beams.filter(b => (b.life -= dt) > 0);

  if (g.phase === 'play') {
    const standing = aliveSides(g);
    const total = g.tanks.length;
    if ((total >= 2 && standing.size <= 1) || g.roundTime > ROUND_LIMIT) {
      g.phase = 'ending';
      g.timer = ENDING;
    }
  } else if (g.phase === 'ending') {
    g.timer -= dt;
    if (g.timer <= 0) endRound(g);
  }
}

function aliveSides(g) {
  const s = new Set();
  for (const t of g.tanks) if (t.alive) s.add(scoreKey(g, t.id));
  return s;
}

function endRound(g) {
  const sides = aliveSides(g);
  let winner = null;
  if (sides.size === 1) winner = [...sides][0];
  g.lastWinner = winner;
  if (winner !== null) g.scores[winner] = (g.scores[winner] || 0) + 1;
  ev(g, 'roundEnd', { winner });
  if (winner !== null && g.scores[winner] >= g.settings.rounds) {
    g.phase = 'matchEnd';
    g.matchWinner = winner;
    ev(g, 'matchEnd', { winner });
  } else {
    g.phase = 'roundEnd';
    g.timer = ROUND_END;
  }
}

function aim(t, inp) {
  if (typeof inp.ax === 'number' && typeof inp.ay === 'number') {
    t.ta = Math.atan2(inp.ay - t.y, inp.ax - t.x);
    t.lastAim = { x: inp.ax, y: inp.ay };
  }
}

function updateTank(g, t, inp, dt) {
  for (const k in t.buffs) if (t.buffs[k] > 0) t.buffs[k] = Math.max(0, t.buffs[k] - dt);
  if (t.grace > 0) t.grace -= dt;
  if (t.cool > 0) t.cool -= dt;
  if (!t.alive) return;

  if (t.frozen > 0) {
    t.frozen -= dt;
    t.charging = 0;
    if (inp.fs !== undefined) t.lastFs = inp.fs;
    return;
  }

  drive(g.grid, t, inp, dt);
  aim(t, inp);

  if (t.charging > 0) {
    t.charging -= dt;
    if (t.charging <= 0) fireLaser(g, t);
  }

  // A click is a counter so a shot is never lost between network packets.
  if (inp.fs !== undefined) {
    if (t.lastFs === null) t.lastFs = inp.fs;
    if (inp.fs !== t.lastFs) { t.lastFs = inp.fs; t.queued = 0.2; }
  }
  if (t.queued > 0) {
    t.queued -= dt;
    if (t.cool <= 0 && t.charging <= 0) { fire(g, t); t.queued = 0; }
  }
}

function muzzle(t, extra = 6) {
  return { x: t.x + Math.cos(t.ta) * (TANK_R + extra), y: t.y + Math.sin(t.ta) * (TANK_R + extra) };
}

/** Anything between the tank's centre and its muzzle? Stops shooting through a wall you are hugging. */
function blockedMuzzle(g, t, m) {
  for (let s = 0.25; s <= 1.001; s += 0.25) {
    const x = t.x + (m.x - t.x) * s, y = t.y + (m.y - t.y) * s;
    const tt = tileAt(g.grid, x, y);
    if (solid(tt)) return { x, y, tile: tt };
  }
  return null;
}

function spawnShell(g, t, angle, opts = {}) {
  const r = opts.r || SHELL_R;
  const m = { x: t.x + Math.cos(angle) * (TANK_R + r + 2), y: t.y + Math.sin(angle) * (TANK_R + r + 2) };
  const hit = blockedMuzzle(g, t, m);
  if (hit) {
    if (hit.tile === CRATE) breakCrate(g, hit.x, hit.y);
    else ev(g, 'spark', { x: hit.x, y: hit.y });
    return;
  }
  const speed = opts.speed || SHELL_SPEED;
  g.shells.push({
    id: g.nextId++, owner: t.id, kind: opts.kind || 'shell',
    x: m.x, y: m.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    r, life: opts.life || SHELL_LIFE, age: 0, armed: false,
    bounces: t.buffs.ricochet > 0 ? 4 : 0,
  });
}

function ownShells(g, id) {
  let n = 0;
  for (const s of g.shells) if (s.owner === id && s.kind !== 'pellet') n++;
  return n;
}

function fire(g, t) {
  const w = t.weapon;
  if (!w) {
    if (ownShells(g, t.id) >= MAX_SHELLS) return;
    spawnShell(g, t, t.ta);
    t.cool = COOLDOWN;
    ev(g, 'fire', { id: t.id });
    return;
  }
  switch (w) {
    case 'laser':
      t.charging = 0.4;
      ev(g, 'charge', { id: t.id });
      break;
    case 'shotgun':
      for (let i = -2; i <= 2; i++) {
        spawnShell(g, t, t.ta + i * 0.13 + (rand(g) - 0.5) * 0.05, { kind: 'pellet', r: 3, speed: 330, life: 0.55 });
      }
      t.cool = 0.5;
      break;
    case 'homing':
      spawnShell(g, t, t.ta, { kind: 'homing', r: 5, speed: 175, life: 6 });
      t.cool = 0.5;
      break;
    case 'mines': {
      if (g.mines.filter(m => m.owner === t.id).length >= 3) return;
      const x = t.x - Math.cos(t.a) * (TANK_R + 6), y = t.y - Math.sin(t.a) * (TANK_R + 6);
      if (solid(tileAt(g.grid, x, y))) return;
      g.mines.push({ id: g.nextId++, owner: t.id, x, y, arm: 0.9, life: 40 });
      t.cool = 0.35;
      break;
    }
    case 'triple':
      for (let i = -1; i <= 1; i++) spawnShell(g, t, t.ta + i * 0.2);
      t.cool = 0.3;
      break;
    case 'giant':
      spawnShell(g, t, t.ta, { kind: 'giant', r: 11, speed: 165, life: 5 });
      t.cool = 0.6;
      break;
    case 'freeze':
      spawnShell(g, t, t.ta, { kind: 'freeze', r: 5, speed: 290, life: 3 });
      t.cool = 0.4;
      break;
    case 'teleport':
      teleport(g, t);
      t.cool = 0.4;
      break;
  }
  ev(g, 'fire', { id: t.id, w });
  if (--t.charges <= 0 && w !== 'laser') { t.weapon = null; t.charges = 0; }
}

function teleport(g, t) {
  const inp = t.lastAim || { x: t.x + Math.cos(t.ta) * 200, y: t.y + Math.sin(t.ta) * 200 };
  let dx = inp.x - t.x, dy = inp.y - t.y;
  const d = Math.hypot(dx, dy) || 1;
  const reach = Math.min(d, 360);
  const tx = t.x + (dx / d) * reach, ty = t.y + (dy / d) * reach;
  const free = (x, y) => x > TANK_R && y > TANK_R && x < W - TANK_R && y < H - TANK_R &&
    circleFree(g.grid, x, y, TANK_R + 1) &&
    g.tanks.every(o => o === t || !o.alive || Math.hypot(o.x - x, o.y - y) > TANK_R * 2 + 2);
  let dest = free(tx, ty) ? { x: tx, y: ty } : null;
  if (!dest) {
    // Nearest open tile centre to where you pointed.
    let best = Infinity;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (g.grid[r * COLS + c] !== FLOOR) continue;
      const x = (c + 0.5) * TILE, y = (r + 0.5) * TILE;
      const dd = (x - tx) ** 2 + (y - ty) ** 2;
      if (dd < best && free(x, y)) { best = dd; dest = { x, y }; }
    }
  }
  if (!dest) return;
  ev(g, 'tp', { id: t.id, x0: t.x, y0: t.y, x1: dest.x, y1: dest.y });
  t.x = dest.x; t.y = dest.y;
}

function fireLaser(g, t) {
  t.charging = 0;
  t.weapon = null; t.charges = 0;
  const m = muzzle(t, 2);
  const pts = [[t.x, t.y]];
  let x = t.x, y = t.y;
  let dx = Math.cos(t.ta), dy = Math.sin(t.ta);
  let bounces = 3, travelled = 0;
  const hit = new Set();
  const stepLen = 3;
  while (travelled < 1500) {
    const nx = x + dx * stepLen, ny = y + dy * stepLen;
    const tt = tileAt(g.grid, nx, ny);
    if (tt === CRATE) {
      breakCrate(g, nx, ny);
    } else if (tt === WALL) {
      if (bounces-- <= 0) break;
      const hx = solid(tileAt(g.grid, nx, y)), hy = solid(tileAt(g.grid, x, ny));
      if (hx || !hy) dx = -dx;
      if (hy || !hx) dy = -dy;
      pts.push([x, y]);
      continue;
    }
    x = nx; y = ny; travelled += stepLen;
    for (const o of g.tanks) {
      if (!o.alive || hit.has(o.id)) continue;
      if (o === t && travelled < 40) continue;
      if (isFriend(g, t.id, o.id) && !g.settings.ff) continue;
      if (Math.hypot(o.x - x, o.y - y) < TANK_R + 3) { hit.add(o.id); damage(g, o, t.id, 'laser'); }
    }
    for (const mn of g.mines) if (!mn.dead && Math.hypot(mn.x - x, mn.y - y) < 10) explode(g, mn);
  }
  pts.push([x, y]);
  pts[0] = [m.x, m.y];
  const beam = { id: g.nextId++, pts: pts.map(p => [Math.round(p[0]), Math.round(p[1])]), life: 0.35 };
  g.beams.push(beam);
  ev(g, 'laser', { id: t.id });
}

function breakCrate(g, x, y) {
  const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
  const i = r * COLS + c;
  if (g.grid[i] !== CRATE) return;
  g.grid[i] = FLOOR;
  g.destroyed.push(i);
  ev(g, 'crate', { x: (c + 0.5) * TILE, y: (r + 0.5) * TILE });
}

function damage(g, t, by, how) {
  if (!t.alive || t.grace > 0) return;
  if (t.buffs.shield > 0) {
    t.buffs.shield = 0;
    t.grace = 0.5;
    ev(g, 'shield', { x: t.x, y: t.y, id: t.id });
    return;
  }
  if (how === 'freeze') {
    t.frozen = 2.6;
    ev(g, 'freeze', { id: t.id, x: t.x, y: t.y });
    return;
  }
  t.alive = false;
  t.charging = 0;
  if (by !== t.id && g.kills[by] !== undefined) g.kills[by]++;
  ev(g, 'die', { id: t.id, by, x: t.x, y: t.y, how });
}

function updateShells(g, dt) {
  const keep = [];
  for (const s of g.shells) {
    s.life -= dt;
    s.age += dt;
    if (s.life <= 0) { ev(g, 'fizzle', { x: s.x, y: s.y }); continue; }

    if (s.kind === 'homing' && s.age > 0.25) steer(g, s, dt);

    const speed = Math.hypot(s.vx, s.vy);
    const n = Math.max(1, Math.ceil((speed * dt) / Math.max(3, s.r * 0.8)));
    let dead = false;
    for (let k = 0; k < n && !dead; k++) {
      dead = moveShellAxis(g, s, 'x', (s.vx * dt) / n) || moveShellAxis(g, s, 'y', (s.vy * dt) / n);
      if (!dead) dead = shellHits(g, s);
    }
    if (!dead) keep.push(s);
  }
  g.shells = keep;
}

/** Move along one axis; returns true if the shell was destroyed. */
function moveShellAxis(g, s, axis, d) {
  if (!d) return false;
  s[axis] += d;
  const hits = overlaps(g.grid, s.x, s.y, s.r);
  if (!hits.length) return false;
  if (s.kind === 'giant') {
    let wall = false;
    for (const i of hits) {
      if (i >= 0 && g.grid[i] === CRATE) breakCrate(g, (i % COLS + 0.5) * TILE, (Math.floor(i / COLS) + 0.5) * TILE);
      else wall = true;
    }
    if (!wall) return false;
  } else {
    const crate = hits.find(i => i >= 0 && g.grid[i] === CRATE);
    if (crate !== undefined) {
      breakCrate(g, (crate % COLS + 0.5) * TILE, (Math.floor(crate / COLS) + 0.5) * TILE);
      return true;
    }
  }
  if (s.bounces > 0) {
    s.bounces--;
    s[axis] -= d;
    if (axis === 'x') s.vx = -s.vx; else s.vy = -s.vy;
    if (s.kind === 'homing') s.age = Math.min(s.age, 0.1);
    ev(g, 'bounce', { x: s.x, y: s.y });
    return false;
  }
  ev(g, 'spark', { x: s.x, y: s.y });
  return true;
}

function shellHits(g, s) {
  const owner = g.tanks.find(t => t.id === s.owner);
  if (!s.armed && (!owner || !owner.alive || Math.hypot(owner.x - s.x, owner.y - s.y) > TANK_R + s.r + 1)) s.armed = true;
  for (const t of g.tanks) {
    if (!t.alive) continue;
    if (t.id === s.owner && !s.armed) continue;
    if (isFriend(g, s.owner, t.id) && !g.settings.ff) continue;
    if (Math.hypot(t.x - s.x, t.y - s.y) < TANK_R + s.r) {
      damage(g, t, s.owner, s.kind === 'freeze' ? 'freeze' : s.kind);
      ev(g, 'hit', { x: s.x, y: s.y });
      return true;
    }
  }
  for (const m of g.mines) {
    if (!m.dead && Math.hypot(m.x - s.x, m.y - s.y) < s.r + 8) { explode(g, m); return true; }
  }
  return false;
}

function steer(g, s, dt) {
  let best = null, bd = 520;
  for (const t of g.tanks) {
    if (!t.alive || t.id === s.owner || isFriend(g, s.owner, t.id)) continue;
    const d = Math.hypot(t.x - s.x, t.y - s.y);
    if (d < bd) { bd = d; best = t; }
  }
  if (!best) return;
  const speed = Math.hypot(s.vx, s.vy);
  const cur = Math.atan2(s.vy, s.vx);
  const want = Math.atan2(best.y - s.y, best.x - s.x);
  const turn = Math.max(-2.6 * dt, Math.min(2.6 * dt, wrap(want - cur)));
  s.vx = Math.cos(cur + turn) * speed;
  s.vy = Math.sin(cur + turn) * speed;
}

function explode(g, m) {
  if (m.dead) return;
  m.dead = true;
  ev(g, 'boom', { x: m.x, y: m.y });
  for (const t of g.tanks) {
    if (t.alive && Math.hypot(t.x - m.x, t.y - m.y) < BLAST + TANK_R * 0.5) damage(g, t, m.owner, 'mine');
  }
  const c0 = Math.floor((m.x - BLAST) / TILE), c1 = Math.floor((m.x + BLAST) / TILE);
  const r0 = Math.floor((m.y - BLAST) / TILE), r1 = Math.floor((m.y + BLAST) / TILE);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
    const cx = (c + 0.5) * TILE, cy = (r + 0.5) * TILE;
    if (Math.hypot(cx - m.x, cy - m.y) < BLAST + 14) breakCrate(g, cx, cy);
  }
  for (const o of g.mines) if (!o.dead && Math.hypot(o.x - m.x, o.y - m.y) < BLAST) explode(g, o);
}

function updateMines(g, dt) {
  for (const m of g.mines) {
    if (m.dead) continue;
    m.life -= dt;
    if (m.arm > 0) { m.arm -= dt; continue; }
    if (m.life <= 0) { explode(g, m); continue; }
    for (const t of g.tanks) {
      if (!t.alive) continue;
      const near = Math.hypot(t.x - m.x, t.y - m.y) < MINE_TRIGGER;
      // The layer is safe until they have driven clear of it once.
      if (t.id === m.owner && !m.clear) { if (!near) m.clear = true; continue; }
      if (near) { explode(g, m); break; }
    }
  }
  g.mines = g.mines.filter(m => !m.dead);
}

function updatePickups(g, dt) {
  for (const p of g.pickups) p.life -= dt;
  g.pickups = g.pickups.filter(p => p.life > 0);

  for (const t of g.tanks) {
    if (!t.alive) continue;
    for (const p of g.pickups) {
      if (p.taken || Math.hypot(p.x - t.x, p.y - t.y) > TANK_R + 12) continue;
      p.taken = true;
      const def = POWERUPS[p.type];
      if (def.buff) t.buffs[p.type] = def.buff;
      else {
        t.weapon = p.type;
        t.charges = def.charges;
        t.charging = 0;
      }
      ev(g, 'pick', { id: t.id, powerup: p.type, x: p.x, y: p.y });
    }
  }
  g.pickups = g.pickups.filter(p => !p.taken);

  const rate = PICKUP_RATE[g.settings.pickups];
  if (!rate || g.phase !== 'play') return;
  g.pickupTimer -= dt;
  if (g.pickupTimer > 0) return;
  g.pickupTimer = rate * (0.75 + rand(g) * 0.5);
  if (g.pickups.length >= 3) return;

  for (let tries = 0; tries < 40; tries++) {
    const c = 1 + Math.floor(rand(g) * (COLS - 2)), r = 1 + Math.floor(rand(g) * (ROWS - 2));
    if (g.grid[r * COLS + c] !== FLOOR) continue;
    const x = (c + 0.5) * TILE, y = (r + 0.5) * TILE;
    if (g.tanks.some(t => t.alive && Math.hypot(t.x - x, t.y - y) < TILE * 2.5)) continue;
    if (g.pickups.some(p => Math.hypot(p.x - x, p.y - y) < TILE * 3)) continue;
    const type = POWERUP_IDS[Math.floor(rand(g) * POWERUP_IDS.length)];
    g.pickups.push({ id: g.nextId++, type, x, y, life: 22 });
    ev(g, 'spawn', { x, y });
    return;
  }
}

function separateTanks(g) {
  const ts = g.tanks.filter(t => t.alive);
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const a = ts[i], b = ts[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = TANK_R * 2;
      if (d >= min || d < 1e-6) continue;
      const push = (min - d) / 2;
      a.x -= (dx / d) * push; a.y -= (dy / d) * push;
      b.x += (dx / d) * push; b.y += (dy / d) * push;
      pushOut(g.grid, a, TANK_R);
      pushOut(g.grid, b, TANK_R);
    }
  }
}

// ── Players joining and leaving mid-match ──────────────────

export function addPlayer(g, p) {
  if (g.players.some(q => q.id === p.id)) return;
  g.players.push({ ...p });
  g.kills[p.id] = 0;
  // They get a tank from the next round.
}

export function removePlayer(g, id) {
  const p = g.players.find(p => p.id === id);
  if (p) p.left = true;
  const t = g.tanks.find(t => t.id === id);
  if (t && t.alive) {
    t.alive = false;
    ev(g, 'die', { id, by: null, x: t.x, y: t.y, how: 'left' });
  }
}

// ── Snapshots ──────────────────────────────────────────────
// Compact arrays, rounded, because they go over the wire twenty times a second.

const BUFFS = ['ricochet', 'shield', 'speed', 'invis'];
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;

export function snapshot(g, events) {
  return {
    k: g.tick,
    ph: g.phase,
    tm: r2(g.timer),
    rd: g.round,
    mp: g.map,
    sc: g.scores,
    kl: g.kills,
    lw: g.lastWinner,
    mw: g.matchWinner,
    dz: g.destroyed,
    T: g.tanks.map(t => [
      t.id, r1(t.x), r1(t.y), r2(t.a), r2(t.ta), t.alive ? 1 : 0,
      BUFFS.map(b => r1(t.buffs[b])), r1(t.frozen), t.weapon, t.charges, r2(t.charging), t.grace > 0 ? 1 : 0,
    ]),
    S: g.shells.map(s => [s.id, r1(s.x), r1(s.y), s.kind, s.r, s.owner]),
    M: g.mines.map(m => [m.id, r1(m.x), r1(m.y), m.arm > 0 ? 0 : 1, m.owner]),
    P: g.pickups.map(p => [p.id, p.x, p.y, p.type, r1(p.life)]),
    B: g.beams.map(b => [b.id, b.pts, r2(b.life)]),
    E: events,
  };
}

/** Rebuild the renderable shape of a snapshot (tanks, shells...) for a client. */
export function unpack(s) {
  return {
    tick: s.k,
    phase: s.ph,
    timer: s.tm,
    round: s.rd,
    map: s.mp,
    scores: s.sc,
    kills: s.kl,
    lastWinner: s.lw,
    matchWinner: s.mw,
    destroyed: s.dz,
    tanks: s.T.map(a => ({
      id: a[0], x: a[1], y: a[2], a: a[3], ta: a[4], alive: !!a[5],
      buffs: Object.fromEntries(BUFFS.map((b, i) => [b, a[6][i]])),
      frozen: a[7], weapon: a[8], charges: a[9], charging: a[10], grace: a[11],
    })),
    shells: s.S.map(a => ({ id: a[0], x: a[1], y: a[2], kind: a[3], r: a[4], owner: a[5] })),
    mines: s.M.map(a => ({ id: a[0], x: a[1], y: a[2], arm: a[3] ? 0 : 1, owner: a[4] })),
    pickups: s.P.map(a => ({ id: a[0], x: a[1], y: a[2], type: a[3], life: a[4] })),
    beams: s.B.map(a => ({ id: a[0], pts: a[1], life: a[2] })),
    events: s.E || [],
  };
}
