// RAPIER=/path/to/@dimforge/rapier3d-compat/rapier.mjs node --test games/derby/sim.test.mjs
// (Rapier is loaded from a CDN in the page; the tests need a local copy.)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMatch, step, snapshot, unpackSnap, view, DT, yawQuat, rotate,
  createMirror, mirrorStep, mirrorCorrect, unpackCar, packCar,
} from './sim.js?v=3';
import { makeBrain, botInput } from './bots.js?v=3';
import * as A from './arena.js?v=3';
import { PART_IDS } from './cars.js?v=3';

const mod = await import(process.env.RAPIER || '@dimforge/rapier3d-compat');
const R = mod.default || mod;
await R.init();

const IDLE = { t: 0, s: 0, hb: 0, b: 0, f: 0 };

/** A match with the countdown skipped and no hazards, unless asked. */
function match(classes, settings = {}) {
  const players = classes.map((cls, i) => ({ id: 'p' + i, name: 'P' + i, cls }));
  const m = createMatch(R, { hazards: false, pickups: false, ...settings }, players, 11);
  m.phase = 'play';
  m.t = 0;
  return m;
}

function place(car, x, z, yaw, speed = 0) {
  const y = A.heightAt(x, z) + car.C.wheel.r + car.C.wheel.rest + car.C.H / 2;
  car.body.setTranslation({ x, y, z }, true);
  car.body.setRotation(yawQuat(yaw), true);
  const f = rotate(yawQuat(yaw), [1, 0, 0]);
  car.body.setLinvel({ x: f[0] * speed, y: 0, z: f[2] * speed }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function run(m, ticks, inputs = {}, stop) {
  const events = [];
  for (let i = 0; i < ticks; i++) {
    step(m, typeof inputs === 'function' ? inputs(i) : inputs);
    events.push(...m.events);
    m.events.length = 0;
    if (stop && stop(events)) break;
  }
  return events;
}

// Yaw angles: +x is 0; a car at yaw a points along (cos a, -sin a).
const FACE_X = 0, FACE_NEG_X = Math.PI, FACE_Z = -Math.PI / 2;

test('a car drives forward and steers', () => {
  const m = match(['sedan', 'sedan']);
  const [a, b] = m.cars;
  place(a, -20, 0, FACE_X);
  place(b, 40, 40, FACE_X);
  run(m, 30, {});
  const x0 = a.body.translation().x;
  run(m, 120, { p0: { t: 1, s: 0 } });
  const p = a.body.translation();
  assert.ok(p.x - x0 > 8, `moved forward ${p.x - x0}`);
  assert.ok(Math.abs(p.z) < 1, 'kept straight');
  run(m, 90, { p0: { t: 1, s: 1 } });
  const f = rotate(a.body.rotation(), [1, 0, 0]);
  assert.ok(f[2] > 0.4, `steering right turns toward +z (${f[2].toFixed(2)})`);
});

test('a T-bone wears the door and hurts the engine less than a head-on', () => {
  // Side hit: the rammed car loses its door.
  let m = match(['sedan', 'sedan']);
  let [a, b] = m.cars;
  place(a, -12, 0, FACE_X, 17);
  place(b, 0, 0, FACE_Z);           // side-on, left flank toward a
  const ev = run(m, 90, { p0: { t: 1 } });
  assert.ok(ev.some(e => e.type === 'hit' && e.c === 1), 'b was hit');
  const side = ev.find(e => e.type === 'hit' && e.c === 1).zone;
  assert.ok(side === 'left' || side === 'right', `zone ${side}`);
  const door = Math.min(b.parts.doorL, b.parts.doorR);
  assert.ok(door < 100, `door wore to ${door}`);
  const tboneEngine = 100 - b.engine;

  // Head-on at the same speed.
  m = match(['sedan', 'sedan']);
  [a, b] = m.cars;
  place(a, -12, 0, FACE_X, 17);
  place(b, 0, 0, FACE_NEG_X);
  run(m, 90, { p0: { t: 1 } });
  const headEngine = 100 - b.engine;
  assert.ok(headEngine > tboneEngine, `head-on ${headEngine.toFixed(1)} > T-bone ${tboneEngine.toFixed(1)}`);
});

test('ramming in reverse spares your own engine', () => {
  const nose = match(['sedan', 'sedan']);
  place(nose.cars[0], -12, 0, FACE_X, 16);
  place(nose.cars[1], 0, 0, FACE_Z);
  run(nose, 90, { p0: { t: 1 } });
  const tail = match(['sedan', 'sedan']);
  place(tail.cars[0], -12, 0, FACE_NEG_X, -16);
  place(tail.cars[1], 0, 0, FACE_Z);
  run(tail, 90, { p0: { t: -1 } });
  const lostNose = 100 - nose.cars[0].engine, lostTail = 100 - tail.cars[0].engine;
  assert.ok(lostNose > lostTail * 2, `nose-first lost ${lostNose.toFixed(1)}, tail-first ${lostTail.toFixed(1)}`);
});

test('parts come off, and a dead engine wrecks the car', () => {
  const m = match(['compact', 'bus']);
  const [small, bus] = m.cars;
  small.engine = 30;
  place(small, 0, 0, FACE_Z);
  let events = [];
  for (let k = 0; k < 4 && !small.out; k++) {
    const p = small.body.translation();
    place(bus, p.x - 14, p.z, FACE_X, 18);
    events.push(...run(m, 80, { p1: { t: 1 } }));
  }
  assert.ok(events.some(e => e.type === 'detach' && e.c === 0), 'something came off the compact');
  assert.equal(small.out, 'wreck');
  const w = events.find(e => e.type === 'wreck');
  assert.equal(w.by, 'p1', 'the bus gets the credit');
});

test('a car off the edge is out', () => {
  const m = match(['sedan', 'sedan']);
  place(m.cars[0], A.HALF - 6, 10, FACE_X);
  place(m.cars[1], 0, -20, FACE_X);
  const ev = run(m, 400, { p0: { t: 1 } }, e => e.some(x => x.type === 'fell'));
  assert.ok(ev.some(e => e.type === 'fell' && e.c === 0));
  assert.equal(m.cars[0].out, 'fell');
});

test('the edge crumbles a ring at a time, and stops', () => {
  assert.deepEqual(A.crumbleRing(10), { fallen: -1, cracking: -1 });
  assert.deepEqual(A.crumbleRing(A.CRUMBLE_START + 1), { fallen: -1, cracking: 0 });
  assert.deepEqual(A.crumbleRing(A.CRUMBLE_START + A.CRUMBLE_WARN + 0.1), { fallen: 0, cracking: -1 });
  assert.equal(A.crumbleRing(1000).fallen, A.MIN_RING - 1);
  const cells = A.startCells();
  A.dropRings(cells, A.MIN_RING - 1);
  const left = cells.reduce((a, b) => a + b, 0);
  assert.equal(left, (A.N - A.MIN_RING * 2) ** 2, 'a 10 x 10 island is left');

  const m = match(['sedan', 'sedan'], { hazards: true });
  place(m.cars[0], 0, 0, FACE_X);
  place(m.cars[1], 5, 5, FACE_X);
  m.t = A.CRUMBLE_START + A.CRUMBLE_WARN - 0.05;
  m.nextDrop = 1e9;
  const ev = run(m, 10);
  assert.ok(ev.some(e => e.type === 'crumble' && e.ring === 0));
  assert.ok(!A.cellAlive(m.cells, -A.HALF + 1, 0));
});

test('a crusher wrecks a weak car parked under it', () => {
  const m = match(['sedan', 'sedan'], { hazards: true });
  const c = A.CRUSHERS[0];
  place(m.cars[0], c.x, c.z, FACE_X);
  place(m.cars[1], -30, 0, FACE_X);
  m.cars[0].engine = 60;
  m.nextDrop = 1e9;
  m.t = A.firstSlam(0) - 1;
  const ev = run(m, 150);
  assert.ok(ev.some(e => e.type === 'crush' && e.c === 0 && e.by === 'press'));
  assert.equal(m.cars[0].out, 'wreck');
  assert.equal(m.cars[1].out, null);
});

test('bots play a whole match with every hazard on', () => {
  const players = ['compact', 'sedan', 'pickup', 'bus', 'sedan', 'compact'].map((cls, i) => ({ id: 'b' + i, name: 'B' + i, cls, bot: true }));
  const m = createMatch(R, { rounds: 2 }, players, 5);
  const brains = Object.fromEntries(players.map((p, i) => [p.id, makeBrain(['easy', 'normal', 'hard'][i % 3], i / 6)]));
  const seen = new Set();
  for (let i = 0; i < 60 * 60 * 15 && m.phase !== 'matchEnd'; i++) {
    const inputs = {};
    for (const car of m.cars) inputs[car.id] = botInput(m, car, brains[car.id], DT);
    step(m, inputs);
    for (const e of m.events) seen.add(e.type);
    m.events.length = 0;
  }
  assert.equal(m.phase, 'matchEnd');
  for (const t of ['hit', 'detach', 'wreck', 'roundEnd', 'drop']) assert.ok(seen.has(t), `saw ${t}`);
  assert.ok(Object.values(m.wins).some(w => w >= 2));
});

test('snapshots carry what the renderer needs', () => {
  const m = match(['sedan', 'pickup', 'bus']);
  run(m, 30, { p0: { t: 1 } });
  m.cars[1].parts.doorL = 40;
  m.cars[1].parts.wheelRR = 0;
  const s = JSON.parse(JSON.stringify(snapshot(m)));
  const v = unpackSnap(s);
  assert.equal(v.cars.length, 3);
  assert.equal(v.cars[2].cls, 'bus');
  assert.equal(v.cars[1].parts[PART_IDS.indexOf('doorL')], 1);
  assert.equal(v.cars[1].parts[PART_IDS.indexOf('wheelRR')], 2);
  const direct = view(m);
  assert.deepEqual(v.cars[0].pos, direct.cars[0].pos);
  const again = unpackCar(packCar(m.cars[0]));
  assert.equal(again.engine, 100);
});

test("a guest's own world tracks the host's car", () => {
  const m = match(['sedan', 'sedan']);
  const [a, b] = m.cars;
  place(a, -20, 0, FACE_X);
  place(b, 30, 30, FACE_X);
  run(m, 20);
  const p = a.body.translation(), q = a.body.rotation();
  const mr = createMirror(R, 'sedan', { x: p.x, y: p.y, z: p.z, q }, [null, { cls: 'sedan', pose: { x: 30, y: 1, z: 30, yaw: 0 } }]);
  const inputs = i => ({ t: 1, s: i > 60 && i < 100 ? 0.6 : 0, hb: 0, b: 0, f: 0 });
  let worst = 0;
  for (let i = 1; i <= 180; i++) {
    const inp = inputs(i);
    step(m, { p0: inp });
    m.events.length = 0;
    mirrorStep(mr, inp, i, false);
    // The host's word arrives every other tick, as over a direct channel.
    if (i % 2 === 0) mirrorCorrect(mr, unpackCar(packCar(a)), i);
    const hp = a.body.translation(), gp = mr.me.body.translation();
    worst = Math.max(worst, Math.hypot(hp.x - gp.x, hp.z - gp.z));
  }
  assert.ok(worst < 0.5, `guest stayed within ${worst.toFixed(3)} m of the host`);
  mr.world.free();
});

test('once every person is out, the healthiest bot takes the round', () => {
  const players = [{ id: 'me', name: 'Me', cls: 'sedan' }, { id: 'b1', name: 'B1', cls: 'sedan', bot: true }, { id: 'b2', name: 'B2', cls: 'sedan', bot: true }];
  const m = createMatch(R, { hazards: false, pickups: false }, players, 4);
  m.phase = 'play'; m.t = 0;
  place(m.cars[0], -20, -40, FACE_X);
  place(m.cars[1], 0, -40, FACE_X);
  place(m.cars[2], 20, -40, FACE_X);
  m.cars[1].engine = 40;
  m.cars[0].engine = 0;
  m.cars[0].out = 'wreck';
  const ev = run(m, 60 * 5);
  const end = ev.find(e => e.type === 'roundEnd');
  assert.ok(end, 'the round ended');
  assert.equal(end.winner, 'b2');
});
