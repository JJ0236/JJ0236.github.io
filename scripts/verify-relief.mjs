#!/usr/bin/env node
// scripts/verify-relief.mjs — headless check of the relief generator.
//
// Generates panels across patterns/sizes and asserts each solid is watertight,
// wound outward, dimensioned exactly as requested, and NaN-free.
//
//   node scripts/verify-relief.mjs

import { generateFeatures, buildHeightfield } from '../relief/patterns.js';
import { gridForPanel, buildSolid, checkManifold, signedVolume, boundingBox }
  from '../relief/mesh.js';

const ALL = ['dome', 'shard', 'cone', 'ring', 'ripple', 'steps', 'puck'];

const cases = [
  { name: 'bubbles 200x200',  widthMm: 200, heightMm: 200, depthMm: 15, baseMm: 4,  shapes: ['dome'],  sizeMinMm: 8, sizeMaxMm: 40, density: 0.85, seed: 42,  cellMm: 0.6 },
  { name: 'shards 300x150',   widthMm: 300, heightMm: 150, depthMm: 20, baseMm: 3,  shapes: ['shard'], sizeMinMm: 12, sizeMaxMm: 55, density: 0.9,  seed: 7,   cellMm: 0.6 },
  { name: 'mixed 120x250',    widthMm: 120, heightMm: 250, depthMm: 10, baseMm: 2,  shapes: ['dome', 'shard'], sizeMinMm: 6, sizeMaxMm: 30, density: 0.8, seed: 999, cellMm: 0.5 },
  { name: 'tiny 40x40 fine',  widthMm: 40,  heightMm: 40,  depthMm: 6,  baseMm: 1,  shapes: ['cone', 'ring'], sizeMinMm: 3, sizeMaxMm: 12, density: 0.9, seed: 3,   cellMm: 0.25 },
  { name: 'inch panel 12x12in', widthMm: 304.8, heightMm: 304.8, depthMm: 19.05, baseMm: 6.35, shapes: ['dome'], sizeMinMm: 10, sizeMaxMm: 50, density: 0.85, seed: 11, cellMm: 0.8 },
  { name: 'chaos all shapes', widthMm: 220, heightMm: 220, depthMm: 16, baseMm: 3,  shapes: [...ALL], sizeMinMm: 8, sizeMaxMm: 45, density: 0.9, seed: 555, cellMm: 0.6 },
  { name: 'effects combo',    widthMm: 180, heightMm: 240, depthMm: 14, baseMm: 3,  shapes: ['ripple', 'steps', 'puck'], sizeMinMm: 10, sizeMaxMm: 35, density: 0.85, seed: 77, cellMm: 0.5, gradient: 'linear', swell: 0.35, frameMm: 12 },
  { name: 'radial + frame',   widthMm: 250, heightMm: 250, depthMm: 18, baseMm: 4,  shapes: ['dome', 'ring'], sizeMinMm: 9, sizeMaxMm: 50, density: 0.9, seed: 8, cellMm: 0.6, gradient: 'radial', frameMm: 20 }
];

let failures = 0;
const fail = (c, msg) => { failures++; console.error(`  FAIL  ${c}: ${msg}`); };

for (const params of cases) {
  const t0 = Date.now();
  const features = generateFeatures(params);
  const { nx, ny } = gridForPanel(params.widthMm, params.heightMm, params.cellMm);
  const heights = buildHeightfield(features, params, nx, ny);
  const positions = buildSolid(heights, nx, ny, params);
  const tris = positions.length / 9;

  if (features.length < 10) fail(params.name, `only ${features.length} features placed`);

  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) { fail(params.name, `non-finite coordinate at ${i}`); break; }
  }

  const m = checkManifold(positions);
  if (!m.ok) fail(params.name, `not watertight: ${m.openEdges} open, ${m.duplicateEdges} dup edges`);

  const vol = signedVolume(positions);
  const slabVol = params.widthMm * params.heightMm * params.baseMm;
  const bboxVol = params.widthMm * params.heightMm * (params.baseMm + params.depthMm);
  if (vol <= 0) fail(params.name, `signed volume ${vol.toFixed(1)} — inward winding`);
  else if (vol < slabVol * 0.99) fail(params.name, `volume ${vol.toFixed(0)} below base slab ${slabVol.toFixed(0)}`);
  else if (vol > bboxVol) fail(params.name, `volume ${vol.toFixed(0)} exceeds bbox ${bboxVol.toFixed(0)}`);

  const bb = boundingBox(positions);
  const eps = 1e-3;
  if (Math.abs(bb.size[0] - params.widthMm) > eps) fail(params.name, `width ${bb.size[0]} != ${params.widthMm}`);
  if (Math.abs(bb.size[1] - params.heightMm) > eps) fail(params.name, `height ${bb.size[1]} != ${params.heightMm}`);
  // The heightfield peak is normalized to the requested depth, so total
  // height should be exact to float32 rounding.
  const total = params.baseMm + params.depthMm;
  const zTol = 0.01;
  if (bb.size[2] > total + eps) fail(params.name, `z ${bb.size[2]} exceeds ${total}`);
  if (bb.size[2] < total - zTol) fail(params.name, `z ${bb.size[2]} well under ${total}`);
  if (Math.abs(bb.min[0]) > eps || Math.abs(bb.min[1]) > eps || Math.abs(bb.min[2]) > eps) {
    fail(params.name, `model not at origin: min ${bb.min}`);
  }

  console.log(`  ok    ${params.name.padEnd(22)} ${String(features.length).padStart(4)} features, ` +
    `${String(tris).padStart(8)} tris, vol ${(vol / 1000).toFixed(1)} cm³, ` +
    `z ${bb.size[2].toFixed(2)}/${total.toFixed(2)} mm, ${Date.now() - t0} ms`);
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll relief checks passed.');
