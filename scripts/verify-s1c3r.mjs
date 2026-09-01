#!/usr/bin/env node
// scripts/verify-s1c3r.mjs — end-to-end check of the s1c3r sheet slicer.
//
// Drives the real page in headless Chrome: drops a generated cube STL,
// slices, places an alignment hole by clicking the canvas, and intercepts
// the exported SVGs to assert:
//   - the sheet-count preview matches what the slicer actually produces
//   - switching units auto-re-slices and scales hole positions correctly
//   - axis=Y exports holes in the slicer's (u=z, v=x) sheet coordinates
//   - square holes export as rects with side = hole size
//
// Needs puppeteer-core (not committed):  npm i --no-save puppeteer-core
// Uses the installed Chrome (override with CHROME=/path/to/chrome).
//
//   node scripts/verify-s1c3r.mjs             # serves the repo itself
//   node scripts/verify-s1c3r.mjs --url URL   # test a deployed copy

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequire } from 'node:module';

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  try { // also accept an install relative to wherever the script was run from
    puppeteer = createRequire(join(process.cwd(), 'noop.js'))('puppeteer-core');
  } catch {
    console.error('puppeteer-core is required:  npm i --no-save puppeteer-core');
    process.exit(2);
  }
}

const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// ── Serve the repo unless a URL was given ───────────────────────────────────
let baseUrl = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : null;
let server = null;
if (!baseUrl) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const data = await readFile(join(repoRoot, path));
      res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end();
    }
  });
  await new Promise(r => server.listen(0, r));
  baseUrl = `http://localhost:${server.address().port}`;
}
const pageUrl = baseUrl.replace(/\/$/, '') + '/s1c3r/';

// ── Binary STL cube, 0..20 raw units (the loader centers it to ±10) ─────────
function cubeStl() {
  const quads = [
    [[0,0,-1], [[0,0,0],[0,20,0],[20,20,0],[20,0,0]]],
    [[0,0,1],  [[0,0,20],[20,0,20],[20,20,20],[0,20,20]]],
    [[0,-1,0], [[0,0,0],[20,0,0],[20,0,20],[0,0,20]]],
    [[0,1,0],  [[0,20,0],[0,20,20],[20,20,20],[20,20,0]]],
    [[-1,0,0], [[0,0,0],[0,0,20],[0,20,20],[0,20,0]]],
    [[1,0,0],  [[20,0,0],[20,20,0],[20,20,20],[20,0,20]]],
  ];
  const tris = [];
  for (const [n, [a,b,c,d]] of quads) tris.push([n,a,b,c], [n,a,c,d]);
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let off = 84;
  for (const [n, ...pts] of tris) {
    for (const v of [n, ...pts]) for (const x of v) { dv.setFloat32(off, x, true); off += 4; }
    off += 2;
  }
  return Buffer.from(buf).toString('base64');
}

const eqApprox = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--use-angle=swiftshader', '--window-size=1400,900']
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); failures++; });
await page.goto(pageUrl, { waitUntil: 'networkidle0' });

// Capture exported SVG text instead of downloading.
await page.evaluate(() => {
  window.__svgs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = b => {
    if (b instanceof Blob && b.type.includes('svg')) b.text().then(t => window.__svgs.push(t));
    return orig(b);
  };
  HTMLAnchorElement.prototype.click = function () {}; // suppress downloads
});

// Drop the cube STL onto the viewport.
await page.evaluate(b64 => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'cube.stl'));
  document.getElementById('viewport').dispatchEvent(
    new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
}, cubeStl());
await page.waitForFunction(() =>
  document.getElementById('drop-overlay').style.display === 'none');

// ── 1. Sheet count preview matches actual slicer output ─────────────────────
const predicted = parseInt(
  (await page.$eval('#slice-info', el => el.textContent)).match(/Sheets:\s*(\d+)/)[1], 10);
await page.click('#btn-slice');
await page.waitForFunction(() => document.getElementById('status').textContent.includes('sheets'));
const actual = parseInt(
  (await page.$eval('#status', el => el.textContent)).match(/(\d+) sheets/)[1], 10);
check('sheet count preview matches slicer', predicted === actual, `info=${predicted} actual=${actual}`);
// planes at 1.5875 + k*3.175 <= 20 → k <= 5.8 → 6 sheets
check('expected 6 sheets for 20mm span @ 3.175mm', actual === 6, `got ${actual}`);

