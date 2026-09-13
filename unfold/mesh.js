// unfold/mesh.js — triangle soup to a polygon-face mesh with fold edges.
//
// Pure. Welds vertices, merges coplanar neighbouring triangles into polygon
// faces (a cube must unfold as six squares, not twelve triangles), and lists
// the edges shared by exactly two faces with their signed dihedral angle.

export const MAX_FACES = 3000;
export const FIDDLY_FACES = 600;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function buildMesh(positions) {
  const triCount = Math.floor(positions.length / 9);
  if (triCount < 4) throw new Error('This file has fewer than four triangles; it cannot enclose anything.');

  // Weld on a grid one ten-thousandth of the bounding diagonal.
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], positions[i + k]); hi[k] = Math.max(hi[k], positions[i + k]);
  }
  const diag = len(sub(hi, lo));
  if (!(diag > 0)) throw new Error('Every vertex is at the same point.');
  const q = diag * 1e-4;
  const verts = [], index = new Map();
  const weld = (x, y, z) => {
    const k = `${Math.round(x / q)},${Math.round(y / q)},${Math.round(z / q)}`;
    let i = index.get(k);
    if (i === undefined) { i = verts.length; index.set(k, i); verts.push([x, y, z]); }
    return i;
  };
  const warnings = [];
  const tris = [];
  for (let t = 0; t < triCount; t++) {
    const a = weld(positions[t * 9], positions[t * 9 + 1], positions[t * 9 + 2]);
    const b = weld(positions[t * 9 + 3], positions[t * 9 + 4], positions[t * 9 + 5]);
    const c = weld(positions[t * 9 + 6], positions[t * 9 + 7], positions[t * 9 + 8]);
    if (a === b || b === c || a === c) continue;
    tris.push([a, b, c]);
  }
  // Triangle adjacency through shared undirected edges.
  const ekey = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
  const triEdge = new Map();
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const key = ekey(t[k], t[(k + 1) % 3]);
      if (!triEdge.has(key)) triEdge.set(key, []);
      triEdge.get(key).push(i);
    }
  });

  // STL winding is often inconsistent. Propagate one orientation across
  // shared manifold edges, then point the whole thing outward by signed
  // volume; a mirrored face would otherwise unfold onto its own neighbour.
  let flipped = orientConsistently(tris, triEdge);
  if (signedVolume(tris, verts) < 0) { for (const t of tris) t.reverse(); flipped += tris.length; }
  if (flipped) warnings.push(`${flipped} triangle${flipped > 1 ? 's' : ''} had reversed winding and were flipped.`);
  const triNormal = tris.map(([a, b, c]) => norm(cross(sub(verts[b], verts[a]), sub(verts[c], verts[a]))));

  // Union-find over coplanar neighbours.
  const parent = tris.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const COPLANAR = Math.cos(0.5 * Math.PI / 180);   // merge only what is flat to half a degree
  for (const list of triEdge.values()) {
    if (list.length !== 2) continue;
    const [i, j] = list;
    if (dot(triNormal[i], triNormal[j]) >= COPLANAR) parent[find(i)] = find(j);
  }
  const groups = new Map();
  tris.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });

  const faces = [];
  // Sliver faces with no real area cannot be laid out or folded; drop them and
  // let their edges become cuts.
  const minArea = 1e-7 * diag * diag;
  let slivers = 0;
  let concaveSplit = 0;
  for (const group of groups.values()) {
    const loop = groupLoop(group, tris);
    let made;
    if (loop && isConvexLoop(loop, verts)) made = [makeFace(loop, verts)];
    else {
      // A concave merged face cannot unfold: a neighbour folded across one of
      // its edges lands inside the concavity. Merge its triangles only as far
      // as they stay convex; the seams between the pieces are flat, not creases.
      const pieces = convexPieces(group, tris, verts);
      if (loop) concaveSplit++;
      made = pieces.map(l => makeFace(l, verts, true));
    }
    for (const f of made) { if (f.area > minArea) faces.push(f); else slivers++; }
  }
  if (concaveSplit) warnings.push(`${concaveSplit} concave flat region${concaveSplit > 1 ? 's' : ''} split into convex pieces (flat seams are not scored).`);
  if (slivers) warnings.push(`${slivers} zero-area sliver face${slivers > 1 ? 's' : ''} dropped.`);
  if (faces.length > MAX_FACES) throw new Error(`${faces.length} faces after merging. The limit is ${MAX_FACES}; decimate the model first.`);
  if (faces.length > FIDDLY_FACES) warnings.push(`${faces.length} faces: the net will be fiddly to assemble.`);

  // Edges shared by exactly two faces are foldable.
  const edgeMap = new Map();
  faces.forEach((f, fi) => {
    const n = f.verts.length;
    for (let i = 0; i < n; i++) {
      const a = f.verts[i], b = f.verts[(i + 1) % n];
      const key = ekey(a, b);
      if (!edgeMap.has(key)) edgeMap.set(key, { a: Math.min(a, b), b: Math.max(a, b), sides: [] });
      edgeMap.get(key).sides.push({ face: fi, index: i });
    }
  });
  const edges = [];
  let boundary = 0, nonManifold = 0;
  for (const e of edgeMap.values()) {
    if (e.sides.length !== 2) { if (e.sides.length === 1) boundary++; else nonManifold++; continue; }
    const f0 = faces[e.sides[0].face], f1 = faces[e.sides[1].face];
    const cosang = Math.max(-1, Math.min(1, dot(f0.normal, f1.normal)));
    const angle = Math.acos(cosang);
    // Convex when the neighbour's centroid sits below this face's plane.
    const convex = dot(sub(f1.centroid, f0.centroid), f0.normal) <= 1e-9;
    edges.push({
      id: edges.length, a: e.a, b: e.b, sides: e.sides,
      len: len(sub(verts[e.a], verts[e.b])),
      dihedral: convex ? angle : -angle,
    });
  }
  if (boundary) warnings.push(`${boundary} open edge${boundary > 1 ? 's' : ''}: the model is not closed, those edges are cut.`);
  if (nonManifold) warnings.push(`${nonManifold} edge${nonManifold > 1 ? 's' : ''} shared by more than two faces, treated as cuts.`);

  return { verts, tris, faces, edges, triCount, warnings, diag };
}

