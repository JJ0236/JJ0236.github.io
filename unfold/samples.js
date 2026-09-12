// unfold/samples.js — low-poly solids generated in code, as triangle
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

// Dodecahedron faces are found rather than typed: each icosahedron vertex
// direction is a face normal, and the five dodecahedron vertices nearest that
// plane form the pentagon.
export function dodecahedron(s = 40) {
  const p = (1 + Math.sqrt(5)) / 2, q = 1 / p;
  const v = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
  for (const a of [-1, 1]) for (const b of [-1, 1]) { v.push([0, a * q, b * p]); v.push([a * q, b * p, 0]); v.push([b * p, 0, a * q]); }
  const k = s / (2 * Math.sqrt(3));
  const verts = v.map(t => t.map(x => x * k));
  const normals = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) { normals.push([a, 0, b * p]); normals.push([0, a * p, b]); normals.push([a * p, b, 0]); }
  const faces = normals.map(n => {
    const l = Math.hypot(...n), nn = n.map(x => x / l);
    const scored = verts.map((t, i) => ({ i, d: t[0] * nn[0] + t[1] * nn[1] + t[2] * nn[2] })).sort((a, b) => b.d - a.d).slice(0, 5);
    const c = [0, 0, 0]; for (const { i } of scored) for (let k = 0; k < 3; k++) c[k] += verts[i][k] / 5;
    const u0 = verts[scored[0].i].map((x, k) => x - c[k]);
    const w = [nn[1] * u0[2] - nn[2] * u0[1], nn[2] * u0[0] - nn[0] * u0[2], nn[0] * u0[1] - nn[1] * u0[0]];
    return scored.map(({ i }) => { const d = verts[i].map((x, k) => x - c[k]); return { i, a: Math.atan2(d[0] * w[0] + d[1] * w[1] + d[2] * w[2], d[0] * u0[0] + d[1] * u0[1] + d[2] * u0[2]) }; })
      .sort((a, b) => a.a - b.a).map(x => x.i);
  });
  return fromFaces(verts, faces);
}

// Icosahedron subdivided once and pushed onto the sphere: 80 triangles.
export function sphere(s = 40) {
  const soup = Array.from(icosahedron(s / 2));
  let r = 0; for (let i = 0; i < soup.length; i += 3) r += Math.hypot(soup[i], soup[i + 1], soup[i + 2]) / (soup.length / 3);
  const proj = p => { const l = Math.hypot(...p); return p.map(x => x / l * r); };
  const mid = (a, b) => proj([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  const out = [];
  for (let t = 0; t < soup.length; t += 9) {
    const a = soup.slice(t, t + 3), b = soup.slice(t + 3, t + 6), c = soup.slice(t + 6, t + 9);
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    for (const tri of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) out.push(...tri.flat());
  }
  return Float64Array.from(out);
}

// Octahedron with a low pyramid on every face: 24 triangles, not convex.
export function star(s = 40) {
  const base = octahedron(s / 2);
  const out = [];
  for (let t = 0; t < base.length; t += 9) {
    const a = base.slice(t, t + 3), b = base.slice(t + 3, t + 6), c = base.slice(t + 6, t + 9);
    const m = [0, 1, 2].map(k => (a[k] + b[k] + c[k]) / 3 * 1.9);
    out.push(...a, ...b, ...m, ...b, ...c, ...m, ...c, ...a, ...m);
  }
  return Float64Array.from(out);
}

// Box with a gable roof: seven faces, two of them pentagons.
export function house(s = 40) {
  const w = s / 2, d = s * 0.35, h = s * 0.3, ridge = s * 0.55;
  const v = [[-w, -d, 0], [w, -d, 0], [w, d, 0], [-w, d, 0], [-w, -d, h], [w, -d, h], [w, d, h], [-w, d, h], [-w, 0, ridge], [w, 0, ridge]];
  return fromFaces(v, [[0, 1, 2, 3], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 9, 5], [3, 0, 4, 8, 7], [4, 5, 9, 8], [6, 7, 8, 9]]);
}

// Triangulated torus, 10 around by 6 through: 120 triangles, the classic
// hard case for a one-piece net.
export function torus(s = 40) {
  const R = s * 0.36, r = s * 0.14, nu = 10, nv = 6;
  const P = (i, j) => { const u = i / nu * 2 * Math.PI, v = j / nv * 2 * Math.PI; return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)]; };
  const out = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return Float64Array.from(out);
}

export const SAMPLES = { cube, octahedron, icosahedron, dodecahedron, gem, sphere, star, house, torus };