// ── 2. Place a hole off-center on the +Z face ───────────────────────────────
const cb = await (await page.$('#viewport canvas')).boundingBox();
await page.click('#btn-place-hole');
await page.mouse.click(cb.x + cb.width / 2 - 60, cb.y + cb.height / 2 + 25);
const holeStatus = await page.$eval('#hole-status', el => el.textContent);
check('hole placed', /1 hole placed/.test(holeStatus), holeStatus);

const svgCount = () => page.evaluate(() => window.__svgs.length);
const lastSvg = () => page.evaluate(() => window.__svgs[window.__svgs.length - 1]);
const holeCircle = svg => {
  const m = svg.match(/<circle class="hole" cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.-]+)"/);
  return m && { cx: +m[1], cy: +m[2], r: +m[3] };
};

// ── 3. Export in mm, recover the hole's raw coordinates ─────────────────────
await page.click('#btn-export');
await page.waitForFunction(n => window.__svgs.length > n, {}, 0);
const svgMm = await lastSvg();
const hMm = holeCircle(svgMm);
check('mm export contains hole circle', !!hMm);
// margin=5, sheet spans -10..10 → cx = 5 + (px+10). Recover raw px, py.
const px = hMm.cx - 5 - 10, py = hMm.cy - 5 - 10;
check('hole is off-center (test is meaningful)',
  Math.abs(px) > 0.5 && Math.abs(py) > 0.5, `px=${px.toFixed(2)} py=${py.toFixed(2)}`);
check('sheet is 20mm', /20\.0x20\.0 mm each/.test(svgMm));

// ── 4. Switch units to inch → auto-reslice + hole scales with it ────────────
let before = await svgCount();
await page.select('#sel-units', '25.4');
await page.waitForFunction(() => /sheets/.test(document.getElementById('status').textContent));
const inchCount = parseInt(
  (await page.$eval('#status', el => el.textContent)).match(/(\d+) sheets/)[1], 10);
check('auto-resliced on unit change (160 sheets for 508mm span)', inchCount === 160, `got ${inchCount}`);
await page.click('#btn-export');
await page.waitForFunction(n => window.__svgs.length > n, {}, before);
const hIn = holeCircle(await lastSvg());
check('inch export: hole position scaled by 25.4',
  hIn && eqApprox(hIn.cx, 5 + (px + 10) * 25.4, 0.6) && eqApprox(hIn.cy, 5 + (py + 10) * 25.4, 0.6),
  hIn && `cx=${hIn.cx} expected≈${(5 + (px + 10) * 25.4).toFixed(1)}`);

// ── 5. Back to mm, switch axis to Y → hole must use slicer's (u=z, v=x) ─────
await page.select('#sel-units', '1');
await page.waitForFunction(() => /sheets/.test(document.getElementById('status').textContent));
before = await svgCount();
await page.select('#sel-axis', 'y');
await new Promise(r => setTimeout(r, 300)); // reslice
await page.click('#btn-export');
await page.waitForFunction(n => window.__svgs.length > n, {}, before);
const hY = holeCircle(await lastSvg());
// Click was on the +z face → pz = 10 exactly. Slicer for axis=y: u=z, v=x.
check('axis=Y export: hole u comes from z (u=pz=10 → cx=25)',
  hY && eqApprox(hY.cx, 25, 0.1), hY && `cx=${hY.cx}`);
check('axis=Y export: hole v comes from x (cy=5+px+10)',
  hY && eqApprox(hY.cy, 5 + px + 10, 0.1), hY && `cy=${hY.cy}`);

// ── 6. Square hole exports as a rect with side = hole size ──────────────────
await page.select('#sel-hole-shape', 'square');
await new Promise(r => setTimeout(r, 200));
before = await svgCount();
await page.click('#btn-export');
await page.waitForFunction(n => window.__svgs.length > n, {}, before);
const svgSq = await lastSvg();
check('square hole exports as <rect>', /<rect class="hole"/.test(svgSq));
check('square hole side = hole size (6mm)', /<rect class="hole"[^>]*width="6\.0000"/.test(svgSq));

await browser.close();
if (server) server.close();
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll s1c3r checks passed.');