// Boundary of a coplanar group as one directed loop, or null if the group's
// outline is not a single simple loop.
function groupLoop(group, tris) {
  const directed = new Set(), out = new Map();
  for (const i of group) for (let k = 0; k < 3; k++) directed.add(`${tris[i][k]},${tris[i][(k + 1) % 3]}`);
  let count = 0;
  for (const d of directed) {
    const [a, b] = d.split(',').map(Number);
    if (directed.has(`${b},${a}`)) continue;
    if (out.has(a)) return null;
    out.set(a, b); count++;
  }
  if (count < 3) return null;
  const start = out.keys().next().value;
  const loop = [start];
  let cur = out.get(start);
  while (cur !== start) {
    if (loop.length > count) return null;
    loop.push(cur);
    cur = out.get(cur);
    if (cur === undefined) return null;
  }
  return loop.length === count ? loop : null;
}

function makeFace(loop, verts, keepCollinear = false) {
  // Drop collinear vertices so one straight side is one edge, except on
  // pieces split out of a flat region, whose seams must keep matching edges.
  const pts = loop.slice();
  for (let pass = 0; pass < (keepCollinear ? 0 : 2); pass++) {
    for (let i = pts.length - 1; i >= 0 && pts.length > 3; i--) {
      const p = verts[pts[(i + pts.length - 1) % pts.length]], c = verts[pts[i]], n = verts[pts[(i + 1) % pts.length]];
      const u = sub(c, p), v = sub(n, c);
      if (len(cross(u, v)) <= 1e-4 * len(u) * len(v) && dot(u, v) > 0) pts.splice(i, 1);
    }
  }
  // Newell normal and centroid.
  const nrm = [0, 0, 0], c = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const p = verts[pts[i]], q = verts[pts[(i + 1) % pts.length]];
    nrm[0] += (p[1] - q[1]) * (p[2] + q[2]);
    nrm[1] += (p[2] - q[2]) * (p[0] + q[0]);
    nrm[2] += (p[0] - q[0]) * (p[1] + q[1]);
    c[0] += p[0] / pts.length; c[1] += p[1] / pts.length; c[2] += p[2] / pts.length;
  }
  const area = len(nrm) / 2;
  return { verts: pts, normal: norm(nrm), centroid: c, area };
}

