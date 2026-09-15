#!/usr/bin/env node
// scripts/verify-arrange.mjs — headless checks for the Arrange nester.
//   node scripts/verify-arrange.mjs

import * as G from '../arrange/geom.js';
import * as N from '../arrange/nest.js';
import * as S from '../arrange/svgin.js';
import * as M from '../arrange/merge.js';
import * as X from '../arrange/export.js';

let failures = 0, checks = 0;
const ok = (name, cond, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ': ' + detail : ''}`); }
};
const section = t => console.log(`\n${t}`);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const rect = (x, y, w, h) => new Float64Array([x, y, x + w, y, x + w, y + h, x, y + h]);
const ngon = (cx, cy, r, n, phase = 0) => {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    p.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return new Float64Array(p);
};
// An L-shape (concave), CCW.
const ell = new Float64Array([0,0, 30,0, 30,10, 10,10, 10,30, 0,30]);
// A plus/cross (4 reflex vertices), CCW.
const plus = new Float64Array([10,0, 20,0, 20,10, 30,10, 30,20, 20,20, 20,30, 10,30, 10,20, 0,20, 0,10, 10,10]);

section('Basics');
ok('area of a 30x20 rect', near(G.area(rect(0, 0, 30, 20)), 600));
ok('CCW rect is CCW', G.isCCW(rect(0, 0, 10, 10)));
ok('reversed rect is CW', !G.isCCW(G.reverse(rect(0, 0, 10, 10))));
ok('toCCW normalises winding', G.isCCW(G.toCCW(G.reverse(rect(0, 0, 10, 10)))));
ok('L-shape is CCW as authored', G.isCCW(ell));
ok('plus is CCW as authored', G.isCCW(plus));
ok('bounds of L-shape', (b => b.minX === 0 && b.minY === 0 && b.maxX === 30 && b.maxY === 30)(G.bounds(ell)));
ok('translate moves bounds', near(G.bounds(G.translate(ell, 5, 7)).minX, 5));
ok('rotate preserves area', near(Math.abs(G.area(G.rotate(ell, 0.7))), Math.abs(G.area(ell)), 1e-9));
ok('point inside L-shape', G.pointInPoly(ell, 5, 5));
ok('point in the L notch is outside', !G.pointInPoly(ell, 20, 20));
ok('clean drops collinear points',
   G.clean(new Float64Array([0,0, 5,0, 10,0, 10,10, 0,10])).length / 2 === 4);

section('Convexity');
ok('rect is convex', G.isConvex(rect(0, 0, 10, 10)));
ok('hexagon is convex', G.isConvex(ngon(0, 0, 10, 6)));
ok('L-shape is not convex', !G.isConvex(ell));
ok('plus is not convex', !G.isConvex(plus));

section('Convex decomposition');
for (const [name, poly] of [['L-shape', ell], ['plus', plus], ['20-gon', ngon(0, 0, 10, 20)],
                            ['rect', rect(0, 0, 10, 5)]]) {
  const pieces = G.convexDecompose(poly);
  const sum = pieces.reduce((s, p) => s + Math.abs(G.area(p)), 0);
  ok(`${name}: produces pieces`, pieces.length > 0, `got ${pieces.length}`);
  ok(`${name}: every piece is convex`, pieces.every(p => G.isConvex(p)));
  ok(`${name}: every piece is CCW`, pieces.every(p => G.isCCW(p)));
  ok(`${name}: piece areas sum to the whole`, near(sum, Math.abs(G.area(poly)), 1e-6),
     `${sum} vs ${Math.abs(G.area(poly))}`);
}
ok('convex input stays one piece', G.convexDecompose(ngon(0, 0, 5, 7)).length === 1);
// Regression: a merge that re-added the shared vertex produced a ring with a
// zero-width slit. It passed a per-triple convexity test, so a concave part
// collapsed to ONE "convex" piece and collided as a solid blob.
{
  const bracket = G.clean(new Float64Array([5,0, 75,0, 80,5, 80,40, 30,40, 30,60, 5,60, 0,55, 0,5]));
  const pieces = G.convexDecompose(bracket);
  ok('concave outline does not collapse to a single piece', pieces.length > 1, `${pieces.length} pieces`);
  ok('concave outline decomposes economically', pieces.length <= 6, `${pieces.length} pieces`);
  ok('no decomposed piece repeats a vertex', pieces.every(p => {
    const seen = new Set();
    for (let i = 0; i < p.length; i += 2) {
      const k = `${p[i].toFixed(6)},${p[i+1].toFixed(6)}`;
      if (seen.has(k)) return false;
      seen.add(k);
    }
    return true;
  }));
  ok('every piece lies inside the outline', pieces.every(pc => {
    for (let i = 0; i < pc.length; i += 2)
      if (!G.pointInPoly(bracket, pc[i], pc[i+1]) && G.distPointPolyEdge(bracket, pc[i], pc[i+1]) > 1e-6) return false;
    return true;
  }));
}

section('Circles');
{
  const c = G.boundingCircle(ngon(3, -2, 7, 24));
  ok('bounding circle centre', near(c.x, 3, 1e-6) && near(c.y, -2, 1e-6), `${c.x},${c.y}`);
  ok('bounding circle radius', near(c.r, 7, 1e-3), `r=${c.r}`);
  const sq = G.boundingCircle(rect(0, 0, 10, 10));
  ok('bounding circle of a square', near(sq.r, Math.hypot(5, 5), 1e-6), `r=${sq.r}`);

  const ins = G.inscribedCircle(rect(0, 0, 10, 20));
  ok('inscribed circle of 10x20 rect has r=5', near(ins.r, 5, 0.05), `r=${ins.r}`);
  ok('inscribed centre is inside', G.pointInPoly(rect(0, 0, 10, 20), ins.x, ins.y));

  const insL = G.inscribedCircle(ell);
  ok('inscribed circle of L is inside', G.pointInPoly(ell, insL.x, insL.y));
  ok('inscribed circle of L fits', G.distPointPolyEdge(ell, insL.x, insL.y) >= insL.r - 0.05,
     `r=${insL.r} d=${G.distPointPolyEdge(ell, insL.x, insL.y)}`);

  const bc = G.boundingCircle(ell), ic = G.inscribedCircle(ell);
  ok('bounding circle contains inscribed circle',
     Math.hypot(bc.x - ic.x, bc.y - ic.y) + ic.r <= bc.r + 1e-6);
}

section('Convex separation (SAT)');
{
  const a = rect(0, 0, 10, 10);
  ok('disjoint on x reports the gap', near(G.convexSeparation(a, rect(15, 0, 10, 10)), 5, 1e-9),
     String(G.convexSeparation(a, rect(15, 0, 10, 10))));
  ok('touching reports 0', near(G.convexSeparation(a, rect(10, 0, 10, 10)), 0, 1e-9));
  ok('overlap by 3 reports -3', near(G.convexSeparation(a, rect(7, 0, 10, 10)), -3, 1e-9),
     String(G.convexSeparation(a, rect(7, 0, 10, 10))));
  ok('identical squares: penetration = side', near(G.convexSeparation(a, rect(0, 0, 10, 10)), -10, 1e-9));
  ok('diagonal corner gap is the true distance, not the SAT bound',
     near(G.convexSeparation(a, rect(13, 14, 10, 10)), 5, 1e-9),
     String(G.convexSeparation(a, rect(13, 14, 10, 10))));
  ok('convexDistance matches on a vertex-vertex pair',
     near(G.convexDistance(a, rect(13, 14, 10, 10)), 5, 1e-9));
  ok('separation is symmetric',
     near(G.convexSeparation(a, rect(3, 4, 10, 10)), G.convexSeparation(rect(3, 4, 10, 10), a), 1e-9));

  // Brute force agreement on random convex pairs: sign must always match.
  let mismatches = 0, overlapping = 0;
  const polyIntersects = (p, q) => {
    for (let i = 0; i < p.length; i += 2) if (G.pointInPoly(q, p[i], p[i + 1])) return true;
    for (let i = 0; i < q.length; i += 2) if (G.pointInPoly(p, q[i], q[i + 1])) return true;
    // edge crossings
    const segs = poly => {
      const s = [];
      for (let i = 0, n = poly.length / 2; i < n; i++) {
        const j = (i + 1) % n;
        s.push([poly[i * 2], poly[i * 2 + 1], poly[j * 2], poly[j * 2 + 1]]);
      }
      return s;
    };
    const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    for (const [ax, ay, bx, by] of segs(p))
      for (const [cx, cy, dx, dy] of segs(q)) {
        const d1 = cross(ax, ay, bx, by, cx, cy), d2 = cross(ax, ay, bx, by, dx, dy);
        const d3 = cross(cx, cy, dx, dy, ax, ay), d4 = cross(cx, cy, dx, dy, bx, by);
        if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
      }
    return false;
  };
  for (let t = 0; t < 4000; t++) {
    const p = G.toCCW(ngon(Math.random() * 40, Math.random() * 40, 3 + Math.random() * 8, 3 + ((Math.random() * 6) | 0), Math.random() * 6));
    const q = G.toCCW(ngon(Math.random() * 40, Math.random() * 40, 3 + Math.random() * 8, 3 + ((Math.random() * 6) | 0), Math.random() * 6));
    const sep = G.convexSeparation(p, q);
    const hit = polyIntersects(p, q);
    if (hit && sep > 1e-7) mismatches++;
    if (!hit && sep < -1e-7) mismatches++;
    if (hit) overlapping++;
  }
  ok('SAT sign agrees with brute force over 4000 random pairs', mismatches === 0, `${mismatches} mismatches`);
  ok('the exactBelow short-circuit never hides a clearance violation', (() => {
    for (let t = 0; t < 3000; t++) {
      const p = G.toCCW(ngon(0, 0, 3 + Math.random() * 6, 3 + ((Math.random() * 5) | 0), Math.random() * 6));
      const q = G.toCCW(ngon(0, 0, 3 + Math.random() * 6, 3 + ((Math.random() * 5) | 0), Math.random() * 6));
      const dx = (Math.random() - 0.5) * 40, dy = (Math.random() - 0.5) * 40;
      const need = Math.random() * 5;
      const exact = G.convexSeparation(p, q, dx, dy);
      const fast = G.convexSeparation(p, q, dx, dy, need);
      // both must agree on whether the clearance is met
      if ((exact >= need) !== (fast >= need)) return false;
      // when it does not clear, the fast path must report the true gap
      if (exact < need && Math.abs(exact - fast) > 1e-9) return false;
    }
    return true;
  })());
  ok('the random set actually contained overlaps', overlapping > 200, `${overlapping} overlapping`);
}

section('Engine — placement validity');
{
  const SHEET = { w: 300, h: 300, margin: 5 };

  // Every placed part must sit inside the sheet and clear its neighbours.
  // Packing efficiency = part area / area of the region the nest actually
  // occupies. Comparing against the whole sheet is meaningless when the parts
  // could never fill it.
  const efficiency = (parts, res) => {
    let best = 0;
    for (const sh of res.sheets) {
      if (!sh.length) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, a = 0;
      for (const p of sh) {
        const bb = parts[p.part].poses[p.pose].bounds;
        minX = Math.min(minX, p.x + bb.minX); maxX = Math.max(maxX, p.x + bb.maxX);
        minY = Math.min(minY, p.y + bb.minY); maxY = Math.max(maxY, p.y + bb.maxY);
        a += parts[p.part].area;
      }
      const region = (maxX - minX) * (maxY - minY);
      if (region > 0) best = Math.max(best, a / region);
    }
    return best;
  };

  const auditNest = (label, parts, items, opts) => {
    const res = N.nest({ parts, items, sheet: SHEET, ...opts });
    let overlaps = 0, escapes = 0, worstViolation = 0, placed = 0;

    for (const sh of res.sheets) {
      placed += sh.length;
      for (let i = 0; i < sh.length; i++) {
        if (N.outside(parts[sh[i].part], sh[i], SHEET, SHEET.h) > 1e-6) escapes++;
        for (let j = i + 1; j < sh.length; j++) {
          const d = N.depth(parts[sh[i].part], sh[i], parts[sh[j].part], sh[j], opts.spacing || 0);
          if (d > 1e-6) { overlaps++; worstViolation = Math.max(worstViolation, d); }
        }
      }
    }
    ok(`${label}: nothing overlaps`, overlaps === 0, `${overlaps} pairs, worst ${worstViolation.toFixed(4)}mm`);
    ok(`${label}: everything is inside its sheet`, escapes === 0, `${escapes} escaped`);
    ok(`${label}: every item got placed`, placed === items.length, `${placed}/${items.length}`);
    return res;
  };

  const mkPart = (id, poly, rotations) => N.prepare({ id, name: id, outer: poly }, rotations);

  // 1. identical rectangles — a known-easy instance. If the search is silently
  //    broken this is where it shows, because near-100% is achievable by hand.
  {
    const parts = [mkPart('r', rect(0, 0, 40, 25), N.ROTATION_SETS.quarter)];
    const items = Array.from({ length: 40 }, (_, i) => ({ part: 0, inst: i }));
    const res = auditNest('40 identical rects', parts, items, { spacing: 0, timeMs: 4000, seed: 7 });
    const eff = efficiency(parts, res);
    ok('40 identical rects: one sheet is enough', res.sheets.length === 1, `${res.sheets.length} sheets`);
    // Identical axis-aligned rectangles tile perfectly, so a working search
    // should get very close to 1. Well under that means the search is broken.
    ok('40 identical rects: efficiency > 85%', eff > 0.85, `${(eff * 100).toFixed(1)}%`);
    console.log(`        (efficiency ${(eff * 100).toFixed(1)}%, ${res.sheets.length} sheet)`);
  }

  // 2. concave parts, which is where naive nesters fall over
  {
    const parts = [mkPart('L', ell, N.ROTATION_SETS.quarter), mkPart('+', plus, N.ROTATION_SETS.quarter)];
    const items = [];
    for (let i = 0; i < 14; i++) items.push({ part: 0, inst: i });
    for (let i = 0; i < 14; i++) items.push({ part: 1, inst: 100 + i });
    // Crosses are the worst-packing shape there is, so the ceiling here is low.
    // The threshold guards a real regression: a bug in the convex decomposition
    // once made every concave part collide as one big convex blob, which made
    // interlocking impossible and pinned this instance at 43%.
    const res = auditNest('concave mix (worst-case shapes)', parts, items, { spacing: 0, timeMs: 3000, seed: 3 });
    const eff = efficiency(parts, res);
    ok('concave mix: interlocks rather than packing blobs, > 55%', eff > 0.55, `${(eff * 100).toFixed(1)}%`);
    console.log(`        (efficiency ${(eff * 100).toFixed(1)}%, ${res.sheets.length} sheet(s))`);
  }

  // 2b. Does it actually interlock? Two right triangles make a perfect
  //     rectangle, so a nester that only packs bounding boxes scores ~50% here
  //     and one that genuinely interlocks scores far higher.
  {
    const parts = [mkPart('tri', new Float64Array([0, 0, 60, 0, 0, 40]), N.ROTATION_SETS.quarter)];
    const items = Array.from({ length: 24 }, (_, i) => ({ part: 0, inst: i }));
    const res = auditNest('right triangles', parts, items, { spacing: 0, timeMs: 3000, seed: 4 });
    const eff = efficiency(parts, res);
    ok('right triangles: interlocks, efficiency > 75%', eff > 0.75, `${(eff * 100).toFixed(1)}%`);
    console.log(`        (efficiency ${(eff * 100).toFixed(1)}% — bbox-only packing would be ~50%)`);
  }

  // 3. spacing must be honoured, not approximated
  {
    const parts = [mkPart('r', rect(0, 0, 35, 22), N.ROTATION_SETS.quarter),
                   mkPart('h', ngon(0, 0, 14, 6), N.ROTATION_SETS.quarter)];
    const items = [];
    for (let i = 0; i < 12; i++) items.push({ part: 0, inst: i });
    for (let i = 0; i < 12; i++) items.push({ part: 1, inst: 100 + i });
    auditNest('with 3mm spacing', parts, items, { spacing: 3, timeMs: 4000, seed: 11 });
  }

  // 4. mixed shapes, free-ish rotation
  {
    const parts = [mkPart('L', ell, N.ROTATION_SETS.free),
                   mkPart('r', rect(0, 0, 50, 12), N.ROTATION_SETS.free),
                   mkPart('o', ngon(0, 0, 18, 12), N.ROTATION_SETS.free)];
    const items = [];
    for (let i = 0; i < 8; i++) items.push({ part: 0, inst: i }, { part: 1, inst: 50 + i }, { part: 2, inst: 100 + i });
    auditNest('free rotation mix', parts, items, { spacing: 1, timeMs: 5000, seed: 5 });
  }

  // 5. overflow to a second sheet when it genuinely cannot fit
  {
    const parts = [mkPart('big', rect(0, 0, 140, 140), N.ROTATION_SETS.none)];
    const items = Array.from({ length: 6 }, (_, i) => ({ part: 0, inst: i }));
    const res = auditNest('overflow to multiple sheets', parts, items, { spacing: 2, timeMs: 3000, seed: 2 });
    ok('overflow: used more than one sheet', res.sheets.length >= 2, `${res.sheets.length}`);
    ok('overflow: reported no unplaced parts', res.unplaced === 0, `${res.unplaced} unplaced`);
  }

  // 5b. Many parts over many sheets. Regression: the time budget used to abort
  //     placement rather than just optimisation, stranding every later sheet.
  {
    const parts = [mkPart('a', rect(0, 0, 80, 60), N.ROTATION_SETS.quarter),
                   mkPart('b', rect(0, 0, 36, 36), N.ROTATION_SETS.quarter)];
    const items = [];
    let k = 0;
    for (let i = 0; i < 40; i++) items.push({ part: 0, inst: k++ });
    for (let i = 0; i < 60; i++) items.push({ part: 1, inst: k++ });
    const t0 = Date.now();
    const res = auditNest('100 parts over many sheets', parts, items, { spacing: 2, timeMs: 2000, seed: 1 });
    const took = Date.now() - t0;
    ok('100 parts: spilled onto several sheets', res.sheets.length >= 3, `${res.sheets.length}`);
    ok('100 parts: a tight budget still places everything', res.unplaced === 0, `${res.unplaced} unplaced`);
    ok('100 parts: respected the time budget', took < 6000, `took ${took}ms`);
    console.log(`        (${res.sheets.length} sheets in ${took}ms)`);
  }

  // 6. determinism — same seed, same nest
  {
    const parts = [mkPart('L', ell, N.ROTATION_SETS.quarter)];
    const items = Array.from({ length: 10 }, (_, i) => ({ part: 0, inst: i }));
    const a = N.nest({ parts, items, sheet: SHEET, spacing: 1, timeMs: 1200, seed: 42 });
    const b = N.nest({ parts, items, sheet: SHEET, spacing: 1, timeMs: 1200, seed: 42 });
    const key = r => JSON.stringify(r.sheets.map(s => s.map(p => [p.part, p.pose, +p.x.toFixed(6), +p.y.toFixed(6)])));
    ok('same seed reproduces the same nest', key(a) === key(b));
  }

  // 7. rotation sets are respected
  {
    const parts = [mkPart('r', rect(0, 0, 40, 18), N.ROTATION_SETS.grain)];
    const items = Array.from({ length: 12 }, (_, i) => ({ part: 0, inst: i }));
    const res = N.nest({ parts, items, sheet: SHEET, spacing: 1, timeMs: 1500, seed: 9 });
    const degs = new Set(res.sheets.flat().map(p => parts[0].poses[p.pose].deg));
    ok('grain lock only uses 0 and 180', [...degs].every(d => d === 0 || d === 180), [...degs].join(','));
  }
}

section('SVG parsing');
{
  const len = pts => { let L = 0; for (let i = 2; i < pts.length; i += 2) L += Math.hypot(pts[i]-pts[i-2], pts[i+1]-pts[i-1]); return L; };

  const sq = S.parsePath('M0 0 L10 0 L10 10 L0 10 Z');
  ok('absolute path: 4 corners', sq.length === 1 && sq[0].length === 8, `${sq[0]?.length/2} pts`);
  ok('absolute path: correct area', near(Math.abs(G.area(Float64Array.from(sq[0]))), 100, 1e-9));

  const rel = S.parsePath('m0 0 l10 0 l0 10 l-10 0 z');
  ok('relative path matches absolute', near(Math.abs(G.area(Float64Array.from(rel[0]))), 100, 1e-9));

  const hv = S.parsePath('M0 0 H10 V10 H0 Z');
  ok('H/V shorthand', near(Math.abs(G.area(Float64Array.from(hv[0]))), 100, 1e-9));

  // A circle drawn as four arcs should come back with the right area.
  const circ = S.shapeToContours('circle', { cx: '0', cy: '0', r: '10' }, 0.01);
  ok('circle flattens to near pi*r^2',
     near(Math.abs(G.area(Float64Array.from(circ[0]))), Math.PI * 100, 0.5),
     String(Math.abs(G.area(Float64Array.from(circ[0])))));
  ok('circle stays within chord tolerance of r=10', (() => {
    const c = circ[0];
    for (let i = 0; i < c.length; i += 2) if (Math.abs(Math.hypot(c[i], c[i+1]) - 10) > 0.02) return false;
    return true;
  })());

  const bez = S.parsePath('M0 0 C0 10 10 10 10 0');
  ok('cubic flattens adaptively', bez[0].length / 2 > 4 && bez[0].length / 2 < 200, `${bez[0].length/2} pts`);
  const smooth = S.parsePath('M0 0 C0 5 5 5 5 0 S10 -5 10 0');
  ok('S reflects the previous control point', smooth.length === 1 && smooth[0].length > 8);

  const arcP = S.parsePath('M0 0 A10 10 0 0 1 20 0');
  ok('arc produces a curve', arcP[0].length / 2 > 3);
  ok('arc ends where it should',
     near(arcP[0][arcP[0].length - 2], 20, 0.01) && near(arcP[0][arcP[0].length - 1], 0, 0.01));

  const rr = S.shapeToContours('rect', { x:'0', y:'0', width:'20', height:'10', rx:'3' }, 0.01);
  ok('rounded rect area is under the plain rect', (() => {
    const a = Math.abs(G.area(Float64Array.from(rr[0])));
    return a < 200 && a > 190;
  })(), String(Math.abs(G.area(Float64Array.from(rr[0])))));

  ok('transform: translate', (() => {
    const m = S.parseTransform('translate(5 7)');
    const p = S.applyMatrix(new Float64Array([0,0]), m);
    return near(p[0], 5) && near(p[1], 7);
  })());
  ok('transform: nested scale+translate composes', (() => {
    const m = S.multiply(S.parseTransform('translate(10 0)'), S.parseTransform('scale(2)'));
    const p = S.applyMatrix(new Float64Array([3,4]), m);
    return near(p[0], 16) && near(p[1], 8);
  })(), '');
  ok('transform: rotate 90 about origin', (() => {
    const p = S.applyMatrix(new Float64Array([1,0]), S.parseTransform('rotate(90)'));
    return near(p[0], 0, 1e-9) && near(p[1], 1, 1e-9);
  })());

  ok('mm length', near(S.lengthToMm('25mm'), 25));
  ok('inch length', near(S.lengthToMm('1in'), 25.4));
  ok('unitless px is 96dpi', near(S.lengthToMm('96'), 25.4));
  ok('unitScale from width+viewBox', near(S.unitScale('100mm', '50mm', '0 0 200 100'), 0.5));
  ok('unitScale falls back to 96dpi', near(S.unitScale(null, null, null), 25.4/96));

  // holes: a ring inside a ring becomes a hole, not a second part
  const outer = new Float64Array([0,0, 50,0, 50,50, 0,50]);
  const inner = new Float64Array([20,20, 30,20, 30,30, 20,30]);
  const ps = S.ringsToParts([inner, outer], 'plate');
  ok('containment: one part with one hole', ps.length === 1 && ps[0].holes.length === 1,
     `${ps.length} parts, ${ps[0]?.holes.length} holes`);
  const two = S.ringsToParts([outer, G.translate(outer, 100, 0)], 'plate');
  ok('disjoint rings become separate parts', two.length === 2);
}

section('Common-line merging');
{
  // Two unit squares sharing an edge: that edge must be cut once, not twice.
  const a = new Float64Array([0,0, 10,0, 10,10, 0,10]);
  const b = new Float64Array([10,0, 20,0, 20,10, 10,10]);
  const m = M.mergeCommonLines([a, b]);
  ok('shared edge is detected', near(m.sharedLength, 10, 1e-6), `${m.sharedLength}`);
  ok('total cut drops by exactly the shared edge',
     near(m.originalLength - m.mergedLength, 10, 1e-6));
  // 80mm of cut becomes 70: the duplicate pass over the shared edge is gone,
  // but that edge is still cut once — otherwise the two parts stay welded.
  ok('merged cut keeps the divider exactly once', near(m.mergedLength, 70, 1e-6), `${m.mergedLength}`);
  ok('merged cut is shorter than cutting both outlines', m.mergedLength < m.originalLength);

  const apart = M.mergeCommonLines([a, G.translate(a, 30, 0)]);
  ok('parts that do not touch share nothing', near(apart.sharedLength, 0, 1e-9), `${apart.sharedLength}`);
  ok('separated parts keep their full perimeter', near(apart.mergedLength, 80, 1e-6));

  // Collinear touching edges should chain into one run, not stay split.
  const chained = M.chain([[0,0,10,0],[10,0,20,0],[20,0,20,10]]);
  ok('chain stitches segments into one run', chained.length === 1, `${chained.length} runs`);
}

section('SVG export');
{
  const parts = [N.prepare({ id: 'r', outer: rect(0, 0, 40, 25) }, N.ROTATION_SETS.quarter)];
  const items = Array.from({ length: 6 }, (_, i) => ({ part: 0, inst: i }));
  const SH = { w: 200, h: 150, margin: 5 };
  const res = N.nest({ parts, items, sheet: SH, spacing: 0, timeMs: 800, seed: 1 });

  const rings = X.ringsForSheets(parts, res.sheets);
  const files = X.toSVG(rings, SH);
  ok('one file per sheet', files.length === res.sheets.length);
  ok('declares mm dimensions', files[0].svg.includes('width="200mm"'));
  ok('uses the red cut convention', files[0].svg.includes('#ff0000'));
  ok('is fill-none stroked', files[0].svg.includes('fill="none"'));
  ok('has one path per part', (files[0].svg.match(/<path /g) || []).length === res.sheets[0].length,
     `${(files[0].svg.match(/<path /g) || []).length} paths vs ${res.sheets[0].length} parts`);
  ok('no NaN leaked into the output', !/NaN|Infinity/.test(files[0].svg));

  const merged = X.toSVG(rings, SH, { merge: true });
  ok('merged export still emits geometry', /<path /.test(merged[0].svg));
  ok('merged export explains itself', /merged common lines/.test(merged[0].svg));

  const combo = X.toSVG(rings, SH, { combined: true });
  ok('combined export is a single file', combo.length === 1);

  // Exported geometry must land inside the declared sheet.
  const nums = [...files[0].svg.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(m => [+m[1], +m[2]]);
  ok('every exported point is inside the sheet',
     nums.every(([x, y]) => x >= -0.01 && x <= SH.w + 0.01 && y >= -0.01 && y <= SH.h + 0.01));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`${failures} failing`); process.exit(1); }
console.log('arrange geometry verified.');
