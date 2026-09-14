#!/usr/bin/env node
// scripts/build-cloche-male.mjs — pack the Janelia male CNS connectome
// (v1.0, CC BY 4.0, via the public Codex bucket) into cloche/data/male.bin
// and cloche/data/male-groups.json, in the same format as brain.bin.
//
//   node scripts/build-cloche-male.mjs [--src DIR]
//
// Source: https://storage.googleapis.com/flywire-data/codex/data/mcns/1.0/
//   neurons.csv.gz (types, transmitter, class, side, community labels)
//   connections_princeton.csv.gz (pre, post, neuropil, syn_count, nt_type)
// The male table carries no coordinates: each neuron is placed at the
// centroid of its cell type in the female (FlyWire) map, written by
// build-cloche-data.mjs; unmatched brain neurons at their class centroid
// with jitter; nerve-cord neurons in a schematic cord below the brain.

import { createReadStream, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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
const SCRATCH = process.env.CLOCHE_SRC || '/private/tmp/claude-501/-Users-josh-Documents-GitHub-JJ0236-github-io/c9b5ef8b-4728-45dd-b1ae-36498165b90e/scratchpad';
const SRC = srcIdx >= 0 ? args[srcIdx + 1] : join(SCRATCH, 'mcns');
const BUCKET = 'https://storage.googleapis.com/flywire-data/codex/data/mcns/1.0/';
const OUT = join(repo, 'cloche', 'data');

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
  for await (const line of rl) { if (first) { first = false; continue; } if (line) yield line; }
}
function splitCsv(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}

const t0 = Date.now();
await ensure('neurons.csv.gz'); await ensure('connections_princeton.csv.gz');
const centroidFile = join(SCRATCH, 'fafb_type_centroids.json');
if (!existsSync(centroidFile)) throw new Error('run scripts/build-cloche-data.mjs first (writes fafb_type_centroids.json)');
const { bbox: fb, centroids, classCentroids, taste } = JSON.parse(readFileSync(centroidFile, 'utf8'));

// 1. neurons
const HDR = ['Root ID', 'Top in/out region', 'Community labels', 'Predicted NT type', 'Predicted NT confidence', 'Verified NT type', 'Verified Neuropeptide', 'Body Part', 'Function', 'Flow', 'Super Class', 'Class', 'Sub Class', 'Hemilineage', 'Nerve', 'Soma side', 'Primary Cell Type'];
const col = Object.fromEntries(HDR.map((h, i) => [h, i]));
const index = new Map(); const rootIds = [], sign = [], ntType = [], superClass = [], subClass = [], side = [], ptype = [], labels = [];
for await (const line of lines(join(SRC, 'neurons.csv.gz'))) {
  const c = splitCsv(line);
  index.set(c[0], rootIds.length);
  rootIds.push(c[0]); ntType.push(c[col['Predicted NT type']]); superClass.push(c[col['Super Class']]); subClass.push(c[col['Sub Class']]);
  side.push(c[col['Soma side']]); ptype.push(c[col['Primary Cell Type']]); labels.push((c[col['Community labels']] || '').toLowerCase());
}
const N = rootIds.length;
console.log(`neurons ${N}`);

// 2. transmitter sign, with the same corrections as the female build plus
//    one the male table needs: Kenyon cells are predicted dopaminergic
//    here; they are cholinergic (Barnstedt et al. 2016), so they are
//    excitatory and not treated as modulatory.
const AL_LN = /^(lLN|vLN|il3LN|v2LN|l2LN)/;
let flipped = 0, kcFixed = 0;
for (let i = 0; i < N; i++) {
  let nt = ntType[i];
  if (ptype[i].startsWith('KC')) { if (nt !== 'ACH') kcFixed++; nt = 'ACH'; ntType[i] = 'ACH'; }
  sign[i] = nt === 'GABA' || nt === 'GLUT' ? -1 : 1;
  if (AL_LN.test(ptype[i]) && sign[i] > 0) { sign[i] = -1; flipped++; }
}
console.log(`antennal lobe local neurons forced inhibitory: ${flipped}; Kenyon cells set cholinergic: ${kcFixed}`);

