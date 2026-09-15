// umbra/project.js — where the light is, and what that placement makes possible.
//
// World is millimetres. The wall is the plane z = 0 with normal +Z; the art is
// laid out on it centred on the origin. The lamp sits at +Z, the object between
// the two. Pure functions only, so the verify script can exercise all of it.

export const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
};

// Emitter diameters in mm. This is the single number that decides how fine the
// shadow can get, so the presets name real light sources rather than abstractions.
export const LAMPS = [
  { id: 'phone',    label: 'Phone flashlight',  emitter: 2 },
  { id: 'led3',     label: 'Bare 3 mm LED',     emitter: 3 },
  { id: 'led5',     label: 'Bare 5 mm LED',     emitter: 5 },
  { id: 'halogen',  label: 'Halogen capsule',   emitter: 4 },
  { id: 'cob',      label: 'COB LED module',    emitter: 12 },
  { id: 'bulb',     label: 'Frosted A19 bulb',  emitter: 40 }
];

// Strokes narrower than this many penumbra widths stop reading as edges.
export const SHARP_RATIO = 3;
export const SOFT_RATIO  = 1.5;

/* ── The optics ──────────────────────────────────────────────────────────── */

// Everything the lamp placement determines, in closed form.
//
//   k = objectDist / lampDist          both measured from the wall
//   M = 1 / (1 - k)                    magnification
//   blur    = emitter · b / a          penumbra width on the wall
//   minFeat = 3 · emitter · k          smallest object detail that still reads
//
// Resolvable detail therefore scales as (1-k)/k: moving the object toward the
// wall buys resolution and costs object size. That trade is the whole design.
export function optics({ lampDist, objectDist, emitter, wallArtWidth }) {
  const a = lampDist - objectDist;          // lamp to object
  const b = objectDist;                     // object to wall
  const k = objectDist / lampDist;
  const M = a > 0 ? lampDist / a : Infinity;
  const blur = a > 0 ? emitter * b / a : Infinity;
  const minFeatureObject = SHARP_RATIO * emitter * k;
  const minFeatureWall = minFeatureObject * M;
  const objectArtWidth = wallArtWidth / M;
  return {
    a, b, k, M, blur,
    minFeatureObject, minFeatureWall, objectArtWidth,
    resolvableFeatures: minFeatureObject > 0 ? objectArtWidth / minFeatureObject : 0
  };
}

// How many penumbra widths wide the art's own strokes are. Mean stroke width is
// estimated as 2·area/perimeter, which is exact for a long rectangle and close
// enough for letterforms.
export function sharpness(meanStrokeObject, o) {
  if (!(o.blur > 0) || !Number.isFinite(o.M)) return { ratio: 0, verdict: 'impossible' };
  const ratio = meanStrokeObject * o.M / o.blur;
  const verdict = ratio >= SHARP_RATIO ? 'sharp' : ratio >= SOFT_RATIO ? 'soft' : 'washed out';
  return { ratio, verdict };
}

export const meanStrokeWidth = (area, perimeter) => perimeter > 0 ? 2 * area / perimeter : 0;

// A laser kerf is perpendicular to the sheet, so a cut plate's walls are not
// ray-aligned and the shadow erodes by about thickness·tan(angle to the rays).
// Cutting at the sheet's mid-plane halves that, leaving this tilt ceiling.
export function tiltLimitForSheet(sheetMm, minFeatureMm) {
  if (sheetMm <= 0) return Math.PI / 2;
  return Math.atan(minFeatureMm / sheetMm);
}

export const sheetErosion = (sheetMm, rayAngleRad) => sheetMm * Math.tan(rayAngleRad) / 2;

/* ── Placement ───────────────────────────────────────────────────────────── */

// The object's anchor sits on the ray from the lamp through the art's centre, so
// the plate stays centred on the image however the lamp is moved off-axis.
export function anchorPoint(L, objectDist) {
  const f = objectDist / L[2];
  return [L[0] * f, L[1] * f, objectDist];
}

// Tilt is measured from parallel-to-the-wall. At zero the plate casts a pure
// scaled copy — the homography, and so all the anamorphic distortion, comes
// entirely from tilting it.
export function planeNormal(yawRad, pitchRad) {
  return [
    Math.sin(yawRad) * Math.cos(pitchRad),
    -Math.sin(pitchRad),
    Math.cos(yawRad) * Math.cos(pitchRad)
  ];
}

