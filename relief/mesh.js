// relief/mesh.js — skins a heightfield into one watertight solid.
//
// The panel sits in the positive octant: x across [0..W], y up [0..H],
// z = relief with a flat base slab underneath. Output is a triangle soup
// (Float32Array, 9 floats per triangle) with outward CCW winding, ready for
// the same STL/3MF writers terra uses. Pure math, no DOM — the verification
// script imports this under Node.

/** Pick a vertex grid for the panel, honoring a hard triangle budget. */
export function gridForPanel(W, H, cellMm, maxTriangles = 2_400_000) {
  let cell = cellMm;
  const tris = c => 2 * Math.ceil(W / c) * Math.ceil(H / c);
  while (tris(cell) > maxTriangles) cell *= 1.25;
  return {
    nx: Math.max(2, Math.round(W / cell) + 1),
    ny: Math.max(2, Math.round(H / cell) + 1),
    cell
  };
}

/**
 * Build the solid. heights is the nx × ny relief grid (0 = slab surface);
 * base thickness is added underneath, so total height = base + max(heights).
 */
export function buildSolid(heights, nx, ny, { widthMm: W, heightMm: H, baseMm }) {
  const base = Math.max(0.5, baseMm); // zero-height walls would be degenerate
  const dx = W / (nx - 1), dy = H / (ny - 1);
  // Snap grid coordinates so boundary vertices land exactly on 0/W/H and
  // shared vertices weld bit-identically everywhere they recur.
  const X = new Float32Array(nx), Y = new Float32Array(ny);
  for (let i = 0; i < nx; i++) X[i] = i === nx - 1 ? W : i * dx;
  for (let j = 0; j < ny; j++) Y[j] = j === ny - 1 ? H : j * dy;
  const Z = (i, j) => base + heights[j * nx + i];

  const perim = 2 * (nx - 1) + 2 * (ny - 1);
  const triCount = 2 * (nx - 1) * (ny - 1)  // top
                 + 2 * perim                // walls
                 + perim;                   // bottom fan
  const out = new Float32Array(triCount * 9);
  let p = 0;
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    out[p++] = ax; out[p++] = ay; out[p++] = az;
    out[p++] = bx; out[p++] = by; out[p++] = bz;
    out[p++] = cx; out[p++] = cy; out[p++] = cz;
  };

  // Top surface — CCW seen from +z.
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const x0 = X[i], x1 = X[i + 1], y0 = Y[j], y1 = Y[j + 1];
      const zA = Z(i, j), zB = Z(i + 1, j), zC = Z(i + 1, j + 1), zD = Z(i, j + 1);
      tri(x0, y0, zA, x1, y0, zB, x1, y1, zC);
      tri(x0, y0, zA, x1, y1, zC, x0, y1, zD);
    }
  }

  // Walls — windings chosen so normals face outward (see verify script).
  for (let i = 0; i < nx - 1; i++) {
    const x0 = X[i], x1 = X[i + 1];
    let z0 = Z(i, 0), z1 = Z(i + 1, 0);          // south, normal −y
    tri(x0, 0, 0, x1, 0, 0, x1, 0, z1);
    tri(x0, 0, 0, x1, 0, z1, x0, 0, z0);
    z0 = Z(i, ny - 1); z1 = Z(i + 1, ny - 1);    // north, normal +y
    tri(x0, H, 0, x0, H, z0, x1, H, z1);
    tri(x0, H, 0, x1, H, z1, x1, H, 0);
  }
  for (let j = 0; j < ny - 1; j++) {
    const y0 = Y[j], y1 = Y[j + 1];
    let z0 = Z(0, j), z1 = Z(0, j + 1);          // west, normal −x
    tri(0, y0, 0, 0, y0, z0, 0, y1, z1);
    tri(0, y0, 0, 0, y1, z1, 0, y1, 0);
    z0 = Z(nx - 1, j); z1 = Z(nx - 1, j + 1);    // east, normal +x
    tri(W, y0, 0, W, y1, 0, W, y1, z1);
    tri(W, y0, 0, W, y1, z1, W, y0, z0);
  }

  // Bottom — fan from the panel center over the full perimeter loop so wall
  // bottom edges are matched vertex-for-vertex (no T-junctions). The loop is
  // CCW from above; winding (center, next, current) points the fan −z.
  const loop = [];
  for (let i = 0; i < nx - 1; i++) loop.push([X[i], 0]);
  for (let j = 0; j < ny - 1; j++) loop.push([W, Y[j]]);
  for (let i = nx - 1; i > 0; i--) loop.push([X[i], H]);
  for (let j = ny - 1; j > 0; j--) loop.push([0, Y[j]]);
  const cx = W / 2, cy = H / 2;
  for (let k = 0; k < loop.length; k++) {
    const [ax, ay] = loop[k];
    const [bx, by] = loop[(k + 1) % loop.length];
    tri(cx, cy, 0, bx, by, 0, ax, ay, 0);
  }

  return out;
}

/* ── Verification helpers ──────────────────────────────────────────────── */

const Q = 1024; // weld quantum: 1/1024 mm

/** Watertightness: every undirected edge shared by exactly two opposed tris. */
export function checkManifold(arr) {
  const index = new Map();
  let verts = 0;
  const dir = new Map();
  const weldKey = (x, y, z) =>
    `${Math.round(x * Q)},${Math.round(y * Q)},${Math.round(z * Q)}`;

  for (let i = 0; i < arr.length; i += 9) {
    const ids = [];
    for (let v = 0; v < 3; v++) {
      const k = weldKey(arr[i + v * 3], arr[i + v * 3 + 1], arr[i + v * 3 + 2]);
      let id = index.get(k);
      if (id === undefined) { id = verts++; index.set(k, id); }
      ids.push(id);
    }
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
    for (const [u, v] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
      const k = `${u}>${v}`;
      dir.set(k, (dir.get(k) || 0) + 1);
    }
  }

  let open = 0, dupes = 0;
  for (const [k, n] of dir) {
    if (n > 1) dupes++;
    const [u, v] = k.split('>');
    if (!dir.has(`${v}>${u}`)) open++;
  }
  return { ok: open === 0 && dupes === 0, openEdges: open, duplicateEdges: dupes, vertices: verts };
}

/** Signed volume via divergence theorem — positive iff wound outward. */
export function signedVolume(arr) {
  let vol = 0;
  for (let i = 0; i < arr.length; i += 9) {
    const ax = arr[i],     ay = arr[i + 1], az = arr[i + 2];
    const bx = arr[i + 3], by = arr[i + 4], bz = arr[i + 5];
    const cx = arr[i + 6], cy = arr[i + 7], cz = arr[i + 8];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return vol;
}

export function boundingBox(arr) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < arr.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = arr[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max, size: max.map((v, a) => v - min[a]) };
}
