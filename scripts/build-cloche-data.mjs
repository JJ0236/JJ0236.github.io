#!/usr/bin/env node
// scripts/build-cloche-data.mjs — pack the FlyWire v783 connectome into
// cloche/data/brain.bin and cloche/data/groups.json.
//
//   node scripts/build-cloche-data.mjs [--src DIR]
//
// Source files are the public Codex exports (no login needed):
//   https://storage.googleapis.com/flywire-data/codex/data/fafb/783/
//     neurons.csv.gz classification.csv.gz consolidated_cell_types.csv.gz
//     coordinates.csv.gz labels.csv.gz connections.csv.gz
// Any file missing from --src is downloaded there first.
//
// Connections are summed per (pre, post) pair across neuropils; pairs with
// fewer than 5 synapses are dropped (the Codex table already only contains
// pairs whose total is ≥5, this just makes it explicit). Weight sign comes
// from the presynaptic neuron's predicted neurotransmitter: GABA and
// glutamate inhibit, everything else excites (Shiu et al. 2024).

import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encodeBrain, CLASS_NAMES } from '../cloche/data.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const args = process.argv.slice(2);
const srcIdx = args.indexOf('--src');
const SRC = srcIdx >= 0 ? args[srcIdx + 1]
  : (process.env.CLOCHE_SRC || '/private/tmp/claude-501/-Users-josh-Documents-GitHub-JJ0236-github-io/c9b5ef8b-4728-45dd-b1ae-36498165b90e/scratchpad');
const BUCKET = 'https://storage.googleapis.com/flywire-data/codex/data/fafb/783/';
const FILES = ['neurons.csv.gz', 'classification.csv.gz', 'consolidated_cell_types.csv.gz', 'coordinates.csv.gz', 'labels.csv.gz', 'connections.csv.gz'];
const OUT = join(repo, 'cloche', 'data');

// Known ids for the groups that have no clean type column (v783 root ids).
const MN9 = ['720575940618238523', '720575940660219265'];
// Descending neurons that respond most strongly to Johnston's organ drive in
// this model (DNpe014, DNp73 and DNb06 pairs, found with scripts/verify-cloche.mjs).
// The page reads them as its grooming signal; the community "putative aDN"
// labels are kept as a separate group but stay silent under JO drive.
const GROOM = ['720575940628796780', '720575940619548799', '720575940629586417', '720575940655587489', '720575940629041879', '720575940637308605'];
const MN6 = ['720575940627410451', '720575940628826128'];
// Sugar GRNs Shiu et al. drove (v630 list, 20 of 21 survive in v783); used
// as a sanity check on the label-derived set.
const SHIU_SUGAR = ['720575940624963786', '720575940630233916', '720575940637568838', '720575940638202345', '720575940617000768', '720575940630797113', '720575940632889389', '720575940621754367', '720575940621502051', '720575940640649691', '720575940639332736', '720575940616885538', '720575940639198653', '720575940620900446', '720575940617937543', '720575940632425919', '720575940633143833', '720575940612670570', '720575940628853239', '720575940629176663', '720575940611875570'];

async function ensure(file) {
  const path = join(SRC, file);
  if (existsSync(path)) return path;
  mkdirSync(SRC, { recursive: true });
  process.stdout.write(`downloading ${file}… `);
  const res = await fetch(BUCKET + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
  console.log('done');
  return path;
}

async function* lines(path) {
  const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (line) yield line;
  }
}

