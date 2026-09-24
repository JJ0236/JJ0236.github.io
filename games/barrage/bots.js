// Bot gunners. A bot works out its shot the way a person does: it tries
// shots in its head against the real ground, keeps the best one, and then
// misses it by however much its skill allows.

import * as T from './terrain.js?v=1';
import { WEAPONS } from './weapons.js?v=1';
import { DT, playerOf } from './sim.js?v=1';

const LEVELS = {
  easy: { think: 1.6, angles: 9, powers: 6, err: 0.1, powErr: 0.14, specials: 0.2 },
  normal: { think: 1.2, angles: 15, powers: 9, err: 0.045, powErr: 0.07, specials: 0.5 },
  hard: { think: 0.8, angles: 23, powers: 13, err: 0.015, powErr: 0.025, specials: 0.8 },
};

export function makeBrain(level = 'normal', seed = Math.random()) {
  return { L: LEVELS[level] || LEVELS.normal, think: 0, plan: null, mood: seed };
}

/** Fly a shot and report where it lands and what it would be worth. */
function trial(m, unit, angle, power, weaponId) {
  const w = WEAPONS[weaponId];
  const speed = 210 + power * 590;
  let x = unit.x + Math.cos(angle) * unit.facing * 14;
  let y = unit.y - Math.sin(angle) * 14;
  let vx = Math.cos(angle) * speed * unit.facing;
  let vy = -Math.abs(Math.sin(angle)) * speed;
  const g = 340 * (w.gravity || 1);
  for (let i = 0; i < 1400; i++) {
    vy += g * DT;
    x += vx * DT;
    y += vy * DT;
    if (x < -40 || x > T.W + 40 || y > T.H + 60) return null;
    if (y > 0 && T.solid(m.mask, x, y)) break;
    let onUnit = false;
    for (const u of m.units) {
      if (!u.alive || u.idx === unit.idx) continue;
      if (Math.hypot(u.x - x, u.y - y) < 12) { onUnit = true; break; }
    }
    if (onUnit) break;
  }
  // What it would be worth: their health off, minus ours.
  let score = 0;
  for (const u of m.units) {
    if (!u.alive) continue;
    const d = Math.hypot(u.x - x, u.y - y);
    if (d > w.r + 9) continue;
    const dmg = w.dmg * Math.max(0, 1 - d / (w.r + 9));
    const mine = u.owner === unit.owner;
    score += mine ? -dmg * (u.idx === unit.idx ? 2.2 : 1.4) : dmg;
  }
  return { x, y, score };
}

/** Pick the best shot this bot can see. */
function plan(m, unit, brain) {
  const L = brain.L;
  const p = playerOf(m, unit.owner);
  const choices = ['shell'];
  // Now and then reach for something better, if there is any left.
  for (const id of ['mortar', 'cluster', 'big', 'digger', 'strike']) {
    if (p.ammo[id] > 0 && Math.random() < L.specials) choices.push(id);
  }
  let best = null;
  for (const weaponId of choices) {
    for (let a = 0; a < L.angles; a++) {
      const angle = 0.12 + (a / (L.angles - 1)) * 1.42;
      for (let q = 0; q < L.powers; q++) {
        const power = 0.28 + (q / (L.powers - 1)) * 0.72;
        for (const facing of [1, -1]) {
          const t = trial(m, { ...unit, facing }, angle, power, weaponId);
          if (!t || t.score <= 0) continue;
          if (!best || t.score > best.score) best = { angle, power, facing, weaponId, score: t.score };
        }
      }
    }
  }
  if (!best) {
    // Nothing on: lob one at the nearest enemy and hope.
    const foe = m.units.filter(u => u.alive && u.owner !== unit.owner).sort((a, b) => Math.abs(a.x - unit.x) - Math.abs(b.x - unit.x))[0];
    const far = foe ? Math.min(1, Math.abs(foe.x - unit.x) / 900) : 0.6;
    best = { angle: 0.8, power: 0.35 + far * 0.5, facing: foe && foe.x < unit.x ? -1 : 1, weaponId: 'shell', score: 0 };
  }
  // Miss by however much this bot misses by.
  best.angle += (Math.random() - 0.5) * 2 * brain.L.err;
  best.power = Math.max(0.12, Math.min(1, best.power + (Math.random() - 0.5) * 2 * brain.L.powErr));
  return best;
}

/** One tick of a bot's turn. */
export function botInput(m, brain, dt = DT) {
  const u = m.units[m.active];
  const inp = { walk: 0, aim: 0, charge: 0, fire: 0, weapon: null };
  if (!u || !u.alive || m.phase !== 'aim') { brain.plan = null; brain.think = 0; return inp; }
  brain.think += dt;
  if (!brain.plan) {
    if (brain.think < brain.L.think * 0.5) return inp;          // a pause, as if thinking
    brain.plan = plan(m, u, brain);
    brain.charge = 0;
  }
  const p = brain.plan;
  inp.weapon = p.weaponId;
  // Turn to face, then bring the barrel round, then wind it up.
  if (u.facing !== p.facing) { inp.walk = p.facing; return inp; }
  const off = p.angle - u.angle;
  if (Math.abs(off) > 0.02) { inp.aim = Math.sign(off); return inp; }
  brain.charge += dt * 0.85;
  if (brain.charge < p.power) inp.charge = 1;
  else { inp.charge = 0; inp.fire = 1; brain.plan = null; brain.think = 0; }
  return inp;
}
