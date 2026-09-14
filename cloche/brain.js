// cloche/brain.js — leaky integrate-and-fire simulation of the FlyWire
// connectome, after Shiu et al. 2024 (Nature 634:210). Pure: no DOM, runs
// under node and in a worker.
//
//   dv/dt = (V_rest − v + g) / τ_m        dg/dt = −g / τ_s
//   presynaptic spike, 1.8 ms later:  g_post += w · W_SYN
//   spike when v ≥ V_th; then v = V_reset, g = 0, refractory 2.2 ms
//
// Only neurons whose state differs from rest are integrated (the active
// set); at rest the network is silent and a step costs nothing.

export const DT = 0.1;              // ms
export const PARAMS = {
  vRest: -52, vReset: -52, vTh: -45, // mV
  tauM: 20, tauS: 5,                 // ms
  refractory: 2.2, delay: 1.8,       // ms
  wSyn: 0.275,                       // mV per synapse
};
// Drive weight for an external Poisson input event: Shiu's Poisson synapse,
// w_syn · f_poi with f_poi = 250. Every input event fires the cell, and
// driven cells have no refractory period, so a neuron stimulated at 100 Hz
// fires at about 100 Hz, exactly as in the paper.
export const W_IN_MV = PARAMS.wSyn * 250;
// Spike-frequency adaptation (not in Shiu et al.): each spike adds `jump` mV
// of a slow hyperpolarising current that decays with `tau`. Without it the
// ≥5-synapse graph has recurrent loops that ring at 200 Hz forever after a
// strong stimulus; real neurons adapt. jump = 0 disables it.
export const ADAPT = { jump: 0.4, tau: 150 };

const RING = Math.round(PARAMS.delay / DT);   // 18 slots
const RATE_BIN_MS = 20, RATE_BINS = 50;   // a one-second window
const EPS = 1e-2;   // mV; 0.14 % of the distance to threshold

