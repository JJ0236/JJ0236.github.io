#!/usr/bin/env node
// scripts/verify-cloche.mjs — headless checks for the cloche brain.
//
//   node scripts/verify-cloche.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodeBrain, CLASS_NAMES } from '../cloche/data.js';
import { createBrain, DT, W_IN_MV } from '../cloche/brain.js';

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
const need = ['sugar', 'bitter', 'MN9', 'MN6', 'GF', 'DNa01', 'DNa02', 'LC4', 'LPLC2', 'JO', 'aDN', 'groom'];
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
console.log(`dynamics (dt ${DT} ms, W_IN ${W_IN_MV} mV, sugar drive ${SUGAR_HZ} Hz)`);
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
run(brain, 200);
ok('settles back to silence', brain.activeCount === 0 && run(brain, 100) === 0, `active ${brain.activeCount}`);

const a = createBrain(data, { seed: 3 }); a.stimulate(groups.sugar, SUGAR_HZ);
const b = createBrain(data, { seed: 3 }); b.stimulate(groups.sugar, SUGAR_HZ);
ok('seeded runs are deterministic', run(a, 300) === run(b, 300));

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
