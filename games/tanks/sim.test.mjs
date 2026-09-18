// node --test games/tanks/sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, snapshot, unpack, TILE, TANK_R, W, H, POWERUP_IDS, POWERUPS, circleFree } from './sim.js';
import { makeBrain, botInput } from './bots.js';
import { MAPS, buildMap, COLS } from './maps.js';

function play(settings, n, maxTicks = 60 * 60 * 12, seed = 7, watch) {
  const players = Array.from({ length: n }, (_, i) => ({
    id: 'p' + i, name: 'P' + i, team: i % 2 ? 'blue' : 'red', bot: true,
  }));
  const g = createGame(settings, players, seed);
  const brains = Object.fromEntries(players.map(p => [p.id, makeBrain(settings.botLevel || 'hard')]));
  for (let i = 0; i < maxTicks && g.phase !== 'matchEnd'; i++) {
    const inputs = {};
    for (const t of g.tanks) inputs[t.id] = botInput(g, t, brains[t.id], 1 / 60);
    step(g, inputs);
    if (watch) watch(g);
    g.events.length = 0;
  }
  return g;
}

test('every map has four reachable spawns', () => {
  for (const { id } of MAPS) {
    const m = buildMap(id, 42);
    assert.equal(m.spawns.filter(Boolean).length, 4, id);
  }
});

test('bots finish a free-for-all match', () => {
  const g = play({ mode: 'ffa', rounds: 3, pickups: 'high' }, 4);
  assert.equal(g.phase, 'matchEnd');
  assert.ok(g.scores[g.matchWinner] >= 3);
});

test('bots finish a teams match', () => {
  const g = play({ mode: 'teams', rounds: 3, pickups: 'normal' }, 4, undefined, 11);
  assert.equal(g.phase, 'matchEnd');
  assert.ok(['red', 'blue'].includes(g.matchWinner));
});

test('tanks never end up inside walls or off the map', () => {
  play({ mode: 'ffa', rounds: 2, pickups: 'high', map: 'maze' }, 4, 60 * 60 * 6, 3, g => {
    for (const t of g.tanks) {
      if (!t.alive) continue;
      assert.ok(t.x > 0 && t.y > 0 && t.x < W && t.y < H, 'on the map');
      assert.ok(circleFree(g.grid, t.x, t.y, TANK_R - 1.5), `tank ${t.id} clear of walls at ${t.x},${t.y}`);
    }
  });
});

test('every power-up can be picked up and does its job', () => {
  for (const type of POWERUP_IDS) {
    const g = createGame({ map: 'meadow', pickups: 'off' }, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 2);
    g.phase = 'play';
    const [a, b] = g.tanks;
    a.x = 4.5 * TILE; a.y = 2.5 * TILE; a.a = 0;
    b.x = (type === 'shotgun' ? 7.5 : 10.5) * TILE; b.y = 2.5 * TILE;
    g.pickups.push({ id: 999, type, x: a.x, y: a.y, life: 10 });
    const aimAtB = fs => ({ a: { ax: b.x, ay: b.y, fs } });
    a.lastFs = 0;
    step(g, aimAtB(0));
    const picked = g.events.find(e => e.type === 'pick');
    assert.equal(picked && picked.powerup, type, type + ' picked up');
    const def = POWERUPS[type];
    if (def.buff) { assert.ok(a.buffs[type] > 0, type + ' buff running'); continue; }
    assert.equal(a.weapon, type);
    const x0 = a.x;
    for (let i = 1; i <= 90; i++) step(g, aimAtB(i < 3 ? i : 2));
    const fired = g.events.some(e => e.type === 'fire' && e.w === type);
    assert.ok(fired, type + ' fired');
    if (type === 'teleport') assert.ok(a.x > x0 + TILE, 'teleport moved the tank towards the aim point');
    else if (type === 'mines') assert.equal(g.mines.length, 1, 'one mine laid');
    else if (type === 'freeze') assert.ok(b.alive && g.events.some(e => e.type === 'freeze'), 'b frozen not killed');
    else assert.ok(!b.alive, type + ' kills a tank in the open');
  }
});

test('shells do not ricochet by default, and do with the power-up', () => {
  const g = createGame({ map: 'meadow', pickups: 'off' }, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 1);
  g.phase = 'play';
  const a = g.tanks[0];
  // Park far from everything and fire straight at the top wall.
  a.x = 5.5 * TILE; a.y = 2.5 * TILE; g.tanks[1].x = 15.5 * TILE; g.tanks[1].y = 12.5 * TILE;
  const up = { ax: a.x + 60, ay: 0, fs: 1 };
  a.lastFs = 0;
  step(g, { a: up });
  assert.equal(g.shells.length, 1);
  for (let i = 0; i < 60; i++) step(g, { a: up });
  assert.equal(g.shells.length, 0, 'plain shell dies on the wall');

  a.buffs.ricochet = 10;
  a.cool = 0;
  step(g, { a: { ...up, fs: 2 } });
  for (let i = 0; i < 40; i++) step(g, { a: { ...up, fs: 2 } });
  assert.equal(g.shells.length, 1, 'ricochet shell survives the wall');
  assert.ok(g.shells[0].vy > 0, 'and is now heading down');
});

test('a crate breaks when shot', () => {
  const g = createGame({ map: 'lumberyard', pickups: 'off' }, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 1);
  g.phase = 'play';
  const before = g.grid.filter(t => t === 2).length;
  const a = g.tanks[0];
  // Spawn 1 is at (1,1); crate at (4,1). Aim right.
  a.lastFs = 0;
  step(g, { a: { ax: a.x + 200, ay: a.y, fs: 1 } });
  for (let i = 0; i < 60; i++) step(g, { a: { ax: a.x + 200, ay: a.y, fs: 1 } });
  const after = g.grid.filter(t => t === 2).length;
  assert.equal(after, before - 1);
  assert.equal(g.destroyed.length, 1);
});

test('a snapshot round-trips through JSON', () => {
  const g = play({ mode: 'ffa', rounds: 1, pickups: 'high' }, 3, 60 * 20);
  const s = JSON.parse(JSON.stringify(snapshot(g, [])));
  const v = unpack(s);
  assert.equal(v.tanks.length, g.tanks.length);
  assert.equal(v.map.id, g.map.id);
  const m = buildMap(v.map.id, v.map.seed);
  for (const i of v.destroyed) m.grid[i] = 0;
  assert.deepEqual([...m.grid], [...g.grid], 'client can rebuild the crate state');
});
