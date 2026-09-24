// The rules. No DOM and no physics engine: the ground is the pixel mask from
// terrain.js and everything else is a handful of positions and speeds, so the
// whole thing runs under node for the tests.
//
// A turn goes: aim (walk, choose, charge, fire) → fly → settle → the next
// squad. A match ends when one squad is the only one left standing.

import * as T from './terrain.js?v=1';
import { WEAPONS, WEAPON_IDS, startingAmmo } from './weapons.js?v=1';

export const DT = 1 / 60;
export const TURN_TIME = 30;
export const SETTLE_QUIET = 1.1;
export const SUDDEN_DEATH_ROUND = 14;
export const MAX_PLAYERS = 4;
export const SQUAD = 3;
export const TEAM_COLOURS = ['#C2452F', '#2F6FA8', '#4E8A3E', '#D9A21B'];
export const UNIT_NAMES = [
  ['Rook', 'Bramble', 'Flint'], ['Sorrel', 'Tamarack', 'Vetch'],
  ['Hazel', 'Mallow', 'Quill'], ['Dock', 'Teasel', 'Yarrow'],
];
export const DEFAULT_SETTINGS = { rounds: 1, bots: 1, botLevel: 'normal', crates: true };

const GRAV = 340;                 // pixels per second per second
const WALK = 62;                  // pixels a second
const STEP_UP = 7;                // how big a lip a unit can walk up
const UNIT_R = 9;                 // how wide a unit is, for hits and standing
const FALL_SAFE = 170;            // a drop longer than this hurts
const POWER_RATE = 0.85;          // how fast the shot charges
const KNOCK = 150;

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** players: [{ id, name, bot }] in seat order. */
export function createMatch(settings, players, seed = (Math.random() * 2 ** 31) | 0) {
  const m = {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    seed,
    rand: rng(seed),
    players: players.slice(0, MAX_PLAYERS).map((p, i) => ({
      id: p.id, name: p.name, bot: !!p.bot, seat: i,
      colour: TEAM_COLOURS[i % TEAM_COLOURS.length],
      ammo: startingAmmo(), weapon: 'shell',
    })),
    wins: {},
    events: [],
    tick: 0,
    round: 1,
    turn: 0,
    crates: [],
    mines: [],
    shots: [],
    phase: 'aim',
    timer: TURN_TIME,
    quiet: 0,
    winner: undefined,
    crateId: 0,
  };
  for (const p of m.players) m.wins[p.id] = 0;
  startRound(m);
  return m;
}

export function startRound(m) {
  const { mask, top } = T.generate(m.rand);
  m.mask = mask;
  m.top = top;
  m.units = [];
  m.crates = [];
  m.mines = [];
  m.shots = [];
  m.phase = 'aim';
  m.timer = TURN_TIME;
  m.round = 1;
  m.turn = 0;
  m.winner = undefined;
  // Squads take turns across the map, so nobody starts in a huddle.
  const spots = [];
  const lanes = m.players.length * SQUAD;
  for (let i = 0; i < lanes; i++) {
    const lane = (T.W - 240) / lanes;
    for (let tries = 0; tries < 40; tries++) {
      const x = 120 + lane * i + m.rand() * lane;
      const y = T.groundBelow(m.mask, x, 0);
      if (y < T.H - 40 && y > 60) { spots.push({ x, y: y - UNIT_R }); break; }
    }
  }
  let k = 0;
  for (const p of m.players) {
    for (let u = 0; u < SQUAD; u++) {
      const spot = spots[(u * m.players.length + p.seat) % spots.length] || { x: T.W / 2, y: 100 };
      m.units.push({
        id: p.id + ':' + u, owner: p.id, seat: p.seat, idx: m.units.length,
        name: (UNIT_NAMES[p.seat % UNIT_NAMES.length] || [])[u] || 'Unit',
        x: spot.x, y: spot.y, vx: 0, vy: 0,
        hp: 85, alive: true, angle: p.seat % 2 ? Math.PI - 0.7 : 0.7, facing: p.seat % 2 ? -1 : 1,
        charge: 0, fell: 0, turnsTaken: 0,
      });
      k++;
    }
  }
  m.active = m.units.findIndex(u => u.alive);
  m.events.push({ type: 'round', seed: m.seed, round: m.round });
}