function xorshift(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function createBrain(data, { seed = 1 } = {}) {
  const { n, offsets, targets, weights } = data;
  const v = new Float32Array(n).fill(PARAMS.vRest);
  const g = new Float32Array(n);
  const ad = new Float32Array(n);                 // adaptation current, mV
  const refUntil = new Float32Array(n);
  const driveHz = new Float32Array(n);          // Poisson drive per neuron
  const isDriven = new Uint8Array(n);
  let driven = new Uint32Array(64), drivenN = 0;
  const inActive = new Uint8Array(n);
  let active = new Uint32Array(1024), activeN = 0;
  const ring = Array.from({ length: RING }, () => ({ a: new Uint32Array(256), n: 0 }));
  let slot = 0;
  const counts = new Uint16Array(n * RATE_BINS);   // spike counts per 20 ms bin
  let bin = 0, binStart = 0;
  const rnd = xorshift(seed);
  const decayS = Math.exp(-DT / PARAMS.tauS);
  const decayA = Math.exp(-DT / ADAPT.tau);
  const aJump = ADAPT.jump;
  const kM = DT / PARAMS.tauM;
  let time = 0, steps = 0;
  let out = new Uint32Array(4096), outN = 0;

  const addActive = i => {
    if (inActive[i]) return;
    inActive[i] = 1;
    if (activeN === active.length) { const a = new Uint32Array(active.length * 2); a.set(active); active = a; }
    active[activeN++] = i;
  };
  const push = (r, i) => {
    if (r.n === r.a.length) { const a = new Uint32Array(r.a.length * 2); a.set(r.a); r.a = a; }
    r.a[r.n++] = i;
  };

  function step(nSteps) {
    outN = 0;
    for (let s = 0; s < nSteps; s++) {
      // (a) deliver spikes due now
      const due = ring[slot];
      for (let k = 0; k < due.n; k++) {
        const j = due.a[k];
        const end = offsets[j + 1];
        for (let e = offsets[j]; e < end; e++) {
          const t = targets[e];
          g[t] += weights[e] * PARAMS.wSyn;
          addActive(t);
        }
      }
      due.n = 0;
      // (b) Poisson drive, (c) integrate the active set, (d) drop settled neurons
      const dueRing = ring[(slot + RING - 1) % RING];   // arrives after `delay`
      // driven neurons: Poisson input, no refractory period (Shiu et al.)
      for (let k = 0; k < drivenN; k++) {
        const i = driven[k];
        if (rnd() < driveHz[i] * DT * 0.001) g[i] += W_IN_MV;
        let gi = g[i] * decayS;
        let vi = v[i] + kM * (PARAMS.vRest - v[i] + gi);
        if (vi >= PARAMS.vTh) {
          vi = PARAMS.vReset; gi = 0;
          push(dueRing, i);
          if (outN === out.length) { const a = new Uint32Array(out.length * 2); a.set(out); out = a; }
          out[outN++] = i;
          counts[i * RATE_BINS + bin]++;
        }
        g[i] = gi; v[i] = vi;
      }
      // everyone else in the active set
      let w = 0;
      const vRest = PARAMS.vRest, vTh = PARAMS.vTh, vReset = PARAMS.vReset, refr = PARAMS.refractory;
      for (let k = 0; k < activeN; k++) {
        const i = active[k];
        if (isDriven[i]) { active[w++] = i; continue; }
        let gi = g[i] * decayS;
        let ai = ad[i] * decayA;
        let vi = v[i];
        if (time >= refUntil[i]) {
          vi += kM * (vRest - vi + gi - ai);
          if (vi >= vTh) {
            vi = vReset; gi = 0; ai += aJump;
            refUntil[i] = time + refr;
            push(dueRing, i);
            if (outN === out.length) { const a = new Uint32Array(out.length * 2); a.set(out); out = a; }
            out[outN++] = i;
            counts[i * RATE_BINS + bin]++;
          }
          g[i] = gi; v[i] = vi; ad[i] = ai;
          if (gi < EPS && gi > -EPS && ai < EPS && vi - vRest < EPS && vi - vRest > -EPS) inActive[i] = 0; else active[w++] = i;
        } else { g[i] = gi; ad[i] = ai; active[w++] = i; }
      }
      activeN = w;
      slot = (slot + 1) % RING;
      time += DT; steps++;
      if (time - binStart >= RATE_BIN_MS - 1e-9) {
        binStart = time; bin = (bin + 1) % RATE_BINS;
        for (let i = bin, end = n * RATE_BINS; i < end; i += RATE_BINS) counts[i] = 0;
      }
    }
    return out.subarray(0, outN);
  }

  function rebuildDriven() {
    drivenN = 0;
    for (let i = 0; i < n; i++) if (driveHz[i] > 0) {
      if (drivenN === driven.length) { const a = new Uint32Array(driven.length * 2); a.set(driven); driven = a; }
      driven[drivenN++] = i; isDriven[i] = 1; addActive(i);
    } else isDriven[i] = 0;
  }
  function stimulate(indices, hz) {
    for (const i of indices) driveHz[i] = hz;
    rebuildDriven();
  }
  function clearAll() { driveHz.fill(0); rebuildDriven(); }
  function rate(indices, windowMs = 200) {
    const nb = Math.max(1, Math.min(RATE_BINS - 1, Math.round(windowMs / RATE_BIN_MS)));
    let c = 0;
    for (const i of indices) for (let b = 0; b < nb; b++) c += counts[i * RATE_BINS + ((bin - b + RATE_BINS) % RATE_BINS)];
    return c / indices.length / (nb * RATE_BIN_MS) * 1000;
  }
  function reset() {
    v.fill(PARAMS.vRest); g.fill(0); ad.fill(0); refUntil.fill(0); driveHz.fill(0); inActive.fill(0); isDriven.fill(0); drivenN = 0;
    activeN = 0; for (const r of ring) r.n = 0; slot = 0; counts.fill(0); bin = 0; binStart = 0; time = 0; steps = 0;
  }

  return {
    step, stimulate, clearAll, rate, reset,
    get time() { return time; }, get steps() { return steps; }, get activeCount() { return activeN; },
    v, g, ad,
  };
}
