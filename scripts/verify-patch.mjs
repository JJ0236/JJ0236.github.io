#!/usr/bin/env node
// scripts/verify-patch.mjs — headless checks for the Patch quilt tool.
//   node scripts/verify-patch.mjs

import * as B from '../patch/blocks.js';
import * as P from '../patch/pieces.js';
import * as X from '../patch/export.js';

let failures = 0, checks = 0;
const ok = (name, cond, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ': ' + detail : ''}`); }
};
const section = t => console.log(`\n${t}`);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const IN = P.INCH, SEAM = P.DEFAULT_SEAM;

const area = p => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i][0] * p[j][1] - p[j][0] * p[i][1];
  }
  return Math.abs(a / 2);
};
const pointInPoly = (poly, x, y) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const distPointSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const distToEdges = (poly, x, y) => {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    best = Math.min(best, distPointSeg(x, y, poly[i][0], poly[i][1], poly[j][0], poly[j][1]));
  }
  return best;
};

section('Blocks tile their grid');
for (const [key, block] of Object.entries(B.LIBRARY)) {
  const regions = B.blockRegions(block);
  const total = regions.reduce((s, r) => s + area(r.poly), 0);
  ok(`${block.name}: regions cover the grid exactly`,
     near(total, block.grid * block.grid, 1e-9), `${total} vs ${block.grid ** 2}`);
  // no two regions may overlap: sample each region's centroid against the rest
  let overlaps = 0;
  const cents = regions.map(r => {
    const n = r.poly.length;
    return [r.poly.reduce((s, p) => s + p[0], 0) / n, r.poly.reduce((s, p) => s + p[1], 0) / n];
  });
  for (let i = 0; i < regions.length; i++)
    for (let j = 0; j < regions.length; j++)
      if (i !== j && pointInPoly(regions[j].poly, cents[i][0], cents[i][1])) overlaps++;
  ok(`${block.name}: no region overlaps another`, overlaps === 0, `${overlaps}`);
  ok(`${block.name}: every region is a closed polygon`, regions.every(r => r.poly.length >= 3));
}
ok('custom grid builds', B.blockRegions(B.gridBlock(3, Array.from({length:9},(_,i)=>({type: i%2?'hst':'plain', rot:i%4})))).length > 0);

section('Seam allowance reproduces the traditional rules');
{
  const one = (type, rot = 0) => ({ name: 't', grid: 1, units: [{ type, x: 0, y: 0, rot, scale: 1 }] });

  const hst = P.blockPieces(one('hst'), 4 * IN, { seamMm: SEAM, trimPoints: false });
  const hb = P.bounds(hst.pieces[0].cut);
  const exactHST = 4 + (2 + Math.SQRT2) / 4;
  ok('half-square: cut leg = finished + s(2+root2)', near(hb.w / IN, exactHST, 1e-6), `${hb.w / IN}`);
  ok('half-square: within a sixteenth of the "+7/8 inch" rule',
     Math.abs(hb.w / IN - 4.875) < 1 / 16, `${(hb.w / IN).toFixed(4)} vs 4.875`);

  const qst = P.blockPieces(one('qst'), 4 * IN, { seamMm: SEAM, trimPoints: false });
  const qb = P.bounds(qst.pieces[0].cut);
  const exactQST = 4 + (2 + 2 * Math.SQRT2) / 4;
  ok('quarter-square: cut square = finished + s(2+2root2)', near(qb.w / IN, exactQST, 1e-6), `${qb.w / IN}`);
  ok('quarter-square: within a sixteenth of the "+1 1/4 inch" rule',
     Math.abs(qb.w / IN - 5.25) < 1 / 16, `${(qb.w / IN).toFixed(4)} vs 5.25`);

  const np = P.blockPieces(B.LIBRARY['nine-patch'], 12 * IN, { seamMm: SEAM });
  const nb = P.bounds(np.pieces[0].cut);
  ok('nine patch 12in: cut squares are exactly 4.5in', near(nb.w / IN, 4.5, 1e-9), `${nb.w / IN}`);
  ok('nine patch: nine pieces in total', np.pieces.reduce((s, p) => s + p.count, 0) === 9);
  ok('nine patch: grouped 5 + 4 by fabric',
     np.pieces.map(p => p.count).sort().join(',') === '4,5',
     np.pieces.map(p => `${p.fabric}:${p.count}`).join(' '));

  // Flying geese, the "no waste" method: a goose finishing 3 x 6 inches comes
  // from a large square cut at finished width + 1 1/4 inch, and the corner
  // triangles from squares at finished height + 7/8 inch.
  const geese = { name: 'g', grid: 2, units: [{ type: 'geese', x: 0, y: 0, rot: 0, scale: 1 }] };
  const gp = P.blockPieces(geese, 6 * IN, { seamMm: SEAM, trimPoints: false });
  const big = gp.pieces.find(x => x.count === 1), small = gp.pieces.find(x => x.count === 2);
  const gb = P.bounds(big.cut), sb = P.bounds(small.cut);
  const exactBase = 6 + 2 * 0.25 / Math.tan(Math.PI / 8);
  ok('flying geese: big triangle base = finished + 2s/tan(22.5deg)',
     near(gb.w / IN, exactBase, 1e-6), `${gb.w / IN}`);
  ok('flying geese: within a sixteenth of the "+1 1/4 inch" rule',
     Math.abs(gb.w / IN - 7.25) < 1 / 16, `${(gb.w / IN).toFixed(4)} vs 7.25`);
  ok('flying geese: corner triangles follow the half-square rule',
     near(sb.w / IN, 3 + (2 + Math.SQRT2) / 4, 1e-6), `${sb.w / IN}`);
  ok('flying geese: one big triangle and two corners', big.count === 1 && small.count === 2);

  // Trimming must only ever remove the point, never eat into a straight edge.
  const trimmed = P.blockPieces(geese, 6 * IN, { seamMm: SEAM, trimPoints: true });
  const tb = P.bounds(trimmed.pieces.find(x => x.count === 1).cut);
  ok('trimming narrows the geese base but keeps its height',
     tb.w < gb.w && near(tb.h, gb.h, 1e-9), `${tb.w / IN} x ${tb.h / IN}`);

  // The default leaves the points on, so a piece matches what a pattern hands
  // you. Trimming is opt-in.
  const dflt = P.blockPieces(geese, 6 * IN, { seamMm: SEAM });
  ok('points are left on by default',
     near(P.bounds(dflt.pieces.find(x => x.count === 1).cut).w, gb.w, 1e-9));
  ok('a square is identical either way, having no acute corners', (() => {
    const a = P.blockPieces(B.LIBRARY['nine-patch'], 12 * IN, { seamMm: SEAM, trimPoints: true });
    const b = P.blockPieces(B.LIBRARY['nine-patch'], 12 * IN, { seamMm: SEAM, trimPoints: false });
    return near(P.bounds(a.pieces[0].cut).w, P.bounds(b.pieces[0].cut).w, 1e-9);
  })());

  const fp = P.blockPieces(B.LIBRARY['four-patch'], 10 * IN, { seamMm: SEAM });
  ok('four patch 10in: cut squares are 5.5in', near(P.bounds(fp.pieces[0].cut).w / IN, 5.5, 1e-9));
}

section('Offsetting is geometrically sound');
{
  const sq = [[0,0],[10,0],[10,10],[0,10]];
  const o = P.offsetConvex(sq, 2);
  ok('square grows by the allowance on every side', near(P.bounds(o).w, 14, 1e-9), `${P.bounds(o).w}`);
  ok('offset square stays a quadrilateral', o.length === 4);
  ok('offset by zero is a no-op', near(area(P.offsetConvex(sq, 0)), 100, 1e-9));

  // Every finished edge must sit exactly `seam` inside the cut outline.
  const tri = [[0,0],[40,0],[0,40]];
  const ct = P.offsetConvex(tri, 6.35);
  for (const [name, poly] of [['square', sq], ['triangle', tri]]) {
    const cut = P.offsetConvex(poly, 6.35);
    let worst = 0;
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      for (let t = 0.1; t <= 0.9; t += 0.1) {
        const x = poly[i][0] + (poly[j][0] - poly[i][0]) * t;
        const y = poly[i][1] + (poly[j][1] - poly[i][1]) * t;
        worst = Math.max(worst, Math.abs(distToEdges(cut, x, y) - 6.35));
      }
    }
    ok(`${name}: every finished edge sits exactly one allowance inside the cut`,
       worst < 1e-6, `off by ${worst}`);
  }
  ok('cut polygon contains the finished polygon',
     tri.every(([x, y]) => pointInPoly(ct, x, y)));
  ok('winding does not matter', near(
     area(P.offsetConvex(sq, 3)), area(P.offsetConvex(sq.slice().reverse(), 3)), 1e-9));

  // dog ears
  const sharp = P.offsetConvex(tri, 6.35, Infinity);
  const trimmed = P.offsetConvex(tri, 6.35, 1.6);
  ok('an untrimmed 45-degree point runs out past 2x the allowance',
     Math.max(...sharp.map(([x, y]) => Math.min(...tri.map(([a, b]) => Math.hypot(x - a, y - b))))) > 2 * 6.35);
  ok('trimming pulls every point inside the mitre limit',
     Math.max(...trimmed.map(([x, y]) => Math.min(...tri.map(([a, b]) => Math.hypot(x - a, y - b))))) <= 1.6 * 6.35 + 1e-6);
  ok('trimming still covers the finished shape',
     tri.every(([x, y]) => pointInPoly(trimmed, x, y)));
  ok('trimming removes material, never adds', area(trimmed) < area(sharp));
}

section('Cutting layout');
{
  const sheet = { w: 400, h: 400, margin: 5 };
  const { pieces } = P.blockPieces(B.LIBRARY['sawtooth-star'], 12 * IN, { seamMm: SEAM });
  const layout = X.layoutForCutting(pieces, sheet, { spacing: 2, timeMs: 700, blocks: 2 });

  ok('one layout per fabric', layout.length === new Set(pieces.map(p => p.fabric)).size);
  ok('nothing is left unplaced', layout.every(l => l.unplaced === 0),
     layout.map(l => `${l.fabric}:${l.unplaced}`).join(' '));
  ok('two blocks means twice the pieces',
     layout.reduce((s, l) => s + l.count, 0) === pieces.reduce((s, p) => s + p.count, 0) * 2);

  let outside = 0, placed = 0;
  for (const l of layout) for (const sh of l.sheets) for (const p of sh) {
    placed++;
    for (const [x, y] of p.poly)
      if (x < -1e-6 || y < -1e-6 || x > sheet.w + 1e-6 || y > sheet.h + 1e-6) outside++;
  }
  ok('every piece lands inside its sheet', outside === 0, `${outside} stray points`);
  ok('every piece was laid out', placed === layout.reduce((s, l) => s + l.count, 0));

  const files = X.toSVG(layout, sheet);
  ok('an SVG per fabric sheet', files.length === layout.reduce((s, l) => s + l.sheets.length, 0));
  ok('declares mm', files[0].svg.includes(`width="400mm"`));
  ok('uses the red cut convention', files[0].svg.includes('#ff0000'));
  ok('no NaN in the output', !files.some(f => /NaN|Infinity/.test(f.svg)));
  ok('grain marks are off by default', !files[0].svg.includes('#008800'));
  ok('grain marks appear when asked', X.toSVG(layout, sheet, { grainMarks: true })[0].svg.includes('#008800'));

  const totals = P.fabricTotals(pieces);
  ok('fabric totals cover every fabric', totals.size === layout.length);
  ok('fabric totals are positive', [...totals.values()].every(v => v > 0));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`${failures} failing`); process.exit(1); }
console.log('patch verified.');
