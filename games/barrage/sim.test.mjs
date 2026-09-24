// node --test games/barrage/sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step, view, snapshot, fire, DT, TURN_TIME, playerOf, rng } from './sim.js?v=1';
import { makeBrain, botInput } from './bots.js?v=1';
import { WEAPONS } from './weapons.js?v=1';
import * as T from './terrain.js?v=1';

const twoPlayers = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];

function match(settings = {}, seed = 5) {
  const m = createMatch({ crates: false, ...settings }, twoPlayers, seed);
  m.events.length = 0;
  return m;
}

function run(m, ticks, input = {}, stop) {
  const events = [];
  for (let i = 0; i < ticks; i++) {
    step(m, typeof input === 'function' ? input(i) : input);
    events.push(...m.events);
    m.events.length = 0;
    if (stop && stop(events, m)) break;
  }
  return events;
}

/** Put a unit somewhere flat and known. */
function place(m, idx, x) {
  const u = m.units[idx];
  u.x = x;
  u.y = T.groundBelow(m.mask, x, 0) - 9;
  u.vx = u.vy = 0;
  return u;
}

test('the ground is solid under the hills and open above them', () => {
  const { mask, top } = T.generate(rng(11));
  assert.equal(mask.length, T.W * T.H);
  for (const x of [50, 400, 900, 1550]) {
    const y = top[x] | 0;
    assert.ok(!T.solid(mask, x, y - 12), `open above the line at ${x}`);
    // The surface sits where the skyline says, give or take a pixel.
    assert.ok(Math.abs(T.groundBelow(mask, x, 0) - y) <= 2, `the surface is at the line at ${x}`);
  }
  assert.ok(T.solid(mask, 800, T.H - 5), 'the world has a floor');
});

test('an explosion leaves a hole that the ground remembers', () => {
  const { mask } = T.generate(rng(3));
  const x = 800, y = T.groundBelow(mask, x, 0) + 30;
  assert.ok(T.solid(mask, x, y));
  const gone = T.carve(mask, x, y, 40);
  assert.ok(gone > 1000, `it took a bite out (${gone} pixels)`);
  assert.ok(!T.solid(mask, x, y), 'the middle is air now');
  assert.ok(T.solid(mask, x + 60, y), 'and the edges are untouched');
});

test('a shell flies, lands, and hurts whoever is near it', () => {
  const m = match();
  const target = place(m, 3, 900);
  const shooter = place(m, 0, 300);
  m.active = 0;
  // Drop one straight onto the target.
  m.shots.push({ x: target.x, y: target.y - 200, vx: 0, vy: 60, w: 'shell', by: 'a', from: 0, life: 8 });
  m.phase = 'fly';
  const ev = run(m, 240, {}, e => e.some(x => x.type === 'boom'));
  assert.ok(ev.some(e => e.type === 'boom'), 'it went off');
  assert.ok(target.hp < 85, `the target was hurt (${target.hp})`);
  assert.equal(shooter.hp, 85, 'the one that fired it was not');
});

test('damage falls off with distance', () => {
  const near = match(), far = match();
  const a = place(near, 3, 900);
  const b = place(far, 3, 900);
  near.shots.push({ x: a.x + 6, y: a.y, vx: 0, vy: 40, w: 'shell', by: 'a', from: 0, life: 8 });
  far.shots.push({ x: b.x + 44, y: b.y, vx: 0, vy: 40, w: 'shell', by: 'a', from: 0, life: 8 });
  near.phase = far.phase = 'fly';
  run(near, 120, {}, e => e.some(x => x.type === 'boom'));
  run(far, 120, {}, e => e.some(x => x.type === 'boom'));
  assert.ok(85 - a.hp > 85 - b.hp, `closer hurts more (${85 - a.hp} vs ${85 - b.hp})`);
});

test('a turn passes when the clock runs out, to the next squad', () => {
  const m = match();
  const first = m.units[m.active].owner;
  const ev = run(m, 60 * (TURN_TIME + 4), {}, e => e.some(x => x.type === 'turn'));
  assert.ok(ev.some(e => e.type === 'timeout'), 'the clock ran out');
  assert.notEqual(m.units[m.active].owner, first, 'it is the other squad now');
});

/** A stretch of flat ground with nobody standing on it. */
function flatSpot(m, from = 200) {
  for (let x = from; x < T.W - 150; x += 5) {
    const y = T.groundBelow(m.mask, x, 0);
    if (y > T.H - 60) continue;
    let flat = true;
    for (let d = -26; d <= 26; d += 4) if (Math.abs(T.groundBelow(m.mask, x + d, 0) - y) > 7) { flat = false; break; }
    if (flat && !m.units.some(u => Math.abs(u.x - x) < 80)) return x;
  }
  throw new Error('no flat ground on this map');
}

test('walking goes up a small lip but not a wall', () => {
  const m = match();
  const u = place(m, m.active, flatSpot(m));
  // A wall right next to it: walking that way gets nowhere.
  for (let dy = 0; dy < 40; dy++) for (let dx = 0; dx < 6; dx++) m.mask[(((u.y | 0) - dy) * T.W) + ((u.x | 0) + 12 + dx)] = 1;
  const x0 = u.x;
  run(m, 60, { walk: 1 });
  assert.ok(u.x - x0 < 8, `the wall stopped it (moved ${(u.x - x0).toFixed(1)})`);
  const x1 = u.x;
  run(m, 60, { walk: -1 });
  assert.ok(x1 - u.x > 20, 'but it walks the other way');
});

