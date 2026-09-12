#!/usr/bin/env node
// scripts/verify-unfold.mjs — headless checks for the STL unfolder.
//
//   node scripts/verify-unfold.mjs

import { parseStl, writeAscii, writeBinary } from '../unfold/stl.js';
import { buildMesh } from '../unfold/mesh.js';
import { unfold, foldPositions, toPatterns, polysOverlap } from '../unfold/unfold.js';
import { solveOnePiece, Net, tabuSearch } from '../unfold/solver.js';
import { decimate } from '../unfold/decimate.js';
import { existsSync, readFileSync } from 'node:fs';
import { SAMPLES } from '../unfold/samples.js';
import { assemble, toSvg } from '../crease/export.js';

let failures = 0, checks = 0;
const ok = (name, cond, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ': ' + detail : ''}`); }
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const section = t => console.log(`\n${t}`);
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ── STL ─────────────────────────────────────────────────────────────────── */

section('stl');
{
  const src = SAMPLES.cube(10);
  const a = parseStl(writeAscii(src)), b = parseStl(writeBinary(src));
  ok('ascii round-trips', a.length === src.length && a.every((v, i) => near(v, src[i], 1e-9)));
  ok('binary round-trips', b.length === src.length && b.every((v, i) => near(v, src[i], 1e-6)));
  ok('ascii and binary agree', a.every((v, i) => near(v, b[i], 1e-6)));
  ok('binary detected from a Uint8Array', parseStl(new Uint8Array(writeBinary(src))).length === src.length);
}

/* ── Mesh ────────────────────────────────────────────────────────────────── */

section('mesh: cube');
const cubeMesh = buildMesh(SAMPLES.cube(40));
{
  ok('12 triangles', cubeMesh.triCount === 12);
  ok('8 welded vertices', cubeMesh.verts.length === 8);
  ok('6 faces after coplanar merge', cubeMesh.faces.length === 6, `${cubeMesh.faces.length}`);
  ok('every face is a quad', cubeMesh.faces.every(f => f.verts.length === 4));
  ok('12 foldable edges', cubeMesh.edges.length === 12, `${cubeMesh.edges.length}`);
  ok('every edge is a 90° convex fold', cubeMesh.edges.every(e => near(e.dihedral, Math.PI / 2, 1e-9)));
  ok('normals point outward', cubeMesh.faces.every(f => f.normal[0] * f.centroid[0] + f.normal[1] * f.centroid[1] + f.normal[2] * f.centroid[2] > 0));
  ok('no warnings', cubeMesh.warnings.length === 0, cubeMesh.warnings.join('; '));
}

section('mesh: others');
const meshes = { cube: cubeMesh };
for (const [name, gen] of Object.entries(SAMPLES)) {
  if (name === 'cube') continue;
  meshes[name] = buildMesh(gen());
}
ok('octahedron: 8 triangles, 12 edges', meshes.octahedron.faces.length === 8 && meshes.octahedron.edges.length === 12);
ok('icosahedron: 20 faces, 30 edges', meshes.icosahedron.faces.length === 20 && meshes.icosahedron.edges.length === 30);
ok('gem: 13 faces (table + 6 crown + 6 pavilion)', meshes.gem.faces.length === 13, `${meshes.gem.faces.length}`);
ok('gem: table is a hexagon', meshes.gem.faces.some(f => f.verts.length === 6));
ok('gem: crown facets are quads', meshes.gem.faces.filter(f => f.verts.length === 4).length === 6);
ok('convex sample edges are all convex', ['cube', 'octahedron', 'icosahedron', 'dodecahedron', 'gem', 'sphere', 'house'].filter(k => meshes[k]).every(k => meshes[k].edges.every(e => e.dihedral > 0)));
  ok('star has concave edges', !meshes.star || meshes.star.edges.some(e => e.dihedral < 0));
ok('closed meshes: no boundary warnings', Object.values(meshes).every(m => m.warnings.length === 0));

/* ── Unfold: cube ────────────────────────────────────────────────────────── */

section('unfold: cube');
const cube = unfold(cubeMesh, { sheet: { w: 210, h: 297 }, margin: 5 });
{
  ok('one island', cube.islands.length === 1, `${cube.islands.length}`);
  ok('5 fold edges, 7 cut edges', cube.foldEdges.length === 5 && cube.cutEdges.length === 7, `${cube.foldEdges.length}/${cube.cutEdges.length}`);
  ok('one sheet', cube.sheets.length === 1);
  // Isometry: every 2D edge length equals its 3D length.
  const iso = cubeMesh.faces.every((f, fi) => f.verts.every((vi, j) => {
    const vj = f.verts[(j + 1) % f.verts.length];
    return near(d2(cube.flat3[fi][j], cube.flat3[fi][(j + 1) % f.verts.length]), d3(cubeMesh.verts[vi], cubeMesh.verts[vj]), 1e-6);
  }));
  ok('2D edge lengths equal 3D edge lengths', iso);
  ok('7 tabs, none missing', cube.stats.tabs === 7 && cube.stats.noTab === 0, `${cube.stats.tabs}/${cube.stats.noTab}`);
  ok('every tab hinge is a mountain', cube.islands[0].folds.filter(f => f.tab).every(f => f.mountain));
  ok('outline is a single loop', cube.islands[0].loops.length === 1, `${cube.islands[0].loops.length}`);
  // 4 sides × 4 = 16 face-edge segments, 7 tabs add 2 points each; boundary of a hexomino
  ok('outline has 14 face corners + 14 tab corners', cube.islands[0].loops[0].length === 28, `${cube.islands[0].loops[0].length}`);
}

/* ── Unfold: overlaps, tabs, labels for every sample ─────────────────────── */

section('unfold: all samples');
const results = {};
for (const [name, mesh] of Object.entries(meshes)) {
  const r = unfold(mesh, { sheet: { w: 210, h: 297 }, margin: 5 });
  results[name] = r;
  let overlap = false, tabClash = false;
  for (const isl of r.islands) {
    for (let i = 0; i < isl.polys.length && !overlap; i++) for (let j = i + 1; j < isl.polys.length; j++) if (polysOverlap(isl.polys[i], isl.polys[j])) { overlap = true; break; }
    for (const t of isl.tabs) {
      if (isl.polys.some(p => polysOverlap(t.poly, p))) tabClash = true;
      for (const u of isl.tabs) if (u !== t && polysOverlap(t.poly, u.poly)) tabClash = true;
    }
  }
  ok(`${name}: no face overlaps`, !overlap);
  ok(`${name}: tabs overlap nothing`, !tabClash);
  ok(`${name}: every face placed`, r.flat3.every(p => p && p.length >= 3));
  const counts = new Map();
  for (const isl of r.islands) for (const l of isl.labels) counts.set(l.text, (counts.get(l.text) || 0) + 1);
  const expected = r.cutEdges.every((e, k) => {
    return counts.get(String(k + 1)) === 2;
  });
  ok(`${name}: each cut number appears exactly twice (tab + face, or both faces)`, expected);
  // Packing keeps everything inside the usable area.
  const inside = r.islands.every(isl => isl.pLoops.every(loop => loop.every(([x, y]) => x >= -1e-6 && y >= -1e-6 && x <= r.uW + 1e-6 && y <= r.uH + 1e-6)));
  ok(`${name}: packed islands lie inside the sheet minus margin`, inside);
  // Fold at t = 1 reproduces the model.
  const folded = foldPositions(r, 1);
  const err = Math.max(...mesh.faces.map((f, fi) => Math.max(...f.verts.map((vi, j) => d3(folded[fi][j], r.target[vi])))));
  ok(`${name}: fold at t=1 reproduces every vertex`, err < 1e-6, `max error ${err}`);
  const flat = foldPositions(r, 0);
  ok(`${name}: fold at t=0 is the flat net`, flat.every((poly, fi) => poly.every((p, j) => d3(p, r.flat3[fi][j]) < 1e-9)));
  const mid = foldPositions(r, 0.5);
  const lenOk = mesh.faces.every((f, fi) => f.verts.every((vi, j) => near(d3(mid[fi][j], mid[fi][(j + 1) % f.verts.length]), d3(mesh.verts[vi], mesh.verts[f.verts[(j + 1) % f.verts.length]]), 1e-6)));
  ok(`${name}: faces stay rigid mid-fold`, lenOk);
}

/* ── Sheet limits force islands ──────────────────────────────────────────── */

section('unfold: small sheet');
{
  const r = unfold(cubeMesh, { sheet: { w: 100, h: 100 }, margin: 5 });
  ok('cube on a 100 mm sheet splits into islands', r.islands.length > 1, `${r.islands.length}`);
  ok('every island fits', r.islands.every(isl => isl.w <= r.uW + 1e-6 && isl.h <= r.uH + 1e-6));
  const folded = foldPositions(r, 1);
  const err = Math.max(...cubeMesh.faces.map((f, fi) => Math.max(...f.verts.map((vi, j) => d3(folded[fi][j], r.target[vi])))));
  ok('multi-island fold still assembles', err < 1e-6, `${err}`);
  const big = unfold(cubeMesh, { sheet: { w: 100, h: 100 }, margin: 5, scale: 3 });
  ok('an oversize model still yields sheets', big.sheets.length >= 1);
}

/* ── Options ─────────────────────────────────────────────────────────────── */

section('unfold: options');
{
  const noTabs = unfold(cubeMesh, { tabs: false });
  ok('tabs off yields no tabs', noTabs.stats.tabs === 0 && noTabs.islands[0].loops[0].length === 14);
  const noLabels = unfold(cubeMesh, { labels: false });
  ok('labels off yields no labels', noLabels.islands.every(i => i.labels.length === 0));
  const out = toPatterns(unfold(cubeMesh, { scoreFace: 'outside' }))[0], inn = toPatterns(unfold(cubeMesh, { scoreFace: 'inside' }))[0];
  ok('outside scoring: cube folds are all mountains', out.mountains.length === 12 && out.valleys.length === 0, `${out.mountains.length}/${out.valleys.length}`);
  ok('inside scoring: cube folds are all valleys', inn.valleys.length === 12 && inn.mountains.length === 0);
  const topOut = Math.max(...out.cuts.flatMap(c => c.pts.map(p => p[1]))), topIn = Math.max(...inn.cuts.flatMap(c => c.pts.map(p => p[1])));
  ok('inside view is the mirror of the outside view', near(out.cuts[0].pts[0][1] + inn.cuts[0].pts[0][1], topOut, 1e-9) && near(topOut, topIn, 1e-9));
  ok('net content starts at the top of the page', near(Math.min(...out.cuts.flatMap(c => c.pts.map(p => p[1]))), 0, 1e-9) && near(Math.min(...inn.cuts.flatMap(c => c.pts.map(p => p[1]))), 0, 1e-9));
  ok('label angles stay readable', out.labels.every(l => l.angle > -90 && l.angle <= 90));
  const one = unfold(cubeMesh, { scale: 1, sheet: { w: 800, h: 800 } }), two2 = unfold(cubeMesh, { scale: 2, sheet: { w: 800, h: 800 } });
  ok('scale doubles the net', one.islands.length === 1 && two2.islands.length === 1 && near(two2.islands[0].w, one.islands[0].w * 2, 1e-6));
}

/* ── Export ──────────────────────────────────────────────────────────────── */

section('export');
{
  const pats = toPatterns(results.gem);
  const asm = assemble(pats[0], { strategy: 'same', margin: 5 });
  const svg = toSvg(asm.files[0], asm.page, { title: 'gem' });
  ok('page is the sheet size', near(asm.page.w, 210) && near(asm.page.h, 297));
  for (const g of ['cut', 'mountain', 'valley', 'label']) ok(`svg has ${g} group`, svg.includes(`<g id="${g}"`));
  ok('labels are text elements', (svg.match(/<text/g) || []).length === pats[0].labels.length && pats[0].labels.length > results.gem.islands.reduce((a, i) => a + i.labels.length, 0));
  ok('m/v marks accompany folds', pats[0].labels.filter(l => l.text === 'm' || l.text === 'v').length > 0);
  ok('no NaN', !svg.includes('NaN'));
  const open = (svg.match(/<g\b/g) || []).length, close = (svg.match(/<\/g>/g) || []).length;
  ok('groups balanced', open === close);
  const two = assemble(pats[0], { strategy: 'two', margin: 5 });
  ok('two-sided keeps labels on the front only', two.files[0].layers.label.length > 0 && !(two.files[1].layers.label || []).length);
  const plain = toSvg(assemble({ cuts: [], mountains: [], valleys: [], w: 10, h: 10 }, { strategy: 'same', margin: 1 }).files[0], { w: 12, h: 12 }, {});
  ok('no label group when there are no labels', !plain.includes('id="label"'));
}

/* ── One piece ───────────────────────────────────────────────────────────── */

section('one piece: search');
{
  const noOverlap = r => r.islands.every(isl => { for (let i = 0; i < isl.polys.length; i++) for (let j = i + 1; j < isl.polys.length; j++) if (polysOverlap(isl.polys[i], isl.polys[j])) return false; return true; });
  for (const id of ['torus', 'star', 'sphere', 'dodecahedron', 'house']) {
    const m = buildMesh(SAMPLES[id]());
    const r = unfold(m, { onePiece: true });
    ok(`${id}: one piece without simplifying`, r.stats.islands === 1, `${r.stats.islands} pieces after ${r.stats.tries} tries`);
    ok(`${id}: no overlaps in the net`, noOverlap(r));
    ok(`${id}: page is the net size, not the sheet`, near(r.uW, r.stats.netW) && r.uW < 5000);
    ok(`${id}: every face placed once`, r.order.length === m.faces.length && new Set(r.order).size === m.faces.length);
  }
  const m = buildMesh(SAMPLES.torus());
  const r1 = unfold(m, { onePiece: true, scale: 1, tabs: false }), r2 = unfold(m, { onePiece: true, scale: 3, tabs: false, tree: r1.tree });
  ok('tree reuse gives the same net scaled', near(r2.stats.netW, r1.stats.netW * 3, 1e-6) && r2.stats.islands === 1);
  ok('one piece does not split for a small sheet', unfold(m, { onePiece: true, sheet: { w: 40, h: 40 } }).stats.islands === 1);
}

section('one piece: decimate');
{
  const m = buildMesh(SAMPLES.sphere());
  const soup = decimate(m, 40);
  const d = buildMesh(soup);
  ok('sphere 80 → about 40 triangles', d.triCount <= 40 && d.triCount >= 30, `${d.triCount}`);
  ok('decimated sphere stays closed', d.warnings.every(w => !/open edge/.test(w)));
  const bad = decimate(m, 4);
  ok('decimating to the floor still yields a solid', buildMesh(bad).triCount >= 4);
  const r0 = 20; let maxDev = 0;
  for (let i = 0; i < soup.length; i += 3) maxDev = Math.max(maxDev, Math.abs(Math.hypot(soup[i], soup[i + 1], soup[i + 2]) - r0) / r0);
  ok('decimated vertices stay near the sphere', maxDev < 0.25, `${maxDev}`);
}

section('one piece: solve');
{
  const noisy = (soup0, amp) => { const soup = Array.from(soup0); let s = 7; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; const key = new Map();
    for (let i = 0; i < soup.length; i += 3) { const k = soup.slice(i, i + 3).map(x => x.toFixed(4)).join(','); if (!key.has(k)) key.set(k, 1 + amp * (rnd() - 0.5)); const f = key.get(k); soup[i] *= f; soup[i + 1] *= f; soup[i + 2] *= f; } return soup; };
  const verifiedOverlaps = u => { let n = 0; for (const isl of u.islands) for (let i = 0; i < isl.polys.length; i++) for (let j = i + 1; j < isl.polys.length; j++) if (polysOverlap(isl.polys[i], isl.polys[j])) n++; return n; };

  // Net bookkeeping against brute force.
  const bm = buildMesh(noisy(SAMPLES.sphere(), 0.4));
  const net = new Net(bm, 3);
  net.grow(0.3);
  let brute = 0; for (let i = 0; i < net.F; i++) for (let j = i + 1; j < net.F; j++) if (net.comp[i] === net.comp[j] && polysOverlap(net.pos[i], net.pos[j])) brute++;
  ok('grid overlap count matches brute force', net.total === brute, `${net.total} vs ${brute}`);
  const before = net.pos.map(p => p.map(q => q.slice()));
  net.reroot(17);
  ok('reroot keeps every position', net.pos.every((p, i) => p.every((q, k) => near(q[0], before[i][k][0], 1e-9) && near(q[1], before[i][k][1], 1e-9))));
  ok('reroot makes the chosen face the root', net.parent[17] === -1 && net.parent.filter(p => p < 0).length === net.components);
  const t = net.tree('x');
  ok('tree order lists parents before children', t.order.every((f, i) => t.parent[f] < 0 || t.order.indexOf(t.parent[f]) < i));
  ok('tree spans every face once', t.order.length === net.F && new Set(t.order).size === net.F);

  const plain = unfold(bm, {});
  const t0 = Date.now();
  const solved = await solveOnePiece(noisy(SAMPLES.sphere(), 0.4), { minFaces: 10, timeLimit: 8000 });
  ok('bumpy sphere: plain unfold needs several pieces', plain.stats.islands > 1, `${plain.stats.islands}`);
  ok('bumpy sphere: tabu solves it without simplifying', solved.overlaps === 0 && solved.rounds === 0, `${solved.overlaps} overlaps, ${solved.rounds} rounds`);
  const su = unfold(solved.mesh, { onePiece: true, tree: solved.tree });
  ok('bumpy sphere: unfold from the solved tree is one clean piece', su.stats.islands === 1 && verifiedOverlaps(su) === 0);
  ok('solver reports the original face count', solved.simplifiedFrom === bm.faces.length);
  console.log(`        (${solved.simplifiedFrom} → ${solved.mesh.faces.length} faces, ${Date.now() - t0} ms, ${solved.tree.info})`);

  const eevee = '/Users/josh/Downloads/eevee_lowpoly_flowalistik.STL';
  if (existsSync(eevee)) {
    const buf = readFileSync(eevee);
    const t1 = Date.now();
    const es = await solveOnePiece(parseStl(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), { minFaces: 20, timeLimit: 15000 });
    const eu = unfold(es.mesh, { onePiece: true, tree: es.tree });
    ok('eevee: solver reaches one piece', es.overlaps === 0 && eu.stats.islands === 1, `${es.overlaps} overlaps at ${es.mesh.faces.length} faces`);
    ok('eevee: solved net has no overlaps', verifiedOverlaps(eu) === 0);
    ok('eevee: solved within 45 s', es.ms < 45000, `${es.ms} ms`);
    console.log(`        (eevee ${es.simplifiedFrom} → ${es.mesh.faces.length} faces in ${es.rounds} rounds, ${Date.now() - t1} ms, ${es.tree.info})`);
  } else console.log('        (eevee STL not present, skipped)');
}

section('labels');
{
  const m = buildMesh(SAMPLES.cube());
  const r = unfold(m, { labels: true, tabs: true });
  const withTab = r.cutEdges.filter(e => r.islands[0].tabs.some(t => t.edge === e)).length;
  const total = r.islands.reduce((a, i) => a + i.labels.length, 0);
  ok('one number per face edge plus one per tab', total === r.cutEdges.length + withTab + (r.cutEdges.length - withTab), `${total}`);
  ok('numbers are 2 mm', r.islands[0].labels.every(l => l.size <= 2));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