// Minimal CSV split that respects double-quoted fields (labels.csv has them).
function splitCsv(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const t0 = Date.now();
for (const f of FILES) await ensure(f);

// 1. neurons: index and sign
const index = new Map();   // root id string → index
const rootIds = [];
const sign = [];
const ntType = [];
let unpredicted = 0;
for await (const line of lines(join(SRC, 'neurons.csv.gz'))) {
  const c = line.split(',');
  const id = c[0], nt = c[2];
  index.set(id, rootIds.length);
  rootIds.push(id);
  ntType.push(nt);
  if (!nt) unpredicted++;
  sign.push(nt === 'GABA' || nt === 'GLUT' ? -1 : 1);
}
const N = rootIds.length;
console.log(`neurons ${N} (${unpredicted} without a transmitter prediction, treated as excitatory)`);

// 2. classification: class byte and sub_class for GRNs
const cls = new Uint8Array(N).fill(CLASS_NAMES.indexOf('other'));
const subClass = new Array(N).fill('');
const sideOf = new Array(N).fill('');
for await (const line of lines(join(SRC, 'classification.csv.gz'))) {
  const c = line.split(',');
  const i = index.get(c[0]);
  if (i === undefined) continue;
  const k = CLASS_NAMES.indexOf(c[2]);
  cls[i] = k >= 0 ? k : CLASS_NAMES.indexOf('other');
  subClass[i] = c[4];
  sideOf[i] = c[6];
}

// 3. cell types
const ptype = new Array(N).fill('');
for await (const line of lines(join(SRC, 'consolidated_cell_types.csv.gz'))) {
  const c = line.split(',');
  const i = index.get(c[0]);
  if (i !== undefined) ptype[i] = c[1];
}

// 3b. Data correction: antennal lobe local neurons are GABAergic or
// glutamatergic in every published account (Chou et al. 2010; Schlegel et
// al. 2024), but most of them carry no transmitter prediction in v783 and a
// few are predicted cholinergic. Left excitatory they form a runaway loop
// that ignites the whole brain on any odour. Their sign is forced negative.
const AL_LN = /^(lLN|vLN|il3LN|v2LN|l2LN)/;
let flipped = 0;
for (let i = 0; i < N; i++) if (AL_LN.test(ptype[i]) && sign[i] > 0) { sign[i] = -1; flipped++; }
console.log(`antennal lobe local neurons forced inhibitory: ${flipped}`);

// 4. coordinates: first row per neuron
const pos = new Float64Array(3 * N);
const havePos = new Uint8Array(N);
for await (const line of lines(join(SRC, 'coordinates.csv.gz'))) {
  const c = line.split(',');
  const i = index.get(c[0]);
  if (i === undefined || havePos[i]) continue;
  const m = c[1].match(/\[\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*\]/);
  if (!m) continue;
  pos[3 * i] = +m[1]; pos[3 * i + 1] = +m[2]; pos[3 * i + 2] = +m[3];
  havePos[i] = 1;
}
let missingPos = 0;
for (let i = 0; i < N; i++) if (!havePos[i]) missingPos++;
console.log(`coordinates missing for ${missingPos} neurons`);

// 5. labels: sugar GRNs and aDN
const labelSugar = new Set(), labelADN = new Set(), labelVpo = new Set(), labelOvi = new Set();
for await (const line of lines(join(SRC, 'labels.csv.gz'))) {
  const c = splitCsv(line);
  const i = index.get(c[0]);
  if (i === undefined) continue;
  const l = c[1].toLowerCase();
  if (l.includes('sugar gustatory receptor neuron')) labelSugar.add(i);
  if (l.includes('putative adn')) labelADN.add(i);
  if (l.includes('vpodn')) labelVpo.add(i);
  if (l.includes('ovidn') && !l.includes('not ')) labelOvi.add(i);
}

// 6. connections: sum per pair, ≥5, CSR
console.log('reading connections…');
const pairs = new Map(); // pre * N + post → syn count
let rows = 0;
for await (const line of lines(join(SRC, 'connections.csv.gz'))) {
  const c = line.split(',');
  const a = index.get(c[0]), b = index.get(c[1]);
  if (a === undefined || b === undefined) continue;
  const key = a * N + b;
  pairs.set(key, (pairs.get(key) || 0) + (+c[3]));
  if (++rows % 1000000 === 0) process.stdout.write(`  ${rows / 1e6}M rows\r`);
}
console.log(`  ${rows} rows, ${pairs.size} pairs`);
const outDeg = new Uint32Array(N);
let E = 0, totalSyn = 0;
for (const [key, syn] of pairs) { if (syn >= 5) { outDeg[Math.floor(key / N)]++; E++; totalSyn += syn; } }
const offsets = new Uint32Array(N + 1);
for (let i = 0; i < N; i++) offsets[i + 1] = offsets[i] + outDeg[i];
const targets = new Uint32Array(E);
const weights = new Int8Array(E);
const fill = new Uint32Array(N);
const keys = Array.from(pairs.keys()).filter(k => pairs.get(k) >= 5).sort((x, y) => x - y);
for (const key of keys) {
  const a = Math.floor(key / N), b = key - a * N;
  const k = offsets[a] + fill[a]++;
  targets[k] = b;
  weights[k] = sign[a] * Math.min(127, pairs.get(key));
}
console.log(`edges ${E} (synapses ${totalSyn})`);

// 7. quantise positions
const bbox = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
for (let i = 0; i < N; i++) for (let d = 0; d < 3; d++) {
  const v = pos[3 * i + d];
  if (v < bbox[d]) bbox[d] = v;
  if (v > bbox[d + 3]) bbox[d + 3] = v;
}
const q = new Uint16Array(3 * N);
for (let i = 0; i < N; i++) for (let d = 0; d < 3; d++) {
  q[3 * i + d] = Math.round((pos[3 * i + d] - bbox[d]) / (bbox[d + 3] - bbox[d]) * 65535);
}

// 8. groups
const byType = pred => { const r = []; for (let i = 0; i < N; i++) if (pred(ptype[i], i)) r.push(i); return r; };
const groups = {
  // GRNs are cholinergic; one labelled cell is predicted glutamatergic and is
  // left out so the drive is purely excitatory as in Shiu et al.
  sugar: [...labelSugar].filter(i => subClass[i] === 'sugar/water' && sign[i] > 0).sort((a, b) => a - b),
  bitter: byType((t, i) => subClass[i] === 'bitter'),
  MN9: MN9.map(id => index.get(id)).filter(i => i !== undefined),
  groom: GROOM.map(id => index.get(id)).filter(i => i !== undefined),
  MN6: MN6.map(id => index.get(id)).filter(i => i !== undefined),
  GF: byType(t => t === 'DNp01'),
  DNa01: byType(t => t === 'DNa01'),
  DNa02: byType(t => t === 'DNa02'),
  LC4: byType(t => t === 'LC4'),
  LPLC2: byType(t => t === 'LPLC2'),
  JO: byType(t => t.startsWith('JO-C') || t.startsWith('JO-E')),
  aDN: [...labelADN].sort((a, b) => a - b),
  // olfaction and learning
  fruit: byType(t => ['ORN_DM2', 'ORN_VM2', 'ORN_VM7d', 'ORN_VA6', 'ORN_DL5', 'ORN_DC1'].includes(t)),   // Or22a, Or43b, Or42a, Or82a, Or7a, Or?: fruit esters
  vinegar: byType(t => t === 'ORN_DM1' || t === 'ORN_VA2'),    // Or42b / Or92a, vinegar
  KC: byType(t => t.startsWith('KC')),
  MBON_approach: byType((t, i) => /^MBON/.test(t) && (ntType[i] === 'ACH' || ntType[i] === 'GABA')),
  MBON_avoid: byType((t, i) => /^MBON/.test(t) && ntType[i] === 'GLUT'),
  PAM: byType(t => t.startsWith('PAM')),
  PPL1: byType(t => t.startsWith('PPL1')),
  APL: byType(t => t === 'APL'),
  modulatory: byType((t, i) => ntType[i] === 'DA' || ntType[i] === 'SER' || ntType[i] === 'OCT'),
  background: byType((t, i) => cls[i] === CLASS_NAMES.indexOf('sensory')),
  // courtship and egg laying (female side)
  JO_A: byType(t => t === 'JO-A'),                    // auditory: hears the male's song
  vpoDN: [...labelVpo].sort((a, b) => a - b),         // vaginal plate opening: acceptance
  oviDN: [...labelOvi].sort((a, b) => a - b),         // egg-laying command
};
// Mushroom-body teaching map by compartment (Aso et al. 2014 nomenclature,
// Aso & Rubin 2016, Owald et al. 2015, Perisse et al. 2016). Reward
// dopamine neurons (PAM) share compartments with the glutamatergic,
// avoidance-driving output neurons; punishment neurons (PPL1) share
// compartments with the approach-driving ones. Learning depresses the
// Kenyon-cell synapses onto the output neuron of the same compartment.
const TEACH = {
  PAM01: ['MBON01'],                       // γ5
  PAM02: ['MBON01', 'MBON03', 'MBON04'],   // β'2a
  PAM03: ['MBON02', 'MBON01'],             // β2β'2a
  PAM04: ['MBON02'],                       // β2
  PAM05: ['MBON03', 'MBON04'],             // β'2p
  PAM06: ['MBON03', 'MBON04'],             // β'2m
  PAM07: ['MBON05'],                       // γ4<γ1γ2
  PAM08: ['MBON05'],                       // γ4
  PAM11: ['MBON07'],                       // α1
  PAM15: ['MBON01'],                       // γ5β'2a
  PPL101: ['MBON11'],                      // γ1pedc
  PPL102: ['MBON12'],                      // γ2α'1
  PPL103: ['MBON13', 'MBON18'],            // α'2α2
  PPL104: ['MBON14'],                      // α3
  PPL105: ['MBON16', 'MBON17'],            // α'3
};
const byExactType = {};
for (let i = 0; i < N; i++) if (ptype[i]) (byExactType[ptype[i]] ||= []).push(i);
const teach = {};
groups.reward_DAN = []; groups.punish_DAN = [];
for (const [dan, mbons] of Object.entries(TEACH)) {
  const dIdx = byExactType[dan] || [];
  const mIdx = mbons.flatMap(m => byExactType[m] || []);
  for (const dn of dIdx) teach[dn] = mIdx;
  (dan.startsWith('PAM') ? groups.reward_DAN : groups.punish_DAN).push(...dIdx);
}
groups.teach = teach;
console.log(`teaching map: ${Object.keys(teach).length} dopamine neurons → ${new Set(Object.values(teach).flat()).size} output neurons`);
groups.DN_L = byType((t, i) => cls[i] === CLASS_NAMES.indexOf('descending') && sideOf[i] === 'left');
groups.DN_R = byType((t, i) => cls[i] === CLASS_NAMES.indexOf('descending') && sideOf[i] === 'right');
for (const k of ['DNa01', 'DNa02']) {
  groups[k + '_L'] = groups[k].filter(i => sideOf[i] === 'left');
  groups[k + '_R'] = groups[k].filter(i => sideOf[i] === 'right');
}
const shiuHit = SHIU_SUGAR.map(id => index.get(id)).filter(i => i !== undefined && groups.sugar.includes(i)).length;
console.log(`Shiu sugar ids in our sugar group: ${shiuHit} / ${SHIU_SUGAR.length}`);
for (const [k, v] of Object.entries(groups)) console.log(`  ${k.padEnd(6)} ${v.length}`);

const meta = {
  version: 'fafb-783', neurons: N, edges: E, synapses: totalSyn, threshold: 5,
  rootIds: Object.fromEntries(Object.entries(groups).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.map(i => rootIds[i])])),
};

