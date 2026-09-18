// Computer tanks. A bot reads the same game state a player sees and returns
// the same input a player would send, so the rules treat it identically.

import { COLS, ROWS, FLOOR, WALL, CRATE } from './maps.js?v=3';
import { TILE, TANK_R, wrap, tileAt, teamOf } from './sim.js?v=3';

const LEVELS = {
  easy:   { err: 0.3,  react: 0.95, gap: 1.1,  dodge: 0.1,  lead: 0 },
  normal: { err: 0.14, react: 0.5,  gap: 0.65, dodge: 0.45, lead: 0.6 },
  hard:   { err: 0.05, react: 0.22, gap: 0.35, dodge: 0.8,  lead: 1 },
};

export function makeBrain(level = 'normal') {
  return {
    lv: LEVELS[level] || LEVELS.normal,
    fs: 0, seen: 0, nextShot: 0, errA: 0, errT: 0,
    dodge: 0, dodgeInp: null, judged: new Set(),
    stuckT: 0, lastX: 0, lastY: 0, reverse: 0,
    prev: {}, field: null, fieldKey: '',
  };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Is the straight line between two points clear of walls and crates? */
export function lineClear(grid, ax, ay, bx, by, pad = 0) {
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.ceil(d / 8);
  for (let i = 1; i < n; i++) {
    const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
    if (tileAt(grid, x, y) !== FLOOR) return false;
    if (pad) {
      const nx = -(by - ay) / d * pad, ny = (bx - ax) / d * pad;
      if (tileAt(grid, x + nx, y + ny) !== FLOOR || tileAt(grid, x - nx, y - ny) !== FLOOR) return false;
    }
  }
  return true;
}

/** Distance field to a goal tile. Crates are passable but cost extra: a bot
 *  will shoot its way through rather than give up. */
function field(grid, goal) {
  const cost = new Float32Array(COLS * ROWS).fill(Infinity);
  cost[goal] = 0;
  const open = [goal];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (cost[open[i]] < cost[open[bi]]) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    const c = cur % COLS, r = (cur - c) / COLS;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const ni = nr * COLS + nc;
      const t = grid[ni];
      if (t === WALL) continue;
      const nd = cost[cur] + (t === CRATE ? 4 : 1);
      if (nd < cost[ni]) { cost[ni] = nd; open.push(ni); }
    }
  }
  return cost;
}

function steerTo(t, x, y, out) {
  const want = Math.atan2(y - t.y, x - t.x);
  let diff = wrap(want - t.a);
  // Reversing is quicker than a full about-turn.
  let dir = 1;
  if (Math.abs(diff) > 2.2) { dir = -1; diff = wrap(diff + Math.PI); }
  out.tu = Math.max(-1, Math.min(1, diff * 3));
  out.th = Math.abs(diff) < 0.45 ? dir : Math.abs(diff) < 1 ? dir * 0.35 : 0;
}

