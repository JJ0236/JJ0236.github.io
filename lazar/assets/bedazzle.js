/**
 * LAZAR Bedazzle Tool
 * Converts images into rhinestone/gem placement templates for laser cutting.
 * Injected into the LAZAR app — hooks into the "Bedazzle" button under Cut / Prep.
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     GEM SIZE CATALOG
     ═══════════════════════════════════════════════════════════════════ */
  const GEM_SIZES = {
    SS6:  { diameter: 2.0,  label: 'SS6  (2 mm)' },
    SS10: { diameter: 2.8,  label: 'SS10 (2.8 mm)' },
    SS16: { diameter: 4.0,  label: 'SS16 (4 mm)' },
    SS20: { diameter: 5.0,  label: 'SS20 (5 mm)' },
    SS30: { diameter: 6.5,  label: 'SS30 (6.5 mm)' },
    SS40: { diameter: 8.0,  label: 'SS40 (8 mm)' },
  };

  const UNIT_TO_MM = { mm: 1, in: 25.4, px: 25.4 / 96 };

  /* ═══════════════════════════════════════════════════════════════════
     IMAGE PROCESSING HELPERS
     ═══════════════════════════════════════════════════════════════════ */

  /** Perceived brightness (ITU-R BT.601) */
  function brightness(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  /** Draw an HTMLImageElement onto an offscreen canvas and return pixel data. */
  function imageToPixels(img, maxDim) {
    const canvas = document.createElement('canvas');
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (maxDim && Math.max(w, h) > maxDim) {
      const s = maxDim / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h), w, h };
  }

  /** 1-D Gaussian kernel (normalised). */
  function gaussKernel(sigma) {
    const r = Math.ceil(sigma * 2.5);
    const k = [];
    let sum = 0;
    for (let i = -r; i <= r; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      k.push(v);
      sum += v;
    }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    return { kernel: k, radius: r };
  }

  /** Separable Gaussian blur on a Float32Array [w×h]. */
  function gaussBlur(src, w, h, sigma) {
    if (sigma < 0.5) return src.slice();
    const { kernel, radius } = gaussKernel(sigma);
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    // horizontal
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = Math.min(w - 1, Math.max(0, x + k));
          v += src[y * w + sx] * kernel[k + radius];
        }
        tmp[y * w + x] = v;
      }
    }
    // vertical
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = -radius; k <= radius; k++) {
          const sy = Math.min(h - 1, Math.max(0, y + k));
          v += tmp[sy * w + x] * kernel[k + radius];
        }
        out[y * w + x] = v;
      }
    }
    return out;
  }

  /** Sobel edge-magnitude map → Float32Array [0 – ~442]. */
  function sobelEdges(imageData, w, h) {
    const src = imageData.data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const j = i * 4;
      gray[i] = brightness(src[j], src[j + 1], src[j + 2]);
    }
    // Pre-blur to reduce noise (sigma relative to image size)
    const sigma = Math.max(1, Math.min(w, h) / 300);
    const blurred = gaussBlur(gray, w, h, sigma);
    const out = new Float32Array(w * h);
    const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sx = 0, sy = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const v = blurred[(y + ky) * w + (x + kx)];
            const ki = (ky + 1) * 3 + (kx + 1);
            sx += v * gx[ki];
            sy += v * gy[ki];
          }
        }
        out[y * w + x] = Math.sqrt(sx * sx + sy * sy);
      }
    }
    return out;
  }

  /**
   * Build a binary edge mask (Uint8Array, 0/1) from the Sobel magnitude map.
   * `sensitivity` 0-255 controls the threshold: higher = more edges detected.
   * `dilateR` is the dilation radius in pixels — expands edges so gems
   * form continuous lines.
   */
  function buildEdgeMask(edgeMag, w, h, sensitivity, dilateR) {
    // Normalise edge map to 0-255
    let maxE = 0;
    for (let i = 0; i < edgeMag.length; i++) if (edgeMag[i] > maxE) maxE = edgeMag[i];
    if (maxE === 0) maxE = 1;
    const scale = 255 / maxE;

    // Threshold: lower sensitivity value = only strong edges; higher = more edges
    const thresh = 255 - sensitivity;
    const binary = new Uint8Array(w * h);
    for (let i = 0; i < edgeMag.length; i++) {
      binary[i] = (edgeMag[i] * scale) >= thresh ? 1 : 0;
    }

    if (dilateR <= 0) return binary;

    // Dilate using a circular structuring element
    const dilated = new Uint8Array(w * h);
    const r2 = dilateR * dilateR;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (binary[y * w + x]) {
          // Stamp circle
          for (let dy = -dilateR; dy <= dilateR; dy++) {
            const py = y + dy;
            if (py < 0 || py >= h) continue;
            for (let dx = -dilateR; dx <= dilateR; dx++) {
              if (dx * dx + dy * dy > r2) continue;
              const px = x + dx;
              if (px < 0 || px >= w) continue;
              dilated[py * w + px] = 1;
            }
          }
        }
      }
    }
    return dilated;
  }

  /* ═══════════════════════════════════════════════════════════════════
     GEM POSITION COMPUTATION
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Returns an array of { x, y, r, g, b, a } in mm coordinates.
   *
   * Area-samples the pixels under each gem footprint so that
   * gems trace lines faithfully – the line is "made of" gems.
   *
   * @param {Object} opts
   *   imageData  – ImageData from canvas
   *   imgW, imgH – pixel dimensions of the sampled image
   *   widthMM, heightMM – physical size (mm)
   *   gemDiameter – in mm
   *   gap        – 0-1 multiplier: 0 = gems touching, 1 = one-diameter gap
   *   gridType   – 'square' | 'hex'
   *   mode       – 'threshold' | 'edge' | 'fill'
   *   threshold  – 0-255 brightness cutoff or edge sensitivity
   *   edgeData   – Float32Array from sobelEdges() (only for 'edge' mode)
   */
  function computeGemPositions(opts) {
    const {
      imageData, imgW, imgH,
      widthMM, heightMM, gemDiameter,
      gap, gridType, mode, threshold,
      edgeMask,            // Uint8Array 0/1 (edge mode)
    } = opts;

    const src = imageData.data;
    const radius = gemDiameter / 2;
    const spacing = gemDiameter * (1 + (gap || 0));
    const rowSpacing = gridType === 'hex'
      ? spacing * Math.sqrt(3) / 2
      : spacing;
    const cols = Math.max(1, Math.floor(widthMM / spacing));
    const rows = Math.max(1, Math.floor(heightMM / rowSpacing));
    const scaleX = imgW / widthMM;
    const scaleY = imgH / heightMM;

    // Pixel radius for area-sampling colour under each gem
    const gemPxR = Math.max(1, Math.round(radius * Math.min(scaleX, scaleY)));
    const step = Math.max(1, Math.floor(gemPxR / 4));

    const positions = [];

    for (let row = 0; row < rows; row++) {
      const yMM = radius + row * rowSpacing;
      const hexOffset = (gridType === 'hex' && row % 2 === 1) ? spacing / 2 : 0;
      const maxCols = (gridType === 'hex' && row % 2 === 1) ? cols - 1 : cols;

      for (let col = 0; col < maxCols; col++) {
        const xMM = radius + hexOffset + col * spacing;
        if (xMM + radius > widthMM || yMM + radius > heightMM) continue;

        const cx = Math.round(xMM * scaleX);
        const cy = Math.round(yMM * scaleY);

        // ── Placement decision ──
        let place = false;

        if (mode === 'edge') {
          // Use the pre-computed dilated edge mask — just check centre pixel
          if (edgeMask) {
            const mx = Math.min(cx, imgW - 1);
            const my = Math.min(cy, imgH - 1);
            place = edgeMask[my * imgW + mx] === 1;
          }
        } else if (mode === 'fill') {
          place = true;
        } else {
          // threshold — area-average brightness
          let brSum = 0, aSum = 0, cnt = 0;
          const r2 = gemPxR * gemPxR;
          for (let dy = -gemPxR; dy <= gemPxR; dy += step) {
            for (let dx = -gemPxR; dx <= gemPxR; dx += step) {
              if (dx * dx + dy * dy > r2) continue;
              const px = cx + dx, py = cy + dy;
              if (px < 0 || px >= imgW || py < 0 || py >= imgH) continue;
              const idx = (py * imgW + px) * 4;
              brSum += brightness(src[idx], src[idx + 1], src[idx + 2]);
              aSum += src[idx + 3];
              cnt++;
            }
          }
          if (cnt === 0) continue;
          if (aSum / cnt < 10) continue;
          place = (brSum / cnt) < threshold;
        }

        if (!place) continue;

        // ── Colour sampling ──
        let rSum = 0, gSum = 0, bSum = 0, aSum2 = 0, cnt2 = 0;
        const r2c = gemPxR * gemPxR;
        for (let dy = -gemPxR; dy <= gemPxR; dy += step) {
          for (let dx = -gemPxR; dx <= gemPxR; dx += step) {
            if (dx * dx + dy * dy > r2c) continue;
            const px = cx + dx, py = cy + dy;
            if (px < 0 || px >= imgW || py < 0 || py >= imgH) continue;
            const idx = (py * imgW + px) * 4;
            rSum += src[idx]; gSum += src[idx + 1]; bSum += src[idx + 2];
            aSum2 += src[idx + 3]; cnt2++;
          }
        }
        if (cnt2 === 0) continue;
        if (aSum2 / cnt2 < 10) continue;

        positions.push({
          x: xMM, y: yMM,
          r: Math.round(rSum / cnt2),
          g: Math.round(gSum / cnt2),
          b: Math.round(bSum / cnt2),
          a: Math.round(aSum2 / cnt2),
        });
      }
    }
    return positions;
  }

  /* ═══════════════════════════════════════════════════════════════════
     SVG GENERATION
     ═══════════════════════════════════════════════════════════════════ */

  function generateBedazzleSVG(opts) {
    const {
      positions, widthMM, heightMM, gemDiameter,
      strokeWidth, strokeColor,
      showImage, imageDataURL,
      colorize,
    } = opts;

    const rad = gemDiameter / 2;
    const f = n => n.toFixed(3);

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" `
      + `width="${f(widthMM)}mm" height="${f(heightMM)}mm" `
      + `viewBox="0 0 ${f(widthMM)} ${f(heightMM)}">\n`;

    if (showImage && imageDataURL) {
      svg += `  <image href="${imageDataURL}" x="0" y="0" `
        + `width="${f(widthMM)}" height="${f(heightMM)}" `
        + `opacity="0.25" preserveAspectRatio="none"/>\n`;
    }

    svg += `  <g fill="none" stroke="${strokeColor}" stroke-width="${f(strokeWidth)}">\n`;

    for (const p of positions) {
      const sc = colorize ? `rgb(${p.r},${p.g},${p.b})` : strokeColor;
      svg += colorize
        ? `    <circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(rad)}" stroke="${sc}"/>\n`
        : `    <circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(rad)}"/>\n`;
    }

    svg += `  </g>\n</svg>`;
    return svg;
  }

  /* ═══════════════════════════════════════════════════════════════════
     CSS INJECTION
     ═══════════════════════════════════════════════════════════════════ */

  function injectStyles() {
    if (document.getElementById('bedazzle-styles')) return;
    const s = document.createElement('style');
    s.id = 'bedazzle-styles';
    s.textContent = `
/* ── Overlay ────────────────────────────────────────────────── */
.bedazzle-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999;
  animation: bdFadeIn .2s ease;
}
@keyframes bdFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ── Modal ──────────────────────────────────────────────────── */
.bedazzle-modal {
  background: var(--bg-card, #1e1e3a);
  border-radius: var(--radius-lg, 10px);
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,.4));
  display: flex; flex-direction: column;
  width: min(96vw, 1100px);
  max-height: 92vh;
  overflow: hidden;
  color: var(--text-primary, #e0e0e0);
  font-family: var(--font-family, "Inter", sans-serif);
}

/* ── Header ─────────────────────────────────────────────────── */
.bedazzle-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border, #2a2a4a);
  background: var(--bg-secondary, #16213e);
  border-radius: var(--radius-lg, 10px) var(--radius-lg, 10px) 0 0;
}
.bedazzle-header h2 {
  font-size: 16px; font-weight: 600;
  display: flex; align-items: center; gap: 8px;
  margin: 0;
}
.bedazzle-close {
  background: none; border: none; color: var(--text-muted, #6a6a80);
  font-size: 22px; cursor: pointer; padding: 4px 8px;
  border-radius: var(--radius, 6px);
  transition: .15s;
}
.bedazzle-close:hover { background: var(--danger, #f44336); color: #fff; }

/* ── Body ───────────────────────────────────────────────────── */
.bedazzle-body {
  display: flex; flex: 1; overflow: hidden;
}

/* ── Controls ───────────────────────────────────────────────── */
.bedazzle-controls {
  width: 290px; min-width: 260px;
  padding: 16px;
  overflow-y: auto;
  border-right: 1px solid var(--border, #2a2a4a);
  background: var(--bg-secondary, #16213e);
  display: flex; flex-direction: column; gap: 14px;
}
.bedazzle-control-group { display: flex; flex-direction: column; gap: 5px; }
.bedazzle-control-group label {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .5px; color: var(--text-secondary, #a0a0b0);
}
.bedazzle-control-row {
  display: flex; align-items: center; gap: 8px;
}
.bedazzle-control-row input[type=range] { flex: 1; }
.bedazzle-control-row .bdz-val {
  font-size: 11px; color: var(--text-muted, #6a6a80);
  min-width: 34px; text-align: right;
}

/* inputs */
.bedazzle-controls select,
.bedazzle-controls input[type=number] {
  background: var(--bg-input, #252545);
  border: 1px solid var(--border, #2a2a4a);
  color: var(--text-primary, #e0e0e0);
  padding: 6px 10px;
  border-radius: var(--radius, 6px);
  font-size: 13px;
  font-family: inherit;
  width: 100%;
}
.bedazzle-controls select { cursor: pointer; }

/* chip buttons for modes */
.bedazzle-chips {
  display: flex; gap: 4px; flex-wrap: wrap;
}
.bedazzle-chip {
  padding: 5px 12px;
  font-size: 12px; font-weight: 500;
  border-radius: 20px;
  border: 1px solid var(--border-light, #3a3a5a);
  background: var(--bg-input, #252545);
  color: var(--text-secondary, #a0a0b0);
  cursor: pointer;
  transition: .15s;
}
.bedazzle-chip:hover { border-color: var(--accent, #e94560); color: var(--text-primary, #e0e0e0); }
.bedazzle-chip.active {
  background: var(--accent, #e94560);
  border-color: var(--accent, #e94560);
  color: #fff;
}

/* upload zone */
.bedazzle-upload-zone {
  border: 2px dashed var(--border-light, #3a3a5a);
  border-radius: var(--radius, 6px);
  padding: 20px 12px;
  text-align: center;
  cursor: pointer;
  transition: .15s;
  font-size: 12px;
  color: var(--text-muted, #6a6a80);
}
.bedazzle-upload-zone:hover,
.bedazzle-upload-zone.drag-over {
  border-color: var(--accent, #e94560);
  background: rgba(233,69,96,.06);
  color: var(--text-primary, #e0e0e0);
}
.bedazzle-upload-zone .bdz-upload-icon {
  font-size: 28px; margin-bottom: 4px; opacity: .4;
}
.bedazzle-upload-zone .bdz-file-name {
  margin-top: 6px;
  font-size: 11px;
  color: var(--accent, #e94560);
  word-break: break-all;
}

/* action buttons */
.bedazzle-btn-group { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; padding-top: 10px; }
.bedazzle-btn {
  flex: 1; min-width: 0;
  padding: 8px 12px;
  font-size: 12px; font-weight: 600;
  border: none; border-radius: var(--radius, 6px);
  cursor: pointer; transition: .15s;
  font-family: inherit;
}
.bedazzle-btn-primary {
  background: var(--accent, #e94560); color: #fff;
}
.bedazzle-btn-primary:hover { background: var(--accent-hover, #ff6b81); }
.bedazzle-btn-secondary {
  background: var(--bg-tertiary, #0f3460); color: var(--text-primary, #e0e0e0);
  border: 1px solid var(--border, #2a2a4a);
}
.bedazzle-btn-secondary:hover { background: var(--bg-input, #252545); }

/* dim row */
.bedazzle-dim-row {
  display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px;
  align-items: end;
}
.bedazzle-dim-row .bedazzle-control-group { gap: 3px; }
.bedazzle-dim-row select { width: 64px; }

/* stat */
.bedazzle-stat {
  font-size: 11px;
  color: var(--text-muted, #6a6a80);
  background: var(--bg-input, #252545);
  padding: 6px 10px;
  border-radius: var(--radius, 6px);
  text-align: center;
}
.bedazzle-stat strong { color: var(--accent, #e94560); }

/* separator */
.bedazzle-sep {
  border: none; border-top: 1px solid var(--border, #2a2a4a);
  margin: 2px 0;
}

/* checkbox row */
.bedazzle-check-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--text-secondary, #a0a0b0);
  cursor: pointer;
}
.bedazzle-check-row input[type=checkbox] {
  accent-color: var(--accent, #e94560);
}

/* ── Preview ────────────────────────────────────────────────── */
.bedazzle-preview {
  flex: 1; display: flex;
  align-items: center; justify-content: center;
  position: relative; overflow: hidden;
  background: var(--bg-dark, #0a0a1a);
  min-height: 350px;
}
.bedazzle-preview .bdz-checker {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(45deg, #1a1a2e 25%, transparent 25%),
    linear-gradient(-45deg, #1a1a2e 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1a1a2e 75%),
    linear-gradient(-45deg, transparent 75%, #1a1a2e 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  opacity: .25;
}
.bedazzle-preview-pan {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  cursor: grab;
  transform-origin: 0 0;
}
.bedazzle-preview-pan:active { cursor: grabbing; }
.bedazzle-svg-container {
  display: flex; align-items: center; justify-content: center;
}
.bedazzle-svg-container svg {
  border: 1px solid var(--border, #2a2a4a);
  background: #1a1a2e;
  display: block;
}

/* zoom controls */
.bedazzle-zoom-controls {
  position: absolute; bottom: 12px; right: 12px;
  display: flex; gap: 4px;
}
.bedazzle-zoom-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-card, #1e1e3a);
  border: 1px solid var(--border, #2a2a4a);
  border-radius: var(--radius, 6px);
  color: var(--text-secondary, #a0a0b0);
  cursor: pointer; font-size: 16px;
  transition: .15s;
}
.bedazzle-zoom-btn:hover {
  background: var(--bg-tertiary, #0f3460);
  color: var(--text-primary, #e0e0e0);
}

/* placeholder */
.bedazzle-placeholder {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px; color: var(--text-muted, #6a6a80);
  text-align: center; padding: 24px;
}
.bedazzle-placeholder-icon { font-size: 56px; opacity: .3; }
.bedazzle-placeholder p { font-size: 14px; }

/* ── Footer ─────────────────────────────────────────────────── */
.bedazzle-footer {
  padding: 8px 20px;
  border-top: 1px solid var(--border, #2a2a4a);
  font-size: 11px;
  color: var(--text-muted, #6a6a80);
  background: var(--bg-secondary, #16213e);
  border-radius: 0 0 var(--radius-lg, 10px) var(--radius-lg, 10px);
  display: flex; align-items: center; justify-content: space-between;
}

/* ── Toggle controls (mobile) ───────────────────────────────── */
.bedazzle-toggle-controls {
  display: none;
  width: 100%;
  padding: 8px;
  background: var(--bg-tertiary, #0f3460);
  border: none;
  color: var(--text-primary, #e0e0e0);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

/* ── Responsive ─────────────────────────────────────────────── */
@media (max-width: 860px) {
  .bedazzle-modal { width: 98vw; }
  .bedazzle-controls { width: 240px; min-width: 200px; }
}
@media (max-width: 640px) {
  .bedazzle-body { flex-direction: column; }
  .bedazzle-toggle-controls { display: block; }
  .bedazzle-controls {
    width: 100%; min-width: 0;
    border-right: none; border-bottom: 1px solid var(--border, #2a2a4a);
    max-height: 0; overflow: hidden;
    transition: max-height .3s ease;
    padding: 0 16px;
  }
  .bedazzle-controls.expanded {
    max-height: 600px; padding: 16px;
  }
  .bedazzle-preview { min-height: 260px; }
}
`;
    document.head.appendChild(s);
  }

  /* ═══════════════════════════════════════════════════════════════════
     MODAL BUILDER
     ═══════════════════════════════════════════════════════════════════ */

  function buildModal() {
    injectStyles();

    const overlay = document.createElement('div');
    overlay.className = 'bedazzle-overlay';

    overlay.innerHTML = `
<div class="bedazzle-modal">
  <!-- Header -->
  <div class="bedazzle-header">
    <h2>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
      Bedazzle Template Generator
    </h2>
    <button class="bedazzle-close" id="bdzClose" title="Close">&times;</button>
  </div>

  <!-- Body -->
  <div class="bedazzle-body">
    <button class="bedazzle-toggle-controls" id="bdzToggle">▼ Controls</button>

    <div class="bedazzle-controls" id="bdzControlsPanel">

      <!-- Upload -->
      <div class="bedazzle-control-group">
        <label>Image</label>
        <div class="bedazzle-upload-zone" id="bdzUploadZone">
          <div class="bdz-upload-icon">💎</div>
          <div>Drop image or <u>browse</u></div>
          <div class="bdz-file-name" id="bdzFileName"></div>
        </div>
        <input type="file" accept="image/*" id="bdzFileInput" style="display:none">
      </div>

      <!-- Dimensions -->
      <div class="bedazzle-control-group">
        <label>Dimensions</label>
        <div class="bedazzle-dim-row">
          <div class="bedazzle-control-group">
            <label style="font-size:10px">Width</label>
            <input type="number" id="bdzWidth" value="100" min="10" max="2000" step="1">
          </div>
          <div class="bedazzle-control-group">
            <label style="font-size:10px">Height</label>
            <input type="number" id="bdzHeight" value="100" min="10" max="2000" step="1">
          </div>
          <div class="bedazzle-control-group">
            <label style="font-size:10px">Unit</label>
            <select id="bdzUnit">
              <option value="mm" selected>mm</option>
              <option value="in">in</option>
              <option value="px">px</option>
            </select>
          </div>
        </div>
      </div>

      <hr class="bedazzle-sep">

      <!-- Gem Size -->
      <div class="bedazzle-control-group">
        <label>Gem Size</label>
        <select id="bdzGemSize">
          <option value="SS6">SS6  (2 mm)</option>
          <option value="SS10">SS10 (2.8 mm)</option>
          <option value="SS16" selected>SS16 (4 mm)</option>
          <option value="SS20">SS20 (5 mm)</option>
          <option value="SS30">SS30 (6.5 mm)</option>
          <option value="SS40">SS40 (8 mm)</option>
        </select>
      </div>

      <!-- Grid Type -->
      <div class="bedazzle-control-group">
        <label>Grid Layout</label>
        <div class="bedazzle-chips" id="bdzGridChips">
          <button class="bedazzle-chip active" data-grid="hex">Hex</button>
          <button class="bedazzle-chip" data-grid="square">Square</button>
        </div>
      </div>

      <!-- Placement Mode -->
      <div class="bedazzle-control-group">
        <label>Placement Mode</label>
        <div class="bedazzle-chips" id="bdzModeChips">
          <button class="bedazzle-chip" data-mode="threshold">Threshold</button>
          <button class="bedazzle-chip active" data-mode="edge">Edge</button>
          <button class="bedazzle-chip" data-mode="fill">Fill</button>
        </div>
      </div>

      <!-- Sensitivity slider (edge + threshold modes) -->
      <div class="bedazzle-control-group" id="bdzThresholdGroup">
        <label id="bdzThresholdLabel">Edge Sensitivity</label>
        <div class="bedazzle-control-row">
          <input type="range" id="bdzThreshold" min="0" max="255" value="160">
          <span class="bdz-val" id="bdzThresholdVal">160</span>
        </div>
      </div>

      <!-- Edge Width slider (edge mode only) -->
      <div class="bedazzle-control-group" id="bdzEdgeWidthGroup">
        <label>Line Width (gem rows)</label>
        <div class="bedazzle-control-row">
          <input type="range" id="bdzEdgeWidth" min="1" max="8" value="2" step="0.5">
          <span class="bdz-val" id="bdzEdgeWidthVal">2</span>
        </div>
      </div>

      <!-- Gap slider -->
      <div class="bedazzle-control-group">
        <label>Gap Between Gems</label>
        <div class="bedazzle-control-row">
          <input type="range" id="bdzGap" min="0" max="100" value="0">
          <span class="bdz-val" id="bdzGapVal">0%</span>
        </div>
      </div>

      <hr class="bedazzle-sep">

      <!-- Preview options -->
      <label class="bedazzle-check-row">
        <input type="checkbox" id="bdzShowImage" checked> Show source image
      </label>
      <label class="bedazzle-check-row">
        <input type="checkbox" id="bdzColorize"> Colorize gems
      </label>

      <!-- Stats -->
      <div class="bedazzle-stat" id="bdzStats">
        Upload an image to begin
      </div>

      <!-- Buttons -->
      <div class="bedazzle-btn-group">
        <button class="bedazzle-btn bedazzle-btn-primary" id="bdzDownload">⬇ Download SVG</button>
        <button class="bedazzle-btn bedazzle-btn-secondary" id="bdzApply">Apply to Canvas</button>
      </div>

    </div><!-- /controls -->

    <!-- Preview -->
    <div class="bedazzle-preview" id="bdzPreview">
      <div class="bdz-checker"></div>
      <div class="bedazzle-preview-pan" id="bdzPanLayer">
        <div class="bedazzle-svg-container" id="bdzSvgContainer">
          <div class="bedazzle-placeholder" id="bdzPlaceholder">
            <div class="bedazzle-placeholder-icon">💎</div>
            <p>Upload an image to generate a<br>bedazzle placement template</p>
          </div>
        </div>
      </div>
      <div class="bedazzle-zoom-controls">
        <button class="bedazzle-zoom-btn" id="bdzZoomIn" title="Zoom in">+</button>
        <button class="bedazzle-zoom-btn" id="bdzZoomOut" title="Zoom out">−</button>
        <button class="bedazzle-zoom-btn" id="bdzZoomFit" title="Fit">⊡</button>
      </div>
    </div>

  </div><!-- /body -->

  <!-- Footer -->
  <div class="bedazzle-footer">
    <span id="bdzFooterLeft">Ready</span>
    <span id="bdzFooterRight">Bedazzle Tool v1.0</span>
  </div>
</div>
`;

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay);
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  /* ═══════════════════════════════════════════════════════════════════
     CLOSE MODAL
     ═══════════════════════════════════════════════════════════════════ */

  function closeModal(overlay) {
    overlay.style.animation = 'bdFadeIn .15s ease reverse';
    setTimeout(() => overlay.remove(), 140);
  }

  /* ═══════════════════════════════════════════════════════════════════
     MODAL CONTROLLER  –  binds all controls, renders preview, export
     ═══════════════════════════════════════════════════════════════════ */

  function openBedazzleModal() {
    const overlay = buildModal();
    const $ = (sel) => overlay.querySelector(sel);

    // ── refs ──
    const closeBtn        = $('#bdzClose');
    const toggleBtn       = $('#bdzToggle');
    const controlsPanel   = $('#bdzControlsPanel');
    const uploadZone      = $('#bdzUploadZone');
    const fileInput       = $('#bdzFileInput');
    const fileNameEl      = $('#bdzFileName');
    const widthInput      = $('#bdzWidth');
    const heightInput     = $('#bdzHeight');
    const unitSelect      = $('#bdzUnit');
    const gemSelect       = $('#bdzGemSize');
    const gridChips       = $('#bdzGridChips');
    const modeChips       = $('#bdzModeChips');
    const thresholdGroup  = $('#bdzThresholdGroup');
    const thresholdInput  = $('#bdzThreshold');
    const thresholdVal    = $('#bdzThresholdVal');
    const thresholdLabel  = $('#bdzThresholdLabel');
    const edgeWidthGroup  = $('#bdzEdgeWidthGroup');
    const edgeWidthInput  = $('#bdzEdgeWidth');
    const edgeWidthVal    = $('#bdzEdgeWidthVal');
    const gapInput        = $('#bdzGap');
    const gapVal          = $('#bdzGapVal');
    const showImageCB     = $('#bdzShowImage');
    const colorizeCB      = $('#bdzColorize');
    const statsEl         = $('#bdzStats');
    const downloadBtn     = $('#bdzDownload');
    const applyBtn        = $('#bdzApply');
    const previewArea     = $('#bdzPreview');
    const panLayer        = $('#bdzPanLayer');
    const svgContainer    = $('#bdzSvgContainer');
    const placeholder     = $('#bdzPlaceholder');
    const zoomInBtn       = $('#bdzZoomIn');
    const zoomOutBtn      = $('#bdzZoomOut');
    const zoomFitBtn      = $('#bdzZoomFit');
    const footerLeft      = $('#bdzFooterLeft');

    // ── state ──
    let srcImage = null;          // HTMLImageElement
    let srcDataURL = null;        // data-url string
    let pixelInfo = null;         // { data, w, h }
    let edgeMag = null;           // Float32Array (cached)
    let lastPositions = [];
    let lastSVG = '';

    let gridType = 'hex';
    let mode = 'edge';
    let zoom = 1;
    let panX = 0, panY = 0;
    let isPanning = false, panStartX = 0, panStartY = 0;

    // ── helpers ──
    function getWidthMM() {
      return parseFloat(widthInput.value) * UNIT_TO_MM[unitSelect.value];
    }
    function getHeightMM() {
      return parseFloat(heightInput.value) * UNIT_TO_MM[unitSelect.value];
    }
    function getGemDiameter() {
      return GEM_SIZES[gemSelect.value].diameter;
    }

    // ── render debounce ──
    let renderTimer = null;
    function scheduleRender() {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 40);
    }

    // ── RENDER ──
    function render() {
      if (!pixelInfo) return;

      const widthMM  = getWidthMM();
      const heightMM = getHeightMM();
      const gemD     = getGemDiameter();

      // Compute edge map + dilated mask if in edge mode
      if (mode === 'edge') {
        if (!edgeMag) {
          edgeMag = sobelEdges(pixelInfo.data, pixelInfo.w, pixelInfo.h);
        }
        // Dilation radius = edge-width (in gem rows) × gem pixel radius
        const gemPxR = Math.max(1,
          Math.round((gemD / 2) * Math.min(pixelInfo.w / widthMM, pixelInfo.h / heightMM)));
        const edgeWidthRows = parseFloat(edgeWidthInput.value) || 2;
        const dilateR = Math.round(gemPxR * edgeWidthRows);
        var edgeMask = buildEdgeMask(
          edgeMag, pixelInfo.w, pixelInfo.h,
          parseInt(thresholdInput.value, 10),
          dilateR
        );
      }

      const gapFrac = parseInt(gapInput.value, 10) / 100;

      lastPositions = computeGemPositions({
        imageData: pixelInfo.data,
        imgW: pixelInfo.w,
        imgH: pixelInfo.h,
        widthMM,
        heightMM,
        gemDiameter: gemD,
        gap: gapFrac,
        gridType,
        mode,
        threshold: parseInt(thresholdInput.value, 10),
        edgeMask: edgeMask || null,
      });

      // Preview stroke: visible thickness
      const previewStroke = Math.max(widthMM, heightMM) * 0.003;

      lastSVG = generateBedazzleSVG({
        positions: lastPositions,
        widthMM,
        heightMM,
        gemDiameter: gemD,
        strokeWidth: previewStroke,
        strokeColor: '#e94560',
        showImage: showImageCB.checked,
        imageDataURL: srcDataURL,
        colorize: colorizeCB.checked,
      });

      // Inject preview SVG
      placeholder.style.display = 'none';
      svgContainer.innerHTML = lastSVG;

      // Size the SVG element for preview
      const svgEl = svgContainer.querySelector('svg');
      if (svgEl) {
        const maxW = previewArea.clientWidth - 40;
        const maxH = previewArea.clientHeight - 40;
        const aspect = widthMM / heightMM;
        let dispW, dispH;
        if (aspect > maxW / maxH) {
          dispW = Math.min(maxW, 800);
          dispH = dispW / aspect;
        } else {
          dispH = Math.min(maxH, 700);
          dispW = dispH * aspect;
        }
        svgEl.setAttribute('width', dispW);
        svgEl.setAttribute('height', dispH);
        svgEl.style.width = dispW + 'px';
        svgEl.style.height = dispH + 'px';
      }

      // Stats
      const totalSlots = computeTotalSlots(widthMM, heightMM, gemD, gridType);
      statsEl.innerHTML = `<strong>${lastPositions.length.toLocaleString()}</strong> gems placed`
        + ` of <strong>${totalSlots.toLocaleString()}</strong> possible`
        + ` &nbsp;·&nbsp; ${gemSelect.value} @ ${gemD}mm`;

      footerLeft.textContent = `${lastPositions.length} gems · ${widthMM.toFixed(1)} × ${heightMM.toFixed(1)} mm`;

      applyTransform();
    }

    function computeTotalSlots(wMM, hMM, gemD, grid) {
      const gapFrac = parseInt(gapInput.value, 10) / 100;
      const spacing = gemD * (1 + gapFrac);
      const rowSp = grid === 'hex' ? spacing * Math.sqrt(3) / 2 : spacing;
      const cols = Math.max(1, Math.floor(wMM / spacing));
      const rows = Math.max(1, Math.floor(hMM / rowSp));
      if (grid === 'hex') {
        const fullRows = Math.ceil(rows / 2);
        const oddRows = Math.floor(rows / 2);
        return fullRows * cols + oddRows * Math.max(cols - 1, 0);
      }
      return cols * rows;
    }

    // ── Zoom / Pan ──
    function applyTransform() {
      panLayer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    }

    function zoomBy(factor) {
      zoom = Math.max(0.1, Math.min(10, zoom * factor));
      applyTransform();
    }

    function fitZoom() {
      zoom = 1; panX = 0; panY = 0;
      applyTransform();
    }

    zoomInBtn.addEventListener('click', () => zoomBy(1.3));
    zoomOutBtn.addEventListener('click', () => zoomBy(1 / 1.3));
    zoomFitBtn.addEventListener('click', fitZoom);

    previewArea.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });

    panLayer.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isPanning = true;
      panStartX = e.clientX - panX;
      panStartY = e.clientY - panY;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      panX = e.clientX - panStartX;
      panY = e.clientY - panStartY;
      applyTransform();
    });
    document.addEventListener('mouseup', () => { isPanning = false; });

    // ── Close ──
    closeBtn.addEventListener('click', () => closeModal(overlay));
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        closeModal(overlay);
        document.removeEventListener('keydown', escHandler);
      }
    });

    // ── Mobile toggle ──
    toggleBtn.addEventListener('click', () => {
      controlsPanel.classList.toggle('expanded');
      toggleBtn.textContent = controlsPanel.classList.contains('expanded')
        ? '▲ Controls' : '▼ Controls';
    });

    // ── Image upload ──
    function loadImage(file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        srcDataURL = ev.target.result;
        const img = new Image();
        img.onload = () => {
          srcImage = img;
          pixelInfo = imageToPixels(img, 2048);
          edgeMag = null; // invalidate
          fileNameEl.textContent = file.name;

          // Auto-set dimensions preserving aspect
          const aspect = img.naturalWidth / img.naturalHeight;
          const curW = parseFloat(widthInput.value) || 100;
          heightInput.value = Math.round(curW / aspect);

          scheduleRender();
        };
        img.src = srcDataURL;
      };
      reader.readAsDataURL(file);
    }

    function loadImageFromDataURL(dataURL, name) {
      srcDataURL = dataURL;
      const img = new Image();
      img.onload = () => {
        srcImage = img;
        pixelInfo = imageToPixels(img, 2048);
        edgeMag = null;
        fileNameEl.textContent = name || 'LAZAR canvas';

        const aspect = img.naturalWidth / img.naturalHeight;
        const curW = parseFloat(widthInput.value) || 100;
        heightInput.value = Math.round(curW / aspect);

        scheduleRender();
      };
      img.src = dataURL;
    }

    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) loadImage(fileInput.files[0]);
    });
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('drag-over');
    });
    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('drag-over');
    });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) loadImage(f);
    });

    // Auto-grab from LAZAR canvas
    try {
      const lazarCanvas = document.querySelector('.canvas-area canvas, .preview-canvas canvas, canvas');
      if (lazarCanvas && lazarCanvas.width > 0) {
        const du = lazarCanvas.toDataURL('image/png');
        if (du && du.length > 100) {
          loadImageFromDataURL(du, 'LAZAR canvas');
          const unit = unitSelect.value;
          const pxToUnit = 1 / UNIT_TO_MM[unit]; // mm -> unit
          widthInput.value = Math.round(lazarCanvas.width * (25.4 / 96) * pxToUnit);
          heightInput.value = Math.round(lazarCanvas.height * (25.4 / 96) * pxToUnit);
        }
      }
    } catch (_) { /* cross-origin or empty */ }

    // ── Control bindings ──
    widthInput.addEventListener('input', scheduleRender);
    heightInput.addEventListener('input', scheduleRender);
    unitSelect.addEventListener('change', scheduleRender);
    gemSelect.addEventListener('change', () => { edgeMag = null; scheduleRender(); });

    thresholdInput.addEventListener('input', () => {
      thresholdVal.textContent = thresholdInput.value;
      scheduleRender();
    });

    edgeWidthInput.addEventListener('input', () => {
      edgeWidthVal.textContent = edgeWidthInput.value;
      scheduleRender();
    });

    gapInput.addEventListener('input', () => {
      gapVal.textContent = gapInput.value + '%';
      scheduleRender();
    });

    showImageCB.addEventListener('change', scheduleRender);
    colorizeCB.addEventListener('change', scheduleRender);

    // Grid chips
    gridChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.bedazzle-chip');
      if (!chip) return;
      gridChips.querySelectorAll('.bedazzle-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      gridType = chip.dataset.grid;
      scheduleRender();
    });

    // Mode chips
    modeChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.bedazzle-chip');
      if (!chip) return;
      modeChips.querySelectorAll('.bedazzle-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      mode = chip.dataset.mode;
      // Show/hide controls per mode
      thresholdGroup.style.display = (mode === 'fill') ? 'none' : '';
      edgeWidthGroup.style.display = (mode === 'edge') ? '' : 'none';
      thresholdLabel.textContent = mode === 'edge' ? 'Edge Sensitivity' : 'Threshold';
      scheduleRender();
    });

    // ── Download SVG ──
    downloadBtn.addEventListener('click', () => {
      if (!pixelInfo) return;

      const widthMM  = getWidthMM();
      const heightMM = getHeightMM();
      const gemD     = getGemDiameter();
      const unit     = unitSelect.value;

      // Export stroke: 0.1pt = 0.035mm → convert to user unit
      const exportStrokeMM = 0.035;
      const exportStroke = exportStrokeMM / UNIT_TO_MM[unit] || exportStrokeMM;

      const exportSVG = generateBedazzleSVG({
        positions: lastPositions,
        widthMM,
        heightMM,
        gemDiameter: gemD,
        strokeWidth: exportStroke,
        strokeColor: '#ff0000',
        showImage: false,
        imageDataURL: null,
        colorize: false,
      });

      // Fix units in the SVG for export
      const unitLabel = unit;
      const exportW = (widthMM / UNIT_TO_MM[unit]).toFixed(3);
      const exportH = (heightMM / UNIT_TO_MM[unit]).toFixed(3);
      const finalSVG = exportSVG
        .replace(/width="[^"]*"/, `width="${exportW}${unitLabel}"`)
        .replace(/height="[^"]*"/, `height="${exportH}${unitLabel}"`);

      const blob = new Blob([finalSVG], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bedazzle-${gemSelect.value}-${lastPositions.length}gems.svg`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);

      footerLeft.textContent = 'SVG downloaded!';
    });

    // ── Apply to Canvas ──
    applyBtn.addEventListener('click', () => {
      if (!lastSVG) return;
      const lazarCanvas = document.querySelector('.canvas-area canvas, .preview-canvas canvas, canvas');
      if (!lazarCanvas) {
        downloadBtn.click();
        return;
      }
      const ctx = lazarCanvas.getContext('2d');
      const img = new Image();
      const blob = new Blob([lastSVG], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        ctx.clearRect(0, 0, lazarCanvas.width, lazarCanvas.height);
        ctx.drawImage(img, 0, 0, lazarCanvas.width, lazarCanvas.height);
        URL.revokeObjectURL(url);
        closeModal(overlay);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        downloadBtn.click();
      };
      img.src = url;
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     DROPDOWN INJECTION  –  adds "Bedazzle" to Cut / Prep menu
     ═══════════════════════════════════════════════════════════════════ */

  function injectDropdownItem() {
    const observer = new MutationObserver(() => {
      const dropdowns = document.querySelectorAll('.nav-dropdown');
      dropdowns.forEach(dd => {
        const items = dd.querySelectorAll('.nav-dropdown-item');
        const hasPuzzle = Array.from(items).some(i => i.textContent.trim() === 'Puzzle');
        const hasBedazzle = Array.from(items).some(i => i.textContent.trim() === 'Bedazzle');
        if (hasPuzzle && !hasBedazzle) {
          const btn = document.createElement('button');
          btn.className = 'nav-dropdown-item';
          btn.textContent = 'Bedazzle';
          dd.appendChild(btn);
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ═══════════════════════════════════════════════════════════════════
     HOOK  –  intercept clicks on the "Bedazzle" dropdown item
     ═══════════════════════════════════════════════════════════════════ */

  function hookBedazzleButton() {
    // Inject the menu item into the dropdown
    injectDropdownItem();

    // Intercept clicks (capture phase, before React)
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-dropdown-item');
      if (btn && btn.textContent.trim() === 'Bedazzle') {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => openBedazzleModal(), 50);
      }
    }, true);
  }

  /* ═══════════════════════════════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════════════════════════════ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookBedazzleButton);
  } else {
    hookBedazzleButton();
  }

  // Expose for debugging
  window.LAZAR_Bedazzle = { openBedazzleModal, generateBedazzleSVG };

})();