// type centroids, borrowed by the male build for neurons the male table has no coordinates for
const cent = {};
for (let i = 0; i < N; i++) { const t = ptype[i]; if (!t) continue; const c = cent[t] ||= [0, 0, 0, 0]; c[0] += pos[3 * i]; c[1] += pos[3 * i + 1]; c[2] += pos[3 * i + 2]; c[3]++; }
const centroids = Object.fromEntries(Object.entries(cent).map(([t, c]) => [t, [Math.round(c[0] / c[3]), Math.round(c[1] / c[3]), Math.round(c[2] / c[3])]]));
const classCent = {};
for (let i = 0; i < N; i++) { const c = classCent[cls[i]] ||= [0, 0, 0, 0]; c[0] += pos[3 * i]; c[1] += pos[3 * i + 1]; c[2] += pos[3 * i + 2]; c[3]++; }
// taste signatures: which cell types the sugar and bitter neurons talk to, by synapse count
const sig = grp => { const m = {}; for (const i of grp) for (let k = offsets[i]; k < offsets[i + 1]; k++) { const t = ptype[targets[k]]; if (t) m[t] = (m[t] || 0) + Math.abs(weights[k]); } return m; };
writeFileSync(join(SRC, 'fafb_type_centroids.json'), JSON.stringify({ bbox: Array.from(bbox), centroids, taste: { sugar: sig(groups.sugar), bitter: sig(groups.bitter) }, classCentroids: Object.fromEntries(Object.entries(classCent).map(([k, c]) => [k, [c[0] / c[3], c[1] / c[3], c[2] / c[3]]])) }));

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'brain.bin'), Buffer.from(encodeBrain({ n: N, e: E, bbox, offsets, targets, weights, pos: q, cls })));
writeFileSync(join(OUT, 'groups.json'), JSON.stringify({ ...groups, meta }));
console.log(`wrote ${OUT} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
