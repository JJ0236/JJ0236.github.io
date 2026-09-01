// relief/patterns.js — places relief features on a panel and evaluates their
// height contributions. Pure math, no DOM: the verification script in
// scripts/ imports this directly under Node.
//
// All lengths are millimeters. A feature is a disc footprint (x, y, r) with a
// peak height h and one of several profiles (dome, faceted shard, cone, ring
// crater, concentric ripple, terraced steps, flat puck). The panel heightmap
// is the max of all contributions, so features squish together the way the
// packed reference panels do. Panel-wide effects — height gradients, a wave
// swell, a raised border frame — are applied at rasterization time.

export const SHAPE_KINDS = ['dome', 'shard', 'cone', 'ring', 'ripple', 'steps', 'puck'];

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
  const { widthMm: W, heightMm: H, sizeMinMm, sizeMaxMm, density, seed,
          shapes = ['dome'], gradient = 'none', frameMm = 0 } = params;
  const rng = makeRng(seed);

  // Pattern area shrinks inside an optional border frame.
  const fx = Math.min(frameMm, W * 0.4), fy = Math.min(frameMm, H * 0.4);
  const PW = W - 2 * fx, PH = H - 2 * fy;

  const rMin = Math.max(0.5, sizeMinMm / 2);
  const rMax = Math.max(rMin, sizeMaxMm / 2);

  // How tightly discs may pack: 1 would be kissing circles, lower lets them
  // overlap into each other. The reference panels are squeezed hard.
  const overlapK = 0.72;

  // Enough candidate radii to saturate the panel at the chosen density.
  const avgR = (rMin + rMax * 0.5) / 2;
  const target = Math.ceil((PW * PH * density * 1.6) / (Math.PI * avgR * avgR));

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
      // Let up to 40% of the disc hang off the pattern-area edge.
      const x = fx - r * 0.4 + rng() * (PW + r * 0.8);
      const y = fy - r * 0.4 + rng() * (PH + r * 0.8);
      if (!fits(x, y, r)) continue;

      const kind = shapes[Math.floor(rng() * shapes.length)];
      const f = { x, y, r, kind };

      if (kind === 'shard') {
        const sides = 4 + Math.floor(rng() * 4);       // 4–7 facets
        f.sides = sides;
        f.rot = rng() * Math.PI * 2;
        f.facetR = [];
        for (let s = 0; s < sides; s++) f.facetR.push(0.62 + rng() * 0.5);
        // Off-center apex gives the crumpled, leaning look.
        const skew = r * 0.28;
        f.ax = (rng() * 2 - 1) * skew;
        f.ay = (rng() * 2 - 1) * skew;
      } else if (kind === 'cone') {
        f.exp = 1.1 + rng() * 0.6;                     // flank curvature
      } else if (kind === 'ripple') {
        f.waves = 2 + Math.floor(rng() * 3);           // rings across radius
      } else if (kind === 'steps') {
        f.steps = 3 + Math.floor(rng() * 3);           // terraces
      } else if (kind === 'puck') {
        f.top = 0.6 + rng() * 0.25;                    // flat top starts here
      }

      // Bigger features rise higher; jitter keeps rows of equals from reading
      // as a repeat. Normalized against the sampled peak at rasterize time.
      const size = rMax > rMin ? (r - rMin) / (rMax - rMin) : 1;
      f.h = (0.38 + 0.62 * size) * (0.86 + rng() * 0.14);
      if (kind === 'puck') f.h *= 0.55 + rng() * 0.45; // pucks vary more

      // Panel-wide height gradient, judged by feature center.
      if (gradient === 'linear') {
        f.h *= 0.3 + 0.7 * (x / W);
      } else if (gradient === 'radial') {
        const t = Math.hypot(x - W / 2, y - H / 2) / (Math.hypot(W, H) / 2);
        f.h *= 0.3 + 0.7 * Math.max(0, 1 - t);
      }
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
  if (f.kind === 'shard') {
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

  const t = Math.hypot(dx, dy) / f.r;        // 0 at center, 1 at rim
  if (t >= 1) return 0;

  switch (f.kind) {
    case 'dome':
      return f.h * Math.sqrt(1 - t * t);
    case 'cone':
      return f.h * Math.pow(1 - t, f.exp);
    case 'ring': {
      // Gaussian donut: crest at 55% radius, dipping toward a center crater.
      const g = Math.exp(-((t - 0.55) ** 2) / (2 * 0.2 ** 2));
      return f.h * Math.max(g, 0.25 * Math.sqrt(1 - t * t));
    }
    case 'ripple': {
      // Concentric ridges under a dome envelope, like exaggerated layer lines.
      const env = Math.sqrt(1 - t * t);
      return f.h * env * (0.55 + 0.45 * Math.cos(t * f.waves * Math.PI * 2));
    }
    case 'steps': {
      // A dome quantized into flat terraces.
      const env = Math.sqrt(1 - t * t);
      return f.h * (Math.ceil(env * f.steps) / f.steps) * 0.999;
    }
    case 'puck': {
      // Flat top rolling off smoothly to the rim.
      if (t <= f.top) return f.h;
      const s = (t - f.top) / (1 - f.top);
      return f.h * 0.5 * (1 + Math.cos(s * Math.PI));
    }
  }
  return 0;
}

