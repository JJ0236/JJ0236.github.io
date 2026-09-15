#!/usr/bin/env node
// scripts/verify-umbra.mjs — headless check of the shadow-caster.
//
// The load-bearing test projects the finished mesh back through the lamp onto
// the wall and asserts it lands on the target art. Everything else guards the
// pieces that feed it.
//
//   node scripts/verify-umbra.mjs

import {
  parsePathData, tokenizePath, ringArea, ellipseRing, parseTransform, mApply, boundsOf
} from '../umbra/svg.js';
import {
  optics, sharpness, meanStrokeWidth, makeSurface, ringToSurface, surfaceToWorld,
  projectToWall, backVertex, tiltLimitForSheet, spreadDepths, LAMPS
} from '../umbra/project.js';
import {
  shapesToPolygons, fitToWall, buildSolid, bridge, groupPolygons, polyStats,
  checkManifold, signedVolume, boundingBox
} from '../umbra/mesh.js';

let failures = 0, checks = 0;
const ok = (name, cond, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ': ' + detail : ''}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
// Mesh positions are Float32, so a hundred-millimetre coordinate carries about
// 1e-5 mm of representation noise. A micron is well under anything physical.
const FLOAT32_TOL = 1e-3;
const section = t => console.log(`\n${t}`);

/* ── Geometry helpers used only by the tests ─────────────────────────────── */

function pointInMulti(pt, mp) {
  let inside = false;
  for (const poly of mp) for (const ring of poly) {
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      const a = ring[j], b = ring[i];
      if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
          pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  return inside;
}

function distToMulti(pt, mp) {
  let best = Infinity;
  for (const poly of mp) for (const ring of poly) {
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      const a = ring[j], b = ring[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy)));
    }
  }
  return best;
}

const letterO = () => {
  const outer = parsePathData('M0 0 L100 0 L100 100 L0 100 Z')[0].points;
  const inner = [[30, 30], [30, 70], [70, 70], [70, 30]];
  return [{ rings: [outer, inner], closed: [true, true], fillRule: 'nonzero', filled: true, strokeWidth: 0 }];
};

/* ── 1. SVG parsing ──────────────────────────────────────────────────────── */

section('SVG parsing');
{
  const sq = parsePathData('M0 0 L10 0 L10 10 L0 10 Z');
  ok('closed square is one subpath of four points', sq.length === 1 && sq[0].points.length === 4);
  ok('square area is 100 and wound CCW', ringArea(sq[0].points) === 100);

  const rel = parsePathData('m0 0 l10 0 l0 10 l-10 0 z');
  ok('relative commands match absolute', near(ringArea(rel[0].points), 100, 1e-9));

  ok('implicit number separators split correctly',
    JSON.stringify(tokenizePath('M.5.5L1.5-2.5')) === JSON.stringify(['M', 0.5, 0.5, 'L', 1.5, -2.5]));

  ok('exponent notation parses', tokenizePath('M1e2 1E-2')[1] === 100);

  const arc = parsePathData('M0 0 A5 5 0 1 1 10 0');
  const end = arc[0].points.at(-1);
  ok('arc reaches its endpoint', near(end[0], 10, 1e-6) && near(end[1], 0, 1e-6),
    `got ${end.map(v => v.toFixed(4))}`);

  const circleArea = ringArea(ellipseRing(0, 0, 10, 10, 0.02));
  ok('flattened circle area is within 0.5% of pi r^2',
    Math.abs(circleArea - Math.PI * 100) / (Math.PI * 100) < 0.005,
    `got ${circleArea.toFixed(3)}`);

  const implicitLine = parsePathData('M0 0 10 0 10 10 0 10 Z');
  ok('implicit lineto after moveto', implicitLine[0].points.length === 4);

  const p = mApply(parseTransform('translate(5,5) rotate(90)'), 1, 0);
  ok('composed transforms apply in SVG order', near(p[0], 5, 1e-9) && near(p[1], 6, 1e-9),
    `got ${p.map(v => v.toFixed(3))}`);
}

/* ── 2. Optics ───────────────────────────────────────────────────────────── */

