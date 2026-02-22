/**
 * LAZAR 3D Engrave Tool
 * Converts images into optimized grayscale power maps for 3D laser engraving.
 * Remaps gray values through a custom LUT for clean depth-varied engraving.
 * Injected into the LAZAR app — hooks into the "3D Engrave" tab.
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     DEFAULT SETTINGS (Plywood @ 10 speed / 20 power)
     ═══════════════════════════════════════════════════════════════════ */
  const DEFAULTS = {
    customGrayValues: [104, 187, 188, 216, 255],
    driverDpi: 600,
    invertOutput: true,
    applyClahe: true,
    claheClip: 4,
    claheTile: 30,
    sharpenAmount: 3.0,
    targetHeightIn: 2.0,
    targetWidthIn: null,
  };

  /* ═══════════════════════════════════════════════════════════════════
     MATH / COLOR HELPERS
     ═══════════════════════════════════════════════════════════════════ */

  /** sRGB → linear light */
  function srgbToLinear(v) {
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  /** Convert inches to pixels at given DPI */
  function inchesToPx(inches, dpi) {
    return Math.round(inches * dpi);
  }

  /** Build a LUT from custom gray values (evenly-spaced input → custom output) */
  function buildMappingLut(grayValues) {
    const sorted = [...new Set(grayValues)].sort((a, b) => a - b);
    const inputLevels = [];
    for (let i = 0; i < sorted.length; i++) {
      inputLevels.push((i / (sorted.length - 1)) * 255);
    }
    const lut = new Uint8Array(256);
    for (let x = 0; x < 256; x++) {
      // Linear interpolation through the custom values
      if (x <= inputLevels[0]) {
        lut[x] = sorted[0];
      } else if (x >= inputLevels[inputLevels.length - 1]) {
        lut[x] = sorted[sorted.length - 1];
      } else {
        for (let i = 0; i < inputLevels.length - 1; i++) {
          if (x >= inputLevels[i] && x <= inputLevels[i + 1]) {
            const t = (x - inputLevels[i]) / (inputLevels[i + 1] - inputLevels[i]);
            lut[x] = Math.round(sorted[i] + t * (sorted[i + 1] - sorted[i]));
            break;
          }
        }
      }
    }
    return lut;
  }

  /* ═══════════════════════════════════════════════════════════════════
     CLAHE (Contrast Limited Adaptive Histogram Equalization)
     Pure JS implementation matching OpenCV's createCLAHE behavior
     ═══════════════════════════════════════════════════════════════════ */

  function applyClahe(gray, width, height, clipLimit, tileSize) {
    const tilesX = Math.max(1, Math.floor(width / tileSize));
    const tilesY = Math.max(1, Math.floor(height / tileSize));
    const tileW = width / tilesX;
    const tileH = height / tilesY;

    // Build equalized LUTs per tile
    const tileLuts = [];
    for (let ty = 0; ty < tilesY; ty++) {
      tileLuts[ty] = [];
      for (let tx = 0; tx < tilesX; tx++) {
        const x0 = Math.round(tx * tileW);
        const y0 = Math.round(ty * tileH);
        const x1 = Math.round((tx + 1) * tileW);
        const y1 = Math.round((ty + 1) * tileH);
        const tw = x1 - x0;
        const th = y1 - y0;
        const numPixels = tw * th;

        // Histogram
        const hist = new Float64Array(256);
        for (let r = y0; r < y1; r++) {
          for (let c = x0; c < x1; c++) {
            hist[gray[r * width + c]]++;
          }
        }

        // Clip histogram
        if (clipLimit > 0) {
          const limit = Math.max(1, clipLimit * numPixels / 256);
          let excess = 0;
          for (let i = 0; i < 256; i++) {
            if (hist[i] > limit) {
              excess += hist[i] - limit;
              hist[i] = limit;
            }
          }
          const increment = excess / 256;
          for (let i = 0; i < 256; i++) {
            hist[i] += increment;
          }
        }

        // CDF → LUT
        const cdf = new Float64Array(256);
        cdf[0] = hist[0];
        for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
        const cdfMin = cdf[0];
        const cdfMax = cdf[255];
        const lut = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
          lut[i] = Math.round(((cdf[i] - cdfMin) / (cdfMax - cdfMin)) * 255);
        }
        tileLuts[ty][tx] = { lut, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
      }
    }

    // Bilinear interpolation between tile LUTs
    const result = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = gray[y * width + x];

        // Find surrounding tile centers
        const ftx = (x - tileW / 2) / tileW;
        const fty = (y - tileH / 2) / tileH;
        const tx0 = Math.max(0, Math.min(tilesX - 1, Math.floor(ftx)));
        const ty0 = Math.max(0, Math.min(tilesY - 1, Math.floor(fty)));
        const tx1 = Math.min(tilesX - 1, tx0 + 1);
        const ty1 = Math.min(tilesY - 1, ty0 + 1);

        const sx = ftx - tx0;
        const sy = fty - ty0;
        const ax = Math.max(0, Math.min(1, sx));
        const ay = Math.max(0, Math.min(1, sy));

        const v00 = tileLuts[ty0][tx0].lut[px];
        const v10 = tileLuts[ty0][tx1].lut[px];
        const v01 = tileLuts[ty1][tx0].lut[px];
        const v11 = tileLuts[ty1][tx1].lut[px];

        const top = v00 * (1 - ax) + v10 * ax;
        const bot = v01 * (1 - ax) + v11 * ax;
        result[y * width + x] = Math.round(top * (1 - ay) + bot * ay);
      }
    }
    return result;
  }

  /* ═══════════════════════════════════════════════════════════════════
     IMAGE PROCESSING PIPELINE
     Mirrors the Python script: sRGB→Linear→Luminance→CLAHE→Invert→
     Sharpen→Resize→LUT mapping
     ═══════════════════════════════════════════════════════════════════ */

  function processImage(img, settings) {
    const {
      customGrayValues, driverDpi, invertOutput, applyClahe: doClahe,
      claheClip, claheTile, sharpenAmount, targetHeightIn, targetWidthIn
    } = settings;

    // 1) Draw image to canvas and get pixel data
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = img.naturalWidth || img.width;
    srcCanvas.height = img.naturalHeight || img.height;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.drawImage(img, 0, 0);
    const imgData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const pixels = imgData.data;
    const w = srcCanvas.width;
    const h = srcCanvas.height;

    // 2) sRGB → linear → luminance Y
    const Y = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const j = i * 4;
      const rLin = srgbToLinear(pixels[j] / 255);
      const gLin = srgbToLinear(pixels[j + 1] / 255);
      const bLin = srgbToLinear(pixels[j + 2] / 255);
      Y[i] = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
    }

    // 3) Optional CLAHE
    let Yprocessed = Y;
    if (doClahe) {
      const Y8 = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        Y8[i] = Math.round(Math.max(0, Math.min(255, Y[i] * 255)));
      }
      const clahed = applyClahe(Y8, w, h, claheClip, claheTile);
      Yprocessed = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        Yprocessed[i] = clahed[i] / 255;
      }
    }

    // 4) Invert + gamma (gamma=1.0 per original code)
    const base = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      let b = invertOutput ? 1.0 - Yprocessed[i] : Yprocessed[i];
      b = Math.max(1e-6, Math.min(1.0, b));
      const adj = Math.pow(b, 1.0);
      base[i] = invertOutput ? 1.0 - adj : adj;
      base[i] = Math.max(0, Math.min(1, base[i]));
    }

    // 5) Sharpen (unsharp mask)
    let sharpened = base;
    if (sharpenAmount > 0) {
      sharpened = unsharpMask(base, w, h, sharpenAmount, 0.7);
    }

    // 6) Resize to target dimensions
    let finalW = w, finalH = h;
    let finalData = sharpened;

    const hasW = targetWidthIn !== null && targetWidthIn !== '' && targetWidthIn > 0;
    const hasH = targetHeightIn !== null && targetHeightIn !== '' && targetHeightIn > 0;

    if (hasW || hasH) {
      if (hasW && !hasH) {
        finalW = inchesToPx(targetWidthIn, driverDpi);
        finalH = Math.round(h * (finalW / w));
      } else if (hasH && !hasW) {
        finalH = inchesToPx(targetHeightIn, driverDpi);
        finalW = Math.round(w * (finalH / h));
      } else {
        finalW = inchesToPx(targetWidthIn, driverDpi);
        finalH = inchesToPx(targetHeightIn, driverDpi);
      }
      finalData = resizeBilinear(sharpened, w, h, finalW, finalH);
    }

    // 7) Quantize to 8-bit
    const cont8 = new Uint8Array(finalW * finalH);
    for (let i = 0; i < finalW * finalH; i++) {
      cont8[i] = Math.round(Math.max(0, Math.min(255, finalData[i] * 255)));
    }

    // 8) Apply custom gray value LUT
    const lut = buildMappingLut(customGrayValues);
    const mapped = new Uint8Array(finalW * finalH);
    for (let i = 0; i < cont8.length; i++) {
      mapped[i] = lut[cont8[i]];
    }

    return { data: mapped, width: finalW, height: finalH, dpi: driverDpi };
  }

  /* ═══════════════════════════════════════════════════════════════════
     UNSHARP MASK  (Gaussian blur + weighted blend)
     ═══════════════════════════════════════════════════════════════════ */

  function gaussianKernel(sigma) {
    const size = Math.ceil(sigma * 3) * 2 + 1;
    const kernel = new Float32Array(size);
    let sum = 0;
    const half = Math.floor(size / 2);
    for (let i = 0; i < size; i++) {
      const x = i - half;
      kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
      sum += kernel[i];
    }
    for (let i = 0; i < size; i++) kernel[i] /= sum;
    return kernel;
  }

  function separableBlur(data, w, h, sigma) {
    const kernel = gaussianKernel(sigma);
    const half = Math.floor(kernel.length / 2);
    const temp = new Float32Array(w * h);
    const result = new Float32Array(w * h);

    // Horizontal pass
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = 0; k < kernel.length; k++) {
          const sx = Math.min(w - 1, Math.max(0, x + k - half));
          sum += data[y * w + sx] * kernel[k];
        }
        temp[y * w + x] = sum;
      }
    }

    // Vertical pass
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = 0; k < kernel.length; k++) {
          const sy = Math.min(h - 1, Math.max(0, y + k - half));
          sum += temp[sy * w + x] * kernel[k];
        }
        result[y * w + x] = sum;
      }
    }
    return result;
  }

  function unsharpMask(data, w, h, amount, sigma) {
    const blurred = separableBlur(data, w, h, sigma);
    const result = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      result[i] = Math.max(0, Math.min(1, data[i] * (1 + amount) - blurred[i] * amount));
    }
    return result;
  }

  /* ═══════════════════════════════════════════════════════════════════
     BILINEAR RESIZE (INTER_AREA analog for downscale)
     ═══════════════════════════════════════════════════════════════════ */

  function resizeBilinear(data, srcW, srcH, dstW, dstH) {
    const result = new Float32Array(dstW * dstH);
    const xRatio = srcW / dstW;
    const yRatio = srcH / dstH;
    for (let dy = 0; dy < dstH; dy++) {
      for (let dx = 0; dx < dstW; dx++) {
        const sx = dx * xRatio;
        const sy = dy * yRatio;
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = Math.min(x0 + 1, srcW - 1);
        const y1 = Math.min(y0 + 1, srcH - 1);
        const fx = sx - x0;
        const fy = sy - y0;
        const v00 = data[y0 * srcW + x0];
        const v10 = data[y0 * srcW + x1];
        const v01 = data[y1 * srcW + x0];
        const v11 = data[y1 * srcW + x1];
        result[dy * dstW + dx] = v00 * (1 - fx) * (1 - fy) +
          v10 * fx * (1 - fy) +
          v01 * (1 - fx) * fy +
          v11 * fx * fy;
      }
    }
    return result;
  }

  /* ═══════════════════════════════════════════════════════════════════
     UI INJECTION — replaces the "Coming soon" placeholder
     ═══════════════════════════════════════════════════════════════════ */

  const CSS = `
    .engrave3d-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-dark, #1a1a2e);
      color: var(--text-primary, #e0e0e0);
      overflow: auto;
    }

    .engrave3d-top {
      display: flex;
      gap: 16px;
      padding: 20px 24px;
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .engrave3d-panel {
      background: var(--bg-panel, #16213e);
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius-lg, 10px);
      padding: 18px;
      flex: 0 0 280px;
    }

    .engrave3d-panel h3 {
      margin: 0 0 14px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: .5px;
      text-transform: uppercase;
      color: var(--text-secondary, #a0a0c0);
    }

    .engrave3d-field {
      margin-bottom: 12px;
    }

    .engrave3d-field label {
      display: block;
      font-size: 12px;
      color: var(--text-secondary, #a0a0c0);
      margin-bottom: 4px;
      font-weight: 500;
    }

    .engrave3d-field input[type="text"],
    .engrave3d-field input[type="number"] {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 10px;
      font-size: 13px;
      border-radius: var(--radius, 6px);
      border: 1px solid var(--border, #2a2a4a);
      background: var(--bg-input, #0f0f23);
      color: var(--text-primary, #e0e0e0);
      font-family: 'Inter', monospace;
      transition: border-color .2s;
    }

    .engrave3d-field input:focus {
      border-color: var(--accent, #2196f3);
      outline: none;
    }

    .engrave3d-field .field-hint {
      font-size: 11px;
      color: var(--text-secondary, #777);
      margin-top: 3px;
    }

    .engrave3d-row {
      display: flex;
      gap: 10px;
    }

    .engrave3d-row .engrave3d-field {
      flex: 1;
    }

    .engrave3d-upload-zone {
      flex: 1;
      min-width: 300px;
      min-height: 200px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px dashed var(--border, #2a2a4a);
      border-radius: var(--radius-lg, 10px);
      background: var(--bg-panel, #16213e);
      cursor: pointer;
      transition: border-color .2s, background .2s;
      position: relative;
    }

    .engrave3d-upload-zone:hover,
    .engrave3d-upload-zone.drag-over {
      border-color: var(--accent, #2196f3);
      background: rgba(33, 150, 243, .06);
    }

    .engrave3d-upload-zone .upload-prompt {
      text-align: center;
      color: var(--text-secondary, #a0a0c0);
    }

    .engrave3d-upload-zone .upload-prompt svg {
      display: block;
      margin: 0 auto 10px;
      opacity: .5;
    }

    .engrave3d-upload-zone .upload-prompt p {
      margin: 0;
      font-size: 14px;
    }

    .engrave3d-upload-zone .upload-prompt span {
      font-size: 12px;
      opacity: .6;
    }

    /* Side-by-side preview area */
    .engrave3d-preview-area {
      flex: 1;
      display: flex;
      gap: 16px;
      padding: 0 24px 20px;
      min-height: 0;
    }

    .engrave3d-preview-box {
      flex: 1;
      background: var(--bg-panel, #16213e);
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius-lg, 10px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 300px;
    }

    .engrave3d-preview-box .preview-header {
      padding: 10px 14px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .5px;
      color: var(--text-secondary, #a0a0c0);
      border-bottom: 1px solid var(--border, #2a2a4a);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .engrave3d-preview-box .preview-header .dim-info {
      font-weight: 400;
      font-size: 11px;
      opacity: .7;
    }

    .engrave3d-preview-box .preview-body {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
      overflow: auto;
      background: #0a0a15;
    }

    .engrave3d-preview-box .preview-body canvas {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      image-rendering: pixelated;
    }

    .engrave3d-preview-box .preview-body img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    /* Buttons */
    .engrave3d-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 9px 18px;
      font-size: 13px;
      font-weight: 600;
      border: none;
      border-radius: var(--radius, 6px);
      cursor: pointer;
      transition: all .2s;
      font-family: inherit;
    }

    .engrave3d-btn-primary {
      background: var(--accent, #2196f3);
      color: #fff;
    }

    .engrave3d-btn-primary:hover {
      filter: brightness(1.15);
    }

    .engrave3d-btn-primary:disabled {
      opacity: .4;
      cursor: not-allowed;
      filter: none;
    }

    .engrave3d-btn-secondary {
      background: var(--bg-input, #0f0f23);
      color: var(--text-primary, #e0e0e0);
      border: 1px solid var(--border, #2a2a4a);
    }

    .engrave3d-btn-secondary:hover {
      border-color: var(--accent, #2196f3);
    }

    .engrave3d-actions {
      display: flex;
      gap: 10px;
      margin-top: 14px;
    }

    .engrave3d-processing {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 0;
      font-size: 13px;
      color: var(--accent, #2196f3);
    }

    .engrave3d-processing .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid var(--border, #2a2a4a);
      border-top-color: var(--accent, #2196f3);
      border-radius: 50%;
      animation: e3d-spin .7s linear infinite;
    }

    @keyframes e3d-spin {
      to { transform: rotate(360deg); }
    }

    .engrave3d-empty-preview {
      color: var(--text-secondary, #777);
      font-size: 13px;
      text-align: center;
      opacity: .6;
    }
  `;

  /* ═══════════════════════════════════════════════════════════════════
     INJECT UI
     ═══════════════════════════════════════════════════════════════════ */

  let injected = false;
  let state = {
    file: null,
    originalImg: null,
    resultData: null,
    resultWidth: 0,
    resultHeight: 0,
    resultDpi: 600,
    processing: false,
    settings: { ...DEFAULTS },
  };

  function injectStyles() {
    if (document.getElementById('engrave3d-styles')) return;
    const style = document.createElement('style');
    style.id = 'engrave3d-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function buildUI(container) {
    container.innerHTML = '';
    container.className = 'engrave3d-container';

    // === Top row: settings panel + upload zone ===
    const topRow = el('div', 'engrave3d-top');

    // --- Settings panel ---
    const panel = el('div', 'engrave3d-panel');
    panel.innerHTML = `
      <h3>3D Engrave Settings</h3>
      <div class="engrave3d-field">
        <label>Gray Values (comma-separated)</label>
        <input type="text" id="e3d-gray-values" value="${state.settings.customGrayValues.join(', ')}" />
        <div class="field-hint">Custom output gray levels for LUT mapping</div>
      </div>
      <div class="engrave3d-row">
        <div class="engrave3d-field">
          <label>DPI</label>
          <input type="number" id="e3d-dpi" value="${state.settings.driverDpi}" min="72" max="2400" step="1" />
        </div>
      </div>
      <div class="engrave3d-row">
        <div class="engrave3d-field">
          <label>Height (in)</label>
          <input type="number" id="e3d-height" value="${state.settings.targetHeightIn || ''}" min="0.1" step="0.1" placeholder="Auto" />
        </div>
        <div class="engrave3d-field">
          <label>Width (in)</label>
          <input type="number" id="e3d-width" value="${state.settings.targetWidthIn || ''}" min="0.1" step="0.1" placeholder="Auto" />
        </div>
      </div>
      <div class="field-hint" style="margin-bottom:12px">Leave one blank to auto-calculate from aspect ratio</div>
      <div class="engrave3d-actions">
        <button class="engrave3d-btn engrave3d-btn-primary" id="e3d-process-btn" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          Process
        </button>
        <button class="engrave3d-btn engrave3d-btn-secondary" id="e3d-download-btn" style="display:none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download PNG
        </button>
      </div>
      <div id="e3d-status"></div>
    `;

    // --- Upload zone ---
    const uploadZone = el('div', 'engrave3d-upload-zone');
    uploadZone.id = 'e3d-upload-zone';
    uploadZone.innerHTML = `
      <div class="upload-prompt" id="e3d-upload-prompt">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <path d="m21 15-5-5L5 21"/>
        </svg>
        <p>Drop an image here or click to upload</p>
        <span>JPG / PNG supported</span>
      </div>
    `;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png';
    fileInput.style.display = 'none';
    fileInput.id = 'e3d-file-input';
    uploadZone.appendChild(fileInput);

    topRow.appendChild(panel);
    topRow.appendChild(uploadZone);
    container.appendChild(topRow);

    // === Preview area (side-by-side) ===
    const previewArea = el('div', 'engrave3d-preview-area');

    const origBox = el('div', 'engrave3d-preview-box');
    origBox.innerHTML = `
      <div class="preview-header">
        Original
        <span class="dim-info" id="e3d-orig-info"></span>
      </div>
      <div class="preview-body" id="e3d-orig-body">
        <div class="engrave3d-empty-preview">Upload an image to begin</div>
      </div>
    `;

    const resultBox = el('div', 'engrave3d-preview-box');
    resultBox.innerHTML = `
      <div class="preview-header">
        Power Map Output
        <span class="dim-info" id="e3d-result-info"></span>
      </div>
      <div class="preview-body" id="e3d-result-body">
        <div class="engrave3d-empty-preview">Processed result will appear here</div>
      </div>
    `;

    previewArea.appendChild(origBox);
    previewArea.appendChild(resultBox);
    container.appendChild(previewArea);

    // === Wire up events ===
    wireEvents();
  }

  function wireEvents() {
    const uploadZone = document.getElementById('e3d-upload-zone');
    const fileInput = document.getElementById('e3d-file-input');
    const processBtn = document.getElementById('e3d-process-btn');
    const downloadBtn = document.getElementById('e3d-download-btn');

    // Click to upload
    uploadZone.addEventListener('click', (e) => {
      if (e.target === fileInput) return;
      fileInput.click();
    });

    // Drag & drop
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
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) handleFile(fileInput.files[0]);
    });

    // Process
    processBtn.addEventListener('click', () => {
      if (!state.originalImg || state.processing) return;
      readSettings();
      runProcessing();
    });

    // Download
    downloadBtn.addEventListener('click', downloadResult);

    // Live-update settings fields (just read on process)
  }

  function handleFile(file) {
    if (!file.type.match(/image\/(jpeg|png)/)) return;
    state.file = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        state.originalImg = img;
        state.resultData = null;

        // Show original preview
        const origBody = document.getElementById('e3d-orig-body');
        origBody.innerHTML = '';
        const previewImg = document.createElement('img');
        previewImg.src = e.target.result;
        origBody.appendChild(previewImg);

        const origInfo = document.getElementById('e3d-orig-info');
        origInfo.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;

        // Enable process button
        document.getElementById('e3d-process-btn').disabled = false;

        // Clear old result
        const resultBody = document.getElementById('e3d-result-body');
        resultBody.innerHTML = '<div class="engrave3d-empty-preview">Click "Process" to generate power map</div>';
        document.getElementById('e3d-result-info').textContent = '';
        document.getElementById('e3d-download-btn').style.display = 'none';

        // Update upload zone to show thumbnail
        const prompt = document.getElementById('e3d-upload-prompt');
        if (prompt) {
          prompt.innerHTML = `
            <img src="${e.target.result}" style="max-width:100%;max-height:160px;border-radius:6px;object-fit:contain;"/>
            <p style="margin-top:8px;font-size:12px">${file.name}</p>
            <span>Click or drop to replace</span>
          `;
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function readSettings() {
    const grayStr = document.getElementById('e3d-gray-values').value;
    const grayVals = grayStr.split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n >= 0 && n <= 255);
    if (grayVals.length >= 2) {
      state.settings.customGrayValues = grayVals;
    }

    const dpi = parseInt(document.getElementById('e3d-dpi').value, 10);
    if (dpi >= 72 && dpi <= 2400) state.settings.driverDpi = dpi;

    const hVal = parseFloat(document.getElementById('e3d-height').value);
    state.settings.targetHeightIn = (hVal > 0) ? hVal : null;

    const wVal = parseFloat(document.getElementById('e3d-width').value);
    state.settings.targetWidthIn = (wVal > 0) ? wVal : null;
  }

  function runProcessing() {
    state.processing = true;
    const statusEl = document.getElementById('e3d-status');
    statusEl.innerHTML = '<div class="engrave3d-processing"><div class="spinner"></div>Processing image…</div>';
    document.getElementById('e3d-process-btn').disabled = true;

    // Use requestAnimationFrame to let the spinner render before heavy work
    requestAnimationFrame(() => {
      setTimeout(() => {
        try {
          const result = processImage(state.originalImg, state.settings);
          state.resultData = result.data;
          state.resultWidth = result.width;
          state.resultHeight = result.height;
          state.resultDpi = result.dpi;
          showResult();
          statusEl.innerHTML = '';
        } catch (err) {
          statusEl.innerHTML = `<div style="color:#ef5350;padding:8px 0;font-size:13px">Error: ${err.message}</div>`;
          console.error('3D Engrave processing error:', err);
        }
        state.processing = false;
        document.getElementById('e3d-process-btn').disabled = false;
      }, 50);
    });
  }

  function showResult() {
    const resultBody = document.getElementById('e3d-result-body');
    resultBody.innerHTML = '';

    const canvas = document.createElement('canvas');
    canvas.width = state.resultWidth;
    canvas.height = state.resultHeight;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(state.resultWidth, state.resultHeight);
    for (let i = 0; i < state.resultData.length; i++) {
      const v = state.resultData[i];
      const j = i * 4;
      imgData.data[j] = v;
      imgData.data[j + 1] = v;
      imgData.data[j + 2] = v;
      imgData.data[j + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    resultBody.appendChild(canvas);

    // Show dimensions info
    const info = document.getElementById('e3d-result-info');
    const wIn = (state.resultWidth / state.resultDpi).toFixed(2);
    const hIn = (state.resultHeight / state.resultDpi).toFixed(2);
    info.textContent = `${state.resultWidth} × ${state.resultHeight} px  |  ${wIn}" × ${hIn}"  @  ${state.resultDpi} DPI`;

    // Show download button
    document.getElementById('e3d-download-btn').style.display = '';
  }

  function downloadResult() {
    if (!state.resultData) return;

    // Update global DPI so dpifix.js embeds the correct value
    if (window.__lazarDpi !== undefined) {
      window.__lazarDpi = state.resultDpi;
    }

    const canvas = document.createElement('canvas');
    canvas.width = state.resultWidth;
    canvas.height = state.resultHeight;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(state.resultWidth, state.resultHeight);
    for (let i = 0; i < state.resultData.length; i++) {
      const v = state.resultData[i];
      const j = i * 4;
      imgData.data[j] = v;
      imgData.data[j + 1] = v;
      imgData.data[j + 2] = v;
      imgData.data[j + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    // Build filename
    const stem = state.file?.name
      ? state.file.name.replace(/\.[^.]+$/, '')
      : 'image';
    const filename = `${stem}_power_map_8bit_${state.resultDpi}dpi.png`;

    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  }

  /* ═══════════════════════════════════════════════════════════════════
     HELPER
     ═══════════════════════════════════════════════════════════════════ */
  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  /* ═══════════════════════════════════════════════════════════════════
     OBSERVER — watch for the 3D tab placeholder and replace it
     ═══════════════════════════════════════════════════════════════════ */

  function tryInject() {
    // The React app renders: <div class="placeholder-3d">
    const placeholder = document.querySelector('.placeholder-3d');
    if (!placeholder) return;

    const wrapper = placeholder.parentElement; // .app-body-3d
    if (!wrapper || wrapper.dataset.e3dInjected) return;

    injectStyles();
    wrapper.dataset.e3dInjected = '1';

    // Replace placeholder with our UI
    buildUI(wrapper);
    injected = true;
  }

  // Observe DOM changes — the React app conditionally renders the 3D placeholder
  const observer = new MutationObserver(() => {
    // Re-check whenever the DOM changes (tab switches, etc.)
    const wrapper = document.querySelector('.app-body-3d');
    if (wrapper && !wrapper.dataset.e3dInjected) {
      tryInject();
    }
  });

  // Start observing once the DOM is ready
  function init() {
    tryInject();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