// Rasterize all features into a heightmap (nx × ny vertex grid spanning the
// panel), each feature touching only the cells under its footprint, then
// layer on the panel-wide effects: wave swell, peak normalization to the
// requested depth, and the flat border frame.
export function buildHeightfield(features, params, nx, ny) {
  const { widthMm: W, heightMm: H, depthMm, swell = 0, frameMm = 0, seed = 0 } = params;
  const dx = W / (nx - 1), dy = H / (ny - 1);
  const heights = new Float32Array(nx * ny);

  for (const f of features) {
    // Shard footprints can reach r * max(facetR) from the apex offset.
    const reach = f.kind === 'shard'
      ? f.r * Math.max(...f.facetR) + Math.hypot(f.ax, f.ay)
      : f.r;
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

  // Gentle large-scale undulation under everything.
  if (swell > 0) {
    const rng = makeRng(seed ^ 0x5EA5EA);
    const p1 = rng() * Math.PI * 2, p2 = rng() * Math.PI * 2;
    const kx = Math.PI * 2 / Math.max(W, H) * (1.2 + rng() * 0.8);
    const ky = Math.PI * 2 / Math.max(W, H) * (1.2 + rng() * 0.8);
    const amp = swell * depthMm * 0.5;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        heights[j * nx + i] += amp *
          (0.5 + 0.5 * Math.sin(i * dx * kx + p1) * Math.sin(j * dy * ky + p2));
      }
    }
  }

  // Normalize the sampled peak to exactly the requested relief depth. The
  // frame band is excluded — it gets stamped flat below, so a peak there
  // would leave the pattern short of full depth.
  const fx = frameMm > 0 ? Math.min(frameMm, W * 0.4) : 0;
  const fy = frameMm > 0 ? Math.min(frameMm, H * 0.4) : 0;
  const inBand = (x, y) => x <= fx || x >= W - fx || y <= fy || y >= H - fy;

  let peak = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (frameMm > 0 && inBand(i * dx, j * dy)) continue;
      const z = heights[j * nx + i];
      if (z > peak) peak = z;
    }
  }
  if (peak > 0) {
    const s = depthMm / peak;
    for (let i = 0; i < heights.length; i++) heights[i] *= s;
  }

  // Flat raised border frame, stamped last so it stays crisp.
  if (frameMm > 0) {
    const frameH = depthMm * 0.4;
    for (let j = 0; j < ny; j++) {
      const y = j * dy;
      for (let i = 0; i < nx; i++) {
        if (inBand(i * dx, y)) heights[j * nx + i] = frameH;
      }
    }
  }

  return heights;
}
