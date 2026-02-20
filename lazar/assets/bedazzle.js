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

  /**
   * Downsample an image to exactly cols×rows using averaged box sampling.
   * Returns an ImageData-like object with .data (Uint8ClampedArray), .w, .h
   * where each pixel = one gem slot.
   */
  function downsampleToGrid(srcImg, cols, rows) {
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    // Use high-quality downscaling (browser's built-in bilinear/bicubic)
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcImg, 0, 0, cols, rows);
    const id = ctx.getImageData(0, 0, cols, rows);
    return { data: id, w: cols, h: rows };
  }

  /**
   * Build a brightness map from downsampled ImageData.
   * Returns Float32Array [0-255] of size w*h.
   */
  function brightnessMap(imageData, w, h) {
    const src = imageData.data;
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const j = i * 4;
      out[i] = brightness(src[j], src[j + 1], src[j + 2]);
    }
    return out;
  }

  /**
   * Sobel edge-magnitude on a brightness map → Float32Array.
   */
  function sobelOnBrightness(gray, w, h) {
    const out = new Float32Array(w * h);
    const gx = [-1,0,1,-2,0,2,-1,0,1];
    const gy = [-1,-2,-1,0,0,0,1,2,1];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sx = 0, sy = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const v = gray[(y + ky) * w + (x + kx)];
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

  /* ═══════════════════════════════════════════════════════════════════
     GEM POSITION COMPUTATION
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Returns an array of { x, y, r, g, b, a } in mm coordinates.
   *
   * The KEY IDEA: we downsample the source image to exactly the gem grid
   * resolution (cols × rows pixels).  Each pixel in that tiny image maps
   * 1-to-1 to a gem slot.  This means a line in the original image that
   * is "one gem wide" in physical space will be exactly 1 px wide in the
   * downsampled image — so gems trace lines faithfully.
   */
  function computeGemPositions(opts) {
    const {
      srcImg,              // HTMLImageElement (original)
      widthMM, heightMM, gemDiameter,
      gap, gridType, mode, threshold,
    } = opts;

    const radius = gemDiameter / 2;
    const spacing = gemDiameter * (1 + (gap || 0));
    const rowSpacing = gridType === 'hex'
      ? spacing * Math.sqrt(3) / 2
      : spacing;
    const cols = Math.max(1, Math.floor(widthMM / spacing));
    const rows = Math.max(1, Math.floor(heightMM / rowSpacing));

    // Downsample source image to grid resolution
    const ds = downsampleToGrid(srcImg, cols, rows);
    const px = ds.data.data;  // Uint8ClampedArray [r,g,b,a,...]
    const bMap = brightnessMap(ds.data, cols, rows);

    // For edge mode, run sobel on the grid-res image
    let edgeMap = null;
    if (mode === 'edge') {
      edgeMap = sobelOnBrightness(bMap, cols, rows);
      // Normalise to 0-255
      let maxE = 0;
      for (let i = 0; i < edgeMap.length; i++) if (edgeMap[i] > maxE) maxE = edgeMap[i];
      if (maxE > 0) {
        const s = 255 / maxE;
        for (let i = 0; i < edgeMap.length; i++) edgeMap[i] *= s;
      }
    }

    const positions = [];

    for (let row = 0; row < rows; row++) {
      const yMM = radius + row * rowSpacing;
      const hexOffset = (gridType === 'hex' && row % 2 === 1) ? spacing / 2 : 0;
      const maxCols = (gridType === 'hex' && row % 2 === 1) ? cols - 1 : cols;

      for (let col = 0; col < maxCols; col++) {
        const xMM = radius + hexOffset + col * spacing;
        if (xMM + radius > widthMM || yMM + radius > heightMM) continue;

        const pi = (row * cols + col) * 4;
        const r = px[pi], g = px[pi + 1], b = px[pi + 2], a = px[pi + 3];

        if (a < 10) continue;

        const br = bMap[row * cols + col];

        let place = false;
        if (mode === 'fill') {
          place = true;
        } else if (mode === 'threshold') {
          place = br < threshold;
        } else if (mode === 'edge') {
          // Place gem if this grid cell has a strong edge
          place = edgeMap[row * cols + col] >= (255 - threshold);
        }

        if (place) positions.push({ x: xMM, y: yMM, r, g, b, a });
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
      if (!srcImage) return;

      const widthMM  = getWidthMM();
      const heightMM = getHeightMM();
      const gemD     = getGemDiameter();
      const gapFrac  = parseInt(gapInput.value, 10) / 100;

      lastPositions = computeGemPositions({
        srcImg: srcImage,
        widthMM,
        heightMM,
        gemDiameter: gemD,
        gap: gapFrac,
        gridType,
        mode,
        threshold: parseInt(thresholdInput.value, 10),
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
    gemSelect.addEventListener('change', () => { scheduleRender(); });

    thresholdInput.addEventListener('input', () => {
      thresholdVal.textContent = thresholdInput.value;
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
      thresholdLabel.textContent = mode === 'edge' ? 'Edge Sensitivity' : 'Threshold';
      scheduleRender();
    });

    // ── Download SVG ──
    downloadBtn.addEventListener('click', () => {
      if (!srcImage) return;

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
