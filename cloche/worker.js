// cloche/worker.js — runs the brain off the main thread in real time.
//
// main → worker:  { type: 'init', buffer, groups }   buffer is transferred
//                 { type: 'stim', group, hz }         hz 0 clears the group
//                 { type: 'stimIdx', indices, hz }
//                 { type: 'pause' } { type: 'resume' } { type: 'reset' }
// worker → main:  { type: 'ready', n, e }
//                 { type: 'tick', time, spikes, rates, active, speed, gf }
//
// Biological time advances in 5 ms chunks and never skips: when a chunk
// costs more than 5 ms of wall time the brain simply runs slower than real
// time and `speed` says by how much.

import { decodeBrain } from './data.js';
import { createBrain } from './brain.js';
import { RATE_ORDER, RATE_WINDOW_MS } from './groups-order.js';

const CHUNK_MS = 5, STEPS = 50;          // 50 steps of 0.1 ms
const TICK_MS = 16;                       // how often we report
const MAX_LAG_MS = 200;                   // biological lag before we stop trying to catch up

let brain = null, groups = null, gfSet = null;
let paused = false, bioTime = 0, wallOrigin = 0;
let acc = [], accLen = 0, lastTick = 0, gfFlag = false;
let speedBio = 0, speedWall = 0, speed = 1;

self.onmessage = e => {
  const m = e.data;
  if (m.type === 'init') {
    const data = decodeBrain(m.buffer);
    groups = m.groups;
    gfSet = new Set(groups.GF);
    brain = createBrain(data, { seed: (Date.now() & 0xffff) | 1 });
    self.postMessage({ type: 'ready', n: data.n, e: data.e });
    wallOrigin = performance.now(); bioTime = 0; lastTick = wallOrigin;
    loop();
  } else if (!brain) return;
  else if (m.type === 'stim') brain.stimulate(groups[m.group], m.hz);
  else if (m.type === 'stimIdx') brain.stimulate(m.indices, m.hz);
  else if (m.type === 'pause') paused = true;
  else if (m.type === 'resume') { paused = false; wallOrigin = performance.now() - bioTime; }
  else if (m.type === 'reset') { brain.reset(); bioTime = 0; wallOrigin = performance.now(); }
};

function loop() {
  const start = performance.now();
  if (!paused) {
    let wallElapsed = start - wallOrigin;
    if (wallElapsed - bioTime > MAX_LAG_MS) { wallOrigin = start - bioTime - MAX_LAG_MS; wallElapsed = bioTime + MAX_LAG_MS; }
    const before = bioTime;
    while (bioTime < wallElapsed && performance.now() - start < 12) {
      const sp = brain.step(STEPS);
      if (sp.length) {
        acc.push(sp.slice()); accLen += sp.length;
        if (!gfFlag) for (let i = 0; i < sp.length; i++) if (gfSet.has(sp[i])) { gfFlag = true; break; }
      }
      bioTime += CHUNK_MS;
    }
    speedBio += bioTime - before; speedWall += performance.now() - start;
  }
  const now = performance.now();
  if (now - lastTick >= TICK_MS) {
    lastTick = now;
    if (speedWall > 500) { speed = speedBio / Math.max(speedWall, 1); speedBio = 0; speedWall = 0; }
    const spikes = new Uint32Array(accLen);
    let o = 0; for (const a of acc) { spikes.set(a, o); o += a.length; }
    acc = []; accLen = 0;
    const rates = new Float32Array(RATE_ORDER.length);
    for (let i = 0; i < RATE_ORDER.length; i++) rates[i] = brain.rate(groups[RATE_ORDER[i]], RATE_WINDOW_MS);
    self.postMessage({ type: 'tick', time: bioTime, spikes, rates, active: brain.activeCount, speed: paused ? 0 : Math.min(speed, 1), gf: gfFlag }, [spikes.buffer]);
    gfFlag = false;
  }
  const wallElapsed = performance.now() - wallOrigin;
  const ahead = paused ? TICK_MS : Math.max(0, bioTime - wallElapsed);
  setTimeout(loop, Math.min(ahead, TICK_MS));
}
