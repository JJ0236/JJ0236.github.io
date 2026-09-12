#!/usr/bin/env node
// scripts/verify-crease.mjs — headless checks for the origami crease generator.
//
//   node scripts/verify-crease.mjs

import { PATTERNS, build, defaults, vertexMap, kawasakiDefect, segLength, totalLength, clipSegment } from '../crease/patterns.js';
import { assemble, chain, dashItems, mirrorX, toSvg, translate } from '../crease/export.js';
import { patternSegments, planarGraph, buildFoldModel, FoldSim, dihedral, miuraKinematics, FOLD_LIMITS } from '../crease/fold.js';

let failures = 0, checks = 0;
const ok = (name, cond, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ': ' + detail : ''}`); }
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const section = t => console.log(`\n${t}`);

const boundsOf = pat => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const s of pat.cuts) {
    if (s.k === 'P') s.pts.forEach(p => see(...p));
    if (s.k === 'C') { see(s.cx - s.r, s.cy - s.r); see(s.cx + s.r, s.cy + s.r); }
  }
  return { minX, minY, maxX, maxY };
};
const inside = (pat, s, tol = 1e-6) => {
  const b = boundsOf(pat);
  const pts = s.k === 'L' ? [[s.x1, s.y1], [s.x2, s.y2]] : s.k === 'C' ? [[s.cx - s.r, s.cy], [s.cx + s.r, s.cy], [s.cx, s.cy - s.r], [s.cx, s.cy + s.r]] : s.pts;
  return pts.every(([x, y]) => x >= b.minX - tol && x <= b.maxX + tol && y >= b.minY - tol && y <= b.maxY + tol);
};

/* ── Every pattern ───────────────────────────────────────────────────────── */

section('all patterns');
for (const id of Object.keys(PATTERNS)) {
  const pat = build(id, {});
  const folds = pat.mountains.concat(pat.valleys);
  ok(`${id}: has folds in both sets`, pat.mountains.length > 0 && pat.valleys.length > 0);
  ok(`${id}: every fold inside outline bounds`, folds.every(s => inside(pat, s)));
  ok(`${id}: no zero-length fold`, folds.every(s => segLength(s) > 1e-6));
  const b = boundsOf(pat);
  ok(`${id}: reported size matches outline`, near(b.maxX - b.minX, pat.w, 1e-6) && near(b.maxY - b.minY, pat.h, 1e-6), `${b.maxX - b.minX}x${b.maxY - b.minY} vs ${pat.w}x${pat.h}`);
  ok(`${id}: outline starts at origin`, near(b.minX, 0) && near(b.minY, 0));

  // Scaling every mm param by 2 must scale the geometry by 2 and leave counts alone.
  const d = defaults(id), big = { ...d };
  for (const p of PATTERNS[id].params) if (p.scales) big[p.key] = d[p.key] * 2;
  const pat2 = build(id, big);
  ok(`${id}: mm params scale geometry linearly`, near(pat2.w, pat.w * 2, 1e-6) && near(pat2.h, pat.h * 2, 1e-6)
    && pat2.mountains.length === pat.mountains.length && pat2.valleys.length === pat.valleys.length);
}

/* ── Miura flat-foldability ──────────────────────────────────────────────── */

section('miura');
{
  const cols = 7, rows = 9, w = 20, h = 15, angle = 35;
  const pat = build('miura', { cols, rows, w, h, angle });
  const verts = [...vertexMap(pat.mountains, pat.valleys).values()];
  const interior = verts.filter(v => v.x > 1e-6 && v.x < pat.w - 1e-6 && v.y > 1e-6 && v.y < pat.h - 1e-6 && v.creases.length > 2);
  ok('interior vertex count', interior.length === (cols - 1) * (rows - 1), `${interior.length}`);
  ok('every interior vertex is degree 4', interior.every(v => v.creases.length === 4));
  ok('Maekawa 3:1 at every interior vertex', interior.every(v => {
    const m = v.creases.filter(c => c.type === 'M').length;
    return Math.abs(m - (4 - m)) === 2;
  }));
  ok('Kawasaki holds at every interior vertex', interior.every(v => kawasakiDefect(v) < 1e-9));
  const d = w * Math.tan(angle * Math.PI / 180);
  ok('height is rows·h + zigzag amplitude', near(pat.h, rows * h + d, 1e-9));
  const zig = pat.mountains.concat(pat.valleys).filter(s => Math.abs(s.x2 - s.x1) > 1e-9);
  ok('every zigzag segment has the set angle', zig.every(s => near(Math.abs(Math.atan2(s.y2 - s.y1, s.x2 - s.x1)) % Math.PI, angle * Math.PI / 180, 1e-9)));
}

/* ── Waterbomb ───────────────────────────────────────────────────────────── */

section('waterbomb');
{
  const pat = build('waterbomb', { cols: 5, rows: 6, w: 30, h: 24 });
  const verts = [...vertexMap(pat.mountains, pat.valleys).values()];
  const centres = verts.filter(v => v.creases.length === 6);
  ok('unit centres exist', centres.length > 0);
  ok('unit centres are 4 mountain diagonals + 2 valley', centres.every(v =>
    v.creases.filter(c => c.type === 'M').length === 4 && v.creases.filter(c => c.type === 'V').length === 2));
  ok('every unit centre lies on a row midline', centres.every(v => near(((v.y / 24) % 1 + 1) % 1, 0.5, 1e-9)));
  ok('odd rows are staggered by half a unit', centres.some(v => near(v.x % 30, 0, 1e-9)) && centres.some(v => near(v.x % 30, 15, 1e-9)));
  ok('clipSegment drops fully outside segments', clipSegment(-10, 0, -5, 5, 100, 100) === null);
  const c = clipSegment(-15, 0, 15, 30, 100, 100);
  ok('clipSegment trims to the edge', c && near(c.x1, 0) && near(c.y1, 15) && near(c.x2, 15) && near(c.y2, 30));
}

/* ── Circles ─────────────────────────────────────────────────────────────── */

section('circles');
{
  const pat = build('circles', { rings: 7, inner: 20, spacing: 8 });
  const radii = pat.mountains.concat(pat.valleys).map(c => c.r).sort((a, b) => a - b);
  ok('ring radii strictly increase', radii.every((r, i) => i === 0 || r > radii[i - 1]));
  ok('ring count', radii.length === 7);
  const seq = radii.map(r => pat.mountains.some(c => c.r === r) ? 'M' : 'V').join('');
  ok('rings alternate M/V', seq === 'MVMVMVM', seq);
  ok('cuts are inner hole and outer circle', pat.cuts.length === 2 && pat.cuts[0].r === 20 && pat.cuts[1].r === 20 + 8 * 8);
}

/* ── Export: chaining ────────────────────────────────────────────────────── */

section('export: chain');
{
  const pat = build('miura', { cols: 6, rows: 6, w: 20, h: 20, angle: 30 });
  const before = totalLength(pat.mountains);
  const chained = chain(pat.mountains);
  ok('chain keeps total length', near(totalLength(chained), before, 1e-6), `${totalLength(chained)} vs ${before}`);
  ok('chain reduces path count', chained.length < pat.mountains.length, `${chained.length} vs ${pat.mountains.length}`);
  ok('chain emits open polylines only', chained.every(p => p.k === 'P' && !p.closed));
  const circ = chain([{ k: 'C', cx: 1, cy: 1, r: 2 }]);
  ok('chain passes circles through', circ.length === 1 && circ[0].k === 'C');
  // Two collinear segments become one 3-point path.
  const two = chain([{ k: 'L', x1: 0, y1: 0, x2: 1, y2: 0 }, { k: 'L', x1: 1, y1: 0, x2: 2, y2: 0 }]);
  ok('two touching segments become one path', two.length === 1 && two[0].pts.length === 3);
}

/* ── Export: perforation ─────────────────────────────────────────────────── */

section('export: dashes');
{
  const seg = { k: 'L', x1: 0, y1: 0, x2: 100, y2: 0 };
  const dashed = dashItems([seg], 3, 1.5);
  ok('dashes start at the segment start', near(dashed[0].x1, 0));
  ok('dashes end at the segment end', near(dashed.at(-1).x2, 100, 1e-9));
  const gaps = dashed.slice(1).map((d, i) => d.x1 - dashed[i].x2);
  ok('gaps are exactly the requested gap', gaps.every(g => near(g, 1.5, 1e-9)));
  const dl = dashed.map(segLength);
  ok('dash lengths are all equal and near the request', dl.every(l => near(l, dl[0], 1e-9)) && Math.abs(dl[0] - 3) < 1);
  ok('short segments are left whole', dashItems([{ k: 'L', x1: 0, y1: 0, x2: 2, y2: 0 }], 3, 1.5).length === 1);
  const arcs = dashItems([{ k: 'C', cx: 0, cy: 0, r: 30 }], 3, 1.5);
  ok('circles become arcs', arcs.every(a => a.k === 'A') && arcs.length > 10);
  const covered = totalLength(arcs), circ = 2 * Math.PI * 30;
  ok('arc dashes cover dash/(dash+gap) of the circle', near(covered / circ, 3 / 4.5, 1e-9), `${covered / circ}`);
}

/* ── Export: mirroring and assembly ──────────────────────────────────────── */

section('export: assemble');
{
  const pat = build('yoshimura', { cols: 4, rows: 4, w: 30, h: 20 });
  const same = assemble(pat, { strategy: 'same', margin: 5 });
  ok('page adds the margin on all sides', near(same.page.w, pat.w + 10) && near(same.page.h, pat.h + 10));
  ok('same-side yields one file', same.files.length === 1);
  ok('score length survives assembly', near(totalLength(same.files[0].layers.mountain) + totalLength(same.files[0].layers.valley),
    totalLength(pat.mountains) + totalLength(pat.valleys), 1e-6));

  const swapped = assemble(pat, { strategy: 'same', margin: 5, swap: true });
  ok('swap exchanges the layers exactly', near(totalLength(swapped.files[0].layers.mountain), totalLength(same.files[0].layers.valley), 1e-6)
    && near(totalLength(swapped.files[0].layers.valley), totalLength(same.files[0].layers.mountain), 1e-6));

  const two = assemble(pat, { strategy: 'two', margin: 6 });
  ok('two-sided yields front and back', two.files.length === 2 && two.files[0].name === 'front' && two.files[1].name === 'back');
  ok('front has no valleys, back has no mountains', two.files[0].layers.valley.length === 0 && two.files[1].layers.mountain.length === 0);
  const v = translate(pat.valleys, 6, 6);
  const mirrored = mirrorX(v, two.page.w);
  const backLen = totalLength(two.files[1].layers.valley);
  ok('back valleys are mirrored copies', near(backLen, totalLength(v), 1e-6));
  ok('mirror maps x to W - x', mirrored.every((s, i) => near(s.x1, two.page.w - v[i].x1) && near(s.y1, v[i].y1)));
  ok('mirror is an involution', mirrorX(mirrored, two.page.w).every((s, i) => near(s.x1, v[i].x1) && near(s.x2, v[i].x2)));
  const regFront = two.files[0].layers.cut.filter(s => s.k === 'L');
  ok('registration crosses in both files', regFront.length === 8 && two.files[1].layers.cut.filter(s => s.k === 'L').length === 8);
  ok('registration marks sit in the margin', regFront.every(s => Math.min(s.x1, s.x2) < 6 || Math.max(s.x1, s.x2) > two.page.w - 6 || Math.min(s.y1, s.y2) < 6 || Math.max(s.y1, s.y2) > two.page.h - 6));
  const arcMirror = mirrorX([{ k: 'A', cx: 10, cy: 10, r: 5, a0: 0, a1: 1 }], 100)[0];
  ok('mirrored arc has the same sweep', near(arcMirror.a1 - arcMirror.a0, 1));
}

/* ── Export: SVG text ────────────────────────────────────────────────────── */

section('export: svg');
{
  const pat = build('circles', { rings: 3, inner: 10, spacing: 5 });
  const asm = assemble(pat, { strategy: 'perf', margin: 4, dash: 3, gap: 1.5 });
  const svg = toSvg(asm.files[0], asm.page, { title: 'Concentric circles', legend: true });
  ok('starts with xml declaration', svg.startsWith('<?xml'));
  ok('physical size in mm', /width="68mm" height="68mm"/.test(svg));
  ok('viewBox matches size', /viewBox="0 0 68 68"/.test(svg));
  for (const layer of ['cut', 'mountain', 'valley']) ok(`has ${layer} layer group`, svg.includes(`<g id="${layer}" inkscape:groupmode="layer"`));
  ok('circles stay circles on the cut layer', (svg.match(/<circle/g) || []).length >= 2);
  ok('perforated valleys are arc paths', /A5?\d*\.?\d*,/.test(svg) && svg.includes(' A'));
  ok('legend present when requested', svg.includes('id="legend"'));
  ok('no NaN anywhere', !svg.includes('NaN'));
  const open = (svg.match(/<g\b/g) || []).length, close = (svg.match(/<\/g>/g) || []).length;
  ok('groups are balanced', open === close);
  const self = (svg.match(/<(line|circle|path)\b[^>]*\/>/g) || []).length, tags = (svg.match(/<(line|circle|path)\b/g) || []).length;
  ok('every shape element is self-closed', self === tags);
  const plain = toSvg(assemble(pat, { strategy: 'same', margin: 4 }).files[0], asm.page, {});
  ok('no legend by default', !plain.includes('id="legend"'));
}

/* ── Fold: faces ─────────────────────────────────────────────────────────── */

section('fold: faces');
{
  const outlineArea = pat => {
    const p = pat.cuts[0].pts; let s = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(s / 2);
  };
  const faceArea = (verts, f) => { let s = 0; for (let i = 0; i < f.length; i++) { const a = verts[f[i]], b = verts[f[(i + 1) % f.length]]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const cases = [['miura', { cols: 5, rows: 6, w: 20, h: 15, angle: 30 }, 30], ['yoshimura', { cols: 4, rows: 3, w: 30, h: 20 }, 27], ['waterbomb', { cols: 3, rows: 4, w: 30, h: 24 }, null]];
  for (const [id, p, expectFaces] of cases) {
    const pat = build(id, p);
    const m = buildFoldModel(pat);
    ok(`${id}: model builds`, m.ok);
    if (expectFaces) ok(`${id}: face count`, m.faces.length === expectFaces, `${m.faces.length}`);
    ok(`${id}: faces tile the outline`, near(m.faces.reduce((s, f) => s + Math.abs(faceArea(m.verts, f)), 0), outlineArea(pat), 1e-6));
    ok(`${id}: every face oriented the same way`, m.faces.every(f => faceArea(m.verts, f) < 0));
    ok(`${id}: every triangle has area`, m.tris.every(t => Math.abs(faceArea(m.verts, t)) > 1e-6));
    const creaseCount = pat.mountains.length + pat.valleys.length;
    const creaseHinges = m.hinges.filter(h => h.type !== 'F').length;
    ok(`${id}: every crease segment is a hinge`, creaseHinges >= creaseCount, `${creaseHinges} vs ${creaseCount}`);
  }
  ok('miura faces are parallelograms', buildFoldModel(build('miura', {})).faces.every(f => f.length === 4));
  ok('yoshimura faces are triangles', buildFoldModel(build('yoshimura', {})).faces.every(f => f.length === 3));
  ok('circles are refused with a reason', !buildFoldModel(build('circles', {})).ok && /curved/i.test(buildFoldModel(build('circles', {})).reason));
  const seg = planarGraph(patternSegments(build('yoshimura', { cols: 2, rows: 2, w: 20, h: 20 })));
  ok('T-junctions split the single row line into three', seg.edges.filter(e => e.type === 'M').length === 3, `${seg.edges.filter(e => e.type === 'M').length}`);
}

/* ── Fold: simulation ────────────────────────────────────────────────────── */

section('fold: sim');
{
  const P = new Float64Array([0, 0, 0, 1, 0, 0, 0.5, 1, -1, 0.5, -1, -1]);
  ok('apexes folded away from +z read as a positive (mountain) dihedral', dihedral(P, { a: 0, b: 1, c: 2, d: 3 }) > 0);
  const hinge = { verts: [[0, 0], [10, 0], [5, 10], [5, -10]], faces: [[0, 1, 2], [1, 0, 3]], tris: [[0, 1, 2], [1, 0, 3]], springs: [[0, 1], [1, 2], [2, 0], [0, 3], [3, 1]], hinges: [{ a: 0, b: 1, c: 2, d: 3, type: 'V' }], edges: [] };
  const hs = new FoldSim(hinge, { maxAngle: 90 });
  hs.setFold(100); hs.step(10000);
  ok('single valley hinge reaches -90°', near(dihedral(hs.P, hs.hinges[0]) * 180 / Math.PI, -90, 1), `${dihedral(hs.P, hs.hinges[0]) * 180 / Math.PI}`);
  const hm = new FoldSim({ ...hinge, hinges: [{ a: 0, b: 1, c: 2, d: 3, type: 'M' }] }, { maxAngle: 90 });
  hm.setFold(100); hm.step(10000);
  ok('single mountain hinge reaches +90°', near(dihedral(hm.P, hm.hinges[0]) * 180 / Math.PI, 90, 1));

  const pat = build('miura', { cols: 8, rows: 10, w: 20, h: 20, angle: 30 });
  const sim = new FoldSim(buildFoldModel(pat), { maxAngle: FOLD_LIMITS.miura, goal: miuraKinematics(30) });
  sim.setFold(60);
  let steps = 0; while (!sim.settled() && steps < 9000) { sim.step(50); steps += 50; }
  sim.step(800);
  ok('miura at 60%: every crease within 1° of target', sim.creaseError() < 1, `${sim.creaseError()}°`);
  ok('miura at 60%: no edge strained past 0.5%', sim.maxStrain() < 0.005, `${sim.maxStrain()}`);
  let z = 0; for (let i = 2; i < sim.P.length; i += 3) z = Math.max(z, Math.abs(sim.P[i]));
  ok('miura at 60% actually leaves the plane', z > 0.02, `${z}`);
  for (const id of ['yoshimura', 'waterbomb']) {
    const s2 = new FoldSim(buildFoldModel(build(id, {})), { maxAngle: FOLD_LIMITS[id] });
    s2.setFold(100); let n = 0; while (!s2.settled() && n < 9000) { s2.step(50); n += 50; } s2.step(500);
    ok(`${id} at 100% stays bounded`, s2.maxStrain() < 0.35 && Number.isFinite(s2.creaseError()), `strain ${s2.maxStrain()}`);
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
