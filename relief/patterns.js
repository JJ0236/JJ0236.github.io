// relief/patterns.js — places bubble/shard features on a panel and evaluates
// their height contributions. Pure math, no DOM: the verification script in
// scripts/ imports this directly under Node.
//
// All lengths are millimeters. A feature is a disc footprint (x, y, r) with a
// peak height h and a profile: 'dome' (spherical cap) or 'shard' (an irregular
// faceted pyramid). The panel heightmap is the max of all contributions, so
// features squish together the way the packed reference panels do.

/* ── Seeded RNG (mulberry32) ───────────────────────────────────────────── */

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Placement ─────────────────────────────────────────────────────────── */

// Dart-throwing pack, big features first, on a spatial hash so thousands of
// features stay fast. Centers may sit slightly off-panel so features clip at
// the edge like the reference panels.
export function generateFeatures(params) {
  const { widthMm: W, heightMm: H, sizeMinMm, sizeMaxMm, density, pattern,
          mixRatio = 0.5, seed } = params;
  const rng = makeRng(seed);

  const rMin = Math.max(0.5, sizeMinMm / 2);
  const rMax = Math.max(rMin, sizeMaxMm / 2);

  // How tightly discs may pack: 1 would be kissing circles, lower lets them
  // overlap into each other. The reference panels are squeezed hard.
  const overlapK = 0.72;

  // Enough candidate radii to saturate the panel at the chosen density.
  const avgR = (rMin + rMax * 0.5) / 2;
  const target = Math.ceil((W * H * density * 1.6) / (Math.PI * avgR * avgR));

  const radii = [];
  for (let i = 0; i < target; i++) {
    radii.push(rMin + (rMax - rMin) * Math.pow(rng(), 2.2));
  }
  radii.sort((a, b) => b - a);

  // Spatial hash for neighbor rejection.
  const cell = rMax * 2;
  const hash = new Map();
  const key = (cx, cy) => cx * 100003 + cy;
  const placed = [];

  const fits = (x, y, r) => {
    const c0x = Math.floor((x - r - rMax) / cell), c1x = Math.floor((x + r + rMax) / cell);
    const c0y = Math.floor((y - r - rMax) / cell), c1y = Math.floor((y + r + rMax) / cell);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const bucket = hash.get(key(cx, cy));
        if (!bucket) continue;
        for (const f of bucket) {
          const dx = x - f.x, dy = y - f.y;
          const minD = (r + f.r) * overlapK;
          if (dx * dx + dy * dy < minD * minD) return false;
        }
      }
    }
    return true;
  };

  const insert = f => {
    const cx = Math.floor(f.x / cell), cy = Math.floor(f.y / cell);
    const k = key(cx, cy);
    let bucket = hash.get(k);
    if (!bucket) hash.set(k, bucket = []);
    bucket.push(f);
    placed.push(f);
  };

  for (const r of radii) {
    const tries = 26;
    for (let t = 0; t < tries; t++) {
      // Let up to 40% of the disc hang off the edge.
      const x = -r * 0.4 + rng() * (W + r * 0.8);
      const y = -r * 0.4 + rng() * (H + r * 0.8);
      if (!fits(x, y, r)) continue;

      const shard = pattern === 'shards' ||
                    (pattern === 'mixed' && rng() < mixRatio);
      const f = { x, y, r, kind: shard ? 'shard' : 'dome' };

      if (shard) {
        const sides = 4 + Math.floor(rng() * 4);       // 4–7 facets
        f.sides = sides;
        f.rot = rng() * Math.PI * 2;
        f.facetR = [];
        for (let s = 0; s < sides; s++) f.facetR.push(0.62 + rng() * 0.5);
        // Off-center apex gives the crumpled, leaning look.
        const skew = r * 0.28;
        f.ax = (rng() * 2 - 1) * skew;
        f.ay = (rng() * 2 - 1) * skew;
      }

      // Bigger features rise higher; jitter keeps rows of equals from reading
      // as a repeat. Normalized to full depth below.
      const size = rMax > rMin ? (r - rMin) / (rMax - rMin) : 1;
      f.h = (0.38 + 0.62 * size) * (0.86 + rng() * 0.14);
      insert(f);
      break;
    }
  }

  // Scale so the tallest feature reaches exactly the requested relief depth.
  let hMax = 0;
  for (const f of placed) hMax = Math.max(hMax, f.h);
  if (hMax > 0) for (const f of placed) f.h = (f.h / hMax) * params.depthMm;

  return placed;
}

/* ── Height evaluation ─────────────────────────────────────────────────── */

// A feature's height at offset (dx, dy) from its center, or 0 outside it.
export function featureHeight(f, dx, dy) {
  if (f.kind === 'dome') {
    const q = 1 - (dx * dx + dy * dy) / (f.r * f.r);
    return q <= 0 ? 0 : f.h * Math.sqrt(q);
  }

  // Faceted pyramid: distance measured by the polygon's support function so
  // the flanks are flat planes meeting in ridges, apex shifted by (ax, ay).
  const px = dx - f.ax, py = dy - f.ay;
  let d = 0;
  for (let s = 0; s < f.sides; s++) {
    const a = f.rot + (s * Math.PI * 2) / f.sides;
    const proj = (px * Math.cos(a) + py * Math.sin(a)) / (f.r * f.facetR[s]);
    if (proj > d) d = proj;
  }
  return d >= 1 ? 0 : f.h * (1 - d);
}

// Rasterize all features into a heightmap (nx × ny vertex grid spanning the
// panel), each feature touching only the cells under its footprint.
export function buildHeightfield(features, params, nx, ny) {
  const { widthMm: W, heightMm: H } = params;
  const dx = W / (nx - 1), dy = H / (ny - 1);
  const heights = new Float32Array(nx * ny);

  for (const f of features) {
    // Shard footprints can reach r * max(facetR) from the apex offset.
    const reach = f.kind === 'dome'
      ? f.r
      : f.r * Math.max(...f.facetR) + Math.hypot(f.ax, f.ay);
    const i0 = Math.max(0, Math.floor((f.x - reach) / dx));
    const i1 = Math.min(nx - 1, Math.ceil((f.x + reach) / dx));
    const j0 = Math.max(0, Math.floor((f.y - reach) / dy));
    const j1 = Math.min(ny - 1, Math.ceil((f.y + reach) / dy));

    for (let j = j0; j <= j1; j++) {
      const py = j * dy - f.y;
      for (let i = i0; i <= i1; i++) {
        const z = featureHeight(f, i * dx - f.x, py);
        const idx = j * nx + i;
        if (z > heights[idx]) heights[idx] = z;
      }
    }
  }
  return heights;
}
