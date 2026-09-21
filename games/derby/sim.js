// The rules and the physics. No DOM: Rapier comes in as an argument, so the
// same code runs in the page and under node for tests.
//
// The host (or a solo game) owns a match: it steps the world, turns contact
// forces into damage, runs the hazards and decides rounds. Everything a
// player needs to see comes out as a view (for drawing) and as events (for
// dents, parts flying off and effects).

import { CLASSES, CLASS_IDS, PART_IDS, WHEEL_PARTS, partsFor, wheelMounts, CAR_COLOURS } from './cars.js?v=1';
import * as A from './arena.js?v=1';

export const DT = 1 / 60;
export const MAX_CARS = 6;
export const COUNTDOWN = 3;
export const ROUND_END = 5.5;        // seconds between a round's end and the next
export const ROUND_LIMIT = 240;
export const PICKUP_KINDS = ['repair', 'armour', 'plough', 'boost'];
export const PICKUPS = {
  repair: { name: 'Repair', note: '+40 engine' },
  armour: { name: 'Armour', note: 'half damage for 12 s' },
  plough: { name: 'Plough', note: 'your front hits twice as hard for 15 s' },
  boost: { name: 'Boost', note: 'fills the boost meter' },
};
export const DEFAULT_SETTINGS = { rounds: 3, bots: 5, botLevel: 'normal', hazards: true, pickups: true };

// Collision groups: membership in the high 16 bits, what it collides with in the low.
const G_WORLD = 1, G_CAR = 2, G_BOX = 4;
const groups = (member, filter) => (member << 16) | filter;
const CAR_GROUPS = groups(G_CAR, G_WORLD | G_CAR | G_BOX);
const WORLD_GROUPS = groups(G_WORLD, G_CAR | G_BOX);
const BOX_GROUPS = groups(G_BOX, G_WORLD | G_CAR | G_BOX);
const RAY_GROUPS = groups(G_CAR, G_WORLD | G_CAR | G_BOX);

// Damage tuning. A contact counts as a hit when its force passes HIT_FORCE;
// the impulse above IMP_MIN turns into damage at DMG_K per N·s.
const HIT_FORCE = 45000;
const IMP_MIN = 900;
const DMG_K = 0.0034;
const HIT_WINDOW = 6;                // ticks a collision is gathered over before it counts
const ENGINE_BY_ZONE = { front: 1.0, rear: 0.22, left: 0.3, right: 0.3, top: 0.65 };
const TAKEN_BY_ZONE = { front: 0.85, rear: 0.85, left: 1.2, right: 1.2, top: 1.0 };
const PART_WEAR = 2.3;               // parts wear faster than the engine
const RAMMER = 0.55;
const RAMMED = 1.2;
const CRUSH_DMG = 78;
const BOX_CRUSH_DMG = 55;

/** Small seeded random, so tests and attract matches repeat. */
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

// ── Vectors and quaternions (plain objects, as Rapier uses) ─

export function rotate(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}
export const unrotate = (q, v) => rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
export const yawQuat = a => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── Building the world ─────────────────────────────────────

/**
 * The arena's colliders. Used by the host's world and by a guest's
 * prediction world alike.
 */
export function buildArena(R, world, cells) {
  const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
  const floor = { body: fixed, collider: null };
  setFloor(R, world, floor, cells);
  for (const r of A.RAMPS) {
    const pts = new Float32Array(A.rampPoints(r).flat());
    const d = R.ColliderDesc.convexHull(pts);
    if (d) world.createCollider(d.setCollisionGroups(WORLD_GROUPS).setFriction(0.9), fixed);
  }
  // Crusher pillars: the plates themselves are handled by rule, not contact.
  for (const c of A.CRUSHERS) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = c.x + sx * (A.PLATE.half + 0.5), z = c.z + sz * (A.PLATE.half + 0.5);
      world.createCollider(R.ColliderDesc.cylinder(6, 0.38).setTranslation(x, 5.5, z)
        .setCollisionGroups(WORLD_GROUPS).setFriction(0.4), fixed);
    }
  }
  return floor;
}

export function setFloor(R, world, floor, cells) {
  if (floor.collider) world.removeCollider(floor.collider, true);
  const { vertices, indices } = A.floorMesh(cells);
  floor.collider = world.createCollider(
    R.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(WORLD_GROUPS).setFriction(1.0), floor.body);
}

