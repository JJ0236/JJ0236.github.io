#!/usr/bin/env node
// scripts/verify-cloche.mjs — headless checks for the cloche brain.
//
//   node scripts/verify-cloche.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodeBrain, CLASS_NAMES } from '../cloche/data.js';
import { createBrain as createBrainRaw, DT, W_IN_MV, ADAPT, PLAST, MODULATOR_SCALE } from '../cloche/brain.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'cloche', 'data');
let failures = 0, checks = 0;
const ok = (name, cond, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${name}${detail ? '  (' + detail + ')' : ''}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ': ' + detail : ''}`); }
};
const soft = (name, cond, detail = '') => console.log(`  ${cond ? 'ok   ' : 'soft '} ${name}${detail ? '  (' + detail + ')' : ''}`);

// ---- A. data format --------------------------------------------------------
console.log('brain.bin');
const buf = readFileSync(join(dataDir, 'brain.bin'));
const data = decodeBrain(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const groups = JSON.parse(readFileSync(join(dataDir, 'groups.json'), 'utf8'));
const createBrain = (d, o = {}) => createBrainRaw(d, { modulatory: groups.modulatory, ...o });
ok('neuron count', data.n === 139255, String(data.n));
ok('edge count', data.e === 2700513, String(data.e));
let mono = true, inRange = true, sorted = true;
for (let i = 0; i < data.n; i++) {
  if (data.offsets[i + 1] < data.offsets[i]) mono = false;
  for (let k = data.offsets[i]; k < data.offsets[i + 1]; k++) {
    if (data.targets[k] >= data.n) inRange = false;
    if (k > data.offsets[i] && data.targets[k] <= data.targets[k - 1]) sorted = false;
  }
}
ok('offsets monotonic', mono && data.offsets[data.n] === data.e);
ok('targets in range', inRange);
ok('rows sorted', sorted);
let zeroW = 0; for (let k = 0; k < data.e; k++) if (data.weights[k] === 0) zeroW++;
ok('no zero weights', zeroW === 0, String(zeroW));
const need = ['modulatory', 'sugar', 'bitter', 'MN9', 'MN6', 'GF', 'DNa01', 'DNa02', 'LC4', 'LPLC2', 'JO', 'aDN', 'groom', 'fruit', 'vinegar', 'KC', 'MBON_approach', 'MBON_avoid', 'PAM', 'PPL1', 'APL', 'DN_L', 'DN_R', 'reward_DAN', 'punish_DAN'];
for (const k of need) ok(`group ${k}`, Array.isArray(groups[k]) && groups[k].length > 0, String(groups[k]?.length));
ok('MN9 is a pair', groups.MN9.length === 2);
ok('GF is a pair', groups.GF.length === 2);
const classCount = new Array(CLASS_NAMES.length).fill(0);
for (let i = 0; i < data.n; i++) classCount[data.cls[i]]++;
ok('class bytes', classCount[CLASS_NAMES.indexOf('optic')] === 77873 && classCount[CLASS_NAMES.indexOf('motor')] === 110,
  CLASS_NAMES.map((c, i) => `${c} ${classCount[i]}`).join(', '));
const motorClass = CLASS_NAMES.indexOf('motor');
ok('MN9 is motor class', groups.MN9.every(i => data.cls[i] === motorClass));
const excOut = i => { let s = 0; for (let k = data.offsets[i]; k < data.offsets[i + 1]; k++) s += data.weights[k]; return s; };
ok('sugar GRNs are excitatory', groups.sugar.every(i => excOut(i) > 0));

// ---- B. dynamics -----------------------------------------------------------
const SUGAR_HZ = 200;   // the notebook default in Shiu et al.; 100 Hz gives ~10 Hz MN9 at the ≥5 cutoff
console.log(`dynamics (dt ${DT} ms, W_IN ${W_IN_MV} mV, adaptation ${ADAPT.jump} mV / ${ADAPT.tau} ms, modulators ×${MODULATOR_SCALE}, sugar drive ${SUGAR_HZ} Hz)`);
const ms = m => Math.round(m / DT);
const run = (brain, m) => { let c = 0; for (let t = 0; t < m; t += 5) c += brain.step(ms(5)).length; return c; };
const W = 980;   // rate window, ms (just under the one-second ring)

const brain = createBrain(data, { seed: 7 });
ok('silent at rest', run(brain, 1000) === 0 && brain.activeCount === 0);

brain.reset();
brain.stimulate(groups.sugar, SUGAR_HZ);
let t0 = performance.now();
const sugarSpikes = run(brain, 1000);
const sugarWall = performance.now() - t0;
const mn9Sugar = brain.rate(groups.MN9, W);
ok('sugar → MN9 fires', mn9Sugar >= 20 && mn9Sugar <= 80,
  `MN9 ${mn9Sugar.toFixed(1)} Hz, GRNs ${brain.rate(groups.sugar, W).toFixed(0)} Hz, ${sugarSpikes} spikes, active ${brain.activeCount}`);
ok('MN6 fires too', brain.rate(groups.MN6, W) > 5, `${brain.rate(groups.MN6, W).toFixed(1)} Hz`);
console.log(`        1 s of sugar drive took ${(sugarWall / 1000).toFixed(2)} s wall (${(1000 / sugarWall).toFixed(2)}× real time)`);

brain.reset();
brain.stimulate(groups.sugar, SUGAR_HZ);
brain.stimulate(groups.bitter, SUGAR_HZ);
run(brain, 1000);
ok('bitter cancels sugar', brain.rate(groups.MN9, W) < 5, `MN9 ${brain.rate(groups.MN9, W).toFixed(1)} Hz`);

brain.reset();
brain.stimulate(groups.bitter, SUGAR_HZ);
run(brain, 1000);
ok('bitter alone does not extend', brain.rate(groups.MN9, W) < 5, `MN9 ${brain.rate(groups.MN9, W).toFixed(1)} Hz`);

brain.reset();
brain.stimulate(groups.LC4, 150);
brain.stimulate(groups.LPLC2, 150);
let gfFirst = -1;
const gfSet = new Set(groups.GF);
for (let t = 0; t < 60 && gfFirst < 0; t += 1) {
  const sp = brain.step(ms(1));
  for (const i of sp) if (gfSet.has(i)) { gfFirst = t; break; }
}
ok('looming → giant fibre', gfFirst >= 0 && gfFirst <= 40, `first GF spike at ${gfFirst} ms`);

brain.reset();
brain.stimulate(groups.JO, 140);
run(brain, 1000);
const desc = CLASS_NAMES.indexOf('descending');
const top = [];
for (let i = 0; i < data.n; i++) if (data.cls[i] === desc) { const r = brain.rate([i], W); if (r > 0) top.push([i, r]); }
top.sort((a, b) => b[1] - a[1]);
console.log('        top descending responders to JO drive: ' + top.slice(0, 8).map(([i, r]) => `${groups.groom.includes(i) ? '*' : ''}${i}:${r.toFixed(0)}Hz`).join(' '));
ok('JO → grooming descending neurons', brain.rate(groups.groom, W) > 30, `groom ${brain.rate(groups.groom, W).toFixed(1)} Hz`);
soft('JO → labelled aDN', brain.rate(groups.aDN, W) > 5, `aDN ${brain.rate(groups.aDN, W).toFixed(1)} Hz`);

brain.reset();
brain.stimulate(groups.sugar, SUGAR_HZ);
run(brain, 2000);
brain.clearAll();
run(brain, 1000);
const tail = run(brain, 500);
ok('quiet within a second of sugar ending', tail === 0 && brain.activeCount === 0, `${tail} spikes in the next 500 ms, active ${brain.activeCount}`);

// ---- C. olfaction and learning --------------------------------------------
console.log('olfaction and learning');
const MB = [...groups.MBON_approach, ...groups.MBON_avoid];
const kcSet = new Set(groups.KC);
{
  let bad = 0;
  for (const i of groups.APL) { let pos = 0; for (let k = data.offsets[i]; k < data.offsets[i + 1]; k++) if (data.weights[k] > 0) pos++; bad += pos; }
  ok('APL is inhibitory', bad === 0);
  ok('teaching map present', groups.teach && Object.keys(groups.teach).length > 200 && groups.reward_DAN.length > 100 && groups.punish_DAN.length >= 10, `${Object.keys(groups.teach || {}).length} DANs, ${groups.reward_DAN?.length} reward, ${groups.punish_DAN?.length} punish`);
}
const sniffKCs = (br, set, hz = 100, ms = 1000) => { br.stimulate(set, hz); const c = new Set(); let spikes = 0; for (let t = 0; t < ms; t += 5) for (const i of br.step(50)) { spikes++; if (kcSet.has(i)) c.add(i); } br.stimulate(set, 0); return { kcs: c, spikes }; };
{
  const br = createBrain(data, { seed: 3 });
  const f = sniffKCs(br, groups.fruit); run(br, 3000);
  const v = sniffKCs(br, groups.vinegar); run(br, 3000);
  const fPct = f.kcs.size / groups.KC.length * 100, vPct = v.kcs.size / groups.KC.length * 100;
  ok('smells recruit sparse Kenyon cells', f.kcs.size >= 20 && fPct < 6 && v.kcs.size >= 20 && vPct < 6, `fruit ${f.kcs.size} (${fPct.toFixed(1)} %), vinegar ${v.kcs.size} (${vPct.toFixed(1)} %)`);
  let ov = 0; for (const k of f.kcs) if (v.kcs.has(k)) ov++;
  ok('two smells are distinct', ov < 0.15 * Math.min(f.kcs.size, v.kcs.size), `${ov} shared`);
  ok('a smell does not ignite the brain', f.spikes < 60000 && v.spikes < 100000, `fruit ${f.spikes}, vinegar ${v.spikes} spikes/s`);
  const tail = run(br, 1000);
  ok('quiet after the smell', tail === 0, `${tail} spikes`);
}
{
  const br = createBrain(data, { seed: 3 }); br.enablePlasticity(groups.KC, MB, groups.teach);
  const v = sniffKCs(br, groups.vinegar); run(br, 5000);
  const f = sniffKCs(br, groups.fruit); run(br, 5000);
  br.stimulate(groups.reward_DAN, 20); br.stimulate(groups.fruit, 100); run(br, 6000); br.clearAll(); run(br, 500);
  const fa = br.plasticSummary(groups.MBON_avoid, f.kcs), fp = br.plasticSummary(groups.MBON_approach, f.kcs);
  const va = br.plasticSummary(groups.MBON_avoid, v.kcs), vp = br.plasticSummary(groups.MBON_approach, v.kcs);
  ok('reward weakens the smell\'s avoidance synapses', fa < 0.7 && fp > 0.9, `fruit→avoid ${fa.toFixed(2)}, fruit→approach ${fp.toFixed(2)}`);
  ok('the other smell is untouched', va > 0.95 && vp > 0.95, `vinegar→avoid ${va.toFixed(2)}, →approach ${vp.toFixed(2)}`);
  const state = br.getPlasticState();
  const br2 = createBrain(data, { seed: 3 }); br2.enablePlasticity(groups.KC, MB, groups.teach); br2.setPlasticState(state);
  ok('learned synapses survive save and load', Math.abs(br2.plasticSummary(groups.MBON_avoid, f.kcs) - fa) < 0.002 && br2.changedEdges === state.length / 2, `${state.length / 2} synapses`);
}
{
  const br = createBrain(data, { seed: 3 }); br.enablePlasticity(groups.KC, MB, groups.teach);
  const f = sniffKCs(br, groups.fruit); run(br, 5000);
  br.stimulate(groups.punish_DAN, 20); br.stimulate(groups.fruit, 100); run(br, 6000); br.clearAll(); run(br, 500);
  const fa = br.plasticSummary(groups.MBON_avoid, f.kcs), fp = br.plasticSummary(groups.MBON_approach, f.kcs);
  ok('punishment weakens the approach synapses', fp < 0.9 && fa > 0.95, `fruit→approach ${fp.toFixed(2)}, fruit→avoid ${fa.toFixed(2)}`);
}
{
  const sens = []; for (let i = 0; i < data.n; i++) if (data.cls[i] === CLASS_NAMES.indexOf('sensory')) sens.push(i);
  const br = createBrain(data, { seed: 3 }); br.background(sens, 0.3);
  const per = []; for (let k = 0; k < 4; k++) per.push(run(br, 1000));
  ok('resting hum is stable', per.every(x => x > 500 && x < 20000) && Math.max(...per) < 3 * Math.min(...per), `spikes/s ${per.join(' ')}`);
}

// ---- D. courtship groups in the female ---------------------------------------
console.log('female courtship groups');
{
  ok('JO-A, vpoDN, oviDN present', groups.JO_A.length > 50 && groups.vpoDN.length === 2 && groups.oviDN.length >= 4, `JO-A ${groups.JO_A.length}, vpoDN ${groups.vpoDN.length}, oviDN ${groups.oviDN.length}`);
  const br = createBrain(data, { seed: 3 }); br.stimulate(groups.oviDN, 50); run(br, 1000);
  ok('oviDN drive fires', br.rate(groups.oviDN, 980) > 20, `${br.rate(groups.oviDN, 980).toFixed(1)} Hz`);
  br.reset(); br.stimulate(groups.JO_A, 100); run(br, 1000);
  soft('hearing reaches vpoDN on its own', br.rate(groups.vpoDN, 980) > 1, `vpoDN ${br.rate(groups.vpoDN, 980).toFixed(1)} Hz — the page bridges this step`);
}

// ---- E. the male brain -------------------------------------------------------
console.log('male.bin');
{
  const mbuf = readFileSync(join(dataDir, 'male.bin'));
  const md = decodeBrain(mbuf.buffer.slice(mbuf.byteOffset, mbuf.byteOffset + mbuf.byteLength));
  const mg = JSON.parse(readFileSync(join(dataDir, 'male-groups.json'), 'utf8'));
  const mk = () => createBrainRaw(md, { seed: 3, modulatory: mg.modulatory });
  ok('male neuron count', md.n === 166700, String(md.n));
  ok('male edges', md.e > 5000000 && md.offsets[md.n] === md.e, String(md.e));
  for (const k of ['sugar', 'bitter', 'MN9', 'GF', 'LC4', 'LPLC2', 'JO', 'fruit', 'vinegar', 'KC', 'MBON_approach', 'MBON_avoid', 'PAM', 'PPL1', 'P1', 'pIP10', 'LC10a', 'tpGRN', 'background', 'reward_DAN', 'punish_DAN', 'DN_L', 'DN_R']) ok(`male group ${k}`, Array.isArray(mg[k]) && mg[k].length > 0, String(mg[k]?.length));
  let kcDA = 0; for (const i of mg.KC) if (mg.modulatory.includes(i)) kcDA++;
  ok('male Kenyon cells are not modulatory', kcDA === 0, String(kcDA));
  let br = mk(); ok('male silent at rest', run(br, 500) === 0);
  br = mk(); br.stimulate(mg.sugar, 200); run(br, 1000);
  ok('male sugar → MN9', br.rate(mg.MN9, 980) > 15, `${br.rate(mg.MN9, 980).toFixed(1)} Hz`);
  br = mk(); br.stimulate(mg.sugar, 200); br.stimulate(mg.bitter, 200); run(br, 1000);
  ok('male bitter cancels sugar', br.rate(mg.MN9, 980) < 5, `${br.rate(mg.MN9, 980).toFixed(1)} Hz`);
  br = mk(); br.stimulate(mg.LC4, 150); br.stimulate(mg.LPLC2, 150);
  let gf = -1; const gfs = new Set(mg.GF); for (let t = 0; t < 60 && gf < 0; t++) for (const i of br.step(10)) if (gfs.has(i)) { gf = t; break; }
  ok('male looming → giant fibre', gf >= 0 && gf <= 40, `${gf} ms`);
  const mkc = new Set(mg.KC);
  const sniffM = (set) => { const b2 = mk(); b2.stimulate(set, 100); const c = new Set(); let n = 0; for (let t = 0; t < 1000; t += 5) for (const i of b2.step(50)) { n++; if (mkc.has(i)) c.add(i); } b2.clearAll(); run(b2, 2000); return { kcs: c, spikes: n, tail: run(b2, 1000) }; };
  const f = sniffM(mg.fruit), v = sniffM(mg.vinegar);
  let ov = 0; for (const k of f.kcs) if (v.kcs.has(k)) ov++;
  ok('male smells are sparse and distinct', f.kcs.size > 20 && f.kcs.size < 0.06 * mg.KC.length && v.kcs.size > 20 && ov < 0.15 * Math.min(f.kcs.size, v.kcs.size), `fruit ${f.kcs.size}, vinegar ${v.kcs.size}, shared ${ov}`);
  ok('male quiet after a smell', f.tail === 0 && v.tail === 0, `${f.tail} / ${v.tail}`);
  br = mk(); br.stimulate(mg.LC10a, 120); br.stimulate(mg.tpGRN, 60); run(br, 1000);
  ok('seeing a female → song command (pIP10)', br.rate(mg.pIP10, 980) > 1, `pIP10 ${br.rate(mg.pIP10, 980).toFixed(1)} Hz, P1 ${br.rate(mg.P1, 980).toFixed(2)} Hz`);
  br = mk(); br.stimulate(mg.P1, 50); run(br, 1000);
  ok('P1 → pIP10', br.rate(mg.pIP10, 980) > 20, `${br.rate(mg.pIP10, 980).toFixed(1)} Hz`);
  br = mk(); br.background(mg.background, 0.15); const per = []; for (let k = 0; k < 3; k++) per.push(run(br, 1000));
  ok('male resting hum is stable', per.every(x => x > 200 && x < 20000) && Math.max(...per) < 3 * Math.min(...per), `spikes/s ${per.join(' ')}`);
}

const a = createBrain(data, { seed: 3 }); a.stimulate(groups.sugar, SUGAR_HZ);
const b = createBrain(data, { seed: 3 }); b.stimulate(groups.sugar, SUGAR_HZ);
ok('seeded runs are deterministic', run(a, 300) === run(b, 300));

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
