// cloche/worker.js — runs the brain off the main thread in real time.
//
// main → worker:  { type: 'init', buffer, groups, state? }   buffer is transferred
//                 { type: 'stim', group, hz }         hz 0 clears the group
//                 { type: 'stimIdx', indices, hz }
//                 { type: 'background', hz }          resting sensory firing
//                 { type: 'pause' } { type: 'resume' } { type: 'reset' }
//                 { type: 'getState', id }            → { type: 'state', id, plastic, changed }
//                 { type: 'forget' }                  learned synapses back to naive
// worker → main:  { type: 'ready', n, e }
//                 { type: 'tick', time, spikes, rates, active, speed, gf, changed, kcOn }
//
// Biological time advances in 5 ms chunks and never skips: when a chunk
// costs more than 5 ms of wall time the brain simply runs slower than real
// time and `speed` says by how much.

import { decodeBrain } from './data.js';
import { createBrain } from './brain.js';
import { RATE_ORDER, RATE_WINDOW_MS, BACKGROUND_HZ } from './groups-order.js';

const CHUNK_MS = 5, STEPS = 50;          // 50 steps of 0.1 ms
const TICK_MS = 16;                       // how often we report
const MAX_LAG_MS = 200;                   // biological lag before we stop trying to catch up

let brain = null, groups = null, gfSet = null, sensory = null;
let paused = false, bioTime = 0, wallOrigin = 0;
let acc = [], accLen = 0, lastTick = 0, gfFlag = false;
let speedBio = 0, speedWall = 0, speed = 1;
let kcRecent = new Set(), kcIsSet = null;
// which Kenyon cells each smell has ever recruited (the smell's identity in the brain)
const ODOURS = ['fruit', 'vinegar'];
const odourKCs = { fruit: new Set(), vinegar: new Set() };
const odourOn = { fruit: 0, vinegar: 0 };

self.onmessage = e => {
  const m = e.data;
  if (m.type === 'init') {
    const data = decodeBrain(m.buffer);
    groups = m.groups;
    gfSet = new Set(groups.GF);
    kcIsSet = new Uint8Array(data.n); for (const k of groups.KC) kcIsSet[k] = 1;
    brain = createBrain(data, { seed: (Date.now() & 0xffff) | 1, modulatory: groups.modulatory });
    brain.enablePlasticity(groups.KC, [...groups.MBON_approach, ...groups.MBON_avoid], groups.teach);
    if (m.state?.plastic) brain.setPlasticState(m.state.plastic);
    if (m.state?.odourKCs) for (const k of ODOURS) for (const i of m.state.odourKCs[k] || []) odourKCs[k].add(i);
    sensory = [];
    for (let i = 0; i < data.n; i++) if (data.cls[i] === 2) sensory.push(i);   // 2 = sensory, see data.js CLASS_NAMES
    brain.background(sensory, m.backgroundHz ?? BACKGROUND_HZ);
    self.postMessage({ type: 'ready', n: data.n, e: data.e, changed: brain.changedEdges });
    wallOrigin = performance.now(); bioTime = 0; lastTick = wallOrigin;
    loop();
  } else if (!brain) return;
  else if (m.type === 'stim') { brain.stimulate(groups[m.group], m.hz); if (m.group in odourOn) odourOn[m.group] = m.hz; }
  else if (m.type === 'stimIdx') brain.stimulate(m.indices, m.hz);
  else if (m.type === 'background') brain.background(sensory, m.hz);
  else if (m.type === 'pause') paused = true;
  else if (m.type === 'resume') { paused = false; wallOrigin = performance.now() - bioTime; }
  else if (m.type === 'reset') { brain.reset(); bioTime = 0; wallOrigin = performance.now(); }
  else if (m.type === 'getState') self.postMessage({ type: 'state', id: m.id, plastic: brain.getPlasticState(), changed: brain.changedEdges, odourKCs: Object.fromEntries(ODOURS.map(k => [k, [...odourKCs[k]]])) });
  else if (m.type === 'forget') { brain.setPlasticState([]); for (const k of ODOURS) odourKCs[k].clear(); }
  else if (m.type === 'memory') self.postMessage({ type: 'memory', id: m.id, memory: memorySummary() });
};

function memorySummary() {
  const out = {};
  for (const k of ODOURS) {
    const set = odourKCs[k];
    const avoid = brain.plasticSummary(groups.MBON_avoid, set), appr = brain.plasticSummary(groups.MBON_approach, set);
    // bias > 0: the fly has learned to like this smell (its avoidance synapses are weakened)
    out[k] = { kcs: set.size, avoid, approach: appr, bias: set.size ? (1 - avoid) - (1 - appr) : 0 };
  }
  return out;
}

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
        for (let i = 0; i < sp.length; i++) {
          const s = sp[i];
          if (!gfFlag && gfSet.has(s)) gfFlag = true;
          if (kcIsSet[s]) { kcRecent.add(s); for (const k of ODOURS) if (odourOn[k] > 0) odourKCs[k].add(s); }
        }
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
    for (let i = 0; i < RATE_ORDER.length; i++) { const gset = groups[RATE_ORDER[i]]; rates[i] = gset && gset.length ? brain.rate(gset, RATE_WINDOW_MS) : 0; }
    self.postMessage({ type: 'tick', time: bioTime, spikes, rates, active: brain.activeCount, speed: paused ? 0 : Math.min(speed, 1), gf: gfFlag, changed: brain.changedEdges, kcOn: kcRecent.size }, [spikes.buffer]);
    gfFlag = false; kcRecent.clear();
  }
  const wallElapsed = performance.now() - wallOrigin;
  const ahead = paused ? TICK_MS : Math.max(0, bioTime - wallElapsed);
  setTimeout(loop, Math.min(ahead, TICK_MS));
}