section('Optics — what the lamp placement allows');
{
  const o = optics({ lampDist: 1000, objectDist: 500, emitter: 2, wallArtWidth: 400 });
  ok('magnification is 1/(1-k)', near(o.M, 2, 1e-12));
  ok('blur is emitter*b/a', near(o.blur, 2, 1e-12));
  ok('minimum object feature is 3*s*k', near(o.minFeatureObject, 3, 1e-12));
  ok('object art width is wallWidth*(1-k)', near(o.objectArtWidth, 200, 1e-12));

  const far = optics({ lampDist: 1000, objectDist: 900, emitter: 2, wallArtWidth: 400 });
  const ratio = o.resolvableFeatures / far.resolvableFeatures;
  ok('resolvable detail scales as (1-k)/k', near(ratio, (0.5 / 0.5) / (0.1 / 0.9), 1e-9),
    `got ${ratio.toFixed(4)}`);

  ok('a frosted bulb cannot resolve fine detail',
    optics({ lampDist: 1000, objectDist: 500, emitter: 40, wallArtWidth: 400 }).minFeatureObject === 60);

  ok('every lamp preset carries an emitter size',
    LAMPS.every(l => l.emitter > 0 && l.id && l.label));

  const stroke = meanStrokeWidth(100 * 10, 2 * (100 + 10));
  ok('mean stroke of a 100x10 bar is ~10', near(stroke, 9.09, 0.01), `got ${stroke.toFixed(3)}`);

  ok('a stroke three blurs wide reads as sharp', sharpness(3, o).verdict === 'sharp');
  ok('a stroke under 1.5 blurs is washed out', sharpness(0.5, o).verdict === 'washed out');

  const lim = tiltLimitForSheet(3, 6) * 180 / Math.PI;
  ok('sheet tilt limit is atan(minFeature/thickness)', near(lim, 63.43, 0.01), `got ${lim.toFixed(2)}`);

  ok('depth spread is deterministic for a seed',
    JSON.stringify(spreadDepths(6, 40, 7)) === JSON.stringify(spreadDepths(6, 40, 7)));
  ok('depth spread stays inside its range',
    spreadDepths(200, 40, 3).every(d => Math.abs(d) <= 20));
}

/* ── 3. The ray-extrusion invariant ──────────────────────────────────────── */

section('Ray extrusion — thickness must not move the shadow');
{
  const L = [140, -90, 1000];
  const S = makeSurface({ L, objectDist: 620, yaw: 0.6, pitch: -0.25, delta: 0 });
  const ring = [[-140, -60], [150, -70], [130, 80], [-120, 90]];
  const sr = ringToSurface(ring, S);
  ok('every target vertex maps onto the surface', sr && sr.length === ring.length);

  const roundTrip = Math.max(...sr.map((p, i) => {
    const w = projectToWall(surfaceToWorld(p, S), L);
    return Math.hypot(w[0] - ring[i][0], w[1] - ring[i][1]);
  }));
  ok('wall to surface to wall round-trips exactly', roundTrip < 1e-9, `err ${roundTrip.toExponential(2)}`);

  for (const th of [0.5, 3, 12, 40]) {
    const err = Math.max(...sr.map((p, i) => {
      const w = projectToWall(backVertex(surfaceToWorld(p, S), L, th), L);
      return Math.hypot(w[0] - ring[i][0], w[1] - ring[i][1]);
    }));
    ok(`back face at ${th} mm still lands on the target`, err < 1e-9, `err ${err.toExponential(2)}`);
  }
}

/* ── 4. Fill rules, strokes, bridging ────────────────────────────────────── */

