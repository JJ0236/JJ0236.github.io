// imprint/process.js — turns a grayscale image into a relief heightfield.
// Pure math, no DOM: the verification script imports this under Node.
//
// Input is a Float32Array of luminance in 0..1 (row-major, y-down as decoded
// from the image). Output is the panel heightfield (y-up) in millimeters,
// normalized to the full relief depth and optionally collapsed into slats.

import { slatQuantize } from '../relief/mesh.js';

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

/* Three-pass box blur ≈ gaussian; separable with running sums. */
function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(src.length);
  const norm = 1 / (2 * r + 1);
  for (let pass = 0; pass < 3; pass++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum * norm;
        sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        src[y * w + x] = sum * norm;
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }
  return src;
}

function bilinear(img, w, h, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = img[y0 * w + x0], b = img[y0 * w + x1];
  const c = img[y1 * w + x0], d = img[y1 * w + x1];
  return a + (b - a) * fx + (c + (d - c) * fx - (a + (b - a) * fx)) * fy;
}

/**
 * gray: Float32Array luminance 0..1, iw × ih, y-down.
 * Returns an nx × ny heightfield in mm (0 = slab surface, y-up).
 */
export function heightsFromImage(gray, iw, ih, params, nx, ny) {
  const { depthMm, invert = false, brightness = 0, contrast = 1,
          blurMm = 0, widthMm } = params;

  // Levels + optional invert into a working copy.
  const img = new Float32Array(iw * ih);
  for (let i = 0; i < img.length; i++) {
    let v = clamp01((gray[i] - 0.5) * contrast + 0.5 + brightness);
    img[i] = invert ? 1 - v : v;
  }

  // Smoothing radius given in panel mm, applied in image pixels.
  const rPx = Math.round(blurMm / (widthMm / iw));
  if (rPx >= 1) boxBlur(img, iw, ih, Math.min(rPx, 64));

  // Resample onto the panel grid; the panel's +y is the image's up.
  const heights = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const iy = (1 - j / (ny - 1)) * (ih - 1);
    for (let i = 0; i < nx; i++) {
      heights[j * nx + i] = bilinear(img, iw, ih, (i / (nx - 1)) * (iw - 1), iy);
    }
  }

  // Stretch to the full relief depth so exports hit exact dimensions.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    if (heights[i] < lo) lo = heights[i];
    if (heights[i] > hi) hi = heights[i];
  }
  const range = hi - lo;
  if (range > 1e-6) {
    const s = depthMm / range;
    for (let i = 0; i < heights.length; i++) heights[i] = (heights[i] - lo) * s;
  } else {
    heights.fill(depthMm * 0.5); // flat image — a uniform mid-height slab
  }

  slatQuantize(heights, nx, ny, params);
  return heights;
}
