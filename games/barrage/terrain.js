// The ground. It is a picture, not a shape: one byte per pixel, 1 where
// there is earth. Every explosion rubs out a circle, so craters, tunnels
// and overhangs all come free, and nothing has to be re-cut into polygons.
//
// No DOM here: the renderer keeps its own image and applies the same holes.

export const W = 1600;
export const H = 900;
export const SKY = 0;
export const EARTH = 1;

const smooth = (a, b, t) => a + (b - a) * t * t * (3 - 2 * t);

/** One layer of rolling noise: random heights every `cell` pixels, eased between. */
function layer(rand, cell, amp) {
  const n = Math.ceil(W / cell) + 2;
  const pts = Array.from({ length: n }, () => (rand() * 2 - 1) * amp);
  return x => {
    const t = x / cell;
    const i = t | 0;
    return smooth(pts[i], pts[i + 1], t - i);
  };
}

/** The line of the hills: a few layers of noise over a base height. */
function skyline(rand) {
  const base = H * 0.60;
  const layers = [
    layer(rand, 430, H * 0.17),
    layer(rand, 165, H * 0.075),
    layer(rand, 72, H * 0.03),
    layer(rand, 29, H * 0.011),
  ];
  const pts = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let y = base;
    for (const f of layers) y -= f(x);
    pts[x] = Math.max(H * 0.2, Math.min(H * 0.86, y));
  }
  return pts;
}

/**
 * Build a map. Returns the mask and the line of the hills, which the
 * renderer uses for its colours.
 */
export function generate(rand) {
  const mask = new Uint8Array(W * H);
  const top = skyline(rand);
  for (let x = 0; x < W; x++) {
    const t = top[x] | 0;
    for (let y = t; y < H; y++) mask[y * W + x] = EARTH;
  }
  // A couple of caves and an arch or two, for cover worth digging into.
  const caves = 2 + ((rand() * 3) | 0);
  for (let i = 0; i < caves; i++) {
    let x = W * (0.12 + rand() * 0.76);
    let y = top[x | 0] + 40 + rand() * (H - top[x | 0] - 90);
    const len = 60 + rand() * 260;
    let a = (rand() - 0.5) * 1.2;
    for (let s = 0; s < len; s += 4) {
      a += (rand() - 0.5) * 0.25;
      x += Math.cos(a) * 4;
      y += Math.sin(a) * 4;
      if (x < 20 || x > W - 20 || y > H - 30) break;
      const r = 16 + rand() * 12;
      // Caves stay underground: they must not eat the surface away.
      if (y - r < top[x | 0] + 24) { a = Math.abs(a) * 0.6 + 0.2; continue; }
      carve(mask, x, y, r);
    }
  }
  return { mask, top };
}

/** Rub out a circle. Returns how much earth went. */
export function carve(mask, cx, cy, r) {
  const r2 = r * r;
  let hit = 0;
  const x0 = Math.max(0, (cx - r) | 0), x1 = Math.min(W - 1, (cx + r) | 0);
  const y0 = Math.max(0, (cy - r) | 0), y1 = Math.min(H - 1, (cy + r) | 0);
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy > r2) continue;
      const i = y * W + x;
      if (mask[i]) { mask[i] = SKY; hit++; }
    }
  }
  return hit;
}

export const solid = (mask, x, y) => {
  if (x < 0 || x >= W || y < 0) return false;
  if (y >= H) return true;                       // the world's floor holds
  return mask[(y | 0) * W + (x | 0)] === EARTH;
};

/** The first earth under a point, or H if there is none. */
export function groundBelow(mask, x, y) {
  const xi = x | 0;
  if (xi < 0 || xi >= W) return H;
  for (let yy = Math.max(0, y | 0); yy < H; yy++) if (mask[yy * W + xi]) return yy;
  return H;
}

/** Is anything holding this point up within `depth` pixels? */
export function supported(mask, x, y, depth = 2) {
  for (let d = 1; d <= depth; d++) if (solid(mask, x, y + d)) return true;
  return false;
}

/** A spot on the surface to stand something on, away from the edges. */
export function surfaceSpot(mask, rand, margin = 60) {
  for (let tries = 0; tries < 200; tries++) {
    const x = margin + rand() * (W - margin * 2);
    const y = groundBelow(mask, x, 0);
    if (y < H - 20 && y > 40) return { x, y: y - 1 };
  }
  return { x: W / 2, y: H / 2 };
}