section('Contour handling');
{
  const mp = shapesToPolygons(letterO());
  ok('nonzero counter becomes a hole', mp.length === 1 && mp[0].length === 2);

  const eo = shapesToPolygons([{ ...letterO()[0], fillRule: 'evenodd' }]);
  ok('even-odd counter becomes a hole', eo.length === 1 && eo[0].length === 2);

  const stats = polyStats(mp);
  ok('area subtracts the hole', near(stats.area, 100 * 100 - 40 * 40, 1e-6), `got ${stats.area}`);

  const uniform = shapesToPolygons([{
    rings: [[[0, 0], [0, 10], [10, 10], [10, 0]]], closed: [true],
    fillRule: 'nonzero', filled: true, strokeWidth: 0
  }]);
  ok('uniformly clockwise art is still filled', polyStats(uniform).area > 0);

  const strokeOnly = shapesToPolygons([{
    rings: [[[0, 0], [100, 0], [100, 100]]], closed: [false],
    fillRule: 'nonzero', filled: false, strokeWidth: 4
  }]);
  ok('stroke-only line art produces area', polyStats(strokeOnly).area > 0,
    `area ${polyStats(strokeOnly).area}`);
  ok('outlined stroke is about width x length',
    near(polyStats(strokeOnly).area, 4 * 200, 60), `got ${polyStats(strokeOnly).area.toFixed(1)}`);

  const two = [
    [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    [[[40, 0], [50, 0], [50, 10], [40, 10], [40, 0]]]
  ];
  const br = bridge(two, 2);
  ok('two islands bridge into one component', br.mp.length === 1, `got ${br.mp.length}`);
  ok('bridging records the bar it added', br.count === 1);

  const groups = groupPolygons(fitToWall(shapesToPolygons(letterO()), 200).mp, 'bands', 4);
  ok('band grouping splits the art', groups.length === 4, `got ${groups.length}`);
}

/* ── 5. The shadow really is the art ─────────────────────────────────────── */

section('Shadow fidelity');
{
  const L = [90, 60, 1000];
  const fit = fitToWall(shapesToPolygons(letterO()), 240);

  let prevBounds = null;
  for (const thickness of [1, 4, 16]) {
    const r = buildSolid(fit.mp, {
      L, objectDist: 560, yaw: 0.4, pitch: -0.18, thickness,
      polarity: 'negative', marginMm: 12, bridgeMm: 2.5, magnification: 2.2
    });

    // Every vertex, front and back, must cast inside the material it was cut
    // from. This is the claim the whole tool makes.
    let outside = 0, worst = 0, n = 0;
    for (let i = 0; i < r.positions.length; i += 3) {
      const w = projectToWall([r.positions[i], r.positions[i + 1], r.positions[i + 2]], L);
      n++;
      if (!pointInMulti(w, r.material)) {
        const d = distToMulti(w, r.material);
        worst = Math.max(worst, d);
        if (d > FLOAT32_TOL) outside++;
      }
    }
    ok(`t=${thickness}mm: all ${n} vertices cast inside the target`, outside === 0,
      `${outside} outside, worst ${worst.toExponential(2)} mm`);

    // Vertices alone are not enough: a triangle can have all three corners on
    // the boundary and still span straight across a hole. That is exactly the
    // failure a bad triangulation produces, so test the interiors too.
    let spanning = 0, worstSpan = 0;
    for (let i = 0; i < r.positions.length; i += 9) {
      const w = [];
      for (let k = 0; k < 3; k++) {
        w.push(projectToWall([r.positions[i + k * 3], r.positions[i + k * 3 + 1], r.positions[i + k * 3 + 2]], L));
      }
      const c = [(w[0][0] + w[1][0] + w[2][0]) / 3, (w[0][1] + w[1][1] + w[2][1]) / 3];
      const area = Math.abs((w[1][0] - w[0][0]) * (w[2][1] - w[0][1]) - (w[2][0] - w[0][0]) * (w[1][1] - w[0][1])) / 2;
      if (area > 1 && !pointInMulti(c, r.material)) { spanning++; worstSpan = Math.max(worstSpan, area); }
    }
    ok(`t=${thickness}mm: no triangle spans a hole`, spanning === 0,
      `${spanning} spanning, largest ${Math.round(worstSpan)} mm^2`);

    // And the cast must not grow with thickness.
    const proj = [];
    for (let i = 0; i < r.positions.length; i += 3) {
      proj.push(projectToWall([r.positions[i], r.positions[i + 1], r.positions[i + 2]], L));
    }
    const b = boundsOf([proj]);
    if (prevBounds) {
      const drift = Math.max(Math.abs(b.w - prevBounds.w), Math.abs(b.h - prevBounds.h));
      ok(`t=${thickness}mm: shadow size unchanged by thickness`, drift < FLOAT32_TOL,
        `drifted ${drift.toExponential(2)} mm`);
    }
    prevBounds = b;
  }
}

/* ── 6. Solids ───────────────────────────────────────────────────────────── */

section('Solid integrity');
{
  const fit = fitToWall(shapesToPolygons(letterO()), 220);
  const cases = [
    { name: 'negative flat plate', polarity: 'negative', yaw: 0.3, pitch: -0.1, spreadMm: 0, granularity: 'plate' },
    { name: 'negative, hard tilt',  polarity: 'negative', yaw: 0.9, pitch: 0.35, spreadMm: 0, granularity: 'plate' },
    { name: 'positive flat',        polarity: 'positive', yaw: 0.2, pitch: 0.1,  spreadMm: 0, granularity: 'plate' },
    { name: 'positive, depth by island', polarity: 'positive', yaw: 0.3, pitch: 0, spreadMm: 60, granularity: 'islands' },
    { name: 'positive, depth by band',   polarity: 'positive', yaw: 0.3, pitch: 0, spreadMm: 60, granularity: 'bands' }
  ];
  for (const c of cases) {
    const r = buildSolid(fit.mp, {
      L: [0, 0, 1000], objectDist: 500, thickness: 3, marginMm: 10,
      bridgeMm: 2, seed: 5, bandCount: 4, magnification: 2, ...c
    });
    const man = checkManifold(r.positions);
    const vol = signedVolume(r.positions);
    const bb = boundingBox(r.positions);
    ok(`${c.name}: watertight`, man.ok, `${man.badEdges} unpaired edges`);
    ok(`${c.name}: wound outward (positive volume)`, vol > 0, `volume ${vol.toFixed(2)}`);
    ok(`${c.name}: no NaNs`, r.positions.every(Number.isFinite));
    ok(`${c.name}: sits between lamp and wall`, bb.lo[2] > 0 && bb.hi[2] < 1000,
      `z ${bb.lo[2].toFixed(1)}..${bb.hi[2].toFixed(1)}`);
  }
}

/* ── 7. Depth spread keeps the shadow ────────────────────────────────────── */

section('Depth spread does not disturb the image');
{
  const L = [0, 0, 1000];
  const fit = fitToWall(shapesToPolygons([{
    rings: [[[0, 0], [30, 0], [30, 30], [0, 30]]], closed: [true], fillRule: 'nonzero', filled: true, strokeWidth: 0
  }, {
    rings: [[[60, 0], [90, 0], [90, 30], [60, 30]]], closed: [true], fillRule: 'nonzero', filled: true, strokeWidth: 0
  }]), 200);

  const deep = buildSolid(fit.mp, { L, objectDist: 500, yaw: 0.25, pitch: 0, thickness: 3, polarity: 'positive', spreadMm: 120, granularity: 'islands', bridgeMm: 2, seed: 9, magnification: 2 });

  const spanZ = boundingBox(deep.positions).size[2];
  ok('depth spread actually separates the pieces in z', spanZ > 40, `z span ${spanZ.toFixed(1)} mm`);

  // Ignore the struts, which are honestly disclosed as casting their own shadow.
  const artOnly = deep.positions.slice(0, deep.artFloatCount);
  let outside = 0;
  for (let i = 0; i < artOnly.length; i += 3) {
    const w = projectToWall([artOnly[i], artOnly[i + 1], artOnly[i + 2]], L);
    if (!pointInMulti(w, deep.material) && distToMulti(w, deep.material) > FLOAT32_TOL) outside++;
  }
  ok('separated pieces still cast onto the same art', outside === 0, `${outside} vertices outside`);
  ok('a strut was added and disclosed', deep.warnings.some(w => /strut/.test(w)));
}

/* ── Result ──────────────────────────────────────────────────────────────── */

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`${failures} FAILED`); process.exit(1); }
console.log('umbra verified.');
