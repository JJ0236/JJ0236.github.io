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
export const ADAPT = { jump: 0.4, tau: 150, knee: 6 };   // knee: mV of adaptation at which each spike's jump has doubled
// Homeostatic ceiling (not in Shiu et al.): when the brain's firing rate,
// averaged over `tau` ms, exceeds `s0` spikes per 10 ms, every active neuron
// is pushed down by `k` mV per excess 100 spikes. A brief response passes;
// a standing hum is damped. Stands in for the inhibitory gain control the
// LIF lacks and stops the network locking into a brain-wide runaway state.
export const CEILING = { s0: 400, k: 3, tau: 600 };
// Neuromodulatory neurons (dopamine, serotonin, octopamine) act through slow
// receptors, not fast ionotropic synapses. Shiu et al. treated them as fast
// excitation; here their synaptic effect is scaled to a tenth, which stops
// the central complex ringing after an odour while leaving every reflex
// and the sparse Kenyon-cell code unchanged.
export const MODULATOR_SCALE = 0.1;
// Mushroom-body plasticity (Aso et al. 2014; Hige et al. 2015): a Kenyon
// cell → output neuron synapse is depressed when the Kenyon cell has fired
// recently (eligibility, τe) and dopamine arrives at that output neuron's
// compartment (τd). Which dopamine neurons teach which output neurons
// comes from the wiring: the DAN → MBON synapses in the connectome.
export const PLAST = { eta: 0.05, tauE: 2000, tauD: 200, floor: 0.05, eligCap: 4 };

const RING = Math.round(PARAMS.delay / DT);   // 18 slots
const RATE_BIN_MS = 20, RATE_BINS = 50;   // a one-second window
const EPS = 1e-2;   // mV; 0.14 % of the distance to threshold