// 3. class byte
const CLS = { descending_neuron: 'descending', visual_projection: 'visual_projection', visual_centrifugal: 'visual_projection', cb_intrinsic: 'central', ol_intrinsic: 'optic', cb_motor: 'motor', ascending_neuron: 'ascending', cb_endocrine: 'endocrine', cb_sensory: 'sensory', ol_sensory: 'sensory', vnc_sensory: 'sensory', sensory_ascending: 'sensory', sensory_descending: 'sensory', vnc_intrinsic: 'other', vnc_motor: 'motor', vnc_efferent: 'motor', vnc_endocrine: 'endocrine' };
const cls = new Uint8Array(N);
const isVnc = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const sc = superClass[i].replace(/_tbc$/, '');
  const name = CLS[sc] || 'other';
  cls[i] = CLASS_NAMES.indexOf(name);
  isVnc[i] = sc.startsWith('vnc') || sc === 'sensory_ascending' || (sc === 'ascending_neuron') ? 1 : 0;
}

// 4. positions: type centroid from the female map; else class centroid with jitter; nerve cord below
let seed = 12345; const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const pos = new Float64Array(3 * N);
let matched = 0;
const w = fb[3] - fb[0], h = fb[4] - fb[1], dpt = fb[5] - fb[2];
for (let i = 0; i < N; i++) {
  const c = centroids[ptype[i]];
  let x, y, z;
  if (isVnc[i]) {
    // schematic cord: an ellipsoid hanging below the brain, left/right by soma side
    const sx = side[i] === 'left' ? -0.35 : side[i] === 'right' ? 0.35 : 0;
    const u = rnd(), v = rnd(), r = Math.sqrt(rnd());
    x = fb[0] + w * (0.5 + sx * 0.5 * r * Math.cos(u * 6.283)); y = fb[4] + h * (0.55 + 1.1 * v); z = fb[2] + dpt * (0.5 + 0.35 * r * Math.sin(u * 6.283));
  } else if (c && !ptype[i].startsWith('KC')) {
    matched++;
    const j = 12000;
    x = c[0] + (rnd() - 0.5) * j; y = c[1] + (rnd() - 0.5) * j; z = c[2] + (rnd() - 0.5) * j;
    if (side[i] === 'left' && x > (fb[0] + fb[3]) / 2) x = fb[0] + fb[3] - x;
    if (side[i] === 'right' && x < (fb[0] + fb[3]) / 2) x = fb[0] + fb[3] - x;
  } else if (c) { matched++; const j = 30000; x = c[0] + (rnd() - 0.5) * j; y = c[1] + (rnd() - 0.5) * j; z = c[2] + (rnd() - 0.5) * j; }
  else {
    const cc = classCentroids[cls[i]] || classCentroids[1];
    const j = 60000;
    x = cc[0] + (rnd() - 0.5) * j; y = cc[1] + (rnd() - 0.5) * j; z = cc[2] + (rnd() - 0.5) * j;
    if (side[i] === 'left' && x > (fb[0] + fb[3]) / 2) x = fb[0] + fb[3] - x;
    if (side[i] === 'right' && x < (fb[0] + fb[3]) / 2) x = fb[0] + fb[3] - x;
  }
  pos[3 * i] = x; pos[3 * i + 1] = y; pos[3 * i + 2] = z;
}
console.log(`positions: ${matched} from female type centroids, ${N - matched} estimated`);

