/**
 * LAZAR Halftone Dot SVG Tool
 * Converts photos into halftone dot patterns — dots swell in dark areas.
 * Supports square & hex grids, circle/square/diamond shapes, and grid rotation.
 * Injected as a new tab alongside Image Prep, 3D Engrave, and Line Art.
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     DEFAULTS
     ═══════════════════════════════════════════════════════════════════ */
  const DEFAULTS = {
    gridType: 'square',       // square | hex
    dotShape: 'circle',       // circle | square | diamond
    angle: 0,                 // grid rotation degrees (0-90)
    densityMode: 'count',     // count | spacing
    dotCount: 60,
    dotSpacing: 2.5,          // mm
    outputWidth: 150,
    outputHeight: 0,          // 0 = auto
    units: 'mm',
    minDot: 0,                // mm diameter (0 = no dot in bright)
    maxDot: 2.0,              // mm diameter
    blur: 2,
    invert: false,
  };

  /* ═══════════════════════════════════════════════════════════════════
     WEB WORKER
     ═══════════════════════════════════════════════════════════════════ */
  const WORKER_SRC = /* js */`
    'use strict';

    /* ── grayscale ── */
    function toGrayscale(pixels, w, h) {
      var gray = new Float32Array(w * h);
      for (var i = 0; i < w * h; i++) {
        var j = i * 4;
        gray[i] = (0.299 * pixels[j] + 0.587 * pixels[j+1] + 0.114 * pixels[j+2]) / 255;
      }
      return gray;
    }

    /* ── box blur (3-pass ≈ Gaussian) ── */
    function boxBlurPass(src, w, h, r) {
      var tmp = new Float32Array(w * h);
      var dst = new Float32Array(w * h);
      var d = 2 * r + 1;
      for (var y = 0; y < h; y++) {
        var sum = 0;
        for (var k = -r; k <= r; k++) sum += src[y * w + Math.min(w-1, Math.max(0, k))];
        tmp[y * w] = sum / d;
        for (var x = 1; x < w; x++) {
          sum += src[y * w + Math.min(w-1, x + r)] - src[y * w + Math.max(0, x - r - 1)];
          tmp[y * w + x] = sum / d;
        }
      }
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

    /* ── bilinear sample ── */
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

    /* ── halftone generation ── */
    function generateHalftone(gray, imgW, imgH, settings) {
      var outW = settings.outW, outH = settings.outH;
      var minR = settings.minDot / 2, maxR = settings.maxDot / 2;
      var invert = settings.invert;
      var gridType = settings.gridType;
      var dotShape = settings.dotShape;
      var angleDeg = settings.angle || 0;
      var angleRad = angleDeg * Math.PI / 180;
      var cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

      /* spacing */
      var spacing;
      if (settings.densityMode === 'count') {
        spacing = outW / Math.max(1, settings.dotCount);
      } else {
        spacing = settings.dotSpacing;
      }

      var cx = outW / 2, cy = outH / 2;
      var SQRT3_2 = 0.8660254;
      var rowSp = gridType === 'hex' ? spacing * SQRT3_2 : spacing;

      /* Rotate output rect corners into grid-local space to find extent */
      var corners = [[0,0],[outW,0],[outW,outH],[0,outH]];
      var gMinX = Infinity, gMaxX = -Infinity;
      var gMinY = Infinity, gMaxY = -Infinity;
      for (var ci = 0; ci < 4; ci++) {
        var dx = corners[ci][0] - cx, dy = corners[ci][1] - cy;
        var lx =  dx * cosA + dy * sinA;
        var ly = -dx * sinA + dy * cosA;
        if (lx < gMinX) gMinX = lx;  if (lx > gMaxX) gMaxX = lx;
        if (ly < gMinY) gMinY = ly;  if (ly > gMaxY) gMaxY = ly;
      }
      gMinX -= spacing * 1.5; gMinY -= rowSp * 1.5;
      gMaxX += spacing * 1.5; gMaxY += rowSp * 1.5;

      var startCol = Math.floor(gMinX / spacing);
      var endCol   = Math.ceil(gMaxX / spacing);
      var startRow = Math.floor(gMinY / rowSp);
      var endRow   = Math.ceil(gMaxY / rowSp);

      var elements = [];
      var dotCount = 0;

      for (var row = startRow; row <= endRow; row++) {
        for (var col = startCol; col <= endCol; col++) {
          /* grid-local position */
          var gx, gy;
          if (gridType === 'hex') {
            gx = col * spacing + ((row & 1) ? spacing * 0.5 : 0);
            gy = row * rowSp;
          } else {
            gx = col * spacing;
            gy = row * spacing;
          }

          /* forward-rotate to output coords (for brightness sampling) */
          var ox = gx * cosA - gy * sinA + cx;
          var oy = gx * sinA + gy * cosA + cy;

          /* generous bounds check (clipPath handles exact clipping) */
          if (ox < -maxR * 3 || ox > outW + maxR * 3 ||
              oy < -maxR * 3 || oy > outH + maxR * 3) continue;

          /* sample brightness */
          var ix = (ox / outW) * (imgW - 1);
          var iy = (oy / outH) * (imgH - 1);
          var brightness = 0.5;
          if (ix >= 0 && ix < imgW && iy >= 0 && iy < imgH) {
            brightness = sampleBilinear(gray, imgW, imgH, ix, iy);
          }
          if (invert) brightness = 1 - brightness;

          var darkness = 1 - brightness;
          var r = minR + (maxR - minR) * darkness;
          if (r < 0.01) continue;

          dotCount++;

          /* SVG position: grid-local offset + center
             The <g> wrapping all dots applies rotate(angle, cx, cy)
             which maps (gx+cx, gy+cy) → (ox, oy) visually */
          var sx = gx + cx, sy = gy + cy;

          if (dotShape === 'circle') {
            elements.push('<circle cx="' + sx.toFixed(2) + '" cy="' + sy.toFixed(2) +
              '" r="' + r.toFixed(3) + '"/>');
          } else if (dotShape === 'square') {
            elements.push('<rect x="' + (sx - r).toFixed(2) + '" y="' + (sy - r).toFixed(2) +
              '" width="' + (r * 2).toFixed(3) + '" height="' + (r * 2).toFixed(3) + '"/>');
          } else {
            /* diamond */
            elements.push('<polygon points="' +
              sx.toFixed(2) + ',' + (sy - r).toFixed(2) + ' ' +
              (sx + r).toFixed(2) + ',' + sy.toFixed(2) + ' ' +
              sx.toFixed(2) + ',' + (sy + r).toFixed(2) + ' ' +
              (sx - r).toFixed(2) + ',' + sy.toFixed(2) + '"/>');
          }
        }
      }

      /* build SVG */
      var rotAttr = angleDeg !== 0
        ? ' transform="rotate(' + angleDeg.toFixed(2) + ',' + cx.toFixed(2) + ',' + cy.toFixed(2) + ')"'
        : '';

      var svg = '<svg xmlns="http://www.w3.org/2000/svg"' +
        ' viewBox="0 0 ' + outW.toFixed(2) + ' ' + outH.toFixed(2) + '"' +
        ' width="' + outW.toFixed(2) + 'mm" height="' + outH.toFixed(2) + 'mm">' +
        '<defs><clipPath id="ht-bounds"><rect width="' + outW.toFixed(2) +
        '" height="' + outH.toFixed(2) + '"/></clipPath></defs>' +
        '<rect width="100%" height="100%" fill="white"/>' +
        '<g clip-path="url(#ht-bounds)"><g' + rotAttr + ' fill="black">';

      for (var ei = 0; ei < elements.length; ei++) svg += elements[ei];
      svg += '</g></g></svg>';

      return { svg: svg, dotCount: dotCount };
    }

    /* ── message handler ── */
    self.onmessage = function (e) {
      var data = e.data;
      try {
        var pixels = new Uint8ClampedArray(data.pixels);
        var gray = toGrayscale(pixels, data.imgW, data.imgH);
        if (data.settings.blur > 0) {
          gray = applyBlur(gray, data.imgW, data.imgH, data.settings.blur);
        }
        var result = generateHalftone(gray, data.imgW, data.imgH, data.settings);
        self.postMessage({ ok: true, jobId: data.jobId,
                           svg: result.svg, dotCount: result.dotCount });
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
    .halftone-container {
      display: flex; flex-direction: row; flex: 1; min-height: 0;
      background: var(--bg-dark, #1a1a2e);
      color: var(--text-primary, #e0e0e0); overflow: hidden;
    }
    .halftone-panel {
      flex: 0 0 270px; background: var(--bg-panel, #16213e);
      border-right: 1px solid var(--border, #2a2a4a);
      padding: 16px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 0;
    }
    .halftone-panel h3 {
      margin: 0 0 14px; font-size: 14px; font-weight: 600;
      letter-spacing: .5px; text-transform: uppercase;
      color: var(--text-secondary, #a0a0c0);
    }
    .halftone-field { margin-bottom: 12px; }
    .halftone-field label {
      display: block; font-size: 12px;
      color: var(--text-secondary, #a0a0c0);
      margin-bottom: 4px; font-weight: 500;
    }
    .halftone-field input[type="text"],
    .halftone-field input[type="number"],
    .halftone-field select {
      width: 100%; box-sizing: border-box; padding: 7px 10px; font-size: 13px;
      border-radius: var(--radius, 6px);
      border: 1px solid var(--border, #2a2a4a);
      background: var(--bg-input, #0f0f23);
      color: var(--text-primary, #e0e0e0);
      font-family: 'Inter', sans-serif; transition: border-color .2s;
    }
    .halftone-field input:focus,
    .halftone-field select:focus {
      border-color: var(--accent, #2196f3); outline: none;
    }
    .halftone-field .field-hint {
      font-size: 11px; color: var(--text-secondary, #777); margin-top: 3px;
    }
    .halftone-row { display: flex; gap: 10px; }
    .halftone-row .halftone-field { flex: 1; }
    .halftone-slider-label {
      display: flex !important; justify-content: space-between; align-items: center;
    }
    .halftone-slider-val {
      font-variant-numeric: tabular-nums;
      color: var(--accent, #2196f3); font-size: 12px; font-weight: 600;
    }
    .halftone-range { width: 100%; margin: 4px 0 2px; }
    .halftone-toggle-label {
      display: flex !important; align-items: center; gap: 8px;
      font-size: 12px; cursor: pointer;
    }
    .halftone-divider {
      border: none; border-top: 1px solid var(--border, #2a2a4a); margin: 14px 0;
    }
    .halftone-btn {
      display: inline-flex; align-items: center; justify-content: center;
      gap: 6px; padding: 8px 16px; border-radius: var(--radius, 6px);
      font-size: 13px; font-weight: 600; font-family: inherit;
      cursor: pointer; border: 1px solid transparent;
      transition: background .15s, border-color .15s; white-space: nowrap;
    }
    .halftone-btn:disabled { opacity: .4; cursor: default; }
    .halftone-btn-primary { background: var(--accent, #2196f3); color: #fff; }
    .halftone-btn-primary:hover:not(:disabled) { background: #1e88e5; }
    .halftone-btn-secondary {
      background: var(--bg-input, #0f0f23);
      border-color: var(--border, #2a2a4a);
      color: var(--text-primary, #e0e0e0);
    }
    .halftone-btn-secondary:hover:not(:disabled) { border-color: var(--accent, #2196f3); }
    .halftone-actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }

    /* Right area */
    .halftone-main {
      flex: 1; display: flex; flex-direction: column;
      min-width: 0; min-height: 0; overflow: hidden;
    }
    .halftone-preview-area {
      flex: 1; display: flex; gap: 0; min-height: 0; overflow: hidden;
    }
    .halftone-preview-box {
      flex: 1; display: flex; flex-direction: column;
      overflow: hidden; border-right: 1px solid var(--border, #2a2a4a);
    }
    .halftone-preview-box:last-child { border-right: none; }
    .halftone-preview-box .preview-header {
      padding: 8px 12px; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: .5px;
      color: var(--text-secondary, #a0a0c0);
      border-bottom: 1px solid var(--border, #2a2a4a);
      display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
    }
    .halftone-preview-box .preview-header .dim-info {
      font-weight: 400; font-size: 10px; opacity: .7;
    }
    .halftone-preview-box .preview-body {
      flex: 1; position: relative; overflow: hidden;
      background: #080812; cursor: grab;
    }
    .halftone-preview-box .preview-body.panning { cursor: grabbing; }
    .halftone-preview-box .pz-wrap {
      position: absolute; top: 0; left: 0;
      transform-origin: 0 0; will-change: transform;
    }
    .halftone-preview-box .pz-wrap canvas,
    .halftone-preview-box .pz-wrap img { display: block; image-rendering: auto; }
    .halftone-preview-box .pz-hint {
      position: absolute; bottom: 6px; right: 8px;
      font-size: 10px; color: rgba(255,255,255,.3);
      pointer-events: none; user-select: none;
    }
    .halftone-empty-preview {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%,-50%);
      color: var(--text-secondary, #777); font-size: 13px;
      text-align: center; opacity: .6; pointer-events: none;
      white-space: nowrap; line-height: 1.6;
    }
    .halftone-preview-box .orig-drop-active {
      background: rgba(33,150,243,.06);
      outline: 2px dashed var(--accent, #2196f3); outline-offset: -4px;
    }
    .halftone-preview-box .preview-header .replace-btn {
      display: none; padding: 2px 8px; font-size: 10px; font-family: inherit;
      background: transparent; border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px);
      color: var(--text-secondary, #a0a0c0); cursor: pointer;
      transition: border-color .15s, color .15s;
    }
    .halftone-preview-box .preview-header .replace-btn:hover {
      border-color: var(--accent, #2196f3); color: var(--text-primary, #e0e0e0);
    }

    /* Option button group (grid type, dot shape) */
    .ht-opt-group { display: flex; gap: 4px; flex-wrap: wrap; }
    .ht-opt-btn {
      flex: 1; min-width: 58px; padding: 5px 4px;
      font-size: 11px; font-family: inherit; font-weight: 500; text-align: center;
      background: var(--bg-input, #0f0f23);
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px);
      color: var(--text-secondary, #a0a0c0); cursor: pointer;
      transition: border-color .15s, color .15s, background .15s;
    }
    .ht-opt-btn:hover {
      border-color: var(--accent, #2196f3); color: var(--text-primary, #e0e0e0);
    }
    .ht-opt-btn.active {
      border-color: var(--accent, #2196f3);
      background: rgba(33,150,243,.12); color: var(--accent, #2196f3);
    }

    /* Density mode toggle */
    .ht-density-toggle {
      display: flex; gap: 0; margin-bottom: 8px;
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px); overflow: hidden;
    }
    .ht-density-toggle button {
      flex: 1; padding: 5px 8px;
      font-size: 11px; font-family: inherit; font-weight: 500;
      background: transparent; border: none;
      color: var(--text-secondary, #a0a0c0);
      cursor: pointer; transition: background .15s, color .15s;
    }
    .ht-density-toggle button.active {
      background: var(--accent, #2196f3); color: #fff;
    }

    @keyframes ht-spin { to { transform: rotate(360deg); } }
  `;

  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    const s = document.createElement('style');
    s.id = 'halftone-styles';
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
    const s = state.settings;

    /* ── Left: settings panel ── */
    const panel = el('div', 'halftone-panel');
    panel.innerHTML = `
      <h3>Halftone Settings</h3>

      <div class="halftone-field">
        <label>Grid</label>
        <div class="ht-opt-group" id="ht-grid-type">
          <button class="ht-opt-btn ${s.gridType === 'square' ? 'active' : ''}" data-val="square">Square</button>
          <button class="ht-opt-btn ${s.gridType === 'hex'    ? 'active' : ''}" data-val="hex">Hex</button>
        </div>
      </div>

      <div class="halftone-field">
        <label>Dot Shape</label>
        <div class="ht-opt-group" id="ht-dot-shape">
          <button class="ht-opt-btn ${s.dotShape === 'circle'  ? 'active' : ''}" data-val="circle">Circle</button>
          <button class="ht-opt-btn ${s.dotShape === 'square'  ? 'active' : ''}" data-val="square">Square</button>
          <button class="ht-opt-btn ${s.dotShape === 'diamond' ? 'active' : ''}" data-val="diamond">Diamond</button>
        </div>
      </div>

      <div class="halftone-field">
        <label class="halftone-slider-label">
          Grid Angle
          <span class="halftone-slider-val" id="ht-angle-val">${s.angle}°</span>
        </label>
        <input type="range" id="ht-angle" min="0" max="90" step="1"
          value="${s.angle}" class="halftone-range" />
      </div>

      <div class="halftone-field">
        <label>Density</label>
        <div class="ht-density-toggle" id="ht-density-toggle">
          <button class="${s.densityMode === 'count'   ? 'active' : ''}" data-mode="count">Dot Count</button>
          <button class="${s.densityMode === 'spacing' ? 'active' : ''}" data-mode="spacing">Spacing</button>
        </div>
        <div id="ht-count-field" ${s.densityMode !== 'count' ? 'style="display:none"' : ''}>
          <input type="number" id="ht-dot-count" value="${s.dotCount}" min="2" max="500" step="1" />
          <div class="field-hint">Dots across the width</div>
        </div>
        <div id="ht-spacing-field" ${s.densityMode !== 'spacing' ? 'style="display:none"' : ''}>
          <input type="number" id="ht-dot-spacing" value="${s.dotSpacing}" min="0.1" max="50" step="0.1" />
          <div class="field-hint">Spacing between dots (mm)</div>
        </div>
      </div>

      <hr class="halftone-divider">

      <div class="halftone-row">
        <div class="halftone-field">
          <label>Width</label>
          <input type="number" id="ht-out-width" value="${s.outputWidth || ''}" min="1" step="1" placeholder="150" />
        </div>
        <div class="halftone-field">
          <label>Height</label>
          <input type="number" id="ht-out-height" value="${s.outputHeight || ''}" min="1" step="1" placeholder="Auto" />
        </div>
        <div class="halftone-field" style="flex:0 0 70px">
          <label>Units</label>
          <select id="ht-units">
            <option value="mm" ${s.units === 'mm' ? 'selected' : ''}>mm</option>
            <option value="in" ${s.units === 'in' ? 'selected' : ''}>inches</option>
          </select>
        </div>
      </div>
      <div class="field-hint" style="margin-bottom:12px">Leave height blank to auto-calculate from aspect ratio</div>

      <hr class="halftone-divider">

      <div class="halftone-field">
        <label class="halftone-slider-label">
          Min Dot Size
          <span class="halftone-slider-val" id="ht-min-val">${s.minDot.toFixed(2)} mm</span>
        </label>
        <input type="range" id="ht-min-dot" min="0" max="3" step="0.05"
          value="${s.minDot}" class="halftone-range" />
        <div class="field-hint">Smallest dot (bright areas). 0 = no dot.</div>
      </div>

      <div class="halftone-field">
        <label class="halftone-slider-label">
          Max Dot Size
          <span class="halftone-slider-val" id="ht-max-val">${s.maxDot.toFixed(2)} mm</span>
        </label>
        <input type="range" id="ht-max-dot" min="0.2" max="10" step="0.1"
          value="${s.maxDot}" class="halftone-range" />
        <div class="field-hint">Largest dot (dark areas)</div>
      </div>

      <div class="halftone-field">
        <label class="halftone-slider-label">
          Blur
          <span class="halftone-slider-val" id="ht-blur-val">${s.blur}</span>
        </label>
        <input type="range" id="ht-blur" min="0" max="10" step="1"
          value="${s.blur}" class="halftone-range" />
        <div class="field-hint">Smooth source image (reduces noise)</div>
      </div>

      <div class="halftone-field">
        <label class="halftone-toggle-label">
          <input type="checkbox" id="ht-invert" ${s.invert ? 'checked' : ''} />
          Invert (big dots in bright areas)
        </label>
      </div>

      <div class="halftone-actions">
        <button class="halftone-btn halftone-btn-primary" id="ht-process-btn" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          Generate
        </button>
        <button class="halftone-btn halftone-btn-secondary" id="ht-download-btn" style="display:none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download SVG
        </button>
      </div>
      <div id="ht-status"></div>
    `;
    container.appendChild(panel);

    /* ── Right: main area ── */
    const main = el('div', 'halftone-main');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp';
    fileInput.style.display = 'none';
    fileInput.id = 'ht-file-input';
    main.appendChild(fileInput);

    const previewArea = el('div', 'halftone-preview-area');

    const origBox = el('div', 'halftone-preview-box');
    origBox.innerHTML = `
      <div class="preview-header">
        <span>Original</span>
        <span style="flex:1"></span>
        <span class="dim-info" id="ht-orig-info"></span>
        <button class="replace-btn" id="ht-replace-btn">Replace</button>
      </div>
      <div class="preview-body" id="ht-orig-body">
        <div class="pz-wrap" id="ht-orig-wrap"></div>
        <div class="halftone-empty-preview" id="ht-orig-empty">Click or drop an image<br>to begin</div>
        <span class="pz-hint">Scroll to zoom · Drag to pan · Dbl-click to reset</span>
      </div>
    `;

    const resultBox = el('div', 'halftone-preview-box');
    resultBox.innerHTML = `
      <div class="preview-header">
        <span>Halftone SVG</span>
        <span style="flex:1"></span>
        <span class="dim-info" id="ht-result-info"></span>
      </div>
      <div class="preview-body" id="ht-result-body">
        <div class="pz-wrap" id="ht-result-wrap"></div>
        <div class="halftone-empty-preview" id="ht-result-empty">Generated SVG will appear here</div>
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
    const fileInput  = document.getElementById('ht-file-input');
    const processBtn = document.getElementById('ht-process-btn');
    const downloadBtn= document.getElementById('ht-download-btn');
    const origBody   = document.getElementById('ht-orig-body');

    // Upload
    origBody.addEventListener('click', () => {
      if (state.originalImg) return;
      fileInput.click();
    });
    origBody.style.cursor = 'pointer';

    document.getElementById('ht-replace-btn').addEventListener('click', () => fileInput.click());
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
    const origWrap = document.getElementById('ht-orig-wrap');
    const resBody  = document.getElementById('ht-result-body');
    const resWrap  = document.getElementById('ht-result-wrap');
    pzInstances.orig   = setupPanZoom(origBody, origWrap);
    pzInstances.result = setupPanZoom(resBody, resWrap);

    // ── Debounced live update ──
    let liveTimer = null;
    function scheduleLiveUpdate() {
      if (!state.originalImg) return;
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => { readSettings(); runProcessing(); }, 200);
    }

    // Option button groups
    function wireOptGroup(groupId) {
      document.querySelectorAll(`#${groupId} .ht-opt-btn`).forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll(`#${groupId} .ht-opt-btn`).forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          scheduleLiveUpdate();
        });
      });
    }
    wireOptGroup('ht-grid-type');
    wireOptGroup('ht-dot-shape');

    // Density toggle
    document.querySelectorAll('#ht-density-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#ht-density-toggle button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        document.getElementById('ht-count-field').style.display   = mode === 'count'   ? '' : 'none';
        document.getElementById('ht-spacing-field').style.display = mode === 'spacing' ? '' : 'none';
        scheduleLiveUpdate();
      });
    });

    // Number inputs
    ['ht-dot-count','ht-dot-spacing','ht-out-width','ht-out-height'].forEach(id => {
      document.getElementById(id).addEventListener('change', scheduleLiveUpdate);
    });
    document.getElementById('ht-units').addEventListener('change', scheduleLiveUpdate);

    // Sliders
    const angleSlider = document.getElementById('ht-angle');
    angleSlider.addEventListener('input', () => {
      document.getElementById('ht-angle-val').textContent = angleSlider.value + '°';
      scheduleLiveUpdate();
    });
    const minSlider = document.getElementById('ht-min-dot');
    minSlider.addEventListener('input', () => {
      document.getElementById('ht-min-val').textContent = parseFloat(minSlider.value).toFixed(2) + ' mm';
      scheduleLiveUpdate();
    });
    const maxSlider = document.getElementById('ht-max-dot');
    maxSlider.addEventListener('input', () => {
      document.getElementById('ht-max-val').textContent = parseFloat(maxSlider.value).toFixed(2) + ' mm';
      scheduleLiveUpdate();
    });
    const blurSlider = document.getElementById('ht-blur');
    blurSlider.addEventListener('input', () => {
      document.getElementById('ht-blur-val').textContent = blurSlider.value;
      scheduleLiveUpdate();
    });

    // Invert
    document.getElementById('ht-invert').addEventListener('change', scheduleLiveUpdate);
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

        const origWrap = document.getElementById('ht-orig-wrap');
        origWrap.innerHTML = '';
        const oc = document.createElement('canvas');
        oc.width = img.naturalWidth; oc.height = img.naturalHeight;
        oc.getContext('2d').drawImage(img, 0, 0);
        origWrap.appendChild(oc);
        document.getElementById('ht-orig-empty').style.display = 'none';
        document.getElementById('ht-orig-info').textContent =
          `${img.naturalWidth} × ${img.naturalHeight} px`;

        requestAnimationFrame(() => pzInstances.orig && pzInstances.orig.fit());

        document.getElementById('ht-process-btn').disabled = false;
        document.getElementById('ht-result-wrap').innerHTML = '';
        document.getElementById('ht-result-empty').style.display = '';
        document.getElementById('ht-result-info').textContent = '';
        document.getElementById('ht-download-btn').style.display = 'none';

        document.getElementById('ht-orig-body').style.cursor = '';
        document.getElementById('ht-replace-btn').style.display = 'inline-block';

        readSettings();
        runProcessing();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ─── Read settings ──────────────────────────────────────────────── */
  function readSettings() {
    const s = state.settings;
    const gt = document.querySelector('#ht-grid-type .ht-opt-btn.active');
    s.gridType = gt ? gt.dataset.val : 'square';
    const ds = document.querySelector('#ht-dot-shape .ht-opt-btn.active');
    s.dotShape = ds ? ds.dataset.val : 'circle';
    s.angle = parseInt(document.getElementById('ht-angle').value, 10) || 0;

    const dm = document.querySelector('#ht-density-toggle button.active');
    s.densityMode = dm ? dm.dataset.mode : 'count';
    s.dotCount   = parseInt(document.getElementById('ht-dot-count').value, 10) || 60;
    s.dotSpacing = parseFloat(document.getElementById('ht-dot-spacing').value) || 2.5;

    const wVal = parseFloat(document.getElementById('ht-out-width').value);
    const hVal = parseFloat(document.getElementById('ht-out-height').value);
    s.outputWidth  = wVal > 0 ? wVal : 150;
    s.outputHeight = hVal > 0 ? hVal : 0;

    s.units  = document.getElementById('ht-units').value;
    s.minDot = parseFloat(document.getElementById('ht-min-dot').value) || 0;
    s.maxDot = parseFloat(document.getElementById('ht-max-dot').value) || 2.0;
    s.blur   = parseInt(document.getElementById('ht-blur').value, 10) || 0;
    s.invert = document.getElementById('ht-invert').checked;
  }

  /* ─── Processing ─────────────────────────────────────────────────── */
  function runProcessing() {
    if (!state.originalImg) return;

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

    let outW = s.outputWidth, outH = s.outputHeight;
    if (s.units === 'in') { outW *= 25.4; outH *= 25.4; }

    const aspect = state.srcH / state.srcW;
    if (!outH || outH <= 0) outH = outW * aspect;
    if (!outW || outW <= 0) outW = outH / aspect;

    state.outWmm = outW;
    state.outHmm = outH;

    let dotSpacingMM = s.dotSpacing;
    if (s.units === 'in' && s.densityMode === 'spacing') dotSpacingMM *= 25.4;

    const jobId = ++_jobGen;
    state.processing = true;

    const pixelsCopy = new Uint8ClampedArray(state.srcPixels).buffer;
    const worker = getWorker();

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.jobId !== _jobGen) return;

      state.processing = false;
      document.getElementById('ht-process-btn').disabled = false;

      if (!msg.ok) {
        console.error('Halftone worker error:', msg.error);
        document.getElementById('ht-status').innerHTML =
          `<div style="color:#ef5350;padding:8px 0;font-size:13px">Error: ${msg.error}</div>`;
        return;
      }

      state.svgString = msg.svg;
      showResult(msg.dotCount);
      document.getElementById('ht-status').innerHTML = '';
    };

    worker.postMessage({
      pixels: pixelsCopy, imgW: state.srcW, imgH: state.srcH,
      settings: {
        gridType: s.gridType, dotShape: s.dotShape, angle: s.angle,
        densityMode: s.densityMode, dotCount: s.dotCount,
        dotSpacing: dotSpacingMM, outW, outH,
        minDot: s.minDot, maxDot: s.maxDot,
        blur: s.blur, invert: s.invert,
      },
      jobId
    }, [pixelsCopy]);
  }

  /* ─── Show result ────────────────────────────────────────────────── */
  function showResult(dotCount) {
    const wrapEl = document.getElementById('ht-result-wrap');
    const isEmpty = !wrapEl.firstElementChild;

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

    document.getElementById('ht-result-empty').style.display = 'none';

    const s = state.settings;
    const uW = s.units === 'in' ? (state.outWmm / 25.4).toFixed(2) + '"' : state.outWmm.toFixed(1) + 'mm';
    const uH = s.units === 'in' ? (state.outHmm / 25.4).toFixed(2) + '"' : state.outHmm.toFixed(1) + 'mm';
    document.getElementById('ht-result-info').textContent =
      `${uW} × ${uH}  |  ${dotCount} dots`;

    document.getElementById('ht-download-btn').style.display = '';
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
      ? `${s.dotCount}dots`
      : `${s.dotSpacing}sp`;

    const angleTag = s.angle > 0 ? `_${s.angle}deg` : '';

    const filename = `${stem}_halftone_${s.gridType}_${s.dotShape}${angleTag}_${densityTag}_${sizeTag}_d${s.minDot.toFixed(1)}-${s.maxDot.toFixed(1)}.svg`;

    const blob = new Blob([state.svgString], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ═══════════════════════════════════════════════════════════════════
     TAB INJECTION
     ═══════════════════════════════════════════════════════════════════ */
  let halftoneTab = null;
  let halftoneBody = null;
  let isActive = false;

  function injectTab() {
    const navTabs = document.querySelector('.nav-tabs');
    if (!navTabs || navTabs.querySelector('.halftone-tab')) return;

    halftoneTab = document.createElement('button');
    halftoneTab.className = 'nav-tab halftone-tab';
    halftoneTab.textContent = 'Halftone';
    halftoneTab.addEventListener('click', activateHalftone);

    // Insert before Line Art if it exists, otherwise append
    const lineartBtn = navTabs.querySelector('.lineart-tab');
    if (lineartBtn) {
      navTabs.insertBefore(halftoneTab, lineartBtn);
    } else {
      navTabs.appendChild(halftoneTab);
    }

    if (isActive) {
      halftoneTab.classList.add('active');
      // Remove active from React tabs so two tabs don't look selected
      navTabs.querySelectorAll('.nav-tab:not(.halftone-tab):not(.lineart-tab)').forEach(t => {
        t.classList.remove('active');
      });
    }
  }

  function ensureBody() {
    if (halftoneBody) return;
    const app = document.querySelector('.app');
    if (!app) return;

    injectStyles();
    halftoneBody = el('div', 'halftone-container');
    halftoneBody.style.display = 'none';
    app.appendChild(halftoneBody);
    buildUI(halftoneBody);
  }

  function activateHalftone() {
    isActive = true;
    ensureBody();

    // Hide React content AND other injected tabs' content
    // Note: 3dengrave.js replaces .app-body-3d class with .engrave3d-container
    document.querySelectorAll('.app-body, .app-body-3d, .engrave3d-container, .step-toolbar, .lineart-container').forEach(e => {
      e.style.setProperty('display', 'none', 'important');
    });

    document.querySelectorAll('.nav-tabs .nav-tab').forEach(t => t.classList.remove('active'));
    if (halftoneTab) halftoneTab.classList.add('active');
    if (halftoneBody) halftoneBody.style.display = 'flex';
  }

  function deactivateHalftone() {
    if (!isActive) return;
    isActive = false;

    if (halftoneBody) halftoneBody.style.display = 'none';

    document.querySelectorAll('.app-body, .app-body-3d, .engrave3d-container, .step-toolbar').forEach(e => {
      e.style.removeProperty('display');
    });
    if (halftoneTab) halftoneTab.classList.remove('active');
  }

  // Capture-phase click intercept for non-halftone tabs
  document.addEventListener('click', (e) => {
    if (!isActive) return;
    if (e.target.closest('.nav-tab:not(.halftone-tab)')) {
      deactivateHalftone();
    }
  }, true);

  /* ═══════════════════════════════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════════════════════════════ */
  const observer = new MutationObserver(() => {
    injectTab();
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