function xorshift(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function createBrain(data, { seed = 1, modulatory = null } = {}) {
  const { n, offsets, targets, weights } = data;
  const outScale = new Float32Array(n).fill(PARAMS.wSyn);   // mV per synapse count, per presynaptic neuron
  if (modulatory) for (const i of modulatory) outScale[i] = PARAMS.wSyn * MODULATOR_SCALE;
  const v = new Float32Array(n).fill(PARAMS.vRest);
  const vThArr = new Float32Array(n).fill(PARAMS.vTh);
  let popEma = 0;                                                    // spikes per 10 ms, smoothed over CEILING.tau
  const g = new Float32Array(n);
  const ad = new Float32Array(n);                 // adaptation current, mV
  const refUntil = new Float32Array(n);
  const driveHz = new Float32Array(n);          // Poisson drive per neuron
  const isDriven = new Uint8Array(n);
  let driven = new Uint32Array(64), drivenN = 0;
  let bgSet = null, bgPerStep = 0;                // background: sparse events over a set
  const inActive = new Uint8Array(n);
  let active = new Uint32Array(1024), activeN = 0;
  const ring = Array.from({ length: RING }, () => ({ a: new Uint32Array(256), n: 0 }));
  let slot = 0;
  const counts = new Uint16Array(n * RATE_BINS);   // spike counts per 20 ms bin
  let bin = 0, binStart = 0;
  const rnd = xorshift(seed);
  // plasticity state (enabled by enablePlasticity)
  let plastOn = false;
  const isKC = new Uint8Array(n);
  const isDAN = new Uint8Array(n);
  const mbonIndex = new Int32Array(n).fill(-1);
  let plast = null;              // Float32Array(E), multiplier on KC→MBON edges (1 = naive)
  let kcEdges = [];              // per MBON m: Uint32Array of edge indices from KCs
  let kcEdgeSrc = [];            // per MBON m: Uint32Array of source KC indices
  let danTargets = [];           // per neuron: Int32Array of MBON m indices it teaches (DANs only)
  let danShare = null;           // per MBON m: 1 / number of DANs teaching it, so dopamine is a rate, not a head count
  const elig = new Float32Array(n);
  let eligList = new Uint32Array(1024), eligN = 0; const inElig = new Uint8Array(n);
  let dop = null;                // Float32Array(M)
  let changedEdges = 0;
  const decayS = Math.exp(-DT / PARAMS.tauS);
  const decayA = Math.exp(-DT / ADAPT.tau);
  const aJump = ADAPT.jump, aKnee = ADAPT.knee > 0 ? 1 / ADAPT.knee : 0;
  const kM = DT / PARAMS.tauM;
  let time = 0, steps = 0;
  let out = new Uint32Array(4096), outN = 0;

  const addActive = i => {
    if (inActive[i]) return;
    inActive[i] = 1;
    if (activeN === active.length) { const a = new Uint32Array(active.length * 2); a.set(active); active = a; }
    active[activeN++] = i;
  };
  const onSpike = i => {
    if (!plastOn) return;
    if (isKC[i]) {
      const e = elig[i] + 1; elig[i] = e > PLAST.eligCap ? PLAST.eligCap : e;
      if (!inElig[i]) { inElig[i] = 1; if (eligN === eligList.length) { const a = new Uint32Array(eligList.length * 2); a.set(eligList); eligList = a; } eligList[eligN++] = i; }
    } else if (isDAN[i]) {
      const ts = danTargets[i];
      for (let q = 0; q < ts.length; q++) dop[ts[q]] += danShare[ts[q]];
    }
  };
  const push = (r, i) => {
    if (r.n === r.a.length) { const a = new Uint32Array(r.a.length * 2); a.set(r.a); r.a = a; }
    r.a[r.n++] = i;
  };

  function step(nSteps) {
    outN = 0;
    for (let s = 0; s < nSteps; s++) {
      const popSlotStart = outN;
      // (a) deliver spikes due now
      const due = ring[slot];
      for (let k = 0; k < due.n; k++) {
        const j = due.a[k];
        const end = offsets[j + 1];
        const ws = outScale[j];
        if (plastOn && isKC[j]) {
          for (let e = offsets[j]; e < end; e++) {
            const t = targets[e];
            g[t] += weights[e] * ws * plast[e];
            addActive(t);
          }
        } else {
          for (let e = offsets[j]; e < end; e++) {
            const t = targets[e];
            g[t] += weights[e] * ws;
            addActive(t);
          }
        }
      }
      due.n = 0;
      // (b) background: a Poisson number of events per step, each on a random
      //     member of the background set (O(events), not O(set))
      if (bgPerStep > 0) {
        let k = 0; const L = Math.exp(-bgPerStep); let p = rnd();
        while (p > L) { k++; p *= rnd(); }
        for (; k > 0; k--) { const i = bgSet[(rnd() * bgSet.length) | 0]; g[i] += W_IN_MV; addActive(i); }
      }
      // (c) Poisson drive, integrate the active set, drop settled neurons
      const dueRing = ring[(slot + RING - 1) % RING];   // arrives after `delay`
      // driven neurons: Poisson input, no refractory period (Shiu et al.)
      for (let k = 0; k < drivenN; k++) {
        const i = driven[k];
        if (rnd() < driveHz[i] * DT * 0.001) g[i] += W_IN_MV;
        let gi = g[i] * decayS;
        let vi = v[i] + kM * (PARAMS.vRest - v[i] + gi);
        if (vi >= vThArr[i]) {
          vi = PARAMS.vReset; gi = 0;
          push(dueRing, i);
          if (outN === out.length) { const a = new Uint32Array(out.length * 2); a.set(out); out = a; }
          out[outN++] = i;
          counts[i * RATE_BINS + bin]++;
          onSpike(i);
        }
        g[i] = gi; v[i] = vi;
      }
      // everyone else in the active set
      let w = 0;
      const vRest = PARAMS.vRest, vReset = PARAMS.vReset, refr = PARAMS.refractory;
      const excess = popEma > CEILING.s0 ? (popEma - CEILING.s0) * 0.01 * CEILING.k : 0;
      const stepSpikes0 = outN;
      for (let k = 0; k < activeN; k++) {
        const i = active[k];
        if (isDriven[i]) { active[w++] = i; continue; }
        let gi = g[i] * decayS;
        let ai = ad[i] * decayA;
        let vi = v[i];
        if (time >= refUntil[i]) {
          vi += kM * (vRest - vi + gi - ai - excess);
          if (vi >= vThArr[i]) {
            vi = vReset; gi = 0; ai += aJump * (1 + ai * aKnee);
            refUntil[i] = time + refr;
            push(dueRing, i);
            if (outN === out.length) { const a = new Uint32Array(out.length * 2); a.set(out); out = a; }
            out[outN++] = i;
            counts[i * RATE_BINS + bin]++;
            onSpike(i);
          }
          g[i] = gi; v[i] = vi; ad[i] = ai;
          if (gi < EPS && gi > -EPS && ai < EPS && vi - vRest < EPS && vi - vRest > -EPS) inActive[i] = 0; else active[w++] = i;
        } else { g[i] = gi; ad[i] = ai; active[w++] = i; }
      }
      activeN = w;
      popEma += ((outN - popSlotStart) * 100 - popEma) * (DT / CEILING.tau);
      slot = (slot + 1) % RING;
      time += DT; steps++;
      if (time - binStart >= RATE_BIN_MS - 1e-9) {
        binStart = time; bin = (bin + 1) % RATE_BINS;
        for (let i = bin, end = n * RATE_BINS; i < end; i += RATE_BINS) counts[i] = 0;
      }
    }
    if (plastOn) applyPlasticity(nSteps * DT);
    return out.subarray(0, outN);
  }

  function applyPlasticity(ms) {
    const kE = Math.exp(-ms / PLAST.tauE), kD = Math.exp(-ms / PLAST.tauD);
    const M = kcEdges.length;
    for (let m = 0; m < M; m++) {
      const dm = dop[m];
      if (dm < 0.01) { dop[m] = 0; continue; }
      const es = kcEdges[m], ks = kcEdgeSrc[m];
      const rate = PLAST.eta * dm * ms * 0.001;
      for (let q = 0; q < es.length; q++) {
        const el = elig[ks[q]];
        if (el < 0.01) continue;
        const e = es[q];
        const p = plast[e] - rate * el;
        if (plast[e] === 1 && p < 1) changedEdges++;
        plast[e] = p < PLAST.floor ? PLAST.floor : p;
      }
      dop[m] = dm * kD;
    }
    let w = 0;
    for (let q = 0; q < eligN; q++) {
      const k = eligList[q];
      const el = elig[k] * kE;
      if (el < 0.01) { elig[k] = 0; inElig[k] = 0; } else { elig[k] = el; eligList[w++] = k; }
    }
    eligN = w;
  }

  /** Turn on KC→MBON plasticity. kc, mbon: index arrays; teach: { danIndex: [mbonIndex, …] }. */
  function enablePlasticity(kc, mbon, teach) {
    plastOn = true;
    isKC.fill(0); isDAN.fill(0); mbonIndex.fill(-1);
    for (const i of kc) isKC[i] = 1;
    mbon.forEach((i, m) => { mbonIndex[i] = m; });
    plast = new Float32Array(offsets[n]).fill(1);
    const ke = mbon.map(() => []), ks = mbon.map(() => []);
    for (const k of kc) for (let e = offsets[k]; e < offsets[k + 1]; e++) { const m = mbonIndex[targets[e]]; if (m >= 0) { ke[m].push(e); ks[m].push(k); } }
    kcEdges = ke.map(a => Uint32Array.from(a)); kcEdgeSrc = ks.map(a => Uint32Array.from(a));
    danTargets = new Array(n);
    for (const [dnKey, ms] of Object.entries(teach)) {
      const dn = +dnKey; const ts = [];
      for (const mi of ms) { const m = mbonIndex[mi]; if (m >= 0) ts.push(m); }
      if (ts.length) { isDAN[dn] = 1; danTargets[dn] = Int32Array.from(ts); }
    }
    dop = new Float32Array(mbon.length);
    const cnt = new Float32Array(mbon.length);
    for (const dn of Object.keys(teach)) { const ts = danTargets[+dn]; if (ts) for (const m of ts) cnt[m]++; }
    danShare = cnt.map(c => c ? 1 / c : 0);
    changedEdges = 0;
  }
  /** Sparse export of learned synapses: [edge, value, edge, value, …]. */
  function getPlasticState() {
    if (!plast) return null;
    const out = [];
    for (let e = 0; e < plast.length; e++) if (plast[e] < 0.999) out.push(e, Math.round(plast[e] * 1000) / 1000);
    changedEdges = out.length / 2;
    return out;
  }
  function setPlasticState(list) {
    if (!plast || !list) return;
    plast.fill(1); changedEdges = 0;
    for (let q = 0; q + 1 < list.length; q += 2) { const e = list[q] | 0; if (e >= 0 && e < plast.length) { plast[e] = list[q + 1]; changedEdges++; } }
  }
  /** Mean multiplier over the KC→MBON edges of the given MBONs, for the given KCs (or all). */
  function plasticSummary(mbonIdx, kcSet = null) {
    if (!plast) return 1;
    let s = 0, c = 0;
    for (const i of mbonIdx) { const m = mbonIndex[i]; if (m < 0) continue; const es = kcEdges[m], ks = kcEdgeSrc[m]; for (let q = 0; q < es.length; q++) { if (kcSet && !kcSet.has(ks[q])) continue; s += plast[es[q]]; c++; } }
    return c ? s / c : 1;
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
  /** Background firing: every member of `indices` fires at about `hz` on average. */
  function background(indices, hz) {
    bgSet = hz > 0 && indices.length ? Uint32Array.from(indices) : null;
    bgPerStep = bgSet ? bgSet.length * hz * DT * 0.001 : 0;
  }
  function rate(indices, windowMs = 200) {
    const nb = Math.max(1, Math.min(RATE_BINS - 1, Math.round(windowMs / RATE_BIN_MS)));
    let c = 0;
    for (const i of indices) for (let b = 0; b < nb; b++) c += counts[i * RATE_BINS + ((bin - b + RATE_BINS) % RATE_BINS)];
    return c / indices.length / (nb * RATE_BIN_MS) * 1000;
  }
  function setThreshold(indices, mV) { for (const i of indices) vThArr[i] = mV; }
  function reset() {
    popEma = 0;
    elig.fill(0); inElig.fill(0); eligN = 0; if (dop) dop.fill(0);
    v.fill(PARAMS.vRest); g.fill(0); ad.fill(0); refUntil.fill(0); driveHz.fill(0); inActive.fill(0); isDriven.fill(0); drivenN = 0;
    activeN = 0; for (const r of ring) r.n = 0; slot = 0; counts.fill(0); bin = 0; binStart = 0; time = 0; steps = 0;
  }

  return {
    step, stimulate, clearAll, background, setThreshold, rate, reset,
    enablePlasticity, getPlasticState, setPlasticState, plasticSummary,
    get changedEdges() { return changedEdges; }, get elig() { return elig; },
    get popRate() { return popEma * 100; },
    get time() { return time; }, get steps() { return steps; }, get activeCount() { return activeN; },
    v, g, ad,
  };
}