test('every weapon does what it says', () => {
  // Cluster splits into bomblets.
  let m = match();
  m.shots.push({ x: 800, y: 200, vx: 0, vy: -10, w: 'cluster', by: 'a', from: 0, life: 8, split: false });
  m.phase = 'fly';
  let ev = run(m, 240, {}, e => e.some(x => x.type === 'split'));
  assert.ok(ev.some(e => e.type === 'split'), 'the cluster split');
  assert.ok(m.shots.length >= WEAPONS.cluster.split - 1, 'into bomblets');

  // The digger goes into the ground before it goes off.
  m = match();
  const dx = flatSpot(m);
  const surface = T.groundBelow(m.mask, dx, 0);
  m.shots.push({ x: dx, y: surface - 40, vx: 0, vy: 320, w: 'digger', by: 'a', from: 0, life: 8 });
  m.phase = 'fly';
  ev = run(m, 240, {}, e => e.some(x => x.type === 'boom'));
  const boom = ev.find(e => e.type === 'boom');
  assert.ok(boom.y > surface + 20, `it went off underground (${Math.round(boom.y - surface)} px down)`);

  // The airstrike drops a line of bombs.
  m = match();
  const sx = flatSpot(m);
  m.shots.push({ x: sx, y: T.groundBelow(m.mask, sx, 0) - 20, vx: 0, vy: 200, w: 'strike', by: 'a', from: 0, life: 8 });
  m.phase = 'fly';
  ev = run(m, 60, {}, e => e.some(x => x.type === 'strike'));
  assert.ok(ev.some(e => e.type === 'strike'));
  assert.equal(m.shots.length, WEAPONS.strike.bombs);

  // A mine waits, then goes off when someone walks past.
  m = match();
  const u = place(m, m.active, flatSpot(m));
  playerOf(m, u.owner).weapon = 'mine';
  fire(m, u, 0.5);
  assert.equal(m.mines.length, 1);
  run(m, 120);
  const victim = place(m, 3, m.mines[0].x + 12);
  ev = run(m, 240, {}, e => e.some(x => x.type === 'boom'));
  assert.ok(ev.some(e => e.type === 'boom'), 'the mine went off');
  assert.ok(victim.hp < 85, 'and caught whoever stepped near it');

  // Teleport moves the unit to where the marker lands.
  m = match();
  const hopper = place(m, m.active, 300);
  m.shots.push({ x: 1200, y: 100, vx: 0, vy: 200, w: 'hop', by: hopper.owner, from: hopper.idx, life: 8 });
  m.phase = 'fly';
  run(m, 240, {}, e => e.some(x => x.type === 'hop'));
  assert.ok(Math.abs(hopper.x - 1200) < 40, `it moved (now at ${Math.round(hopper.x)})`);
});

test('a crate can be walked into, or shot', () => {
  const m = match({ crates: true });
  const u = place(m, m.active, flatSpot(m));
  u.hp = 40;
  m.crates.push({ id: 1, x: u.x + 10, y: u.y, vy: 0, kind: 'health', what: 'shell' });
  const ev = run(m, 90, { walk: 1 }, e => e.some(x => x.type === 'crate'));
  assert.ok(ev.some(e => e.type === 'crate'), 'picked up');
  assert.ok(u.hp > 40, 'and it helped');

  const m2 = match({ crates: true });
  const near = place(m2, 3, flatSpot(m2));
  m2.crates.push({ id: 1, x: near.x + 30, y: near.y, vy: 0, kind: 'ammo', what: 'mortar' });
  m2.shots.push({ x: near.x + 30, y: near.y - 60, vx: 0, vy: 200, w: 'shell', by: 'a', from: 0, life: 8 });
  m2.phase = 'fly';
  run(m2, 240, {}, (e, mm) => mm.crates.length === 0);
  assert.equal(m2.crates.length, 0, 'the crate went up');
  assert.ok(near.hp < 85, 'and caught whoever was beside it');
});

test('a match ends when one squad is the only one left', () => {
  const m = match();
  for (const u of m.units) if (u.owner === 'b') { u.alive = false; u.hp = 0; }
  const ev = run(m, 60 * 40, {}, e => e.some(x => x.type === 'matchEnd'));
  assert.ok(ev.some(e => e.type === 'matchEnd'));
  assert.equal(m.winner, 'a');
  assert.equal(m.wins.a, 1);
});

test('bots play a whole match on their own', () => {
  const players = [{ id: 'a', name: 'A', bot: true }, { id: 'b', name: 'B', bot: true }];
  const m = createMatch({ crates: true }, players, 9);
  const brains = { a: makeBrain('hard', 0.1), b: makeBrain('normal', 0.6) };
  const seen = new Set();
  for (let i = 0; i < 60 * 60 * 12 && m.phase !== 'matchEnd'; i++) {
    const u = m.units[m.active];
    step(m, u ? botInput(m, brains[u.owner], DT) : {});
    for (const e of m.events) seen.add(e.type);
    m.events.length = 0;
  }
  assert.equal(m.phase, 'matchEnd');
  for (const t of ['fire', 'boom', 'hurt', 'down', 'turn']) assert.ok(seen.has(t), `saw ${t}`);
  assert.ok(m.winner, 'somebody won');
});

test('a snapshot carries what a guest needs to draw', () => {
  const m = match();
  run(m, 30);
  const s = JSON.parse(JSON.stringify(snapshot(m)));
  assert.equal(s.units.length, 6);
  assert.ok(s.players.every(p => p.ammo && p.weapon));
  assert.equal(typeof s.active, 'number');
  assert.equal(typeof s.timer, 'number');
  // The map itself is not sent: a guest grows it from the seed.
  assert.equal(s.mask, undefined);
  const mine = view(m);
  assert.equal(mine.units[0].x, s.units[0].x);
});