/** A car's body, colliders and vehicle controller. */
export function buildCar(R, world, clsId, pose, { kinematic = false } = {}) {
  const C = CLASSES[clsId];
  // Cars never sleep: the vehicle controller's engine force does not wake a
  // body, so a car parked through the countdown would ignore the throttle.
  const desc = kinematic ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic().setCanSleep(false);
  desc.setTranslation(pose.x, pose.y, pose.z).setRotation(pose.q || yawQuat(pose.yaw || 0))
    .setLinearDamping(0.05).setAngularDamping(0.6).setCcdEnabled(true);
  const body = world.createRigidBody(desc);
  const hl = C.L / 2, hh = C.H / 2, hw = C.W / 2;
  // The chassis carries all the mass, low down, so cars roll less.
  const m = C.mass;
  const inertia = { x: m / 12 * (C.H * C.H + C.W * C.W) * 1.3, y: m / 12 * (C.L * C.L + C.W * C.W), z: m / 12 * (C.L * C.L + C.H * C.H) };
  const chassis = world.createCollider(R.ColliderDesc.cuboid(hl + C.bumper * 0.6, hh, hw)
    .setMassProperties(m, { x: 0, y: -hh * 0.7, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
    .setCollisionGroups(CAR_GROUPS).setFriction(0.35).setRestitution(0.18)
    .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(HIT_FORCE), body);
  const cab = C.cabin;
  const cabin = world.createCollider(R.ColliderDesc.cuboid(cab.L / 2, cab.H / 2, hw - cab.inset)
    .setTranslation(cab.x, hh + cab.H / 2, 0).setDensity(0)
    .setCollisionGroups(CAR_GROUPS).setFriction(0.35).setRestitution(0.1)
    .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(HIT_FORCE), body);
  let vc = null;
  if (!kinematic) {
    vc = world.createVehicleController(body);
    for (const [x, y, z] of wheelMounts(clsId)) {
      vc.addWheel({ x, y, z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, C.wheel.rest, C.wheel.r);
    }
    for (let i = 0; i < 4; i++) tuneWheel(vc, i, C);
  }
  return { body, chassis, cabin, vc };
}

function tuneWheel(vc, i, C) {
  vc.setWheelSuspensionStiffness(i, 30);
  vc.setWheelSuspensionCompression(i, 2.4);
  vc.setWheelSuspensionRelaxation(i, 3.2);
  vc.setWheelMaxSuspensionTravel(i, 0.3);
  vc.setWheelMaxSuspensionForce(i, C.mass * 40);
  vc.setWheelFrictionSlip(i, 2.2);
  vc.setWheelSideFrictionStiffness(i, 1.0);
}

// ── A match ────────────────────────────────────────────────

/**
 * players: [{ id, name, cls, bot }] in seat order. Colours come from the seat.
 */
export function createMatch(R, settings, players, seed = (Math.random() * 2 ** 31) | 0) {
  const m = {
    R,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    players: players.map((p, i) => ({
      id: p.id, name: p.name, bot: !!p.bot, seat: i,
      cls: CLASSES[p.cls] ? p.cls : 'sedan',
      color: CAR_COLOURS[i % CAR_COLOURS.length],
    })),
    wins: {},
    kills: {},
    round: 0,
    phase: 'countdown',
    rand: rng(seed),
    events: [],
    tick: 0,
    world: null,
  };
  for (const p of m.players) { m.wins[p.id] = 0; m.kills[p.id] = 0; }
  startRound(m);
  return m;
}

export function startRound(m) {
  const R = m.R;
  if (m.world) { m.world.free(); m.queue.free(); }
  m.round++;
  m.phase = 'countdown';
  m.t = -COUNTDOWN;
  m.endAt = 0;
  m.winner = undefined;
  m.world = new R.World({ x: 0, y: -9.81, z: 0 });
  m.world.timestep = DT;
  m.queue = new R.EventQueue(true);
  m.cells = A.startCells();
  m.fallen = -1;
  m.floor = buildArena(R, m.world, m.cells);
  m.owners = new Map();            // collider handle -> { car } | { box }
  m.pending = new Map();           // pair key -> gathered hit
  m.boxes = [];
  m.boxId = 0;
  m.nextDrop = 6 + m.rand() * 3;
  m.pickups = [];
  m.pickupId = 0;
  m.nextPickup = 4;
  m.crushed = {};                  // crusher k -> cycle already crushed on
  const spawns = A.spawnPoints(Math.max(m.players.length, 2));
  // A fresh seat order each round, so nobody always starts in the same spot.
  const order = m.players.map((_, i) => i).sort(() => m.rand() - 0.5);
  m.cars = m.players.map((p, i) => {
    const s = spawns[order[i]];
    const C = CLASSES[p.cls];
    const y = A.heightAt(s.x, s.z) + C.wheel.r + C.wheel.rest + C.H / 2 - 0.05;
    const built = buildCar(R, m.world, p.cls, { x: s.x, y, z: s.z, yaw: s.yaw });
    const car = {
      id: p.id, idx: i, cls: p.cls, C, ...built,
      parts: Object.fromEntries(PART_IDS.map(id => [id, 100])),
      engine: 100, boost: 1, out: null, outAt: 0,
      steer: 0, flipCd: 0, stuck: 0,
      buffs: { armour: 0, plough: 0 },
      lastHit: null,
      scrapes: [],
      input: { t: 0, s: 0, hb: 0, b: 0, f: 0 },
    };
    m.owners.set(built.chassis.handle, { car });
    m.owners.set(built.cabin.handle, { car });
    return car;
  });
  m.events.push({ type: 'round', round: m.round });
}

const zoneOf = (C, l, normalUp) => {
  const hl = C.L / 2, hw = C.W / 2;
  if (normalUp && l[1] > C.H / 2 - 0.05) return 'top';
  const fx = Math.abs(l[0]) / hl, fz = Math.abs(l[2]) / hw;
  if (fx * 1.15 > fz) return l[0] > 0 ? 'front' : 'rear';
  return l[2] > 0 ? 'right' : 'left';
};

/** Wear a car down. Returns the engine damage done. */
function damage(m, car, zone, amount, local, by) {
  if (car.out || amount <= 0) return 0;
  let dmg = amount * TAKEN_BY_ZONE[zone] / car.C.armour;
  if (car.buffs.armour > 0) dmg *= 0.5;
  if (car.buffs.plough > 0 && zone === 'front') dmg *= 0.3;
  const eng = dmg * ENGINE_BY_ZONE[zone];
  car.engine = Math.max(0, car.engine - eng);
  // Parts in the zone wear, and a hit near a corner hurts that wheel too.
  for (const pid of PART_IDS) {
    if (WHEEL_PARTS.includes(pid)) continue;
    if (partZone(pid) === zone) wearPart(m, car, pid, dmg * PART_WEAR * (pid.startsWith('bumper') ? 1.25 : 1));
  }
  if (local && zone !== 'top') {
    const fx = local[0] / (car.C.L / 2), fz = local[2] / (car.C.W / 2);
    if (Math.abs(fx) > 0.5 && Math.abs(fz) > 0.45) {
      wearPart(m, car, (fx > 0 ? 'wheelF' : 'wheelR') + (fz > 0 ? 'R' : 'L'), dmg * 1.5);
    }
  }
  // Only a car still running gets the credit; ramming a wreck is not a kill.
  if (by && by !== car && !by.out) car.lastHit = { id: by.id, t: m.t };
  if (car.engine <= 0) eliminate(m, car, 'wreck');
  return eng;
}

const ZONES = { bumperF: 'front', hood: 'front', bumperR: 'rear', trunk: 'rear', doorL: 'left', doorR: 'right', roof: 'top' };
const partZone = pid => ZONES[pid] || null;

function wearPart(m, car, pid, amount) {
  const before = car.parts[pid];
  if (before <= 0) return;
  const after = Math.max(0, before - amount);
  car.parts[pid] = after;
  if (after <= 0) {
    const v = car.body.linvel();
    m.events.push({ type: 'detach', c: car.idx, part: pid, v: [v.x, v.y, v.z] });
    if (WHEEL_PARTS.includes(pid)) loseWheel(m, car, WHEEL_PARTS.indexOf(pid));
  }
}

/** A wheel comes off: its corner drops and scrapes along the ground. */
function loseWheel(m, car, i) {
  const vc = car.vc;
  if (vc) {
    vc.setWheelMaxSuspensionForce(i, 0);
    vc.setWheelSuspensionStiffness(i, 0);
    vc.setWheelFrictionSlip(i, 0);
    vc.setWheelEngineForce(i, 0);
  }
  const [x, y, z] = wheelMounts(car.cls)[i];
  const col = m.world.createCollider(m.R.ColliderDesc.ball(0.2).setTranslation(x, y - 0.12, z * 0.9)
    .setDensity(0).setFriction(1.1).setCollisionGroups(CAR_GROUPS), car.body);
  car.scrapes.push(col);
}

function eliminate(m, car, how) {
  if (car.out) return;
  car.out = how;
  car.outAt = m.t;
  let by = null;
  if (car.lastHit && m.t - car.lastHit.t < 7) by = car.lastHit.id;
  if (by) m.kills[by] = (m.kills[by] || 0) + 1;
  m.events.push({ type: how, c: car.idx, by });
  if (how === 'wreck' && car.vc) {
    for (let i = 0; i < 4; i++) { car.vc.setWheelEngineForce(i, 0); car.vc.setWheelBrake(i, 8); }
  }
}

// ── Driving ────────────────────────────────────────────────

export function enginePower(car) {
  const e = car.engine;
  return e >= 60 ? 1 : 0.45 + 0.55 * (e / 60);
}

/** Apply one tick of input to a car's controller. Shared by host and guest. */
export function drive(car, inp, { frozen = false } = {}) {
  const vc = car.vc;
  if (!vc) return;
  const C = car.C;
  const speed = vc.currentVehicleSpeed();
  let engine = 0, brake = 0.8;
  const dead = !!car.out;
  if (!dead && !frozen) {
    const t = clamp(inp.t || 0, -1, 1);
    if (t > 0.05) {
      if (speed < -1.5) brake = 40 * t;
      else if (speed < C.maxSpeed) engine = C.power * t;
    } else if (t < -0.05) {
      if (speed > 1.5) brake = 40 * -t;
      else if (speed > -C.maxSpeed * 0.8) engine = C.power * t * 0.85;
    }
    engine *= enginePower(car);
  } else if (frozen) brake = 30;
  else brake = 6;

  const target = dead ? car.steer : -clamp(inp.s || 0, -1, 1) * C.steer / (1 + Math.abs(speed) / 16);
  car.steer += clamp(target - car.steer, -3.2 * DT, 3.2 * DT);
  const hb = !dead && !frozen && inp.hb;
  for (let i = 0; i < 4; i++) {
    if (car.parts[WHEEL_PARTS[i]] <= 0) continue;
    vc.setWheelEngineForce(i, engine / 4);
    vc.setWheelSteering(i, i < 2 ? car.steer : 0);
    const rear = i >= 2;
    vc.setWheelBrake(i, hb && rear ? 60 : brake);
    vc.setWheelFrictionSlip(i, hb && rear ? 0.75 : 2.2);
    vc.setWheelSideFrictionStiffness(i, hb && rear ? 0.45 : 1.0);
  }

  // Boost: a push along the car's nose.
  const boosting = !dead && !frozen && inp.b && car.boost > 0.02 && Math.abs(speed) < C.maxSpeed * 1.45;
  car.boosting = !!boosting;
  if (boosting) {
    const q = car.body.rotation();
    const f = rotate(q, [1, 0, 0]);
    const imp = C.mass * 8.5 * DT * Math.sign(inp.t || 1);
    car.body.applyImpulse({ x: f[0] * imp, y: 0, z: f[2] * imp }, true);
    car.boost = Math.max(0, car.boost - 0.42 * DT);
  } else if (!dead) {
    car.boost = Math.min(1, car.boost + 0.06 * DT);
  }

  // Flip upright when on the roof or stuck.
  car.flipCd = Math.max(0, car.flipCd - DT);
  if (!dead && !frozen && inp.f && car.flipCd <= 0) {
    const up = rotate(car.body.rotation(), [0, 1, 0]);
    if (up[1] < 0.5 || Math.abs(speed) < 2) {
      const p = car.body.translation();
      const fwd = rotate(car.body.rotation(), [1, 0, 0]);
      car.body.setTranslation({ x: p.x, y: p.y + 1.6, z: p.z }, true);
      car.body.setRotation(yawQuat(Math.atan2(-fwd[2], fwd[0])), true);
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      car.flipCd = 3;
    }
  }
}

// ── A tick ─────────────────────────────────────────────────

/** inputs: { [playerId]: { t, s, hb, b, f } } */
export function step(m, inputs) {
  m.tick++;
  if (m.phase === 'matchEnd') return;
  const frozen = m.phase === 'countdown';

  for (const car of m.cars) {
    if (car.out === 'fell') continue;
    const inp = inputs[car.id] || car.input;
    car.input = inp;
    drive(car, inp, { frozen });
    car.vc.updateVehicle(DT, m.R.QueryFilterFlags.EXCLUDE_SENSORS, RAY_GROUPS);
    for (const k of ['armour', 'plough']) car.buffs[k] = Math.max(0, car.buffs[k] - DT);
  }

  m.world.step(m.queue);
  m.t += DT;
  if (m.phase === 'countdown' && m.t >= 0) { m.phase = 'play'; m.events.push({ type: 'go' }); }

  gatherHits(m);
  if (m.phase === 'play' || m.phase === 'roundEnd') {
    if (m.settings.hazards) { crushers(m); crumble(m); drops(m); }
    if (m.settings.pickups) pickups(m);
  }
  boxesUpkeep(m);

  for (const car of m.cars) {
    const p = car.body.translation();
    if (car.out !== 'fell' && p.y < A.FALL_Y) eliminate(m, car, 'fell');
    if (car.out === 'fell' && p.y < -60 && car.body.isEnabled()) car.body.setEnabled(false);
  }

  if (m.phase === 'play') {
    const alive = m.cars.filter(c => !c.out);
    const limit = m.t >= ROUND_LIMIT;
    if (alive.length <= 1 || limit) {
      let w = alive.length === 1 ? alive[0] : null;
      if (limit && alive.length > 1) w = alive.slice().sort((a, b) => b.engine - a.engine)[0];
      m.winner = w ? w.id : null;
      if (w) m.wins[w.id]++;
      m.phase = 'roundEnd';
      m.endAt = m.t;
      const champ = w && m.wins[w.id] >= m.settings.rounds;
      m.events.push({ type: 'roundEnd', winner: m.winner, match: !!champ });
    }
  } else if (m.phase === 'roundEnd' && m.t - m.endAt > ROUND_END) {
    const champ = m.winner && m.wins[m.winner] >= m.settings.rounds;
    if (champ) { m.phase = 'matchEnd'; m.events.push({ type: 'matchEnd', winner: m.winner }); }
    else startRound(m);
  }
}

/** Turn this tick's strong contacts into hits, gathered over a few ticks. */
function gatherHits(m) {
  const R = m.R, world = m.world;
  m.queue.drainContactForceEvents(ev => {
    const h1 = ev.collider1(), h2 = ev.collider2();
    const o1 = m.owners.get(h1), o2 = m.owners.get(h2);
    if (!(o1 && o1.car) && !(o2 && o2.car)) return;
    const c1 = world.getCollider(h1), c2 = world.getCollider(h2);
    if (!c1 || !c2) return;
    let px = 0, py = 0, pz = 0, n = 0, nx = 0, ny = 0, nz = 0;
    world.contactPair(c1, c2, (mf, flipped) => {
      const nn = mf.normal();
      const s = flipped ? -1 : 1;
      for (let i = 0; i < mf.numSolverContacts(); i++) {
        const p = mf.solverContactPoint(i);
        px += p.x; py += p.y; pz += p.z; n++;
      }
      nx += nn.x * s; ny += nn.y * s; nz += nn.z * s;
    });
    if (!n) return;
    const imp = ev.totalForceMagnitude() * DT;
    const a = o1 && (o1.car || o1.box), b = o2 && (o2.car || o2.box);
    // One crash between two cars touches several colliders (chassis, cabin):
    // gather by what they belong to, so it counts once.
    const k1 = ownerKey(o1, h1), k2 = ownerKey(o2, h2);
    const key = k1 < k2 ? k1 + ':' + k2 : k2 + ':' + k1;
    let g = m.pending.get(key);
    if (!g) {
      g = { o1, o2, imp: 0, p: [0, 0, 0], w: 0, until: m.tick + HIT_WINDOW, n: [nx, ny, nz], closing: closing(o1, o2) };
      m.pending.set(key, g);
    }
    g.imp += imp;
    g.p[0] += px / n * imp; g.p[1] += py / n * imp; g.p[2] += pz / n * imp; g.w += imp;
  });

  for (const [key, g] of m.pending) {
    if (m.tick < g.until) continue;
    m.pending.delete(key);
    const p = g.p.map(v => v / g.w);
    const cars = [g.o1 && g.o1.car, g.o2 && g.o2.car];
    const boxes = [g.o1 && g.o1.box, g.o2 && g.o2.box];
    const worldHit = !g.o1 || !g.o2;
    // Landing on the floor is not a crash; hitting a pillar or ramp side is.
    if (worldHit && Math.abs(g.n[1]) > 0.6) continue;
    for (let s = 0; s < 2; s++) {
      const car = cars[s];
      if (!car) continue;
      const other = cars[1 - s];
      const box = boxes[1 - s];
      const imp = g.imp - IMP_MIN;
      if (imp <= 0) continue;
      const q = car.body.rotation(), cp = car.body.translation();
      const local = unrotate(q, [p[0] - cp.x, p[1] - cp.y, p[2] - cp.z]);
      const upHit = box ? box.body.translation().y > cp.y + 0.3 : (other ? other.body.translation().y > cp.y + car.C.H * 0.7 : false);
      const zone = zoneOf(car.C, local, upHit);
      let amt = imp * DMG_K * ramShare(g, s);
      // A plough on the other car's nose doubles what it does to you.
      if (other && other.buffs.plough > 0) {
        const oq = other.body.rotation(), op = other.body.translation();
        const ol = unrotate(oq, [p[0] - op.x, p[1] - op.y, p[2] - op.z]);
        if (zoneOf(other.C, ol, false) === 'front') amt *= 2;
      }
      if (box && box.falling && !box.crushed.has(car.id)) {
        box.crushed.add(car.id);
        amt += BOX_CRUSH_DMG;
        m.events.push({ type: 'crush', c: car.idx, by: 'box' });
      }
      if (worldHit) amt *= 0.6;
      const before = car.out;
      damage(m, car, zone, amt, local, other);
      if (other && !before) other.dealt = (other.dealt || 0) + amt;
      // The dent: inward from the hit, deeper for harder hits.
      const dir = unrotate(q, [-(p[0] - cp.x), 0, -(p[2] - cp.z)]);
      if (zone === 'top') { dir[0] = 0; dir[1] = -1; dir[2] = 0; }
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      m.events.push({
        type: 'hit', c: car.idx, zone,
        p: local.map(v => +v.toFixed(2)),
        d: dir.map(v => +(v / len).toFixed(2)),
        s: +Math.min(0.42, 0.05 + amt * 0.011).toFixed(3),
        big: amt > 14 ? 1 : 0,
        by: other ? other.idx : -1,
      });
    }
  }
}

const ownerKey = (o, h) => (o && o.car ? 'c' + o.car.idx : o && o.box ? 'b' + o.box.id : 'w' + h);

/** How fast each of two cars was driving into the other when they met. */
function closing(o1, o2) {
  const a = o1 && o1.car, b = o2 && o2.car;
  if (!a || !b) return null;
  const pa = a.body.translation(), pb = b.body.translation();
  const va = a.body.linvel(), vb = b.body.linvel();
  let dx = pb.x - pa.x, dz = pb.z - pa.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  return [va.x * dx + va.z * dz, -(vb.x * dx + vb.z * dz)];
}

/** The rammer takes less than the car it rams; a meeting of equals splits it. */
function ramShare(g, s) {
  if (!g.closing) return 1;
  const mine = g.closing[s], theirs = g.closing[1 - s];
  if (Math.abs(mine - theirs) < 3) return 1;
  return mine > theirs ? RAMMER : RAMMED;
}

// ── Hazards ────────────────────────────────────────────────

function crushers(m) {
  for (const c of A.CRUSHERS) {
    const st = A.crusherState(c.k, m.t);
    if (st.phase !== 'hold' && !(st.phase === 'slam' && st.y < 2)) {
      continue;
    }
    const cycle = Math.floor(m.t * 10);   // one crush per car per plate visit
    for (const car of m.cars) {
      if (car.out === 'fell') continue;
      const p = car.body.translation();
      if (Math.abs(p.x - c.x) > A.PLATE.half + 0.3 || Math.abs(p.z - c.z) > A.PLATE.half + 0.3) continue;
      const key = c.k + ':' + car.id;
      if (m.crushed[key] && m.t - m.crushed[key] < 3) continue;
      m.crushed[key] = m.t;
      m.events.push({ type: 'crush', c: car.idx, by: 'press', k: c.k, cycle });
      m.events.push({ type: 'hit', c: car.idx, zone: 'top', p: [car.C.cabin.x, car.C.H / 2 + car.C.cabin.H, 0], d: [0, -1, 0], s: 0.55, big: 1, by: -1, wide: 1 });
      car.parts.roof = Math.min(car.parts.roof, 30);
      if (!car.out) {
        const before = car.engine;
        car.engine = Math.max(0, car.engine - CRUSH_DMG / car.C.armour * (car.buffs.armour > 0 ? 0.5 : 1));
        if (car.engine <= 0 && before > 0) eliminate(m, car, 'wreck');
      }
      car.body.applyImpulse({ x: 0, y: -car.C.mass * 3, z: 0 }, true);
    }
  }
}

function crumble(m) {
  const { fallen, cracking } = A.crumbleRing(m.t);
  if (cracking >= 0 && m.cracking !== cracking) {
    m.cracking = cracking;
    m.events.push({ type: 'crack', ring: cracking });
  }
  if (fallen > m.fallen) {
    for (let r = m.fallen + 1; r <= fallen; r++) {
      const gone = A.dropRings(m.cells, r);
      m.events.push({ type: 'crumble', ring: r, n: gone.length });
    }
    m.fallen = fallen;
    setFloor(m.R, m.world, m.floor, m.cells);
    for (const car of m.cars) car.body.wakeUp();
    for (const b of m.boxes) b.body.wakeUp();
  }
}

function drops(m) {
  if (m.phase !== 'play' || m.t < m.nextDrop) return;
  m.nextDrop = m.t + 7 + m.rand() * 3;
  const alive = m.cars.filter(c => !c.out);
  let x, z, ok = false;
  for (let tries = 0; tries < 12 && !ok; tries++) {
    if (alive.length && m.rand() < 0.65) {
      const car = alive[(m.rand() * alive.length) | 0];
      const p = car.body.translation(), v = car.body.linvel();
      x = p.x + v.x * 2.2 + (m.rand() - 0.5) * 6;
      z = p.z + v.z * 2.2 + (m.rand() - 0.5) * 6;
    } else {
      x = (m.rand() - 0.5) * A.HALF * 1.6;
      z = (m.rand() - 0.5) * A.HALF * 1.6;
    }
    ok = A.cellAlive(m.cells, x, z) && A.cellAlive(m.cells, x + 3, z) && A.cellAlive(m.cells, x - 3, z);
  }
  if (!ok) return;
  const yaw = m.rand() * Math.PI;
  const body = m.world.createRigidBody(m.R.RigidBodyDesc.dynamic().setTranslation(x, 34, z).setRotation(yawQuat(yaw))
    .setLinvel(0, -6, 0).setAngularDamping(0.8).setCcdEnabled(true));
  const col = m.world.createCollider(m.R.ColliderDesc.cuboid(3, 1.3, 1.25).setMass(7500)
    .setCollisionGroups(BOX_GROUPS).setFriction(0.8).setRestitution(0.05), body);
  const box = { id: ++m.boxId, body, col, falling: true, crushed: new Set(), sink: 0, at: m.t, x, z };
  m.owners.set(col.handle, { box });
  m.boxes.push(box);
  m.events.push({ type: 'drop', id: box.id, x: +x.toFixed(2), z: +z.toFixed(2) });
  // Only four at a time: the oldest one sinks away.
  const live = m.boxes.filter(b => !b.sink);
  if (live.length > 4) live[0].sink = m.t;
}

function boxesUpkeep(m) {
  for (const b of m.boxes) {
    const v = b.body.linvel();
    if (b.falling && v.y > -2 && m.t - b.at > 1) {
      b.falling = false;
      m.events.push({ type: 'land', id: b.id });
    }
    if (b.sink && b.body.bodyType() !== m.R.RigidBodyType.KinematicPositionBased) {
      b.body.setBodyType(m.R.RigidBodyType.KinematicPositionBased, true);
    }
    if (b.sink) {
      const p = b.body.translation();
      b.body.setNextKinematicTranslation({ x: p.x, y: p.y - 2.2 * DT, z: p.z });
    }
  }
  const keep = [];
  for (const b of m.boxes) {
    const p = b.body.translation();
    if ((b.sink && m.t - b.sink > 3) || p.y < -40) {
      m.owners.delete(b.col.handle);
      m.world.removeRigidBody(b.body);
    } else keep.push(b);
  }
  m.boxes = keep;
}

function pickups(m) {
  if (m.phase === 'play' && m.t >= m.nextPickup && m.pickups.length < 3) {
    m.nextPickup = m.t + 8 + m.rand() * 4;
    for (let tries = 0; tries < 10; tries++) {
      const x = (m.rand() - 0.5) * A.HALF * 1.4, z = (m.rand() - 0.5) * A.HALF * 1.4;
      if (!A.cellAlive(m.cells, x, z)) continue;
      if (A.CRUSHERS.some(c => Math.abs(x - c.x) < 5 && Math.abs(z - c.z) < 5)) continue;
      const kind = PICKUP_KINDS[(m.rand() * PICKUP_KINDS.length) | 0];
      m.pickups.push({ id: ++m.pickupId, kind, x: +x.toFixed(2), z: +z.toFixed(2), y: +(A.heightAt(x, z) + 1).toFixed(2) });
      break;
    }
  }
  m.pickups = m.pickups.filter(pk => {
    if (!A.cellAlive(m.cells, pk.x, pk.z)) return false;
    for (const car of m.cars) {
      if (car.out) continue;
      const p = car.body.translation();
      if (Math.hypot(p.x - pk.x, p.z - pk.z) < 2.6 && Math.abs(p.y - pk.y) < 3) {
        applyPickup(car, pk.kind);
        m.events.push({ type: 'pickup', c: car.idx, kind: pk.kind });
        return false;
      }
    }
    return true;
  });
}

function applyPickup(car, kind) {
  if (kind === 'repair') car.engine = Math.min(100, car.engine + 40);
  else if (kind === 'armour') car.buffs.armour = 12;
  else if (kind === 'plough') car.buffs.plough = 15;
  else if (kind === 'boost') car.boost = 1;
}

// ── Players coming and going ───────────────────────────────

/** A new player takes a seat from the next round, replacing a bot if full. */
export function addPlayer(m, p) {
  if (m.players.some(q => q.id === p.id)) return;
  if (m.players.length >= MAX_CARS) {
    const bot = [...m.players].reverse().find(q => q.bot);
    if (!bot) return false;
    removePlayer(m, bot.id);
  }
  m.players.push({ id: p.id, name: p.name, bot: !!p.bot, cls: CLASSES[p.cls] ? p.cls : 'sedan', seat: m.players.length });
  recolour(m);
  m.wins[p.id] = m.wins[p.id] || 0;
  m.kills[p.id] = m.kills[p.id] || 0;
  return true;
}

/** A player leaves: their car is out now, their seat gone from next round. */
export function removePlayer(m, id) {
  const car = m.cars.find(c => c.id === id);
  if (car && !car.out) eliminate(m, car, 'wreck');
  m.players = m.players.filter(p => p.id !== id);
  recolour(m);
}

function recolour(m) {
  m.players.forEach((p, i) => { p.seat = i; p.color = CAR_COLOURS[i % CAR_COLOURS.length]; });
}

// ── A guest's own little world ─────────────────────────────
//
// A guest cannot wait for the host to see its steering, so it runs a small
// world of its own: the arena, its car as a real body, and everyone else as
// kinematic stand-ins moved to where the host says they are. The host stays
// the judge; this only makes your own driving feel immediate.

export function createMirror(R, cls, pose, others) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const cells = A.startCells();
  const floor = buildArena(R, world, cells);
  const built = buildCar(R, world, cls, pose);
  const me = {
    cls, C: CLASSES[cls], ...built,
    parts: Object.fromEntries(PART_IDS.map(id => [id, 100])),
    engine: 100, boost: 1, out: null, steer: 0, flipCd: 0,
    buffs: { armour: 0, plough: 0 }, scrapes: [], lostWheels: new Set(),
  };
  const proxies = others.map(o => o ? buildCar(R, world, o.cls, o.pose, { kinematic: true }) : null);
  return { R, world, floor, cells, fallen: -1, me, proxies, boxes: new Map(), hist: [] };
}

export function freeMirror(mr) { if (mr) mr.world.free(); }

/** Bring the guest's world in line with a snapshot: floor, lost wheels, stand-ins. */
export function mirrorSync(mr, v, myIdx) {
  if (v.fallen > mr.fallen) {
    for (let r = mr.fallen + 1; r <= v.fallen; r++) A.dropRings(mr.cells, r);
    mr.fallen = v.fallen;
    setFloor(mr.R, mr.world, mr.floor, mr.cells);
    mr.me.body.wakeUp();
  }
  const mine = v.cars[myIdx];
  if (mine) {
    for (let i = 0; i < 4; i++) {
      if (mine.parts[7 + i] === 2 && !mr.me.lostWheels.has(i)) {
        mr.me.lostWheels.add(i);
        mr.me.parts[WHEEL_PARTS[i]] = 0;
        const fake = { world: mr.world, R: mr.R };
        loseWheel(fake, mr.me, i);
      }
    }
    mr.me.engine = mine.engine;
    mr.me.out = mine.out;
    mr.me.buffs.armour = mine.armour ? 1 : 0;
    mr.me.buffs.plough = mine.plough ? 1 : 0;
  }
  // Containers: stand-ins that follow the host.
  const seen = new Set();
  for (const b of v.boxes || []) {
    seen.add(b.id);
    let body = mr.boxes.get(b.id);
    if (!body) {
      body = mr.world.createRigidBody(mr.R.RigidBodyDesc.kinematicPositionBased().setTranslation(...b.pos));
      mr.world.createCollider(mr.R.ColliderDesc.cuboid(3, 1.3, 1.25).setCollisionGroups(BOX_GROUPS), body);
      mr.boxes.set(b.id, body);
    }
    body.setNextKinematicTranslation({ x: b.pos[0], y: b.pos[1], z: b.pos[2] });
    body.setNextKinematicRotation({ x: b.quat[0], y: b.quat[1], z: b.quat[2], w: b.quat[3] });
  }
  for (const [id, body] of mr.boxes) if (!seen.has(id)) { mr.world.removeRigidBody(body); mr.boxes.delete(id); }
}

/** Move the stand-ins toward where the other cars are being drawn. */
export function mirrorPlace(mr, cars, myIdx) {
  cars.forEach((c, i) => {
    const px = mr.proxies[i];
    if (!px || i === myIdx || !c) return;
    if (c.out === 'fell') { px.body.setNextKinematicTranslation({ x: 0, y: -200 - i * 10, z: 0 }); return; }
    px.body.setNextKinematicTranslation({ x: c.pos[0], y: c.pos[1], z: c.pos[2] });
    px.body.setNextKinematicRotation({ x: c.quat[0], y: c.quat[1], z: c.quat[2], w: c.quat[3] });
  });
}

/** One tick of the guest's own car. n numbers the input, for matching the host's ack. */
export function mirrorStep(mr, inp, n, frozen) {
  const me = mr.me;
  drive(me, inp, { frozen });
  me.vc.updateVehicle(DT, mr.R.QueryFilterFlags.EXCLUDE_SENSORS, RAY_GROUPS);
  mr.world.step();
  const p = me.body.translation(), q = me.body.rotation(), v = me.body.linvel(), w = me.body.angvel();
  mr.hist.push({ n, p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], v: [v.x, v.y, v.z], w: [w.x, w.y, w.z] });
  if (mr.hist.length > 240) mr.hist.shift();
}

/**
 * The host's word on my car, as of my input n. Compare with what I
 * predicted then: a small miss is blended in over a few frames, a big one
 * (a hit I did not see coming) is taken at once, carried forward to now.
 */
export function mirrorCorrect(mr, host, n) {
  const i = mr.hist.findIndex(h => h.n === n);
  if (i < 0) return 'none';
  const h = mr.hist[i];
  mr.hist.splice(0, i);
  const me = mr.me, body = me.body;
  const ex = host.pos[0] - h.p[0], ey = host.pos[1] - h.p[1], ez = host.pos[2] - h.p[2];
  const err = Math.hypot(ex, ey, ez);
  const dq = Math.abs(host.quat[0] * h.q[0] + host.quat[1] * h.q[1] + host.quat[2] * h.q[2] + host.quat[3] * h.q[3]);
  const ahead = (mr.hist.length - 1) * DT;
  if (err > 2.5 || dq < 0.95) {
    body.setTranslation({ x: host.pos[0] + host.vel[0] * ahead, y: host.pos[1] + host.vel[1] * ahead, z: host.pos[2] + host.vel[2] * ahead }, true);
    body.setRotation({ x: host.quat[0], y: host.quat[1], z: host.quat[2], w: host.quat[3] }, true);
    body.setLinvel({ x: host.vel[0], y: host.vel[1], z: host.vel[2] }, true);
    body.setAngvel({ x: host.ang[0], y: host.ang[1], z: host.ang[2] }, true);
    mr.hist.length = 0;
    return 'snap';
  }
  const k = err > 0.6 ? 0.35 : 0.15;
  const p = body.translation(), v = body.linvel();
  const cx = ex * k, cy = ey * k, cz = ez * k;
  body.setTranslation({ x: p.x + cx, y: p.y + cy, z: p.z + cz }, true);
  const vk = 0.3;
  const dvx = (host.vel[0] - h.v[0]) * vk, dvy = (host.vel[1] - h.v[1]) * vk, dvz = (host.vel[2] - h.v[2]) * vk;
  body.setLinvel({ x: v.x + dvx, y: v.y + dvy, z: v.z + dvz }, true);
  // Rotation: nudge by a share of the difference between the host's and mine then.
  const cur = body.rotation();
  const diff = qmul([host.quat[0], host.quat[1], host.quat[2], host.quat[3]], [-h.q[0], -h.q[1], -h.q[2], h.q[3]]);
  const part = qslerpId(diff, k);
  const nq = qmul(part, [cur.x, cur.y, cur.z, cur.w]);
  body.setRotation({ x: nq[0], y: nq[1], z: nq[2], w: nq[3] }, true);
  // The same nudge applies to everything predicted since, or the next
  // snapshot measures the same miss again and it is corrected twice.
  for (const e of mr.hist) {
    e.p[0] += cx; e.p[1] += cy; e.p[2] += cz;
    e.v[0] += dvx; e.v[1] += dvy; e.v[2] += dvz;
    e.q = qmul(part, e.q);
  }
  return 'blend';
}

function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
/** A share k of rotation q, from no rotation at all. */
function qslerpId(q, k) {
  let [x, y, z, w] = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const ang = 2 * Math.acos(Math.min(1, w));
  const s = Math.sqrt(1 - w * w);
  if (s < 1e-5) return [0, 0, 0, 1];
  const a = ang * k / 2;
  return [x / s * Math.sin(a), y / s * Math.sin(a), z / s * Math.sin(a), Math.cos(a)];
}

// ── What gets drawn and sent ───────────────────────────────

const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;

/** One car's state, packed for the wire. */
export function packCar(car) {
  const p = car.body.translation(), q = car.body.rotation();
  const v = car.body.linvel(), w = car.body.angvel();
  const parts = PART_IDS.map(id => { const h = car.parts[id]; return h <= 0 ? 2 : h < 50 ? 1 : 0; }).join('');
  const susp = car.vc ? [0, 1, 2, 3].map(i => r2(car.vc.wheelSuspensionLength(i) ?? car.C.wheel.rest)) : [0, 0, 0, 0];
  const flags = (car.boosting ? 1 : 0) | (car.buffs.armour > 0 ? 2 : 0) | (car.buffs.plough > 0 ? 4 : 0)
    | (car.out === 'wreck' ? 8 : 0) | (car.out === 'fell' ? 16 : 0);
  return [r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w),
    r2(v.x), r2(v.y), r2(v.z), r2(w.x), r2(w.y), r2(w.z),
    r3(car.steer), Math.ceil(car.engine), r2(car.boost), flags, parts, susp];
}

