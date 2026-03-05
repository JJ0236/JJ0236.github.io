/**
 * LAZAR Line Art SVG Tool
 * Converts photos into variable-width line art SVGs for laser engraving/cutting.
 * Lines swell in dark areas and pinch in light areas.
 * Injected into the LAZAR app as a new tab alongside Image Prep & 3D Engrave.
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     DEFAULTS
     ═══════════════════════════════════════════════════════════════════ */
  const DEFAULTS = {
    direction: 'vertical',      // vertical | horizontal | diag-right | diag-left
    densityMode: 'count',       // count | spacing
    lineCount: 80,
    lineSpacing: 2.0,           // mm
    outputWidth: 150,           // in current units
    outputHeight: 0,            // 0 = auto from aspect ratio
    units: 'mm',                // mm | in
    minWidth: 0.15,             // mm (thinnest line in bright areas)
    maxWidth: 2.0,              // mm (thickest line in dark areas)
    blur: 2,                    // pixel-radius blur before sampling
    invert: false,
  };

  /* ═══════════════════════════════════════════════════════════════════
     WEB WORKER — all line generation runs off main thread
     ═══════════════════════════════════════════════════════════════════ */
  const WORKER_SRC = /* js */`
    'use strict';

    function toGrayscale(pixels, w, h) {
      var gray = new Float32Array(w * h);
      for (var i = 0; i < w * h; i++) {
        var j = i * 4;
        gray[i] = (0.299 * pixels[j] + 0.587 * pixels[j+1] + 0.114 * pixels[j+2]) / 255;
      }
      return gray;
    }

    function boxBlurPass(src, w, h, r) {
      var tmp = new Float32Array(w * h);
      var dst = new Float32Array(w * h);
      var d = 2 * r + 1;
      // Horizontal
      for (var y = 0; y < h; y++) {
        var sum = 0;
        for (var k = -r; k <= r; k++) sum += src[y * w + Math.min(w-1, Math.max(0, k))];
        tmp[y * w] = sum / d;
        for (var x = 1; x < w; x++) {
          sum += src[y * w + Math.min(w-1, x + r)] - src[y * w + Math.max(0, x - r - 1)];
          tmp[y * w + x] = sum / d;
        }
      }
      // Vertical
      for (var x2 = 0; x2 < w; x2++) {
        var sum2 = 0;
        for (var k2 = -r; k2 <= r; k2++) sum2 += tmp[Math.min(h-1, Math.max(0, k2)) * w + x2];
        dst[x2] = sum2 / d;
        for (var y2 = 1; y2 < h; y2++) {
          sum2 += tmp[Math.min(h-1, y2 + r) * w + x2] - tmp[Math.max(0, y2 - r - 1) * w + x2];
          dst[y2 * w + x2] = sum2 / d;
        }
      }
      return dst;
    }

    function applyBlur(gray, w, h, radius) {
      if (radius <= 0) return gray;
      var r = Math.max(1, Math.round(radius));
      var result = gray;
      for (var pass = 0; pass < 3; pass++) result = boxBlurPass(result, w, h, r);
      return result;
    }

    function sampleBilinear(gray, w, h, x, y) {
      var x0 = Math.floor(x), y0 = Math.floor(y);
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
      var x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
      x0 = Math.min(x0, w - 1); y0 = Math.min(y0, h - 1);
      var fx = x - Math.floor(x), fy = y - Math.floor(y);
      return gray[y0 * w + x0] * (1-fx) * (1-fy) +
             gray[y0 * w + x1] * fx * (1-fy) +
             gray[y1 * w + x0] * (1-fx) * fy +
             gray[y1 * w + x1] * fx * fy;
    }

    function generateSVG(gray, imgW, imgH, settings) {
      var outW = settings.outW, outH = settings.outH;
      var minW = settings.minWidth, maxW = settings.maxWidth;
      var invert = settings.invert;

      // Direction angle: 0 = vertical
      var angle = 0;
      if (settings.direction === 'horizontal')  angle = Math.PI / 2;
      else if (settings.direction === 'diag-right') angle = Math.PI / 4;
      else if (settings.direction === 'diag-left')  angle = -Math.PI / 4;

      // Direction vectors
      var ldx = Math.sin(angle), ldy = Math.cos(angle);   // along line
      var pdx = Math.cos(angle), pdy = -Math.sin(angle);  // perpendicular (spacing)

      // Project rectangle corners onto perp and along axes
      var corners = [[0,0], [outW,0], [outW,outH], [0,outH]];
      var minPerp = Infinity, maxPerp = -Infinity;
      var minAlong = Infinity, maxAlong = -Infinity;
      for (var ci = 0; ci < 4; ci++) {
        var cx = corners[ci][0], cy = corners[ci][1];
        var p = cx * pdx + cy * pdy;
        var a = cx * ldx + cy * ldy;
        if (p < minPerp) minPerp = p;
        if (p > maxPerp) maxPerp = p;
        if (a < minAlong) minAlong = a;
        if (a > maxAlong) maxAlong = a;
      }

      // Spacing
      var spacing;
      if (settings.densityMode === 'count') {
        spacing = outW / Math.max(1, settings.lineCount);
      } else {
        spacing = settings.lineSpacing;
      }

      var perpRange = maxPerp - minPerp;
      var numLines = Math.ceil(perpRange / spacing);
      var alongRange = maxAlong - minAlong;

      // Sample step: enough detail without bloating SVG
      var sampleStep = Math.max(0.15, alongRange / 600);
      var numSamples = Math.ceil(alongRange / sampleStep) + 1;

      var allPaths = [];

      for (var i = 0; i < numLines; i++) {
        var perpOffset = minPerp + (i + 0.5) * spacing;
        // Flat arrays: [x0, y0, x1, y1, ...]
        var leftX = new Float64Array(numSamples);
        var leftY = new Float64Array(numSamples);
        var rightX = new Float64Array(numSamples);
        var rightY = new Float64Array(numSamples);
        var validCount = 0;

        for (var s = 0; s < numSamples; s++) {
          var alongOffset = minAlong + s * sampleStep;
          var ox = perpOffset * pdx + alongOffset * ldx;
          var oy = perpOffset * pdy + alongOffset * ldy;

          // Map output coords to image coords
          var ix = (ox / outW) * (imgW - 1);
          var iy = (oy / outH) * (imgH - 1);

          var brightness = 0.5;
          if (ix >= 0 && ix < imgW && iy >= 0 && iy < imgH) {
            brightness = sampleBilinear(gray, imgW, imgH, ix, iy);
          }
          if (invert) brightness = 1 - brightness;

          var darkness = 1 - brightness;
          var halfW = (minW + (maxW - minW) * darkness) / 2;

          leftX[s]  = ox - halfW * pdx;
          leftY[s]  = oy - halfW * pdy;
          rightX[s] = ox + halfW * pdx;
          rightY[s] = oy + halfW * pdy;
          validCount++;
        }

        if (validCount < 2) continue;

        // Build path: down left side, up right side
        var d = 'M' + leftX[0].toFixed(2) + ',' + leftY[0].toFixed(2);
        for (var p = 1; p < validCount; p++) {
          d += 'L' + leftX[p].toFixed(2) + ',' + leftY[p].toFixed(2);
        }
        // Bottom of right side
        d += 'L' + rightX[validCount-1].toFixed(2) + ',' + rightY[validCount-1].toFixed(2);
        // Up right side
        for (var p2 = validCount - 2; p2 >= 0; p2--) {
          d += 'L' + rightX[p2].toFixed(2) + ',' + rightY[p2].toFixed(2);
        }
        d += 'Z';
        allPaths.push(d);
      }

      // Build SVG
      var svg = '<svg xmlns="http://www.w3.org/2000/svg"' +
        ' viewBox="0 0 ' + outW.toFixed(2) + ' ' + outH.toFixed(2) + '"' +
        ' width="' + outW.toFixed(2) + 'mm" height="' + outH.toFixed(2) + 'mm">' +
        '<defs><clipPath id="la-bounds"><rect width="' + outW.toFixed(2) +
        '" height="' + outH.toFixed(2) + '"/></clipPath></defs>' +
        '<rect width="100%" height="100%" fill="white"/>' +
        '<g clip-path="url(#la-bounds)">';

      for (var pi = 0; pi < allPaths.length; pi++) {
        svg += '<path d="' + allPaths[pi] + '" fill="black"/>';
      }
      svg += '</g></svg>';

      return { svg: svg, numLines: numLines };
    }

    self.onmessage = function (e) {
      var data = e.data;
      try {
        var pixels = new Uint8ClampedArray(data.pixels);
        var gray = toGrayscale(pixels, data.imgW, data.imgH);
        if (data.settings.blur > 0) {
          gray = applyBlur(gray, data.imgW, data.imgH, data.settings.blur);
        }
        var result = generateSVG(gray, data.imgW, data.imgH, data.settings);
        self.postMessage({ ok: true, jobId: data.jobId,
                           svg: result.svg, numLines: result.numLines });
      } catch (err) {
        self.postMessage({ ok: false, jobId: data.jobId, error: err.message });
      }
    };
  `;

  /* ─── Worker singleton ──────────────────────────────────────────── */
  let _worker = null, _jobGen = 0;
  function getWorker() {
    if (!_worker) {
      const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
      _worker = new Worker(URL.createObjectURL(blob));
    }
    return _worker;
  }

  /* ═══════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════ */
  const state = {
    settings: { ...DEFAULTS },
    originalImg: null,
    file: null,
    srcPixels: null, srcW: 0, srcH: 0,
    svgString: null,
    outWmm: 0, outHmm: 0,
    processing: false,
  };

  /* ═══════════════════════════════════════════════════════════════════
     CSS
     ═══════════════════════════════════════════════════════════════════ */
  const CSS = `
    .lineart-container {
      display: flex;
      flex-direction: row;
      flex: 1;
      min-height: 0;
      background: var(--bg-dark, #1a1a2e);
      color: var(--text-primary, #e0e0e0);
      overflow: hidden;
    }

    /* ── Left panel ── */
    .lineart-panel {
      flex: 0 0 270px;
      background: var(--bg-panel, #16213e);
      border-right: 1px solid var(--border, #2a2a4a);
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .lineart-panel h3 {
      margin: 0 0 14px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: .5px;
      text-transform: uppercase;
      color: var(--text-secondary, #a0a0c0);
    }

    .lineart-field {
      margin-bottom: 12px;
    }

    .lineart-field label {
      display: block;
      font-size: 12px;
      color: var(--text-secondary, #a0a0c0);
      margin-bottom: 4px;
      font-weight: 500;
    }

    .lineart-field input[type="text"],
    .lineart-field input[type="number"],
    .lineart-field select {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 10px;
      font-size: 13px;
      border-radius: var(--radius, 6px);
      border: 1px solid var(--border, #2a2a4a);
      background: var(--bg-input, #0f0f23);
      color: var(--text-primary, #e0e0e0);
      font-family: 'Inter', sans-serif;
      transition: border-color .2s;
    }

    .lineart-field input:focus,
    .lineart-field select:focus {
      border-color: var(--accent, #2196f3);
      outline: none;
    }

    .lineart-field .field-hint {
      font-size: 11px;
      color: var(--text-secondary, #777);
      margin-top: 3px;
    }

    .lineart-row {
      display: flex;
      gap: 10px;
    }

    .lineart-row .lineart-field { flex: 1; }

    .lineart-slider-label {
      display: flex !important;
      justify-content: space-between;
      align-items: center;
    }

    .lineart-slider-val {
      font-variant-numeric: tabular-nums;
      color: var(--accent, #2196f3);
      font-size: 12px;
      font-weight: 600;
    }

    .lineart-range {
      width: 100%;
      margin: 4px 0 2px;
    }

    .lineart-toggle-label {
      display: flex !important;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      cursor: pointer;
    }

    .lineart-divider {
      border: none;
      border-top: 1px solid var(--border, #2a2a4a);
      margin: 14px 0;
    }

    /* Buttons */
    .lineart-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: var(--radius, 6px);
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background .15s, border-color .15s;
      white-space: nowrap;
    }
    .lineart-btn:disabled { opacity: .4; cursor: default; }
    .lineart-btn-primary {
      background: var(--accent, #2196f3);
      color: #fff;
    }
    .lineart-btn-primary:hover:not(:disabled) { background: #1e88e5; }
    .lineart-btn-secondary {
      background: var(--bg-input, #0f0f23);
      border-color: var(--border, #2a2a4a);
      color: var(--text-primary, #e0e0e0);
    }
    .lineart-btn-secondary:hover:not(:disabled) { border-color: var(--accent, #2196f3); }

    .lineart-actions {
      display: flex;
      gap: 8px;
      margin-top: 14px;
      flex-wrap: wrap;
    }

    /* ── Right: main area with previews ── */
    .lineart-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .lineart-preview-area {
      flex: 1;
      display: flex;
      gap: 0;
      min-height: 0;
      overflow: hidden;
    }

    .lineart-preview-box {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-right: 1px solid var(--border, #2a2a4a);
    }

    .lineart-preview-box:last-child { border-right: none; }

    .lineart-preview-box .preview-header {
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .5px;
      color: var(--text-secondary, #a0a0c0);
      border-bottom: 1px solid var(--border, #2a2a4a);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }

    .lineart-preview-box .preview-header .dim-info {
      font-weight: 400;
      font-size: 10px;
      opacity: .7;
    }

    .lineart-preview-box .preview-body {
      flex: 1;
      position: relative;
      overflow: hidden;
      background: #080812;
      cursor: grab;
    }

    .lineart-preview-box .preview-body.panning { cursor: grabbing; }

    .lineart-preview-box .pz-wrap {
      position: absolute;
      top: 0; left: 0;
      transform-origin: 0 0;
      will-change: transform;
    }

    .lineart-preview-box .pz-wrap canvas,
    .lineart-preview-box .pz-wrap img {
      display: block;
      image-rendering: auto;
    }

    .lineart-preview-box .pz-hint {
      position: absolute;
      bottom: 6px; right: 8px;
      font-size: 10px;
      color: rgba(255,255,255,.3);
      pointer-events: none;
      user-select: none;
    }

    .lineart-empty-preview {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%,-50%);
      color: var(--text-secondary, #777);
      font-size: 13px;
      text-align: center;
      opacity: .6;
      pointer-events: none;
      white-space: nowrap;
      line-height: 1.6;
    }

    .lineart-preview-box .orig-drop-active {
      background: rgba(33,150,243,.06);
      outline: 2px dashed var(--accent, #2196f3);
      outline-offset: -4px;
    }

    .lineart-preview-box .preview-header .replace-btn {
      display: none;
      padding: 2px 8px; font-size: 10px; font-family: inherit;
      background: transparent;
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px);
      color: var(--text-secondary, #a0a0c0);
      cursor: pointer;
      transition: border-color .15s, color .15s;
    }
    .lineart-preview-box .preview-header .replace-btn:hover {
      border-color: var(--accent, #2196f3);
      color: var(--text-primary, #e0e0e0);
    }

    .lineart-processing {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 0; font-size: 13px;
      color: var(--text-secondary, #a0a0c0);
    }
    .lineart-processing .spinner {
      width: 16px; height: 16px;
      border: 2px solid var(--border, #2a2a4a);
      border-top-color: var(--accent, #2196f3);
      border-radius: 50%;
      animation: la-spin .6s linear infinite;
    }
    @keyframes la-spin { to { transform: rotate(360deg); } }

    /* Direction radio buttons */
    .la-direction-group {
      display: flex; gap: 4px; flex-wrap: wrap;
    }
    .la-dir-btn {
      flex: 1;
      min-width: 58px;
      padding: 5px 4px;
      font-size: 11px;
      font-family: inherit;
      font-weight: 500;
      text-align: center;
      background: var(--bg-input, #0f0f23);
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px);
      color: var(--text-secondary, #a0a0c0);
      cursor: pointer;
      transition: border-color .15s, color .15s, background .15s;
    }
    .la-dir-btn:hover { border-color: var(--accent, #2196f3); color: var(--text-primary, #e0e0e0); }
    .la-dir-btn.active {
      border-color: var(--accent, #2196f3);
      background: rgba(33,150,243,.12);
      color: var(--accent, #2196f3);
    }

    /* Density mode toggle */
    .la-density-toggle {
      display: flex; gap: 0; margin-bottom: 8px;
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px);
      overflow: hidden;
    }
    .la-density-toggle button {
      flex: 1; padding: 5px 8px;
      font-size: 11px; font-family: inherit; font-weight: 500;
      background: transparent; border: none;
      color: var(--text-secondary, #a0a0c0);
      cursor: pointer; transition: background .15s, color .15s;
    }
    .la-density-toggle button.active {
      background: var(--accent, #2196f3); color: #fff;
    }
  `;

  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    const s = document.createElement('style');
    s.id = 'lineart-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
    stylesInjected = true;
  }

  /* ═══════════════════════════════════════════════════════════════════
     UI
     ═══════════════════════════════════════════════════════════════════ */
  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  const pzInstances = {};

  function buildUI(container) {
    container.innerHTML = '';

    // === Left: settings panel ===
    const panel = el('div', 'lineart-panel');
    const s = state.settings;
    panel.innerHTML = `
      <h3>Line Art Settings</h3>

      <div class="lineart-field">
        <label>Direction</label>
        <div class="la-direction-group" id="la-direction">
          <button class="la-dir-btn ${s.direction === 'vertical'   ? 'active' : ''}" data-dir="vertical">Vertical</button>
          <button class="la-dir-btn ${s.direction === 'horizontal' ? 'active' : ''}" data-dir="horizontal">Horizontal</button>
          <button class="la-dir-btn ${s.direction === 'diag-right' ? 'active' : ''}" data-dir="diag-right">Diag ↘</button>
          <button class="la-dir-btn ${s.direction === 'diag-left'  ? 'active' : ''}" data-dir="diag-left">Diag ↗</button>
        </div>
      </div>

      <div class="lineart-field">
        <label>Density</label>
        <div class="la-density-toggle" id="la-density-toggle">
          <button class="${s.densityMode === 'count'   ? 'active' : ''}" data-mode="count"># of Lines</button>
          <button class="${s.densityMode === 'spacing' ? 'active' : ''}" data-mode="spacing">Spacing</button>
        </div>
        <div id="la-count-field" ${s.densityMode !== 'count' ? 'style="display:none"' : ''}>
          <input type="number" id="la-line-count" value="${s.lineCount}" min="2" max="1000" step="1" />
          <div class="field-hint">Number of lines across the width</div>
        </div>
        <div id="la-spacing-field" ${s.densityMode !== 'spacing' ? 'style="display:none"' : ''}>
          <input type="number" id="la-line-spacing" value="${s.lineSpacing}" min="0.1" max="50" step="0.1" />
          <div class="field-hint">Spacing between lines (mm)</div>
        </div>
      </div>

      <div class="lineart-divider"></div>

      <div class="lineart-row">
        <div class="lineart-field">
          <label>Width</label>
          <input type="number" id="la-out-width" value="${s.outputWidth || ''}" min="1" step="1" placeholder="150" />
        </div>
        <div class="lineart-field">
          <label>Height</label>
          <input type="number" id="la-out-height" value="${s.outputHeight || ''}" min="1" step="1" placeholder="Auto" />
        </div>
        <div class="lineart-field" style="flex:0 0 70px">
          <label>Units</label>
          <select id="la-units">
            <option value="mm" ${s.units === 'mm' ? 'selected' : ''}>mm</option>
            <option value="in" ${s.units === 'in' ? 'selected' : ''}>inches</option>
          </select>
        </div>
      </div>
      <div class="field-hint" style="margin-bottom:12px">Leave height blank to auto-calculate from aspect ratio</div>

      <div class="lineart-divider"></div>

      <div class="lineart-field">
        <label class="lineart-slider-label">
          Min Line Width
          <span class="lineart-slider-val" id="la-min-val">${s.minWidth.toFixed(2)} mm</span>
        </label>
        <input type="range" id="la-min-width" min="0" max="3" step="0.05"
          value="${s.minWidth}" class="lineart-range" />
        <div class="field-hint">Thinnest line (bright areas). 0 = gaps.</div>
      </div>

      <div class="lineart-field">
        <label class="lineart-slider-label">
          Max Line Width
          <span class="lineart-slider-val" id="la-max-val">${s.maxWidth.toFixed(2)} mm</span>
        </label>
        <input type="range" id="la-max-width" min="0.2" max="10" step="0.1"
          value="${s.maxWidth}" class="lineart-range" />
        <div class="field-hint">Thickest line (dark areas)</div>
      </div>

      <div class="lineart-field">
        <label class="lineart-slider-label">
          Blur
          <span class="lineart-slider-val" id="la-blur-val">${s.blur}</span>
        </label>
        <input type="range" id="la-blur" min="0" max="10" step="1"
          value="${s.blur}" class="lineart-range" />
        <div class="field-hint">Smooth image before sampling (reduces noise)</div>
      </div>

      <div class="lineart-field">
        <label class="lineart-toggle-label">
          <input type="checkbox" id="la-invert" ${s.invert ? 'checked' : ''} />
          Invert (thick lines in bright areas)
        </label>
      </div>

      <div class="lineart-actions">
        <button class="lineart-btn lineart-btn-primary" id="la-process-btn" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          Generate
        </button>
        <button class="lineart-btn lineart-btn-secondary" id="la-download-btn" style="display:none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download SVG
        </button>
      </div>
      <div id="la-status"></div>
    `;
    container.appendChild(panel);

    // === Right: main area ===
    const main = el('div', 'lineart-main');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp';
    fileInput.style.display = 'none';
    fileInput.id = 'la-file-input';
    main.appendChild(fileInput);

    const previewArea = el('div', 'lineart-preview-area');

    const origBox = el('div', 'lineart-preview-box');
    origBox.innerHTML = `
      <div class="preview-header">
        <span>Original</span>
        <span style="flex:1"></span>
        <span class="dim-info" id="la-orig-info"></span>
        <button class="replace-btn" id="la-replace-btn">Replace</button>
      </div>
      <div class="preview-body" id="la-orig-body">
        <div class="pz-wrap" id="la-orig-wrap"></div>
        <div class="lineart-empty-preview" id="la-orig-empty">Click or drop an image<br>to begin</div>
        <span class="pz-hint">Scroll to zoom · Drag to pan · Dbl-click to reset</span>
      </div>
    `;

    const resultBox = el('div', 'lineart-preview-box');
    resultBox.innerHTML = `
      <div class="preview-header">
        <span>Line Art SVG</span>
        <span style="flex:1"></span>
        <span class="dim-info" id="la-result-info"></span>
      </div>
      <div class="preview-body" id="la-result-body">
        <div class="pz-wrap" id="la-result-wrap"></div>
        <div class="lineart-empty-preview" id="la-result-empty">Generated SVG will appear here</div>
        <span class="pz-hint">Scroll to zoom · Drag to pan · Dbl-click to reset</span>
      </div>
    `;

    previewArea.appendChild(origBox);
    previewArea.appendChild(resultBox);
    main.appendChild(previewArea);
    container.appendChild(main);

    wireEvents();
  }

  /* ─── Pan / Zoom ─────────────────────────────────────────────────── */
  function setupPanZoom(bodyEl, wrapEl) {
    let scale = 1, tx = 0, ty = 0;
    let dragging = false, lastX = 0, lastY = 0;

    function apply() {
      wrapEl.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    }

    function fit() {
      const child = wrapEl.firstElementChild;
      if (!child) return;
      const bw = bodyEl.clientWidth, bh = bodyEl.clientHeight;
      let cw, ch;
      if (child.tagName === 'IMG' || child.tagName === 'CANVAS') {
        cw = child.naturalWidth  || child.width  || bw;
        ch = child.naturalHeight || child.height || bh;
      } else {
        cw = child.clientWidth  || bw;
        ch = child.clientHeight || bh;
      }
      if (!cw || !ch) return;
      scale = Math.min(bw / cw, bh / ch);
      tx = (bw - cw * scale) / 2;
      ty = (bh - ch * scale) / 2;
      apply();
    }

    bodyEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = bodyEl.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const ns = Math.min(Math.max(scale * factor, 0.02), 80);
      tx = mx - (mx - tx) * (ns / scale);
      ty = my - (my - ty) * (ns / scale);
      scale = ns;
      apply();
    }, { passive: false });

    bodyEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      bodyEl.classList.add('panning');
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      tx += e.clientX - lastX; ty += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      apply();
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      bodyEl.classList.remove('panning');
    });
    bodyEl.addEventListener('dblclick', fit);

    // Touch
    let lastDist = 0;
    bodyEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        dragging = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        dragging = false;
        lastDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: true });
    bodyEl.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && dragging) {
        tx += e.touches[0].clientX - lastX; ty += e.touches[0].clientY - lastY;
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
        apply();
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY);
        const f = dist / (lastDist || dist); lastDist = dist;
        const r = bodyEl.getBoundingClientRect();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
        const ns = Math.min(Math.max(scale * f, 0.02), 80);
        tx = cx - (cx - tx) * (ns / scale);
        ty = cy - (cy - ty) * (ns / scale);
        scale = ns; apply();
      }
    }, { passive: false });
    bodyEl.addEventListener('touchend', () => { dragging = false; });

    return { fit, apply };
  }

  /* ─── Wire events ────────────────────────────────────────────────── */
  function wireEvents() {
    const fileInput  = document.getElementById('la-file-input');
    const processBtn = document.getElementById('la-process-btn');
    const downloadBtn= document.getElementById('la-download-btn');
    const origBody   = document.getElementById('la-orig-body');

    // Upload: click orig preview or replace button
    origBody.addEventListener('click', (e) => {
      if (state.originalImg) return;
      fileInput.click();
    });
    origBody.style.cursor = 'pointer';

    document.getElementById('la-replace-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) handleFile(fileInput.files[0]);
    });

    // Drag & drop
    origBody.addEventListener('dragover', (e) => {
      e.preventDefault(); origBody.classList.add('orig-drop-active');
    });
    origBody.addEventListener('dragleave', () => origBody.classList.remove('orig-drop-active'));
    origBody.addEventListener('drop', (e) => {
      e.preventDefault(); origBody.classList.remove('orig-drop-active');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    // Process & download
    processBtn.addEventListener('click', () => {
      if (!state.originalImg || state.processing) return;
      readSettings();
      runProcessing();
    });
    downloadBtn.addEventListener('click', downloadResult);

    // Pan/zoom
    const origWrap = document.getElementById('la-orig-wrap');
    const resBody  = document.getElementById('la-result-body');
    const resWrap  = document.getElementById('la-result-wrap');
    pzInstances.orig   = setupPanZoom(origBody, origWrap);
    pzInstances.result = setupPanZoom(resBody, resWrap);

    // ── Debounced live update ──
    let liveTimer = null;
    function scheduleLiveUpdate() {
      if (!state.originalImg) return;
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => { readSettings(); runProcessing(); }, 200);
    }

    // Direction buttons
    document.querySelectorAll('#la-direction .la-dir-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#la-direction .la-dir-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        scheduleLiveUpdate();
      });
    });

    // Density mode toggle
    document.querySelectorAll('#la-density-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#la-density-toggle button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        document.getElementById('la-count-field').style.display   = mode === 'count'   ? '' : 'none';
        document.getElementById('la-spacing-field').style.display = mode === 'spacing' ? '' : 'none';
        scheduleLiveUpdate();
      });
    });

    // Line count / spacing
    document.getElementById('la-line-count').addEventListener('change', scheduleLiveUpdate);
    document.getElementById('la-line-spacing').addEventListener('change', scheduleLiveUpdate);

    // Output size / units
    document.getElementById('la-out-width').addEventListener('change', scheduleLiveUpdate);
    document.getElementById('la-out-height').addEventListener('change', scheduleLiveUpdate);
    document.getElementById('la-units').addEventListener('change', scheduleLiveUpdate);

    // Sliders
    const minSlider = document.getElementById('la-min-width');
    minSlider.addEventListener('input', () => {
      document.getElementById('la-min-val').textContent = parseFloat(minSlider.value).toFixed(2) + ' mm';
      scheduleLiveUpdate();
    });
    const maxSlider = document.getElementById('la-max-width');
    maxSlider.addEventListener('input', () => {
      document.getElementById('la-max-val').textContent = parseFloat(maxSlider.value).toFixed(2) + ' mm';
      scheduleLiveUpdate();
    });
    const blurSlider = document.getElementById('la-blur');
    blurSlider.addEventListener('input', () => {
      document.getElementById('la-blur-val').textContent = blurSlider.value;
      scheduleLiveUpdate();
    });

    // Invert
    document.getElementById('la-invert').addEventListener('change', scheduleLiveUpdate);
  }

  /* ─── File handling ──────────────────────────────────────────────── */
  function handleFile(file) {
    if (!file.type.match(/image\/(jpeg|png|webp)/)) return;
    state.file = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        state.originalImg = img;
        state.svgString = null;
        state.srcPixels = null;

        // Draw original
        const origWrap = document.getElementById('la-orig-wrap');
        origWrap.innerHTML = '';
        const oc = document.createElement('canvas');
        oc.width = img.naturalWidth; oc.height = img.naturalHeight;
        oc.getContext('2d').drawImage(img, 0, 0);
        origWrap.appendChild(oc);
        document.getElementById('la-orig-empty').style.display = 'none';
        document.getElementById('la-orig-info').textContent =
          `${img.naturalWidth} × ${img.naturalHeight} px`;

        requestAnimationFrame(() => pzInstances.orig && pzInstances.orig.fit());

        // Enable process, clear result
        document.getElementById('la-process-btn').disabled = false;
        document.getElementById('la-result-wrap').innerHTML = '';
        document.getElementById('la-result-empty').style.display = '';
        document.getElementById('la-result-info').textContent = '';
        document.getElementById('la-download-btn').style.display = 'none';

        // Switch cursor & show replace
        document.getElementById('la-orig-body').style.cursor = '';
        document.getElementById('la-replace-btn').style.display = 'inline-block';

        // Auto-process
        readSettings();
        runProcessing();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ─── Read settings from UI ──────────────────────────────────────── */
  function readSettings() {
    const s = state.settings;
    const activeDir = document.querySelector('#la-direction .la-dir-btn.active');
    s.direction = activeDir ? activeDir.dataset.dir : 'vertical';

    const activeMode = document.querySelector('#la-density-toggle button.active');
    s.densityMode = activeMode ? activeMode.dataset.mode : 'count';

    s.lineCount   = parseInt(document.getElementById('la-line-count').value, 10) || 80;
    s.lineSpacing = parseFloat(document.getElementById('la-line-spacing').value) || 2.0;

    const wVal = parseFloat(document.getElementById('la-out-width').value);
    const hVal = parseFloat(document.getElementById('la-out-height').value);
    s.outputWidth  = wVal > 0 ? wVal : 150;
    s.outputHeight = hVal > 0 ? hVal : 0;

    s.units    = document.getElementById('la-units').value;
    s.minWidth = parseFloat(document.getElementById('la-min-width').value) || 0;
    s.maxWidth = parseFloat(document.getElementById('la-max-width').value) || 2.0;
    s.blur     = parseInt(document.getElementById('la-blur').value, 10) || 0;
    s.invert   = document.getElementById('la-invert').checked;
  }

  /* ─── Processing (via worker) ────────────────────────────────────── */
  function runProcessing() {
    if (!state.originalImg) return;

    // Cache source pixels
    if (!state.srcPixels) {
      const tmp = document.createElement('canvas');
      tmp.width  = state.originalImg.naturalWidth  || state.originalImg.width;
      tmp.height = state.originalImg.naturalHeight || state.originalImg.height;
      tmp.getContext('2d').drawImage(state.originalImg, 0, 0);
      state.srcPixels = tmp.getContext('2d').getImageData(0, 0, tmp.width, tmp.height).data;
      state.srcW = tmp.width;
      state.srcH = tmp.height;
    }

    const s = state.settings;

    // Compute output dimensions in mm
    let outW = s.outputWidth;
    let outH = s.outputHeight;
    if (s.units === 'in') { outW *= 25.4; outH *= 25.4; }

    // Auto-calculate missing dimension from aspect ratio
    const aspect = state.srcH / state.srcW;
    if (!outH || outH <= 0) outH = outW * aspect;
    if (!outW || outW <= 0) outW = outH / aspect;

    state.outWmm = outW;
    state.outHmm = outH;

    // Line spacing in mm
    let lineSpacingMM = s.lineSpacing;
    if (s.units === 'in' && s.densityMode === 'spacing') lineSpacingMM *= 25.4;

    const jobId = ++_jobGen;
    state.processing = true;

    const pixelsCopy = new Uint8ClampedArray(state.srcPixels).buffer;
    const worker = getWorker();

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.jobId !== _jobGen) return;

      state.processing = false;
      document.getElementById('la-process-btn').disabled = false;

      if (!msg.ok) {
        console.error('Line Art worker error:', msg.error);
        document.getElementById('la-status').innerHTML =
          `<div style="color:#ef5350;padding:8px 0;font-size:13px">Error: ${msg.error}</div>`;
        return;
      }

      state.svgString = msg.svg;
      showResult(msg.numLines);
      document.getElementById('la-status').innerHTML = '';
    };

    worker.postMessage({
      pixels: pixelsCopy, imgW: state.srcW, imgH: state.srcH,
      settings: {
        direction: s.direction, densityMode: s.densityMode,
        lineCount: s.lineCount, lineSpacing: lineSpacingMM,
        outW, outH,
        minWidth: s.minWidth, maxWidth: s.maxWidth,
        blur: s.blur, invert: s.invert,
      },
      jobId
    }, [pixelsCopy]);
  }

  /* ─── Show result ────────────────────────────────────────────────── */
  function showResult(numLines) {
    const wrapEl = document.getElementById('la-result-wrap');
    const isEmpty = !wrapEl.firstElementChild;

    // Render SVG via an <img> tag so pan/zoom uses naturalWidth/Height
    const blob = new Blob([state.svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      wrapEl.innerHTML = '';
      wrapEl.appendChild(img);
      if (isEmpty) {
        requestAnimationFrame(() => pzInstances.result && pzInstances.result.fit());
      }
    };
    img.src = url;

    document.getElementById('la-result-empty').style.display = 'none';

    // Info
    const s = state.settings;
    const uW = s.units === 'in' ? (state.outWmm / 25.4).toFixed(2) + '"' : state.outWmm.toFixed(1) + 'mm';
    const uH = s.units === 'in' ? (state.outHmm / 25.4).toFixed(2) + '"' : state.outHmm.toFixed(1) + 'mm';
    document.getElementById('la-result-info').textContent =
      `${uW} × ${uH}  |  ${numLines} lines`;

    document.getElementById('la-download-btn').style.display = '';
  }

  /* ─── Download ───────────────────────────────────────────────────── */
  function downloadResult() {
    if (!state.svgString) return;

    const s = state.settings;
    const stem = state.file?.name ? state.file.name.replace(/\.[^.]+$/, '') : 'image';

    const sizeTag = s.units === 'in'
      ? `${(state.outWmm / 25.4).toFixed(1)}x${(state.outHmm / 25.4).toFixed(1)}in`
      : `${state.outWmm.toFixed(0)}x${state.outHmm.toFixed(0)}mm`;

    const densityTag = s.densityMode === 'count'
      ? `${s.lineCount}lines`
      : `${s.lineSpacing}sp`;

    const filename = `${stem}_lineart_${s.direction}_${densityTag}_${sizeTag}_w${s.minWidth.toFixed(1)}-${s.maxWidth.toFixed(1)}.svg`;

    const blob = new Blob([state.svgString], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ═══════════════════════════════════════════════════════════════════
     TAB INJECTION — add "Line Art" to the navbar
     ═══════════════════════════════════════════════════════════════════ */
  let lineartTab = null;
  let lineartBody = null;
  let isActive = false;

  function injectTab() {
    const navTabs = document.querySelector('.nav-tabs');
    if (!navTabs || navTabs.querySelector('.lineart-tab')) return;

    lineartTab = document.createElement('button');
    lineartTab.className = 'nav-tab lineart-tab';
    lineartTab.textContent = 'Line Art';
    lineartTab.addEventListener('click', activateLineart);
    navTabs.appendChild(lineartTab);

    if (isActive) lineartTab.classList.add('active');
  }

  function ensureBody() {
    if (lineartBody) return;
    const app = document.querySelector('.app');
    if (!app) return;

    injectStyles();
    lineartBody = el('div', 'lineart-container');
    lineartBody.style.display = 'none';
    app.appendChild(lineartBody);
    buildUI(lineartBody);
  }

  function activateLineart() {
    isActive = true;
    ensureBody();

    // Hide React content
    document.querySelectorAll('.app-body, .app-body-3d, .step-toolbar').forEach(e => {
      e.style.setProperty('display', 'none', 'important');
    });

    // Un-active React tabs, active ours
    document.querySelectorAll('.nav-tabs .nav-tab').forEach(t => t.classList.remove('active'));
    if (lineartTab) lineartTab.classList.add('active');
    if (lineartBody) lineartBody.style.display = 'flex';
  }

  function deactivateLineart() {
    if (!isActive) return;
    isActive = false;

    if (lineartBody) lineartBody.style.display = 'none';

    // Restore React content (React handles correct display via its own state)
    document.querySelectorAll('.app-body, .app-body-3d, .step-toolbar').forEach(e => {
      e.style.removeProperty('display');
    });
    if (lineartTab) lineartTab.classList.remove('active');
  }

  // Intercept clicks on React's own tabs (capturing phase, survives re-renders)
  document.addEventListener('click', (e) => {
    if (!isActive) return;
    if (e.target.closest('.nav-tab:not(.lineart-tab)')) {
      deactivateLineart();
    }
  }, true);

  /* ═══════════════════════════════════════════════════════════════════
     INIT — observe DOM for React renders, keep tab injected
     ═══════════════════════════════════════════════════════════════════ */
  const observer = new MutationObserver(() => {
    injectTab();
    // If React re-rendered and activated its own tab while we were active, deactivate
    if (isActive) {
      const reactTabs = document.querySelectorAll('.nav-tabs .nav-tab:not(.lineart-tab)');
      const anyReactActive = [...reactTabs].some(t => t.classList.contains('active'));
      if (anyReactActive) deactivateLineart();
    }
  });

  function init() {
    injectTab();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
