#!/usr/bin/env node
// scripts/verify-imprint.mjs — headless check of the photo → slat relief tool.
//
// Builds panels from synthetic images and asserts the solids are watertight,
// dimensioned exactly, oriented correctly (bright = high, invert flips it,
// image top = panel top), and slat-quantized when stacked.
//
//   node scripts/verify-imprint.mjs

import { heightsFromImage } from '../imprint/process.js';
import { gridForPanel, buildSolid, checkManifold, signedVolume, boundingBox }
  from '../relief/mesh.js';

let failures = 0;
const fail = (c, msg) => { failures++; console.error(`  FAIL  ${c}: ${msg}`); };

// Synthetic test image: horizontal gradient dark→bright, plus a bright
// square in the TOP-left quadrant (to catch y-flips).
const IW = 320, IH = 240;
const gray = new Float32Array(IW * IH);
for (let y = 0; y < IH; y++) {
  for (let x = 0; x < IW; x++) {
    let v = x / (IW - 1) * 0.7;
    if (x > IW * 0.05 && x < IW * 0.30 && y > IH * 0.05 && y < IH * 0.30) v = 1;
    gray[y * IW + x] = v;
  }
}

const cases = [
  { name: 'smooth 200x150', widthMm: 200, heightMm: 150, depthMm: 12, baseMm: 3, cellMm: 0.6 },
  { name: 'inverted',       widthMm: 200, heightMm: 150, depthMm: 12, baseMm: 3, cellMm: 0.6, invert: true },
  { name: 'blur + levels',  widthMm: 160, heightMm: 120, depthMm: 10, baseMm: 2, cellMm: 0.5, blurMm: 3, contrast: 1.5, brightness: 0.1 },
  { name: 'slats 1/8in X',  widthMm: 200, heightMm: 150, depthMm: 15, baseMm: 4, cellMm: 0.6, sheetMm: 3.175, sliceAxis: 'x' },
  { name: 'slats 6mm Y',    widthMm: 240, heightMm: 180, depthMm: 20, baseMm: 5, cellMm: 0.6, sheetMm: 6, sliceAxis: 'y' }
];

for (const params of cases) {
  const t0 = Date.now();
  const { nx, ny } = gridForPanel(params.widthMm, params.heightMm, params.cellMm);
  const heights = heightsFromImage(gray, IW, IH, params, nx, ny);
  const positions = buildSolid(heights, nx, ny, params);
  const baseC = Math.max(0.5, params.baseMm);

  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) { fail(params.name, `non-finite coordinate at ${i}`); break; }
  }

  const m = checkManifold(positions);
  if (!m.ok) fail(params.name, `not watertight: ${m.openEdges} open, ${m.duplicateEdges} dup`);
  const vol = signedVolume(positions);
  if (vol <= 0) fail(params.name, `signed volume ${vol.toFixed(1)} — inward winding`);

  const bb = boundingBox(positions);
  const eps = 1e-3;
  if (Math.abs(bb.size[0] - params.widthMm) > eps) fail(params.name, `width ${bb.size[0]}`);
  if (Math.abs(bb.size[1] - params.heightMm) > eps) fail(params.name, `height ${bb.size[1]}`);

  // Full depth range is used: peak == depth (slat mid-lines still hit the
  // bright square / gradient edge since both are wide).
  let peak = 0;
  for (let i = 0; i < heights.length; i++) if (heights[i] > peak) peak = heights[i];
  const zTolPk = params.sheetMm ? params.depthMm * 0.1 : 0.01;
  if (Math.abs(peak - params.depthMm) > zTolPk) fail(params.name, `peak ${peak} vs depth ${params.depthMm}`);
  if (Math.abs(bb.size[2] - (baseC + peak)) > 0.01) fail(params.name, `z ${bb.size[2]} != ${baseC + peak}`);

  // Orientation: sample away from the square. Right side of the image is
  // bright → high (or low when inverted); left edge is dark.
  const h = (fx, fy) => heights[Math.round(fy * (ny - 1)) * nx + Math.round(fx * (nx - 1))];
  const left = h(0.02, 0.5), right = h(0.98, 0.5);
  if (!params.invert && right < left + params.depthMm * 0.3) fail(params.name, `gradient not rising: L=${left.toFixed(2)} R=${right.toFixed(2)}`);
  if (params.invert && left < right + params.depthMm * 0.3) fail(params.name, `invert not flipping: L=${left.toFixed(2)} R=${right.toFixed(2)}`);

  // Y-orientation: bright square is at image TOP-left → panel top-left
  // (high j). Compare against bottom-left which is plain dark gradient.
  if (!params.invert) {
    const tl = h(0.17, 0.85), blc = h(0.17, 0.15);
    if (tl < blc + params.depthMm * 0.3) fail(params.name, `image top not at panel top: tl=${tl.toFixed(2)} bl=${blc.toFixed(2)}`);
  }

  // Slat mode: piecewise-constant along the slicing axis.
  if (params.sheetMm > 0) {
    const alongY = params.sliceAxis === 'y';
    const lines = alongY ? ny : nx;
    let changes = 0;
    for (let a = 0; a < lines - 1; a++) {
      let differs = false;
      for (let b = 0; b < (alongY ? nx : ny); b++) {
        const i0 = alongY ? a * nx + b : b * nx + a;
        const i1 = alongY ? (a + 1) * nx + b : b * nx + a + 1;
        if (heights[i0] !== heights[i1]) { differs = true; break; }
      }
      if (differs) changes++;
    }
    const span = alongY ? params.heightMm : params.widthMm;
    const maxSlats = Math.ceil(span / params.sheetMm);
    if (changes > maxSlats) fail(params.name, `${changes} profile changes > ${maxSlats} slats`);
  }

  console.log(`  ok    ${params.name.padEnd(16)} ${String(positions.length / 9).padStart(8)} tris, ` +
    `vol ${(vol / 1000).toFixed(1)} cm³, z ${bb.size[2].toFixed(2)} mm, ${Date.now() - t0} ms`);
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll imprint checks passed.');
