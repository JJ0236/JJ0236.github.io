// Bot drivers. They pick a target, line up and ram it; once their engine is
// hurt they turn round and ram in reverse, as a real derby driver would.
// They steer clear of edges, holes and a crusher about to come down.

import * as A from './arena.js?v=4';
import { rotate } from './sim.js?v=4';

const LEVELS = {
  easy: { throttle: 0.72, aim: 1.6, lead: 0, boost: false, react: 0.9, careful: 0.6 },
  normal: { throttle: 0.9, aim: 2.4, lead: 0.35, boost: true, react: 0.45, careful: 1 },
  hard: { throttle: 1, aim: 3.2, lead: 0.7, boost: true, react: 0.2, careful: 1.2 },
};

export function makeBrain(level = 'normal', seed = Math.random()) {
  return { L: LEVELS[level] || LEVELS.normal, target: null, retarget: 0, stuck: 0, backup: 0, flip: 0, wobble: seed * 10, mood: seed };
}

const angleTo = (fx, fz, dx, dz) => Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** m: the match (host side). Returns one tick of input. */
export function botInput(m, car, brain, dt) {
  const inp = { t: 0, s: 0, hb: 0, b: 0, f: 0 };
  if (car.out || m.phase === 'countdown') return inp;
  const L = brain.L;
  const p = car.body.translation();
  const q = car.body.rotation();
  const f = rotate(q, [1, 0, 0]);
  const up = rotate(q, [0, 1, 0]);
  const fl = Math.hypot(f[0], f[2]) || 1;
  const fx = f[0] / fl, fz = f[2] / fl;
  const speed = car.vc.currentVehicleSpeed();
  brain.wobble += dt;

  // On the roof: flip.
  if (up[1] < 0.3) { brain.flip += dt; if (brain.flip > 1) { inp.f = 1; brain.flip = 0; } return inp; }
  brain.flip = 0;

  // Pick a target now and then: close, and weak ones are tempting.
  brain.retarget -= dt;
  const others = m.cars.filter(c => c !== car && !c.out);
  if (!others.length) return inp;
  let target = others.find(c => c.id === brain.target);
  if (brain.retarget <= 0 || !target) {
    brain.retarget = 2 + brain.mood * 2;
    let best = null, bestScore = Infinity;
    for (const o of others) {
      const op = o.body.translation();
      const d = Math.hypot(op.x - p.x, op.z - p.z);
      const score = d * (0.6 + o.engine / 250) * (0.8 + ((brain.mood * 7 + o.idx) % 1) * 0.4);
      if (score < bestScore) { bestScore = score; best = o; }
    }
    brain.target = best.id;
    target = best;
  }

  // A pickup close by is worth a detour, repairs most of all when hurt.
  let goal = null;
  for (const pk of m.pickups) {
    const d = Math.hypot(pk.x - p.x, pk.z - p.z);
    const want = pk.kind === 'repair' ? (car.engine < 70 ? 30 : 0) : 14;
    if (d < want) { goal = { x: pk.x, z: pk.z, pickup: true }; break; }
  }
  if (!goal) {
    const t = target;
    const tp = t.body.translation(), tv = t.body.linvel();
    const d = Math.hypot(tp.x - p.x, tp.z - p.z);
    const lead = L.lead * Math.min(1.2, d / 18);
    goal = { x: tp.x + tv.x * lead, z: tp.z + tv.z * lead, d };
  }

  let dx = goal.x - p.x, dz = goal.z - p.z;
  const dist = Math.hypot(dx, dz) || 1;
  dx /= dist; dz /= dist;

  // Hurt engine: back into them instead.
  const reverse = !goal.pickup && car.engine < 48 && L.careful >= 1 && dist < 40;
  if (reverse) {
    const a = angleTo(-fx, -fz, dx, dz);
    inp.t = -L.throttle;
    inp.s = clamp(-a * L.aim, -1, 1);
    if (Math.abs(a) > 1.8 && dist > 8) {
      // Facing them: swing round first.
      inp.t = L.throttle * 0.7;
      inp.s = clamp(angleTo(fx, fz, -dx, -dz) * L.aim, -1, 1);
    }
  } else {
    const a = angleTo(fx, fz, dx, dz);
    inp.t = L.throttle;
    inp.s = clamp(a * L.aim + Math.sin(brain.wobble * 1.3) * 0.08, -1, 1);
    if (Math.abs(a) > 1.6 && dist < 12) { inp.t = -0.8; inp.s = -inp.s; }
    if (L.boost && Math.abs(a) < 0.15 && dist > 8 && dist < 32 && car.boost > 0.3) inp.b = 1;
    if (Math.abs(a) > 1.1 && Math.abs(speed) > 12) inp.hb = 1;
  }

  // Stay on the floor: look ahead along the way we are moving.
  const dir = Math.sign(inp.t || 1);
  const look = 5 + Math.abs(speed) * 0.55 * L.careful;
  const ax = p.x + fx * look * dir, az = p.z + fz * look * dir;
  const cracking = A.crumbleRing(m.t).cracking;
  const edgeRing = Math.max(m.fallen + 1, cracking >= 0 ? cracking + 1 : 0);
  const cellRing = A.ringOf(A.cellOf(ax), A.cellOf(az));
  const danger = !A.cellAlive(m.cells, ax, az) || (cellRing < edgeRing);
  if (danger) {
    // Steer for the middle and ease off.
    const a = angleTo(fx * dir, fz * dir, -p.x, -p.z);
    inp.s = clamp(a * 3 * dir, -1, 1);
    inp.t = dir * (Math.abs(speed) > 9 ? -0.6 : 0.4);
    inp.b = 0;
  }

  // Crushers: do not be under one when it comes down.
  for (const c of A.CRUSHERS) {
    const st = A.crusherState(c.k, m.t);
    const soon = st.phase === 'warn' || st.phase === 'slam' || st.phase === 'hold' || (st.phase === 'idle' && A.crusherState(c.k, m.t + 1.2).phase !== 'idle');
    if (!soon) continue;
    const inX = Math.abs(ax - c.x) < A.PLATE.half + 1.5 && Math.abs(az - c.z) < A.PLATE.half + 1.5;
    const under = Math.abs(p.x - c.x) < A.PLATE.half + 1 && Math.abs(p.z - c.z) < A.PLATE.half + 1;
    if (under) { inp.t = dir; inp.b = car.boost > 0.1 ? 1 : 0; }
    else if (inX && L.careful >= 1) { inp.t = -dir * 0.5; }
  }

  // Stuck against something: back off for a moment.
  if (Math.abs(speed) < 0.8 && Math.abs(inp.t) > 0.5) brain.stuck += dt; else brain.stuck = Math.max(0, brain.stuck - dt);
  if (brain.stuck > 1.4) { brain.backup = 0.9; brain.stuck = 0; brain.backDir = -Math.sign(inp.t); }
  if (brain.backup > 0) {
    brain.backup -= dt;
    inp.t = brain.backDir || -1;
    inp.s = -inp.s;
    inp.b = 0;
    if (brain.backup <= 0 && Math.abs(speed) < 0.5) inp.f = 1;
  }
  return inp;
}