// Flips triangles in place so every manifold edge is traversed in opposite
// directions by its two triangles, component by component, then flips whole
// components whose signed volume is negative. Returns the flip count.
function orientConsistently(tris, triEdge) {
  const dirKey = (t, a, b) => { for (let k = 0; k < 3; k++) if (t[k] === a && t[(k + 1) % 3] === b) return 1; return -1; };
  const seen = new Uint8Array(tris.length);
  let flips = 0;
  for (let s = 0; s < tris.length; s++) {
    if (seen[s]) continue;
    const comp = [s]; seen[s] = 1;
    for (let i = 0; i < comp.length; i++) {
      const ti = comp[i], t = tris[ti];
      for (let k = 0; k < 3; k++) {
        const a = t[k], b = t[(k + 1) % 3];
        const list = triEdge.get(a < b ? `${a},${b}` : `${b},${a}`);
        if (!list || list.length !== 2) continue;
        const tj = list[0] === ti ? list[1] : list[0];
        if (seen[tj]) continue;
        // Consistent neighbours traverse the shared edge the opposite way.
        if (dirKey(tris[tj], a, b) === 1) { tris[tj].reverse(); flips++; }
        seen[tj] = 1; comp.push(tj);
      }
    }
  }
  return flips;
}

// Signed volume of a triangle list against a vertex array; positive when
// wound outward.
export function signedVolume(tris, verts) {
  let v = 0;
  for (const [i, j, k] of tris) {
    const a = verts[i], b = verts[j], c = verts[k];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

// Convexity of a planar loop: every turn has the same sign (collinear turns allowed).
function isConvexLoop(loop, verts) {
  const n = loop.length;
  if (n < 4) return true;
  const nrm = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const p = verts[loop[i]], q = verts[loop[(i + 1) % n]];
    nrm[0] += (p[1] - q[1]) * (p[2] + q[2]); nrm[1] += (p[2] - q[2]) * (p[0] + q[0]); nrm[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const scale = len(nrm);
  for (let i = 0; i < n; i++) {
    const a = verts[loop[i]], b = verts[loop[(i + 1) % n]], c = verts[loop[(i + 2) % n]];
    const t = dot(cross(sub(b, a), sub(c, b)), nrm);
    if (t < -1e-6 * scale * len(sub(b, a)) * len(sub(c, b))) return false;
  }
  return true;
}

// Greedy convex merging of a coplanar triangle group: union neighbouring
// pieces along their shared edge whenever the result is a single convex loop.
function convexPieces(group, tris, verts) {
  let pieces = group.map(i => tris[i].slice());
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      const u = unionLoops(pieces[i], pieces[j]);
      if (u && isConvexLoop(u, verts)) { pieces[i] = u; pieces.splice(j, 1); merged = true; break outer; }
    }
  }
  return pieces;
}

// Union of two loops sharing exactly one edge (traversed in opposite
// directions); null otherwise.
function unionLoops(A, B) {
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      if (B[j] === b && B[(j + 1) % B.length] === a) {
        const out = [];
        for (let k = 1; k <= A.length; k++) out.push(A[(i + k) % A.length]);      // b ... a (inclusive)
        for (let k = 2; k < B.length; k++) out.push(B[(j + k) % B.length]);       // after a ... before b
        if (new Set(out).size !== out.length) return null;
        return out;
      }
    }
  }
  return null;
}