/** Is there earth anywhere in the body's column at this spot? */
function blocked(m, x, y) {
  for (const dx of [-6, 0, 6]) {
    for (let dy = -UNIT_R + 2; dy <= UNIT_R - 1; dy++) if (T.solid(m.mask, x + dx, y + dy)) return true;
  }
  return false;
}

const alive = m => m.units.filter(u => u.alive);
const teamsLeft = m => new Set(alive(m).map(u => u.owner));
export const activeUnit = m => m.units[m.active];
export const playerOf = (m, id) => m.players.find(p => p.id === id);

/** Damage in a circle, and a shove away from the middle of it. */
function blast(m, x, y, r, dmg, by) {
  T.carve(m.mask, x, y, r);
  m.events.push({ type: 'boom', x: +x.toFixed(1), y: +y.toFixed(1), r });
  for (const u of m.units) {
    if (!u.alive) continue;
    const d = Math.hypot(u.x - x, u.y - y);
    if (d > r + UNIT_R) continue;
    const share = Math.max(0, 1 - d / (r + UNIT_R));
    hurt(m, u, dmg * share, by);
    const push = (KNOCK * share) / Math.max(8, d);
    u.vx += (u.x - x) * push * 0.06;
    u.vy += (u.y - y) * push * 0.06 - 40 * share;
  }
  for (const c of m.crates) {
    if (Math.hypot(c.x - x, c.y - y) < r + 8) c.pop = true;
  }
  for (const mine of m.mines) {
    if (!mine.dead && Math.hypot(mine.x - x, mine.y - y) < r + 6) mine.trigger = 0.15;
  }
}

function hurt(m, u, amount, by) {
  if (!u.alive || amount <= 0) return;
  u.hp -= amount;
  m.events.push({ type: 'hurt', unit: u.idx, amount: Math.round(amount), by: by || null });
  if (u.hp <= 0) {
    u.hp = 0;
    u.alive = false;
    m.events.push({ type: 'down', unit: u.idx, by: by || null });
    // A unit going down leaves a small crater where it stood.
    blastLater(m, u.x, u.y, 34, 18, by);
  }
}

// Craters from a unit going down are queued so they cannot recurse.
function blastLater(m, x, y, r, dmg, by) { (m.pending ||= []).push({ x, y, r, dmg, by }); }

/** Fire the active unit's weapon. */
export function fire(m, unit, power) {
  const p = playerOf(m, unit.owner);
  const id = p.weapon;
  const w = WEAPONS[id];
  if (!w) return;
  if (p.ammo[id] !== Infinity) {
    if (!p.ammo[id]) return;
    p.ammo[id]--;
  }
  const speed = 210 + power * 590;
  const vx = Math.cos(unit.angle) * speed * unit.facing;
  const vy = -Math.abs(Math.sin(unit.angle)) * speed;
  const from = { x: unit.x + Math.cos(unit.angle) * unit.facing * 14, y: unit.y - Math.sin(unit.angle) * 14 };
  if (w.kind === 'mine') {
    m.mines.push({ x: unit.x, y: unit.y + 4, vy: 0, arm: 1.2, by: unit.owner, dead: false, id: ++m.crateId });
    m.events.push({ type: 'drop', x: unit.x, y: unit.y });
  } else {
    m.shots.push({ x: from.x, y: from.y, vx, vy, w: id, by: unit.owner, from: unit.idx, life: 12, split: false });
    m.events.push({ type: 'fire', x: +from.x.toFixed(1), y: +from.y.toFixed(1), w: id });
  }
  unit.turnsTaken++;
  m.phase = 'fly';
  m.quiet = 0;
}

function explode(m, s, x, y) {
  const w = WEAPONS[s.w];
  if (w.kind === 'teleport') {
    const u = m.units[s.from];
    if (u && u.alive) {
      const ty = T.groundBelow(m.mask, x, Math.max(0, y - 30)) - UNIT_R;
      u.x = Math.max(12, Math.min(T.W - 12, x));
      u.y = Math.max(20, ty);
      u.vx = u.vy = 0;
      m.events.push({ type: 'hop', unit: u.idx, x: u.x, y: u.y });
    }
    return;
  }
  if (w.kind === 'strike') {
    for (let i = 0; i < w.bombs; i++) {
      const bx = x + (i - (w.bombs - 1) / 2) * 46;
      m.shots.push({ x: bx, y: 0, vx: 0, vy: 260, w: 'shellBomb', by: s.by, from: s.from, life: 8, r: w.r, dmg: w.dmg });
    }
    m.events.push({ type: 'strike', x: +x.toFixed(1) });
    return;
  }
  blast(m, x, y, s.r || w.r, s.dmg || w.dmg, s.by);
}