// 5. connections
console.log('reading connections…');
const pairs = new Map(); let rows = 0;
for await (const line of lines(join(SRC, 'connections_princeton.csv.gz'))) {
  const c = line.split(',');
  const a = index.get(c[0]), b = index.get(c[1]);
  if (a === undefined || b === undefined) continue;
  const key = a * N + b;
  pairs.set(key, (pairs.get(key) || 0) + (+c[3]));
  if (++rows % 1000000 === 0) process.stdout.write(`  ${rows / 1e6}M rows\r`);
}
console.log(`  ${rows} rows, ${pairs.size} pairs`);
const outDeg = new Uint32Array(N); let E = 0, totalSyn = 0;
for (const [key, syn] of pairs) if (syn >= 5) { outDeg[Math.floor(key / N)]++; E++; totalSyn += syn; }
const offsets = new Uint32Array(N + 1);
for (let i = 0; i < N; i++) offsets[i + 1] = offsets[i] + outDeg[i];
const targets = new Uint32Array(E), weights = new Int8Array(E), fill = new Uint32Array(N);
const keys = Array.from(pairs.keys()).filter(k => pairs.get(k) >= 5).sort((x, y) => x - y);
for (const key of keys) { const a = Math.floor(key / N), b = key - a * N; const k = offsets[a] + fill[a]++; targets[k] = b; weights[k] = sign[a] * Math.min(127, pairs.get(key)); }
console.log(`edges ${E} (synapses ${totalSyn})`);

// 6. quantise
const bbox = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
for (let i = 0; i < N; i++) for (let d = 0; d < 3; d++) { const v = pos[3 * i + d]; if (v < bbox[d]) bbox[d] = v; if (v > bbox[d + 3]) bbox[d + 3] = v; }
const q = new Uint16Array(3 * N);
for (let i = 0; i < N; i++) for (let d = 0; d < 3; d++) q[3 * i + d] = Math.round((pos[3 * i + d] - bbox[d]) / (bbox[d + 3] - bbox[d]) * 65535);

