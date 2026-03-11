/**
 * LAZAR Depth Mapping Tab
 * AI-powered monocular depth estimation running entirely in the browser.
 * Uses Transformers.js (Depth Anything V2) + Three.js for 3D parallax preview.
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     MODEL CONFIGS
     ═══════════════════════════════════════════════════════════════════ */
  const MODELS = {
    small: {
      id: 'onnx-community/depth-anything-v2-small',
      label: 'Small',
      desc: '~25 MB · faster',
    },
    base: {
      id: 'onnx-community/depth-anything-v2-base',
      label: 'Base',
      desc: '~100 MB · better quality',
    },
  };

  /* ═══════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════ */
  const state = {
    modelSize: 'small',
    displacement: 0.2,
    autoSway: true,
    invert: false,

    file: null,
    originalImg: null,
    imageDataUrl: null,

    depthCanvas: null,       // native-res depth canvas
    depthFullCanvas: null,   // upscaled to original dimensions

    pipeline: null,
    pipelineModel: null,     // which model the pipeline was built for
    loadingModel: false,
    generating: false,

    // Three.js objects (set in setup3D)
    three: null,             // THREE module namespace
    scene: null,
    camera: null,
    renderer: null,
    mesh: null,
    animId: null,
    cameraBaseZ: 1.3,

    // 3D interaction
    swayTime: 0,
    isHovering: false,
    targetMX: 0, targetMY: 0,
    currentMX: 0, currentMY: 0,

    resultView: 'depth', // 'depth' | '3d'
  };

  /* ═══════════════════════════════════════════════════════════════════
     CSS
     ═══════════════════════════════════════════════════════════════════ */
  const CSS = `
    .dm-container {
      display: flex; flex-direction: row; flex: 1; min-height: 0;
      background: var(--bg-dark, #0f0f1a);
      color: var(--text-primary, #e0e0e0); overflow: hidden;
    }

    /* ── Left panel ── */
    .dm-panel {
      flex: 0 0 280px; background: var(--bg-secondary, #16213e);
      border-right: 1px solid var(--border, #2a2a4a);
      padding: 16px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 0;
    }
    .dm-panel h3 {
      margin: 0 0 14px; font-size: 14px; font-weight: 600;
      letter-spacing: .5px; text-transform: uppercase;
      color: var(--text-secondary, #a0a0c0);
    }

    /* ── Fields ── */
    .dm-field { margin-bottom: 12px; }
    .dm-field label {
      display: block; font-size: 12px;
      color: var(--text-secondary, #a0a0c0);
      margin-bottom: 4px; font-weight: 500;
    }
    .dm-field-hint {
      font-size: 11px; color: var(--text-secondary, #777); margin-top: 3px;
    }
    .dm-divider {
      border: none; border-top: 1px solid var(--border, #2a2a4a); margin: 14px 0;
    }

    /* ── Option group (model picker) ── */
    .dm-opt-group { display: flex; gap: 4px; flex-wrap: wrap; }
    .dm-opt-btn {
      flex: 1; min-width: 80px; padding: 8px 6px;
      font-size: 12px; font-family: inherit; font-weight: 500; text-align: center;
      background: var(--bg-input, #0f0f23);
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px);
      color: var(--text-secondary, #a0a0c0); cursor: pointer;
      transition: border-color .15s, color .15s, background .15s;
      line-height: 1.3;
    }
    .dm-opt-btn:hover {
      border-color: var(--accent, #e94560); color: var(--text-primary, #e0e0e0);
    }
    .dm-opt-btn.active {
      border-color: var(--accent, #e94560);
      background: rgba(233,69,96,.12); color: var(--accent, #e94560);
    }
    .dm-opt-btn .desc {
      display: block; font-size: 10px; font-weight: 400;
      color: var(--text-secondary, #777); margin-top: 2px;
    }
    .dm-opt-btn.active .desc { color: inherit; opacity: .7; }

    /* ── Slider ── */
    .dm-slider-label {
      display: flex !important; justify-content: space-between; align-items: center;
    }
    .dm-slider-val {
      font-variant-numeric: tabular-nums;
      color: var(--accent, #e94560); font-size: 12px; font-weight: 600;
    }
    .dm-range { width: 100%; margin: 4px 0 2px; }

    /* ── Toggle ── */
    .dm-toggle-label {
      display: flex !important; align-items: center; gap: 8px;
      font-size: 12px; cursor: pointer;
    }

    /* ── Buttons ── */
    .dm-btn {
      display: inline-flex; align-items: center; justify-content: center;
      gap: 6px; padding: 8px 16px; border-radius: var(--radius, 6px);
      font-size: 13px; font-weight: 600; font-family: inherit;
      cursor: pointer; border: 1px solid transparent;
      transition: background .15s, border-color .15s, filter .15s;
      white-space: nowrap;
    }
    .dm-btn:disabled { opacity: .4; cursor: default; }
    .dm-btn-primary { background: var(--accent, #e94560); color: #fff; }
    .dm-btn-primary:hover:not(:disabled) { filter: brightness(1.15); }
    .dm-btn-secondary {
      background: var(--bg-input, #0f0f23);
      border-color: var(--border, #2a2a4a);
      color: var(--text-primary, #e0e0e0);
    }
    .dm-btn-secondary:hover:not(:disabled) { border-color: var(--accent, #e94560); }
    .dm-actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }

    /* ── Progress ── */
    .dm-progress-wrapper { margin: 12px 0; display: none; }
    .dm-progress-wrapper.active { display: block; }
    .dm-progress {
      height: 6px; background: var(--bg-input, #0f0f23);
      border-radius: 3px; overflow: hidden;
    }
    .dm-progress-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--accent, #e94560), #ff8fab);
      border-radius: 3px; transition: width .3s ease;
      width: 0%; box-shadow: 0 0 8px rgba(233,69,96,.3);
    }
    .dm-progress-text {
      font-size: 11px; color: var(--text-secondary, #a0a0c0);
      margin-top: 6px; line-height: 1.5;
    }
    @keyframes dm-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: .5; }
    }
    .dm-progress-text .pulse { animation: dm-pulse 1.5s ease-in-out infinite; }

    /* ── Device badge ── */
    .dm-device-badge {
      display: inline-block; font-size: 10px; font-weight: 600;
      padding: 2px 8px; border-radius: 10px;
      background: rgba(233,69,96,.12); color: var(--accent, #e94560);
      text-transform: uppercase; letter-spacing: .5px;
      margin-left: 4px; vertical-align: middle;
    }

    /* ── Right area ── */
    .dm-main {
      flex: 1; display: flex; flex-direction: column;
      min-width: 0; min-height: 0; overflow: hidden;
    }
    .dm-preview-area {
      flex: 1; display: flex; gap: 0; min-height: 0; overflow: hidden;
    }
    .dm-preview-box {
      flex: 1; display: flex; flex-direction: column;
      overflow: hidden; border-right: 1px solid var(--border, #2a2a4a);
    }
    .dm-preview-box:last-child { border-right: none; }
    .dm-preview-box .preview-header {
      padding: 8px 12px; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: .5px;
      color: var(--text-secondary, #a0a0c0);
      border-bottom: 1px solid var(--border, #2a2a4a);
      display: flex; justify-content: space-between; align-items: center;
      flex-shrink: 0;
    }
    .dm-preview-box .preview-header .dim-info {
      font-weight: 400; font-size: 10px; opacity: .7;
    }
    .dm-preview-box .preview-body {
      flex: 1; position: relative; overflow: hidden;
      background: #080812; cursor: grab;
    }
    .dm-preview-box .preview-body.panning { cursor: grabbing; }
    .dm-preview-box .pz-wrap {
      position: absolute; top: 0; left: 0;
      transform-origin: 0 0; will-change: transform;
    }
    .dm-preview-box .pz-wrap canvas,
    .dm-preview-box .pz-wrap img { display: block; image-rendering: auto; }
    .dm-preview-box .pz-hint {
      position: absolute; bottom: 6px; right: 8px;
      font-size: 10px; color: rgba(255,255,255,.3);
      pointer-events: none; user-select: none;
    }
    .dm-empty-preview {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%,-50%);
      color: var(--text-secondary, #777); font-size: 13px;
      text-align: center; opacity: .6; pointer-events: none;
      white-space: nowrap; line-height: 1.6;
    }
    .dm-preview-box .orig-drop-active {
      background: rgba(233,69,96,.06);
      outline: 2px dashed var(--accent, #e94560); outline-offset: -4px;
    }
    .dm-preview-box .preview-header .replace-btn {
      display: none; padding: 2px 8px; font-size: 10px; font-family: inherit;
      background: transparent; border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px);
      color: var(--text-secondary, #a0a0c0); cursor: pointer;
      transition: border-color .15s, color .15s;
    }
    .dm-preview-box .preview-header .replace-btn:hover {
      border-color: var(--accent, #e94560); color: var(--text-primary, #e0e0e0);
    }

    /* ── Result view toggle ── */
    .dm-view-toggle {
      display: inline-flex; gap: 0;
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px); overflow: hidden;
      margin-left: 8px;
    }
    .dm-view-toggle button {
      padding: 2px 9px; font-size: 10px; font-family: inherit; font-weight: 600;
      background: transparent; border: none;
      color: var(--text-secondary, #a0a0c0);
      cursor: pointer; transition: background .15s, color .15s;
      text-transform: uppercase; letter-spacing: .3px;
    }
    .dm-view-toggle button.active {
      background: var(--accent, #e94560); color: #fff;
    }
    .dm-view-toggle button:disabled {
      opacity: .35; cursor: default;
    }

    /* ── 3D canvas ── */
    .dm-3d-canvas {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      display: none;
    }
    .dm-3d-canvas.visible { display: block; }
  `;

  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    const s = document.createElement('style');
    s.id = 'dm-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
    stylesInjected = true;
  }

  /* ═══════════════════════════════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════════════════════════════ */
  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  const pzInstances = {};

  /* ═══════════════════════════════════════════════════════════════════
     LIBRARY LOADERS
     ═══════════════════════════════════════════════════════════════════ */
  let threePromise = null;

  function preloadThreeJS() {
    if (!threePromise) {
      threePromise = import('https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js')
        .then(mod => { state.three = mod; return mod; })
        .catch(err => {
          console.warn('Three.js failed to load:', err);
          state.three = null;
          return null;
        });
    }
    return threePromise;
  }

  async function getDevice() {
    try {
      if (navigator.gpu) {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) return 'webgpu';
      }
    } catch { /* ignore */ }
    return 'wasm';
  }

  async function getOrCreatePipeline(progressCb) {
    const modelKey = state.modelSize;

    if (state.pipeline && state.pipelineModel === modelKey) {
      return state.pipeline;
    }

    // Dispose previous pipeline
    if (state.pipeline) {
      try { await state.pipeline.dispose(); } catch { /* ignore */ }
      state.pipeline = null;
    }

    const device = await getDevice();
    updateDeviceBadge(device);

    const tfModule = await import(
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
    );

    const pipe = await tfModule.pipeline('depth-estimation', MODELS[modelKey].id, {
      device,
      dtype: device === 'webgpu' ? 'fp32' : 'fp32',
      progress_callback: progressCb || (() => {}),
    });

    state.pipeline = pipe;
    state.pipelineModel = modelKey;
    return pipe;
  }

  /* ═══════════════════════════════════════════════════════════════════
     BUILD UI
     ═══════════════════════════════════════════════════════════════════ */
  function buildUI(container) {
    container.innerHTML = '';

    /* ── Left panel ── */
    const panel = el('div', 'dm-panel');
    panel.innerHTML = `
      <h3>Depth Mapping</h3>

      <!-- Model picker -->
      <div class="dm-field">
        <label>
          AI Model
          <span class="dm-device-badge" id="dm-device-badge" style="display:none"></span>
        </label>
        <div class="dm-opt-group" id="dm-model-group">
          <button class="dm-opt-btn ${state.modelSize==='small'?'active':''}" data-val="small">
            Small<span class="desc">~25 MB · faster</span>
          </button>
          <button class="dm-opt-btn ${state.modelSize==='base'?'active':''}" data-val="base">
            Base<span class="desc">~100 MB · better</span>
          </button>
        </div>
        <div class="dm-field-hint">Model downloads on first use, then cached</div>
      </div>

      <hr class="dm-divider">

      <!-- 3D Preview settings -->
      <div class="dm-field">
        <label class="dm-slider-label">
          3D Displacement
          <span class="dm-slider-val" id="dm-disp-val">${state.displacement.toFixed(2)}</span>
        </label>
        <input type="range" id="dm-displacement" min="0" max="0.5" step="0.01"
          value="${state.displacement}" class="dm-range" />
        <div class="dm-field-hint">Depth extrusion amount for 3D preview</div>
      </div>

      <div class="dm-field">
        <label class="dm-toggle-label">
          <input type="checkbox" id="dm-auto-sway" ${state.autoSway?'checked':''} />
          Auto-Sway
        </label>
        <div class="dm-field-hint">Gentle idle animation in 3D preview</div>
      </div>

      <div class="dm-field">
        <label class="dm-toggle-label">
          <input type="checkbox" id="dm-invert" ${state.invert?'checked':''} />
          Invert Depth
        </label>
        <div class="dm-field-hint">Swap near/far (white↔black)</div>
      </div>

      <hr class="dm-divider">

      <!-- Actions -->
      <div class="dm-actions">
        <button class="dm-btn dm-btn-primary" id="dm-generate-btn" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
          </svg>
          Generate
        </button>
        <button class="dm-btn dm-btn-secondary" id="dm-download-btn" style="display:none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download PNG
        </button>
      </div>

      <!-- Progress -->
      <div class="dm-progress-wrapper" id="dm-progress-wrapper">
        <div class="dm-progress"><div class="dm-progress-bar" id="dm-progress-bar"></div></div>
        <div class="dm-progress-text" id="dm-progress-text"></div>
      </div>
    `;
    container.appendChild(panel);

    /* ── Right: preview area ── */
    const main = el('div', 'dm-main');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp';
    fileInput.style.display = 'none';
    fileInput.id = 'dm-file-input';
    main.appendChild(fileInput);

    const previewArea = el('div', 'dm-preview-area');

    /* ── Original box ── */
    const origBox = el('div', 'dm-preview-box');
    origBox.innerHTML = `
      <div class="preview-header">
        <span>Original</span>
        <span style="flex:1"></span>
        <span class="dim-info" id="dm-orig-info"></span>
        <button class="replace-btn" id="dm-replace-btn">Replace</button>
      </div>
      <div class="preview-body" id="dm-orig-body">
        <div class="pz-wrap" id="dm-orig-wrap"></div>
        <div class="dm-empty-preview" id="dm-orig-empty">Click or drop an image<br>to begin</div>
        <span class="pz-hint">Scroll to zoom · Drag to pan · Dbl-click to reset</span>
      </div>
    `;

    /* ── Result box ── */
    const resultBox = el('div', 'dm-preview-box');
    resultBox.innerHTML = `
      <div class="preview-header">
        <span>Result</span>
        <div class="dm-view-toggle" id="dm-view-toggle">
          <button class="active" data-view="depth">Depth</button>
          <button data-view="3d" id="dm-3d-toggle-btn">3D</button>
        </div>
        <span style="flex:1"></span>
        <span class="dim-info" id="dm-result-info"></span>
      </div>
      <div class="preview-body" id="dm-result-body">
        <div class="pz-wrap" id="dm-result-wrap"></div>
        <canvas class="dm-3d-canvas" id="dm-3d-canvas"></canvas>
        <div class="dm-empty-preview" id="dm-result-empty">Depth map will appear here</div>
        <span class="pz-hint" id="dm-result-hint">Scroll to zoom · Drag to pan · Dbl-click to reset</span>
      </div>
    `;

    previewArea.appendChild(origBox);
    previewArea.appendChild(resultBox);
    main.appendChild(previewArea);
    container.appendChild(main);

    wireEvents();
  }

  /* ═══════════════════════════════════════════════════════════════════
     PAN / ZOOM
     ═══════════════════════════════════════════════════════════════════ */
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
      } else { cw = child.clientWidth || bw; ch = child.clientHeight || bh; }
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
      scale = ns; apply();
    }, { passive: false });

    bodyEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      bodyEl.classList.add('panning');
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      tx += e.clientX - lastX; ty += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY; apply();
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; bodyEl.classList.remove('panning');
    });
    bodyEl.addEventListener('dblclick', fit);

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
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; apply();
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

  /* ═══════════════════════════════════════════════════════════════════
     WIRE EVENTS
     ═══════════════════════════════════════════════════════════════════ */
  function wireEvents() {
    const fileInput   = document.getElementById('dm-file-input');
    const generateBtn = document.getElementById('dm-generate-btn');
    const downloadBtn = document.getElementById('dm-download-btn');
    const origBody    = document.getElementById('dm-orig-body');

    /* ── Upload ── */
    origBody.addEventListener('click', () => {
      if (state.originalImg) return;
      fileInput.click();
    });
    origBody.style.cursor = 'pointer';

    document.getElementById('dm-replace-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) handleFile(fileInput.files[0]);
    });

    origBody.addEventListener('dragover', (e) => {
      e.preventDefault(); origBody.classList.add('orig-drop-active');
    });
    origBody.addEventListener('dragleave', () => origBody.classList.remove('orig-drop-active'));
    origBody.addEventListener('drop', (e) => {
      e.preventDefault(); origBody.classList.remove('orig-drop-active');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    /* ── Generate / Download ── */
    generateBtn.addEventListener('click', () => {
      if (!state.originalImg || state.generating) return;
      generateDepthMap();
    });
    downloadBtn.addEventListener('click', downloadDepthMap);

    /* ── Pan/zoom ── */
    pzInstances.orig   = setupPanZoom(origBody, document.getElementById('dm-orig-wrap'));
    pzInstances.result = setupPanZoom(
      document.getElementById('dm-result-body'),
      document.getElementById('dm-result-wrap'));

    /* ── Model picker ── */
    document.querySelectorAll('#dm-model-group .dm-opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#dm-model-group .dm-opt-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.modelSize = btn.dataset.val;
      });
    });

    /* ── Displacement slider ── */
    const dispSlider = document.getElementById('dm-displacement');
    dispSlider.addEventListener('input', () => {
      const v = parseFloat(dispSlider.value);
      state.displacement = v;
      document.getElementById('dm-disp-val').textContent = v.toFixed(2);
      update3DDisplacement();
    });

    /* ── Toggles ── */
    document.getElementById('dm-auto-sway').addEventListener('change', (e) => {
      state.autoSway = e.target.checked;
    });
    document.getElementById('dm-invert').addEventListener('change', (e) => {
      state.invert = e.target.checked;
      if (state.depthCanvas) {
        // Re-render depth map with new invert setting
        regenerateFromCachedDepth();
      }
    });

    /* ── View toggle (Depth / 3D) ── */
    document.querySelectorAll('#dm-view-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        document.querySelectorAll('#dm-view-toggle button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        setResultView(btn.dataset.view);
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     FILE HANDLING
     ═══════════════════════════════════════════════════════════════════ */
  function handleFile(file) {
    if (!file.type.match(/image\/(jpeg|png|webp)/)) return;
    state.file = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      state.imageDataUrl = dataUrl;

      const img = new Image();
      img.onload = () => {
        state.originalImg = img;
        state.depthCanvas = null;
        state.depthFullCanvas = null;

        // Show original
        const origWrap = document.getElementById('dm-orig-wrap');
        origWrap.innerHTML = '';
        const oc = document.createElement('canvas');
        oc.width = img.naturalWidth; oc.height = img.naturalHeight;
        oc.getContext('2d').drawImage(img, 0, 0);
        origWrap.appendChild(oc);
        document.getElementById('dm-orig-empty').style.display = 'none';
        document.getElementById('dm-orig-info').textContent =
          `${img.naturalWidth} × ${img.naturalHeight} px`;
        requestAnimationFrame(() => pzInstances.orig && pzInstances.orig.fit());

        document.getElementById('dm-generate-btn').disabled = false;
        document.getElementById('dm-result-wrap').innerHTML = '';
        document.getElementById('dm-result-empty').style.display = '';
        document.getElementById('dm-result-info').textContent = '';
        document.getElementById('dm-download-btn').style.display = 'none';

        document.getElementById('dm-orig-body').style.cursor = '';
        document.getElementById('dm-replace-btn').style.display = 'inline-block';

        // Dispose previous 3D scene
        dispose3D();

        // Auto-generate
        generateDepthMap();
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  /* ═══════════════════════════════════════════════════════════════════
     PROGRESS HELPERS
     ═══════════════════════════════════════════════════════════════════ */
  function showProgress(percent, text) {
    const wrapper = document.getElementById('dm-progress-wrapper');
    wrapper.classList.add('active');
    document.getElementById('dm-progress-bar').style.width = percent + '%';
    document.getElementById('dm-progress-text').innerHTML = text;
  }
  function hideProgress() {
    const wrapper = document.getElementById('dm-progress-wrapper');
    wrapper.classList.remove('active');
  }
  function updateDeviceBadge(device) {
    const badge = document.getElementById('dm-device-badge');
    if (badge) {
      badge.textContent = device.toUpperCase();
      badge.style.display = 'inline-block';
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     DEPTH MAP GENERATION
     ═══════════════════════════════════════════════════════════════════ */

  // Cache raw depth for re-invert without re-running inference
  let cachedRawDepth = null;

  async function generateDepthMap() {
    if (state.generating || !state.originalImg) return;
    state.generating = true;

    const genBtn = document.getElementById('dm-generate-btn');
    genBtn.disabled = true;

    try {
      // ── 1. Load pipeline (shows model download progress) ──
      showProgress(0, '<span class="pulse">Loading AI model…</span>');

      let lastProgress = 0;
      const pipe = await getOrCreatePipeline((info) => {
        if (info.status === 'progress' && info.progress !== undefined) {
          lastProgress = Math.round(info.progress);
          showProgress(lastProgress,
            `Downloading model… <strong>${lastProgress}%</strong>`);
        } else if (info.status === 'initiate') {
          showProgress(lastProgress, `<span class="pulse">Initializing ${info.file || ''}…</span>`);
        } else if (info.status === 'done') {
          // individual file done
        } else if (info.status === 'ready') {
          showProgress(100, 'Model ready');
        }
      });

      // ── 2. Run inference ──
      showProgress(100, '<span class="pulse">Generating depth map…</span>');

      const result = await pipe(state.imageDataUrl);

      // ── 3. Extract depth data ──
      const depthImage = result.depth;    // RawImage
      cachedRawDepth = depthImage;
      renderDepthFromRaw(depthImage);

    } catch (err) {
      console.error('Depth map generation failed:', err);
      showProgress(0,
        `<span style="color:#ef5350">Error: ${err.message || err}</span>`);
      state.generating = false;
      genBtn.disabled = false;
      return;
    }

    state.generating = false;
    genBtn.disabled = false;
    hideProgress();
  }

  function regenerateFromCachedDepth() {
    if (!cachedRawDepth) return;
    renderDepthFromRaw(cachedRawDepth);
  }

  function renderDepthFromRaw(depthImage) {
    const w = depthImage.width;
    const h = depthImage.height;
    const channels = depthImage.channels;
    const data = depthImage.data;

    // Render to native-res canvas
    const nativeCanvas = document.createElement('canvas');
    nativeCanvas.width = w;
    nativeCanvas.height = h;
    const ctx = nativeCanvas.getContext('2d');
    const imgData = ctx.createImageData(w, h);

    for (let i = 0; i < w * h; i++) {
      let val;
      if (channels === 1) val = data[i];
      else val = data[i * channels];
      if (state.invert) val = 255 - val;
      imgData.data[i * 4]     = val;
      imgData.data[i * 4 + 1] = val;
      imgData.data[i * 4 + 2] = val;
      imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    state.depthCanvas = nativeCanvas;

    // Upscale to original dimensions for high-res download
    const origW = state.originalImg.naturalWidth;
    const origH = state.originalImg.naturalHeight;
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = origW;
    fullCanvas.height = origH;
    const fctx = fullCanvas.getContext('2d');
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(nativeCanvas, 0, 0, origW, origH);
    state.depthFullCanvas = fullCanvas;

    // Show in result preview
    showDepthResult();

    // Setup or update 3D preview
    setup3DPreview();
  }

  function showDepthResult() {
    const wrapEl = document.getElementById('dm-result-wrap');
    const isEmpty = !wrapEl.firstElementChild;

    // Show depth map as image
    const dataUrl = state.depthFullCanvas.toDataURL('image/png');
    const img = new Image();
    img.onload = () => {
      wrapEl.innerHTML = '';
      wrapEl.appendChild(img);
      if (isEmpty) {
        requestAnimationFrame(() => pzInstances.result && pzInstances.result.fit());
      }
    };
    img.src = dataUrl;

    document.getElementById('dm-result-empty').style.display = 'none';
    document.getElementById('dm-result-info').textContent =
      `${state.depthFullCanvas.width} × ${state.depthFullCanvas.height} px`;
    document.getElementById('dm-download-btn').style.display = '';

    // Ensure we're in depth view
    setResultView('depth');
  }

  /* ═══════════════════════════════════════════════════════════════════
     RESULT VIEW TOGGLE
     ═══════════════════════════════════════════════════════════════════ */
  function setResultView(view) {
    state.resultView = view;

    const wrap    = document.getElementById('dm-result-wrap');
    const canvas  = document.getElementById('dm-3d-canvas');
    const hint    = document.getElementById('dm-result-hint');

    if (view === '3d') {
      wrap.style.display = 'none';
      canvas.classList.add('visible');
      if (hint) hint.style.display = 'none';
      start3DAnimation();
    } else {
      wrap.style.display = '';
      canvas.classList.remove('visible');
      if (hint) hint.style.display = '';
      stop3DAnimation();
    }

    // Update toggle buttons
    document.querySelectorAll('#dm-view-toggle button').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     3D PARALLAX PREVIEW (Three.js)
     ═══════════════════════════════════════════════════════════════════ */

  const VERT_SHADER = `
    uniform sampler2D uDepth;
    uniform float uDisplacement;
    varying vec2 vUv;

    void main() {
      vUv = uv;
      vec3 pos = position;
      float d = texture2D(uDepth, uv).r;
      pos.z += d * uDisplacement;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  const FRAG_SHADER = `
    uniform sampler2D uImage;
    varying vec2 vUv;

    void main() {
      gl_FragColor = texture2D(uImage, vUv);
    }
  `;

  async function setup3DPreview() {
    if (!state.depthCanvas || !state.originalImg) return;

    // Wait for Three.js
    const THREE = state.three || await preloadThreeJS();
    if (!THREE) {
      const btn = document.getElementById('dm-3d-toggle-btn');
      if (btn) { btn.disabled = true; btn.title = 'Three.js failed to load'; }
      return;
    }

    const canvas3d = document.getElementById('dm-3d-canvas');
    const container = document.getElementById('dm-result-body');

    // Dispose previous
    dispose3D();

    // ── Scene ──
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080812);

    // ── Camera ──
    const cw = container.clientWidth || 400;
    const ch = container.clientHeight || 400;
    const camera = new THREE.PerspectiveCamera(50, cw / ch, 0.01, 100);

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true });
    renderer.setSize(cw, ch);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // ── Plane ──
    const imgW = state.originalImg.naturalWidth;
    const imgH = state.originalImg.naturalHeight;
    const aspect = imgH / imgW;
    const planeW = 1;
    const planeH = planeW * aspect;
    const segsX = 256;
    const segsY = Math.round(segsX * aspect);
    const geo = new THREE.PlaneGeometry(planeW, planeH, segsX, segsY);

    // ── Textures ──
    // Image texture from original
    const imgCanvas = document.createElement('canvas');
    imgCanvas.width = imgW; imgCanvas.height = imgH;
    imgCanvas.getContext('2d').drawImage(state.originalImg, 0, 0);
    const imageTex = new THREE.CanvasTexture(imgCanvas);
    imageTex.minFilter = THREE.LinearFilter;
    imageTex.magFilter = THREE.LinearFilter;

    // Depth texture
    const depthTex = new THREE.CanvasTexture(state.depthCanvas);
    depthTex.minFilter = THREE.LinearFilter;
    depthTex.magFilter = THREE.LinearFilter;

    // ── Shader material ──
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uImage: { value: imageTex },
        uDepth: { value: depthTex },
        uDisplacement: { value: state.displacement },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    // ── Position camera to fit plane ──
    const vFov = camera.fov * Math.PI / 180;
    const containerAspect = cw / ch;
    let camZ;
    if (containerAspect > planeW / planeH) {
      camZ = (planeH / 2) / Math.tan(vFov / 2);
    } else {
      camZ = (planeW / 2) / Math.tan(vFov / 2) / containerAspect;
    }
    camZ *= 1.15; // padding
    camera.position.z = camZ;
    camera.lookAt(0, 0, 0);

    state.scene = scene;
    state.camera = camera;
    state.renderer = renderer;
    state.mesh = mesh;
    state.cameraBaseZ = camZ;
    state.swayTime = 0;
    state.currentMX = 0;
    state.currentMY = 0;

    // ── Mouse / touch interaction ──
    canvas3d.addEventListener('mousemove', on3DMouseMove);
    canvas3d.addEventListener('mouseenter', () => { state.isHovering = true; });
    canvas3d.addEventListener('mouseleave', () => { state.isHovering = false; });
    canvas3d.addEventListener('touchmove', on3DTouchMove, { passive: false });
    canvas3d.addEventListener('touchend', () => { state.isHovering = false; });

    // ── Resize observer ──
    if (!state._resizeObs) {
      state._resizeObs = new ResizeObserver(() => resize3D());
      state._resizeObs.observe(container);
    }

    // Enable 3D toggle
    const btn3d = document.getElementById('dm-3d-toggle-btn');
    if (btn3d) { btn3d.disabled = false; btn3d.title = ''; }

    // Auto-switch to 3D view
    setResultView('3d');
  }

  function on3DMouseMove(e) {
    const rect = e.target.getBoundingClientRect();
    state.isHovering = true;
    state.targetMX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    state.targetMY = -((e.clientY - rect.top) / rect.height - 0.5) * 2;
  }

  function on3DTouchMove(e) {
    e.preventDefault();
    if (e.touches.length !== 1) return;
    const rect = e.target.getBoundingClientRect();
    state.isHovering = true;
    state.targetMX = ((e.touches[0].clientX - rect.left) / rect.width - 0.5) * 2;
    state.targetMY = -((e.touches[0].clientY - rect.top) / rect.height - 0.5) * 2;
  }

  function resize3D() {
    if (!state.renderer || !state.camera) return;
    const container = document.getElementById('dm-result-body');
    if (!container) return;
    const w = container.clientWidth, h = container.clientHeight;
    if (w < 1 || h < 1) return;
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h);
  }

  function update3DCamera() {
    if (!state.camera) return;
    const maxAngle = 0.2;
    const bz = state.cameraBaseZ;
    state.camera.position.x = state.currentMX * maxAngle * bz * 0.5;
    state.camera.position.y = state.currentMY * maxAngle * bz * 0.5;
    state.camera.position.z = bz;
    state.camera.lookAt(0, 0, 0);
  }

  function update3DDisplacement() {
    if (!state.mesh) return;
    state.mesh.material.uniforms.uDisplacement.value = state.displacement;
  }

  function start3DAnimation() {
    if (state.animId) return;
    function loop() {
      state.animId = requestAnimationFrame(loop);

      state.swayTime += 0.008;

      if (!state.isHovering && state.autoSway) {
        state.targetMX = Math.sin(state.swayTime) * 0.4;
        state.targetMY = Math.cos(state.swayTime * 0.7) * 0.25;
      } else if (!state.isHovering) {
        state.targetMX *= 0.95;
        state.targetMY *= 0.95;
      }

      // Smooth lerp
      state.currentMX += (state.targetMX - state.currentMX) * 0.06;
      state.currentMY += (state.targetMY - state.currentMY) * 0.06;

      update3DCamera();

      if (state.renderer && state.scene && state.camera) {
        state.renderer.render(state.scene, state.camera);
      }
    }
    loop();
  }

  function stop3DAnimation() {
    if (state.animId) {
      cancelAnimationFrame(state.animId);
      state.animId = null;
    }
  }

  function dispose3D() {
    stop3DAnimation();
    if (state.mesh) {
      state.mesh.geometry.dispose();
      if (state.mesh.material.uniforms) {
        if (state.mesh.material.uniforms.uImage.value)
          state.mesh.material.uniforms.uImage.value.dispose();
        if (state.mesh.material.uniforms.uDepth.value)
          state.mesh.material.uniforms.uDepth.value.dispose();
      }
      state.mesh.material.dispose();
      state.mesh = null;
    }
    if (state.renderer) {
      state.renderer.dispose();
      state.renderer = null;
    }
    state.scene = null;
    state.camera = null;
  }

  /* ═══════════════════════════════════════════════════════════════════
     DOWNLOAD
     ═══════════════════════════════════════════════════════════════════ */
  function downloadDepthMap() {
    if (!state.depthFullCanvas) return;
    const stem = state.file?.name ? state.file.name.replace(/\.[^.]+$/, '') : 'image';
    const filename = `${stem}_depthmap_${state.modelSize}${state.invert ? '_inv' : ''}.png`;

    state.depthFullCanvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  }

  /* ═══════════════════════════════════════════════════════════════════
     TAB INJECTION
     ═══════════════════════════════════════════════════════════════════ */
  let dmTab = null;
  let dmBody = null;
  let isActive = false;

  function injectTab() {
    const navTabs = document.querySelector('.nav-tabs');
    if (!navTabs || navTabs.querySelector('.depthmap-tab')) return;

    dmTab = document.createElement('button');
    dmTab.className = 'nav-tab depthmap-tab';
    dmTab.textContent = 'Depth Map';
    dmTab.addEventListener('click', activateDepthMap);
    navTabs.appendChild(dmTab);

    if (isActive) {
      dmTab.classList.add('active');
      navTabs.querySelectorAll('.nav-tab:not(.depthmap-tab)').forEach(t => {
        t.classList.remove('active');
      });
    }
  }

  function ensureBody() {
    if (dmBody) return;
    const app = document.querySelector('.app');
    if (!app) return;

    injectStyles();
    dmBody = el('div', 'dm-container');
    dmBody.style.display = 'none';
    app.appendChild(dmBody);
    buildUI(dmBody);
  }

  function activateDepthMap() {
    isActive = true;
    ensureBody();

    // Preload Three.js in background
    preloadThreeJS();

    // Hide React content + other injected tab content
    document.querySelectorAll(
      '.app-body, .app-body-3d, .engrave3d-container, .step-toolbar, ' +
      '.halftone-container, .lineart-container, .fx-container'
    ).forEach(e => {
      e.style.setProperty('display', 'none', 'important');
    });

    document.querySelectorAll('.nav-tabs .nav-tab').forEach(t => t.classList.remove('active'));
    if (dmTab) dmTab.classList.add('active');
    if (dmBody) dmBody.style.display = 'flex';

    // Resume 3D animation if in 3D view
    if (state.resultView === '3d' && state.scene) {
      start3DAnimation();
    }
  }

  function deactivateDepthMap() {
    if (!isActive) return;
    isActive = false;

    if (dmBody) dmBody.style.display = 'none';

    document.querySelectorAll('.app-body, .app-body-3d, .engrave3d-container, .step-toolbar').forEach(e => {
      e.style.removeProperty('display');
    });
    if (dmTab) dmTab.classList.remove('active');

    // Pause 3D animation when tab is not visible
    stop3DAnimation();
  }

  // Capture-phase click intercept for non-depthmap tabs
  document.addEventListener('click', (e) => {
    if (!isActive) return;
    if (e.target.closest('.nav-tab:not(.depthmap-tab)')) {
      deactivateDepthMap();
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