function stepShots(m) {
  const keep = [];
  for (const s of m.shots) {
    const w = WEAPONS[s.w] || { kind: 'shot', gravity: 1, r: s.r || 34, dmg: s.dmg || 20 };
    s.life -= DT;
    s.vy += GRAV * (w.gravity || 1) * DT;
    // A cluster splits once, at the top of its arc.
    if (w.kind === 'cluster' && !s.split && s.vy >= 0) {
      s.split = true;
      for (let i = 0; i < w.split; i++) {
        const a = -0.9 + (i / (w.split - 1)) * 1.8;
        m.shots.push({ x: s.x, y: s.y, vx: s.vx * 0.5 + Math.sin(a) * 120, vy: -60 + Math.cos(a) * -40, w: 'shellBomb', by: s.by, from: s.from, life: 8, r: w.r, dmg: w.dmg });
      }
      m.events.push({ type: 'split', x: +s.x.toFixed(1), y: +s.y.toFixed(1) });
      continue;
    }
    const steps = 4;                                   // small steps, so nothing tunnels
    let hit = null;
    for (let i = 0; i < steps && !hit; i++) {
      s.x += (s.vx * DT) / steps;
      s.y += (s.vy * DT) / steps;
      if (s.x < -60 || s.x > T.W + 60 || s.y > T.H + 80) { hit = 'gone'; break; }
      if (s.y < -400) continue;
      if (T.solid(m.mask, s.x, s.y)) hit = 'ground';
      for (const u of m.units) {
        if (!u.alive || u.idx === s.from || hit) continue;
        if (Math.hypot(u.x - s.x, u.y - s.y) < UNIT_R + 3) hit = 'unit';
      }
    }
    if (hit === 'gone' || s.life <= 0) { if (s.life <= 0 && hit !== 'gone') explode(m, s, s.x, s.y); continue; }
    if (!hit) { keep.push(s); continue; }
    if (w.kind === 'digger' && hit === 'ground' && (s.dug || 0) < (w.burrow || 0)) {
      // Keep going through the earth for a while, then go off inside it.
      const len = Math.hypot(s.vx, s.vy) || 1;
      s.dug = (s.dug || 0) + (len * DT);
      T.carve(m.mask, s.x, s.y, 9);
      keep.push(s);
      continue;
    }
    explode(m, s, s.x, s.y);
  }
  m.shots = keep;
}

function stepUnits(m) {
  for (const u of m.units) {
    if (!u.alive) continue;
    const onGround = T.supported(m.mask, u.x, u.y + UNIT_R, 2);
    if (!onGround) {
      u.vy += GRAV * DT;
      u.fell += Math.max(0, u.vy) * DT;
    } else if (u.vy > 0) {
      if (u.fell > FALL_SAFE) hurt(m, u, Math.min(45, (u.fell - FALL_SAFE) * 0.12), null);
      u.fell = 0;
      u.vy = 0;
      u.vx *= 0.4;
    }
    u.x += u.vx * DT;
    u.y += u.vy * DT;
    u.vx *= 0.92;
    // Climb out of anything it has been pushed into.
    let guard = 0;
    while (T.solid(m.mask, u.x, u.y + UNIT_R - 1) && guard++ < 24) u.y -= 1;
    u.x = Math.max(8, Math.min(T.W - 8, u.x));
    if (u.y > T.H + 40) { u.hp = 0; u.alive = false; m.events.push({ type: 'down', unit: u.idx, by: null, off: 1 }); }
  }
}