export function botInput(g, t, brain, dt) {
  const lv = brain.lv;
  const out = { th: 0, tu: 0, ax: t.x + Math.cos(t.ta) * 100, ay: t.y + Math.sin(t.ta) * 100, fs: brain.fs };
  const velOf = o => {
    const p = brain.prev[o.id];
    return p ? { vx: (o.x - p.x) / dt, vy: (o.y - p.y) / dt } : { vx: 0, vy: 0 };
  };
  const remember = () => { for (const o of g.tanks) brain.prev[o.id] = { x: o.x, y: o.y }; };

  if (!t.alive || (g.phase !== 'play' && g.phase !== 'ending' && g.phase !== 'countdown')) { remember(); return out; }

  const teams = g.settings.mode === 'teams';
  const myTeam = teamOf(g, t.id);
  const enemies = g.tanks.filter(o => o.alive && o.id !== t.id && !(teams && teamOf(g, o.id) === myTeam));
  let target = null;
  for (const e of enemies) {
    // A cloaked tank is only noticed up close.
    if (e.buffs.invis > 0 && dist(e, t) > 110) continue;
    if (!target || dist(e, t) < dist(target, t)) target = e;
  }

  if (g.phase === 'countdown') {
    if (target) { out.ax = target.x; out.ay = target.y; }
    remember();
    return out;
  }

  // ── Dodge anything on a collision course ──
  if (brain.dodge > 0) {
    brain.dodge -= dt;
    Object.assign(out, brain.dodgeInp);
  } else {
    for (const s of g.shells) {
      if (s.owner === t.id && s.age < 0.3) continue;
      const px = t.x - s.x, py = t.y - s.y;
      const v2 = s.vx * s.vx + s.vy * s.vy;
      const tca = (px * s.vx + py * s.vy) / v2;
      if (tca < 0 || tca > 0.8) continue;
      const cx = s.x + s.vx * tca - t.x, cy = s.y + s.vy * tca - t.y;
      if (Math.hypot(cx, cy) > TANK_R + s.r + 8) continue;
      // Each shell gets one roll against the bot's reflexes.
      if (brain.judged.has(s.id)) continue;
      brain.judged.add(s.id);
      if (Math.random() > lv.dodge) continue;
      let ax = -cx, ay = -cy;
      const m = Math.hypot(ax, ay);
      if (m < 1) { ax = -s.vy; ay = s.vx; } // dead centre: sidestep
      const inp = {};
      steerTo(t, t.x + ax * 5, t.y + ay * 5, inp);
      inp.th = Math.sign(inp.th || 1);
      brain.dodge = 0.35;
      brain.dodgeInp = inp;
      Object.assign(out, inp);
      if (t.weapon === 'teleport') {
        // Blink somewhere across the map.
        out.ax = t.x + ax * 20; out.ay = t.y + ay * 20;
        out.fs = ++brain.fs;
      }
      break;
    }
    if (brain.judged.size > 200) brain.judged.clear();
  }

  // Unstick: if the tracks are turning but the tank is not going anywhere.
  if (brain.reverse > 0) {
    brain.reverse -= dt;
    out.th = -1; out.tu = 0.7;
  }

  if (!target) { remember(); return out; }

  const d = dist(t, target);
  const sees = lineClear(g.grid, t.x, t.y, target.x, target.y, 3);

  // ── Aim and shoot ──
  brain.errT -= dt;
  if (brain.errT <= 0) { brain.errA = (Math.random() - 0.5) * 2 * lv.err; brain.errT = 0.6; }
  const tv = velOf(target);
  const lead = (d / 250) * lv.lead;
  let aimX = target.x + tv.vx * lead, aimY = target.y + tv.vy * lead;
  const ang = Math.atan2(aimY - t.y, aimX - t.x) + brain.errA;
  out.ax = t.x + Math.cos(ang) * d;
  out.ay = t.y + Math.sin(ang) * d;

  brain.nextShot -= dt;
  const w = t.weapon;
  let shoot = false;
  if (sees) {
    brain.seen += dt;
    const aligned = Math.abs(wrap(t.ta - ang)) < 0.12;
    if (brain.seen > lv.react && brain.nextShot <= 0 && aligned) {
      if (w === 'shotgun') shoot = d < 200;
      else if (w === 'mines') shoot = false;
      else if (w === 'teleport') shoot = false;
      else shoot = true;
    }
  } else {
    brain.seen = 0;
    if (w === 'homing' && d < 420 && brain.nextShot <= 0) shoot = true;
  }
  if (w === 'mines' && d < TILE * 5 && brain.nextShot <= 0 && Math.random() < 0.02) shoot = true;
  if (shoot) {
    out.fs = ++brain.fs;
    brain.nextShot = lv.gap * (0.7 + Math.random() * 0.6);
  }

  // ── Move ──
  if (brain.dodge > 0 || brain.reverse > 0) { trackStuck(brain, t, out, dt); remember(); return out; }

  // Go for a power-up if one is close and the hands are empty.
  let goal = target;
  if (!w) {
    for (const p of g.pickups) {
      if (dist(p, t) < TILE * 4.5 && dist(p, t) < d) { goal = p; break; }
    }
  }

  const keepAway = sees && goal === target && d < 150;
  const holdGround = sees && goal === target && d < 260 && !keepAway;
  if (keepAway) {
    steerTo(t, t.x - (target.x - t.x), t.y - (target.y - t.y), out);
  } else if (holdGround) {
    // Stand and turn the hull a little so it is not a sitting duck.
    out.tu = Math.sin(g.tick / 40 + t.id.length) * 0.6;
    out.th = 0;
  } else {
    const gc = Math.floor(goal.x / TILE), gr = Math.floor(goal.y / TILE);
    const key = gr * COLS + gc + ':' + g.destroyed.length + ':' + g.map.seed;
    if (key !== brain.fieldKey) { brain.field = field(g.grid, gr * COLS + gc); brain.fieldKey = key; }
    const f = brain.field;
    const c = Math.floor(t.x / TILE), r = Math.floor(t.y / TILE);
    let best = r * COLS + c, bestCost = f[best];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = (r + dr) * COLS + c + dc;
      if (f[ni] < bestCost) { bestCost = f[ni]; best = ni; }
    }
    const bc = best % COLS, br = (best - bc) / COLS;
    const wx = (bc + 0.5) * TILE, wy = (br + 0.5) * TILE;
    if (g.grid[best] === CRATE) {
      // A crate in the way: shoot it.
      out.ax = wx; out.ay = wy;
      if (Math.abs(wrap(t.ta - Math.atan2(wy - t.y, wx - t.x))) < 0.2 && brain.nextShot <= 0) {
        out.fs = ++brain.fs;
        brain.nextShot = lv.gap;
      }
      steerTo(t, wx, wy, out);
      out.th = 0;
    } else if (best === r * COLS + c) {
      steerTo(t, goal.x, goal.y, out);
    } else {
      steerTo(t, wx, wy, out);
    }
  }

  trackStuck(brain, t, out, dt);
  remember();
  return out;
}

function trackStuck(brain, t, out, dt) {
  const moved = Math.hypot(t.x - brain.lastX, t.y - brain.lastY);
  if (Math.abs(out.th) > 0.3 && moved < 0.3) brain.stuckT += dt; else brain.stuckT = 0;
  brain.lastX = t.x; brain.lastY = t.y;
  if (brain.stuckT > 0.6) { brain.reverse = 0.4; brain.stuckT = 0; }
}
