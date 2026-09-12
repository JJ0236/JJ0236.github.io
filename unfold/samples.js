// unfold/samples.js — four low-poly solids generated in code, as triangle
// soups the same shape parseStl() returns. Faces are wound outward.

function fromFaces(verts, faces) {
  // Fan-triangulate each polygon and orient every triangle to face away from
  // the solid's centroid, so hand-typed winding mistakes cannot leak through.
  const c = [0, 0, 0];
  for (const v of verts) { c[0] += v[0] / verts.length; c[1] += v[1] / verts.length; c[2] += v[2] / verts.length; }
  const out = [];
  for (const f of faces) {
    for (let i = 1; i + 1 < f.length; i++) {
      let a = verts[f[0]], b = verts[f[i]], d = verts[f[i + 1]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const m = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]];
      if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) [b, d] = [d, b];
      out.push(...a, ...b, ...d);
    }
  }
  return Float64Array.from(out);
}

export function cube(s = 40) {
  const h = s / 2;
  const v = [[-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h], [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]];
  return fromFaces(v, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]);
}

export function octahedron(s = 40) {
  const v = [[s, 0, 0], [-s, 0, 0], [0, s, 0], [0, -s, 0], [0, 0, s], [0, 0, -s]];
  return fromFaces(v, [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]]);
}

export function icosahedron(s = 30) {
  const p = (1 + Math.sqrt(5)) / 2;
  const raw = [[-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0], [0, -1, p], [0, 1, p], [0, -1, -p], [0, 1, -p], [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1]];
  const k = s / Math.hypot(1, p);
  const v = raw.map(q => q.map(x => x * k));
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return fromFaces(v, f);
}

// A brilliant-ish gem: flat hexagonal table, six crown facets, six pavilion
// facets to a point. Crown facets are isosceles trapezoids, so they are planar.
export function gem(s = 40) {
  const R = s / 2, r = R * 0.55, zt = R * 0.4, za = -R * 1.3;
  const v = [];
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; v.push([r * Math.cos(a), r * Math.sin(a), zt]); }
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; v.push([R * Math.cos(a), R * Math.sin(a), 0]); }
  v.push([0, 0, za]);
  const faces = [[0, 1, 2, 3, 4, 5]];
  for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; faces.push([i, 6 + i, 6 + j, j]); faces.push([6 + i, 12, 6 + j]); }
  return fromFaces(v, faces);
}

export const SAMPLES = { cube, octahedron, icosahedron, gem };