function stepMines(m) {
  for (const mine of m.mines) {
    if (mine.dead) continue;
    if (!T.supported(m.mask, mine.x, mine.y + 4, 2)) { mine.vy += GRAV * DT; mine.y += mine.vy * DT; } else mine.vy = 0;
    mine.arm = Math.max(0, mine.arm - DT);
    if (mine.trigger !== undefined) {
      mine.trigger -= DT;
      if (mine.trigger <= 0) { mine.dead = true; blast(m, mine.x, mine.y, WEAPONS.mine.r, WEAPONS.mine.dmg, mine.by); }
      continue;
    }
    if (mine.arm > 0) continue;
    // Whoever is already standing over it when it arms is let off, until
    // they walk away: a mine should not go off in its owner's face.
    if (!mine.seen) mine.seen = new Set(m.units.filter(u => u.alive && Math.hypot(u.x - mine.x, u.y - mine.y) < 34).map(u => u.idx));
    for (const u of m.units) {
      if (!u.alive) continue;
      const d = Math.hypot(u.x - mine.x, u.y - mine.y);
      if (d > 44) { mine.seen.delete(u.idx); continue; }
      if (d < 26 && !mine.seen.has(u.idx)) { mine.trigger = 0.5; m.events.push({ type: 'beep', x: mine.x, y: mine.y }); break; }
    }
  }
  m.mines = m.mines.filter(x => !x.dead);
}

const CRATE_KINDS = ['health', 'ammo', 'weapon'];
function stepCrates(m) {
  for (const c of m.crates) {
    if (c.pop) continue;
    if (!T.supported(m.mask, c.x, c.y + 8, 2)) { c.vy = Math.min(90, (c.vy || 0) + 140 * DT); c.y += c.vy * DT; } else c.vy = 0;
    for (const u of m.units) {
      if (!u.alive) continue;
      if (Math.hypot(u.x - c.x, u.y - c.y) < 22) { collect(m, u, c); c.taken = true; break; }
    }
  }
  for (const c of m.crates) {
    if (c.pop && !c.done) { c.done = true; blast(m, c.x, c.y, 52, 30, null); }
  }
  m.crates = m.crates.filter(c => !c.taken && !c.pop);
}

function collect(m, u, c) {
  const p = playerOf(m, u.owner);
  if (c.kind === 'health') u.hp = Math.min(85, u.hp + 30);
  else if (c.kind === 'ammo') { const id = c.what; if (p.ammo[id] !== Infinity) p.ammo[id] += 2; }
  else { const id = c.what; if (p.ammo[id] !== Infinity) p.ammo[id] += 1; }
  m.events.push({ type: 'crate', unit: u.idx, kind: c.kind, what: c.what });
}

function dropCrate(m) {
  const kind = CRATE_KINDS[(m.rand() * CRATE_KINDS.length) | 0];
  const pool = WEAPON_IDS.filter(id => WEAPONS[id].ammo !== Infinity);
  const what = pool[(m.rand() * pool.length) | 0];
  const x = 70 + m.rand() * (T.W - 140);
  m.crates.push({ id: ++m.crateId, x, y: 20, vy: 0, kind, what });
  m.events.push({ type: 'parachute', x: +x.toFixed(1), kind });
}

/** Whose turn is next: the next living unit of the next squad. */
function nextTurn(m) {
  const teams = [...teamsLeft(m)];
  if (teams.length <= 1) {
    m.winner = teams[0] || null;
    if (m.winner) m.wins[m.winner] = (m.wins[m.winner] || 0) + 1;
    m.phase = 'matchEnd';
    m.events.push({ type: 'matchEnd', winner: m.winner });
    return;
  }
  const cur = m.units[m.active];
  const order = m.players.map(p => p.id);
  let seat = cur ? order.indexOf(cur.owner) : -1;
  for (let step = 1; step <= order.length; step++) {
    const owner = order[(seat + step) % order.length];
    const squad = m.units.filter(u => u.alive && u.owner === owner);
    if (!squad.length) continue;
    // Each squad works through its units in turn.
    const last = m.lastUnit && m.lastUnit[owner];
    const pick = squad[(squad.findIndex(u => u.idx === last) + 1) % squad.length] || squad[0];
    (m.lastUnit ||= {})[owner] = pick.idx;
    m.active = pick.idx;
    if ((seat + step) % order.length <= seat) m.round++;
    break;
  }
  m.turn++;
  m.phase = 'aim';
  m.timer = TURN_TIME;
  const u = m.units[m.active];
  if (u) u.charge = 0;
  if (m.round >= SUDDEN_DEATH_ROUND && !m.sudden) {
    m.sudden = true;
    for (const x of m.units) if (x.alive) x.hp = Math.min(x.hp, 1);
    m.events.push({ type: 'sudden' });
  }
  if (m.settings.crates && m.crates.length < 3 && m.rand() < 0.45) dropCrate(m);
  m.events.push({ type: 'turn', unit: m.active, round: m.round });
}