// Right-handed (u, v, n) with n facing the lamp, so a CCW ring in surface space
// has its front face pointing at the light.
export function surfaceBasis(n, L, C) {
  let nn = V.norm(n);
  if (V.dot(nn, V.sub(L, C)) < 0) nn = V.mul(nn, -1);
  let up = [0, 1, 0];
  if (Math.abs(V.dot(nn, up)) > 0.999) up = [0, 0, 1];
  const u = V.norm(V.cross(up, nn));
  const v = V.cross(nn, u);
  return { u, v, n: nn };
}

/* ── Rays ────────────────────────────────────────────────────────────────── */

// Ray from the lamp through a wall point, hitting the plane through Cg.
// Returns null when the ray runs parallel to the plane or lands behind the lamp.
export function rayToPlane(L, wallPt, Cg, n) {
  const P = [wallPt[0], wallPt[1], 0];
  const d = V.sub(P, L);
  const den = V.dot(d, n);
  if (Math.abs(den) < 1e-9) return null;
  const t = V.dot(V.sub(Cg, L), n) / den;
  if (!(t > 1e-6)) return null;
  return { t, point: V.add(L, V.mul(d, t)) };
}

// A surface point projected back onto the wall. This is the inverse of the
// above, and what the verify script uses to check the shadow really lands on
// the target.
export function projectToWall(Q, L) {
  const dz = Q[2] - L[2];
  if (Math.abs(dz) < 1e-9) return null;
  const s = -L[2] / dz;
  return [L[0] + s * (Q[0] - L[0]), L[1] + s * (Q[1] - L[1])];
}

// The invariant the whole tool rests on: material extrudes along the rays, so
// the back vertex shares its ray with the front one and casts to the same spot.
export const backVertex = (Q, L, thickness) => V.add(Q, V.mul(V.norm(V.sub(Q, L)), thickness));

/* ── Surface mapping ─────────────────────────────────────────────────────── */

// Builds everything a group of contours needs to be mapped onto its own plane.
// `delta` offsets that plane along the normal, which is how depth spread works:
// each group is re-projected through the rays onto a plane at its own depth, so
// the shadow stays exact while the physical pieces separate.
export function makeSurface({ L, objectDist, yaw, pitch, delta = 0 }) {
  const C0 = anchorPoint(L, objectDist);
  const basis = surfaceBasis(planeNormal(yaw, pitch), L, C0);
  const Cg = V.add(C0, V.mul(basis.n, delta));
  return { ...basis, C: Cg, C0, L };
}

// Wall-space ring to surface-space ring. Returns null if any vertex misses,
// which means the plate has been tilted past the point where it can catch the
// whole image.
export function ringToSurface(ring, S) {
  const out = new Array(ring.length);
  for (let i = 0; i < ring.length; i++) {
    const hit = rayToPlane(S.L, ring[i], S.C, S.n);
    if (!hit) return null;
    const d = V.sub(hit.point, S.C);
    out[i] = [V.dot(d, S.u), V.dot(d, S.v)];
  }
  return out;
}

export function surfaceToWorld(pt, S) {
  return V.add(S.C, V.add(V.mul(S.u, pt[0]), V.mul(S.v, pt[1])));
}

// Angle between the surface normal and the ray through its anchor — the number
// that drives sheet erosion.
export function rayAngleAtAnchor(S) {
  return Math.acos(Math.min(1, Math.abs(V.dot(S.n, V.norm(V.sub(S.C, S.L))))));
}

/* ── Depth spread ────────────────────────────────────────────────────────── */

// Deterministic, so a seed reproduces an arrangement exactly.
export function spreadDepths(count, spread, seed = 1) {
  if (count <= 1 || spread <= 0) return new Array(count).fill(0);
  let s = (seed >>> 0) || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  // Spaced evenly across the range and then shuffled, rather than drawn at
  // random: random draws can land every piece near the middle, which quietly
  // produces no separation at all.
  const out = [];
  for (let i = 0; i < count; i++) out.push(-spread / 2 + spread * i / (count - 1));
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