// 7. groups
const byType = pred => { const r = []; for (let i = 0; i < N; i++) if (pred(ptype[i], i)) r.push(i); return r; };
const byLabel = re => byType((t, i) => re.test(labels[i]));
// Taste: the male table does not say which labellar neurons taste sugar and
// which bitter. Each labellar gustatory neuron is classified by which cell
// types it talks to, compared with the female sugar and bitter neurons'
// downstream types (from build-cloche-data.mjs): a connectivity homology.
const labellar = byType((t, i) => superClass[i] === 'cb_sensory' && subClass[i] === 'labellar_bristle');
const score = (i, sigm) => { let s = 0, tot = 0; for (let k = offsets[i]; k < offsets[i + 1]; k++) { const t = ptype[targets[k]]; const w = Math.abs(weights[k]); tot += w; if (t && sigm[t]) s += w; } return tot ? s / tot : 0; };
const tasteOf = i => { const a = score(i, taste.sugar), b = score(i, taste.bitter); if (a < 0.15 && b < 0.15) return null; return a >= b * 1.2 ? 'sugar' : b >= a * 1.2 ? 'bitter' : null; };
const tasteClass = new Map(labellar.map(i => [i, tasteOf(i)]));
const groups = {
  sugar: labellar.filter(i => tasteClass.get(i) === 'sugar' && sign[i] > 0),
  bitter: labellar.filter(i => tasteClass.get(i) === 'bitter'),
  MN9: byType(t => t === 'MN9'),
  MN6: byType(t => t === 'MN6'),
  GF: byType(t => t === 'DNp01'),
  DNa01: byType(t => t === 'DNa01'), DNa02: byType(t => t === 'DNa02'),
  LC4: byType(t => t === 'LC4'), LPLC2: byType(t => t === 'LPLC2'),
  JO: byType(t => t.startsWith('JO-C') || t.startsWith('JO-E')),
  JO_A: byType(t => t.startsWith('JO-A')),
  fruit: byType(t => ['ORN_DM2', 'ORN_VM2', 'ORN_VM7d', 'ORN_VA6', 'ORN_DL5', 'ORN_DC1'].includes(t)),
  vinegar: byType(t => t === 'ORN_DM1' || t === 'ORN_VA2'),
  KC: byType(t => t.startsWith('KC')),
  MBON_approach: byType((t, i) => /^MBON/.test(t) && (ntType[i] === 'ACH' || ntType[i] === 'GABA')),
  MBON_avoid: byType((t, i) => /^MBON/.test(t) && (ntType[i] === 'GLUT' || t === 'MBON05')),
  PAM: byType(t => t.startsWith('PAM')), PPL1: byType(t => t.startsWith('PPL1')),
  APL: byType(t => t === 'APL'),
  modulatory: byType((t, i) => ntType[i] === 'DA' || ntType[i] === 'SER' || ntType[i] === 'OCT'),
  background: byType((t, i) => superClass[i] === 'cb_sensory' || superClass[i] === 'ol_sensory'),   // brain sensory only; the cord's are left quiet
  // courtship (male side)
  P1: byType(t => /^pC1_/.test(t)),                           // the male pC1 / P1 cluster: courtship command
  pIP10: byType(t => t === 'pIP10'),                          // descending song command
  vPR6: byType(t => t === 'vPR6'),                            // song pattern neurons in the cord
  LC10a: byType(t => t === 'LC10a'),                          // visual female-tracking
  tpGRN: byType(t => /tpGRN/.test(t)),                        // tarsal pheromone gustatory neurons
  aDN: [],
  groom: [],    // filled below from a JO-drive probe, see verify
};
const TEACH = {
  PAM01: ['MBON01'], PAM02: ['MBON01', 'MBON03', 'MBON04'], PAM03: ['MBON02', 'MBON01'], PAM04: ['MBON02'], PAM05: ['MBON03', 'MBON04'], PAM06: ['MBON03', 'MBON04'], PAM07: ['MBON05'], PAM08: ['MBON05'], PAM11: ['MBON07'], PAM15: ['MBON01'],
  PPL101: ['MBON11'], PPL102: ['MBON12'], PPL103: ['MBON13', 'MBON18'], PPL104: ['MBON14'], PPL105: ['MBON16', 'MBON17'],
};
const byExact = {}; for (let i = 0; i < N; i++) if (ptype[i]) (byExact[ptype[i]] ||= []).push(i);
const teach = {}; groups.reward_DAN = []; groups.punish_DAN = [];
for (const [dan, mbons] of Object.entries(TEACH)) { const dIdx = byExact[dan] || []; const mIdx = mbons.flatMap(m => byExact[m] || []); for (const dn of dIdx) teach[dn] = mIdx; (dan.startsWith('PAM') ? groups.reward_DAN : groups.punish_DAN).push(...dIdx); }
groups.teach = teach;
groups.DN_L = byType((t, i) => cls[i] === CLASS_NAMES.indexOf('descending') && side[i] === 'left');
groups.DN_R = byType((t, i) => cls[i] === CLASS_NAMES.indexOf('descending') && side[i] === 'right');
for (const k of ['DNa01', 'DNa02']) { groups[k + '_L'] = groups[k].filter(i => side[i] === 'left'); groups[k + '_R'] = groups[k].filter(i => side[i] === 'right'); }
// grooming readout: the strongest descending responders to JO drive in this brain (from the verify probe)
const GROOM_TYPES = process.env.MALE_GROOM_TYPES ? process.env.MALE_GROOM_TYPES.split(',') : ['DNpe014', 'DNp73', 'DNb06'];
groups.groom = byType(t => GROOM_TYPES.includes(t));
console.log(`labellar taste neurons ${labellar.length}: sugar ${groups.sugar.length}, bitter ${groups.bitter.length}, unclassified ${labellar.filter(i => !tasteClass.get(i)).length}`);
for (const [k, v] of Object.entries(groups)) if (Array.isArray(v)) console.log(`  ${k.padEnd(14)} ${v.length}`);
const meta = { version: 'mcns-1.0', neurons: N, edges: E, synapses: totalSyn, threshold: 5, sex: 'male', rootIds: Object.fromEntries(Object.entries(groups).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.map(i => rootIds[i])])) };
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'male.bin'), Buffer.from(encodeBrain({ n: N, e: E, bbox, offsets, targets, weights, pos: q, cls })));
writeFileSync(join(OUT, 'male-groups.json'), JSON.stringify({ ...groups, meta }));
console.log(`wrote male.bin in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