/**
 * One tick. `input` is the active player's, and is ignored when it is not
 * their turn: { walk, aim, charge, fire, weapon }.
 */
export function step(m, input = {}) {
  m.tick++;
  const u = m.units[m.active];

  if (m.phase === 'aim' && u && u.alive) {
    const p = playerOf(m, u.owner);
    if (input.weapon && WEAPONS[input.weapon] && (p.ammo[input.weapon] === Infinity || p.ammo[input.weapon] > 0)) p.weapon = input.weapon;
    const walk = Math.max(-1, Math.min(1, input.walk || 0));
    if (walk) {
      u.facing = walk < 0 ? -1 : 1;
      const nx = u.x + walk * WALK * DT;
      // The whole body has to fit, not just the feet: a lip is a step up,
      // a wall or an overhang is a stop.
      let ny = null;
      for (let lift = 0; lift <= STEP_UP; lift++) {
        if (!blocked(m, nx, u.y - lift)) { ny = u.y - lift; break; }
      }
      if (ny !== null && nx > 8 && nx < T.W - 8) { u.x = nx; u.y = ny; }
    }
    if (input.aim) u.angle = Math.max(0.05, Math.min(Math.PI / 2 + 0.6, u.angle + input.aim * 1.25 * DT));
    if (input.charge) u.charge = Math.min(1, u.charge + POWER_RATE * DT);
    else if (u.charge > 0 || input.fire) { const power = Math.max(0.12, u.charge || (input.fire ? 0.6 : 0)); u.charge = 0; fire(m, u, power); }
    m.timer -= DT;
    if (m.timer <= 0) { m.phase = 'settle'; m.quiet = 0; m.events.push({ type: 'timeout' }); }
  }

  stepShots(m);
  stepUnits(m);
  stepMines(m);
  stepCrates(m);
  // Craters left by units going down, resolved after everything else.
  if (m.pending && m.pending.length) {
    const list = m.pending;
    m.pending = [];
    for (const b of list) blast(m, b.x, b.y, b.r, b.dmg, b.by);
  }

  if (m.phase === 'fly' && !m.shots.length) { m.phase = 'settle'; m.quiet = 0; }
  if (m.phase === 'settle') {
    const busy = m.shots.length || m.mines.some(x => x.trigger !== undefined)
      || m.units.some(x => x.alive && (Math.abs(x.vy) > 6 || Math.abs(x.vx) > 6));
    m.quiet = busy ? 0 : m.quiet + DT;
    if (m.quiet >= SETTLE_QUIET) nextTurn(m);
  }
}

// ── What gets drawn and sent ───────────────────────────────

const r1 = v => Math.round(v * 10) / 10;

export function view(m) {
  return {
    phase: m.phase, round: m.round, turn: m.turn, timer: m.timer, active: m.active,
    winner: m.winner, sudden: !!m.sudden, seed: m.seed,
    units: m.units.map(u => ({ idx: u.idx, owner: u.owner, seat: u.seat, name: u.name, x: r1(u.x), y: r1(u.y), hp: Math.ceil(u.hp), alive: u.alive, angle: +u.angle.toFixed(3), facing: u.facing, charge: +u.charge.toFixed(2) })),
    shots: m.shots.map(s => ({ x: r1(s.x), y: r1(s.y), w: s.w })),
    mines: m.mines.map(x => ({ x: r1(x.x), y: r1(x.y), armed: x.arm <= 0 })),
    crates: m.crates.map(c => ({ id: c.id, x: r1(c.x), y: r1(c.y), kind: c.kind, air: !T.supported(m.mask, c.x, c.y + 8, 2) })),
    players: m.players.map(p => ({ id: p.id, name: p.name, colour: p.colour, weapon: p.weapon, ammo: p.ammo })),
  };
}

export function snapshot(m) {
  const v = view(m);
  v.k = m.tick;
  return v;
}

export function unpackSnap(s) { return s; }

export { WEAPONS, WEAPON_IDS, T };