export function unpackCar(a) {
  return {
    pos: [a[0], a[1], a[2]], quat: [a[3], a[4], a[5], a[6]],
    vel: [a[7], a[8], a[9]], ang: [a[10], a[11], a[12]],
    steer: a[13], engine: a[14], boost: a[15],
    boosting: !!(a[16] & 1), armour: !!(a[16] & 2), plough: !!(a[16] & 4),
    out: a[16] & 8 ? 'wreck' : a[16] & 16 ? 'fell' : null,
    parts: String(a[17]).split('').map(Number),
    susp: a[18],
  };
}

/** Everything a client needs to draw a moment of the match. */
export function snapshot(m) {
  return {
    k: m.tick, t: r3(m.t), ph: m.phase, r: m.round,
    p: m.cars.map(c => [c.id, c.cls]),
    c: m.cars.map(packCar),
    b: m.boxes.map(b => {
      const p = b.body.translation(), q = b.body.rotation();
      return [b.id, r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), r2(b.body.linvel().y)];
    }),
    pk: m.pickups.map(p => [p.id, p.kind, p.x, p.y, p.z]),
    f: m.fallen,
    w: m.winner === undefined ? undefined : m.winner,
  };
}

/** A snapshot back into the shape the renderer draws. */
export function unpackSnap(s) {
  return {
    tick: s.k, t: s.t, phase: s.ph, round: s.r, fallen: s.f, winner: s.w,
    cars: s.c.map((a, i) => ({ id: s.p[i][0], idx: i, cls: s.p[i][1], ...unpackCar(a) })),
    boxes: s.b.map(b => ({ id: b[0], pos: [b[1], b[2], b[3]], quat: [b[4], b[5], b[6], b[7]], vy: b[8] })),
    pickups: s.pk.map(p => ({ id: p[0], kind: p[1], x: p[2], y: p[3], z: p[4] })),
  };
}

/** Local view of the host's own match: the same shape a client builds. */
export function view(m) {
  return {
    t: m.t, phase: m.phase, round: m.round, fallen: m.fallen,
    winner: m.winner,
    cars: m.cars.map(car => ({ id: car.id, idx: car.idx, cls: car.cls, ...unpackCar(packCar(car)) })),
    boxes: m.boxes.map(b => {
      const p = b.body.translation(), q = b.body.rotation(), v = b.body.linvel();
      return { id: b.id, pos: [p.x, p.y, p.z], quat: [q.x, q.y, q.z, q.w], vy: v.y };
    }),
    pickups: m.pickups.map(p => ({ ...p })),
  };
}

export { CLASS_IDS };
