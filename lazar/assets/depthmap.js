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
    marigold: {
      ids: [
        'Xenova/marigold-depth-lcm-v1-onnx',
        'onnx-community/marigold-depth-lcm-v1-int8',
      ],
      label: 'Marigold',
      desc: 'Diffusion depth · max detail (~420 MB)',
    },
    zoedepth: {
      ids: [
        'Xenova/zoedepth-m12-nk-nyu-kitti-onnx',
        'onnx-community/zoedepth-m12-nk-nyu-kitti-onnx',
        'Xenova/zoedepth-m12-nk-nyu-kitti-int8',
      ],
      label: 'ZoeDepth',
      desc: 'Strong edges/structure (~190 MB)',
    },
    da2large: {
      ids: [
        'onnx-community/depth-anything-v2-large',
        'Xenova/depth-anything-large-onnx',
      ],
      label: 'DA2 Large (fallback)',
      desc: 'Fast open fallback (~350 MB)',
    },
  };

  const MODEL_ORDER = ['marigold', 'zoedepth'];

  /* ═══════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════ */
  const state = {
    modelSize: 'marigold',
    hfToken: '',
    tileGrid: 2,
    guidedFilter: true,
    detailBoost: 0.35,
    displacement: 0.12,
    autoSway: true,
    invert: false,

    // Orbit state
    orbitTheta: 0,
    orbitPhi: Math.PI / 2,
    orbitDist: 1,
    orbitTargetTheta: 0,
    orbitTargetPhi: Math.PI / 2,
    isDragging3D: false,
    lastDragX: 0,
    lastDragY: 0,

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

    // Portrait mode
    portraitMode: 'auto',  // 'auto' | 'on' | 'off'
    portraitDetected: false,
    faceBox: null,         // { x, y, w, h } in original image pixels
    faceLandmarks: null,   // 478×{x,y,z} normalized landmarks
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
      display: none; cursor: grab;
    }
    .dm-3d-canvas.visible { display: block; }
    .dm-3d-canvas:active { cursor: grabbing; }

    /* ── Portrait badge ── */
    .dm-portrait-badge {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 10px; font-weight: 600;
      padding: 2px 8px; border-radius: 10px;
      background: rgba(100,180,255,.12); color: #60b8ff;
      text-transform: uppercase; letter-spacing: .5px;
      margin-left: 4px; vertical-align: middle;
      opacity: 0; transition: opacity .3s;
    }
    .dm-portrait-badge.visible { opacity: 1; }

    /* ── Portrait mode toggle ── */
    .dm-portrait-row {
      display: flex; align-items: center; gap: 6px;
      flex-wrap: wrap;
    }
    .dm-portrait-row .dm-opt-btn {
      flex: none; min-width: 0; padding: 4px 10px; font-size: 11px;
    }

    /* ── Fallback launcher ── */
    .dm-launcher {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 10001;
      padding: 10px 14px;
      border: 1px solid rgba(233,69,96,.45);
      border-radius: 999px;
      background: rgba(15,15,35,.92);
      color: #fff;
      font: 600 12px/1 Inter, system-ui, sans-serif;
      letter-spacing: .2px;
      box-shadow: 0 10px 28px rgba(0,0,0,.35);
      cursor: pointer;
      transition: transform .15s ease, background .15s ease, border-color .15s ease;
      backdrop-filter: blur(8px);
    }
    .dm-launcher:hover {
      transform: translateY(-1px);
      background: rgba(233,69,96,.95);
      border-color: rgba(233,69,96,.95);
    }
    .dm-launcher.hidden { display: none; }
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
    const preferred = state.modelSize;
    const fallback = preferred === 'marigold' ? 'zoedepth' : 'marigold';
    const lastResort = 'da2large';
    const tried = new Set();

    if (state.pipeline && state.pipelineModel === preferred) return state.pipeline;

    // Dispose previous pipeline
    if (state.pipeline) {
      try { await state.pipeline.dispose(); } catch { /* ignore */ }
      state.pipeline = null;
    }

    const device = await getDevice();
    updateDeviceBadge(device);
    const dtype = device === 'webgpu' ? 'fp16' : 'fp32';

    const tfModule = await import(
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
    );

    async function tryLoad(key) {
      const candidates = MODELS[key].ids || [MODELS[key].id];
      for (const repo of candidates) {
        try {
          const pipe = await tfModule.pipeline('depth-estimation', repo, {
            device,
            dtype,
            token: state.hfToken || undefined,
            progress_callback: progressCb || (() => {}),
          });
          state.pipeline = pipe;
          state.pipelineModel = key;
          state.modelSize = key;
          const btn = document.querySelector(`#dm-model-group .dm-opt-btn[data-val="${key}"]`);
          if (btn) {
            document.querySelectorAll('#dm-model-group .dm-opt-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
          }
          return pipe;
        } catch (err) {
          console.warn(`Repo ${repo} failed, trying next`, err);
          showProgress(5, `Model ${MODELS[key].label}: trying alternate mirror/quant...`);
        }
      }
      throw new Error(`All repos failed for model ${key}`);
    }

    const order = [preferred, fallback, lastResort];
    for (const key of order) {
      if (tried.has(key)) continue;
      try {
        return await tryLoad(key);
      } catch (err) {
        console.warn(`Model ${key} failed, trying fallback`, err);
        tried.add(key);
        showProgress(5, `Model ${MODELS[key].label} unavailable — trying fallback...`);
      }
    }
    throw new Error('All depth models failed to load');
  }

  /* ═══════════════════════════════════════════════════════════════════
     BUILD UI
     ═══════════════════════════════════════════════════════════════════ */
  function buildUI(container) {
    container.innerHTML = '';

    const modelButtons = MODEL_ORDER.map(key => {
      const m = MODELS[key];
      return `
          <button class="dm-opt-btn ${state.modelSize===key?'active':''}" data-val="${key}">
            ${m.label}<span class="desc">${m.desc}</span>
          </button>`;
    }).join('');

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
          ${modelButtons}
        </div>
        <div class="dm-field-hint">Model downloads on first use, then cached</div>
      </div>

      <div class="dm-field">
        <label class="dm-slider-label">
          HF Access Token (optional)
        </label>
        <input type="password" id="dm-hf-token" placeholder="hf_..." style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border, #2a2a4a);background:var(--bg-input, #0f0f23);color:var(--text-primary, #e0e0e0);font-size:12px;" />
        <div class="dm-field-hint">Only needed if your region requires a token for model downloads. Stored in memory only.</div>
      </div>

      <hr class="dm-divider">

      <!-- Quality settings -->
      <div class="dm-field">
        <label>Detail Level</label>
        <div class="dm-opt-group" id="dm-tile-group">
          <button class="dm-opt-btn ${state.tileGrid===1?'active':''}" data-val="1">
            Standard<span class="desc">2 passes · fast</span>
          </button>
          <button class="dm-opt-btn ${state.tileGrid===2?'active':''}" data-val="2">
            High<span class="desc">10 passes · detailed</span>
          </button>
          <button class="dm-opt-btn ${state.tileGrid===3?'active':''}" data-val="3">
            Ultra<span class="desc">20 passes · maximum</span>
          </button>
        </div>
        <div class="dm-field-hint">Uses tiling + flip augmentation + affine alignment for accuracy</div>
      </div>

      <div class="dm-field">
        <label class="dm-toggle-label">
          <input type="checkbox" id="dm-guided-filter" ${state.guidedFilter?'checked':''} />
          Edge Refinement
        </label>
        <div class="dm-field-hint">Guided filter aligns depth edges to real object boundaries</div>
      </div>

      <div class="dm-field">
        <label class="dm-slider-label">
          Detail
          <span class="dm-slider-val" id="dm-detail-val">${(state.detailBoost * 100).toFixed(0)}%</span>
        </label>
        <input type="range" id="dm-detail-boost" min="0" max="1" step="0.05"
          value="${state.detailBoost}" class="dm-range" />
        <div class="dm-field-hint">Boosts structural depth detail and edge separation (without injecting free texture noise)</div>
      </div>

      <div class="dm-field">
        <label>
          Portrait Mode
          <span class="dm-portrait-badge" id="dm-portrait-badge">Face Detected</span>
        </label>
        <div class="dm-portrait-row" id="dm-portrait-group">
          <button class="dm-opt-btn ${state.portraitMode==='auto'?'active':''}" data-val="auto">Auto</button>
          <button class="dm-opt-btn ${state.portraitMode==='on'?'active':''}" data-val="on">Always On</button>
          <button class="dm-opt-btn ${state.portraitMode==='off'?'active':''}" data-val="off">Off</button>
        </div>
        <div class="dm-field-hint">Auto-enhances face geometry when a large face is detected. Uses face crop re-inference + landmark priors for nose, eyes, and lips.</div>
      </div>

      <div class="dm-field">
        <label class="dm-toggle-label">
          <input type="checkbox" id="dm-invert" ${state.invert?'checked':''} />
          Invert Depth
        </label>
        <div class="dm-field-hint">Swap near/far (white↔black)</div>
      </div>

      <hr class="dm-divider">

      <!-- 3D Preview settings -->
      <div class="dm-field">
        <label class="dm-slider-label">
          3D Displacement
          <span class="dm-slider-val" id="dm-disp-val">${state.displacement.toFixed(2)}</span>
        </label>
        <input type="range" id="dm-displacement" min="0" max="0.3" step="0.005"
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
    const hfTokenInput = document.getElementById('dm-hf-token');

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

    /* ── Detail level picker ── */
    document.querySelectorAll('#dm-tile-group .dm-opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#dm-tile-group .dm-opt-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.tileGrid = parseInt(btn.dataset.val, 10);
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
    document.getElementById('dm-guided-filter').addEventListener('change', (e) => {
      state.guidedFilter = e.target.checked;
      if (cachedDepthFloat) processAndDisplayDepth();
    });
    const detailSlider = document.getElementById('dm-detail-boost');
    detailSlider.addEventListener('input', (e) => {
      state.detailBoost = parseFloat(e.target.value);
      document.getElementById('dm-detail-val').textContent =
        (state.detailBoost * 100).toFixed(0) + '%';
      if (cachedDepthFloat) processAndDisplayDepth();
    });
    document.getElementById('dm-auto-sway').addEventListener('change', (e) => {
      state.autoSway = e.target.checked;
    });
    document.getElementById('dm-invert').addEventListener('change', (e) => {
      state.invert = e.target.checked;
      if (cachedDepthFloat) processAndDisplayDepth();
    });

    hfTokenInput.addEventListener('input', () => {
      state.hfToken = hfTokenInput.value.trim();
    });

    /* ── Portrait mode picker ── */
    document.querySelectorAll('#dm-portrait-group .dm-opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#dm-portrait-group .dm-opt-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.portraitMode = btn.dataset.val;
      });
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

        // Reset portrait state
        state.portraitDetected = false;
        state.faceBox = null;
        state.faceLandmarks = null;
        updatePortraitBadge();

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

  // Cache depth as Float32Array (0-1 range, original image resolution)
  let cachedDepthFloat = null;

  /* ── Separable box-mean filter (O(N), memory-efficient) ── */
  function boxMeanSep(src, w, h, r, out, tmp) {
    // Pass 1: Horizontal (src → tmp)
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = src[row];
      for (let i = 1; i <= Math.min(r, w - 1); i++) sum += src[row + i];
      tmp[row] = sum / (Math.min(r, w - 1) + 1);
      for (let x = 1; x < w; x++) {
        if (x + r <= w - 1) sum += src[row + x + r];
        if (x - r - 1 >= 0) sum -= src[row + x - r - 1];
        tmp[row + x] = sum / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
      }
    }
    // Pass 2: Vertical (tmp → out)
    for (let x = 0; x < w; x++) {
      let sum = tmp[x];
      for (let i = 1; i <= Math.min(r, h - 1); i++) sum += tmp[i * w + x];
      out[x] = sum / (Math.min(r, h - 1) + 1);
      for (let y = 1; y < h; y++) {
        if (y + r <= h - 1) sum += tmp[(y + r) * w + x];
        if (y - r - 1 >= 0) sum -= tmp[(y - r - 1) * w + x];
        out[y * w + x] = sum / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1);
      }
    }
  }

  /* ── Guided Filter (He et al.) — uses original image edges to sharpen depth ── */
  function guidedFilterApply(guide, src, w, h, radius, eps) {
    const n = w * h;
    const tmp   = new Float32Array(n);
    const meanI = new Float32Array(n);
    const meanP = new Float32Array(n);
    const corrII = new Float32Array(n);
    const corrIP = new Float32Array(n);

    for (let i = 0; i < n; i++) corrII[i] = guide[i] * guide[i];
    for (let i = 0; i < n; i++) corrIP[i] = guide[i] * src[i];

    boxMeanSep(guide,  w, h, radius, meanI,  tmp);
    boxMeanSep(src,    w, h, radius, meanP,  tmp);
    boxMeanSep(corrII, w, h, radius, corrII, tmp); // now mean(I*I)
    boxMeanSep(corrIP, w, h, radius, corrIP, tmp); // now mean(I*P)

    // a = cov(I,P) / (var(I) + eps),  b = meanP - a·meanI
    for (let i = 0; i < n; i++) {
      const varI  = corrII[i] - meanI[i] * meanI[i];
      const covIP = corrIP[i] - meanI[i] * meanP[i];
      corrIP[i] = covIP / (varI + eps);              // a
      corrII[i] = meanP[i] - corrIP[i] * meanI[i];   // b
    }

    boxMeanSep(corrIP, w, h, radius, meanI, tmp); // meanA → meanI
    boxMeanSep(corrII, w, h, radius, meanP, tmp); // meanB → meanP

    const output = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      output[i] = Math.max(0, Math.min(1, meanI[i] * guide[i] + meanP[i]));
    }
    return output;
  }

  function getOrigGray() {
    const img = state.originalImg;
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      g[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    }
    return g;
  }

  /* ── Multi-scale guided filter — uses original image edges to sharpen
       true depth boundaries WITHOUT injecting texture as fake depth.
       Larger eps values = only transfer strong structural edges.
       The guided filter naturally distinguishes "this edge exists in depth"
       from "this edge is just texture" via the variance term. ── */
  function multiScaleGuidedFilter(guide, src, w, h) {
    const dim = Math.min(w, h);
    // Conservative eps values: only structural edges transfer, not texture
    const scales = [
      { radius: Math.max(8,  Math.round(dim / 20)),  eps: 0.04  },   // coarse structure
      { radius: Math.max(4,  Math.round(dim / 50)),  eps: 0.015 },   // medium features
    ];
    let result = src;
    for (const { radius, eps } of scales) {
      result = guidedFilterApply(guide, result, w, h, radius, eps);
    }
    return result;
  }

  /* ── Depth-aware edge refinement — only sharpen edges that actually
       exist in the MODEL's depth output, not arbitrary photo edges.
       Uses the depth map's own gradients to decide where to sharpen. ── */
  function depthEdgeRefine(depth, guide, w, h, strength) {
    const n = w * h;

    // Compute depth gradient magnitude (Sobel-like)
    const depthGrad = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const gx = depth[idx + 1] - depth[idx - 1];
        const gy = depth[idx + w] - depth[idx - w];
        depthGrad[idx] = Math.sqrt(gx * gx + gy * gy);
      }
    }

    // Normalize gradient to 0-1
    let gMax = 0;
    for (let i = 0; i < n; i++) if (depthGrad[i] > gMax) gMax = depthGrad[i];
    if (gMax > 0) for (let i = 0; i < n; i++) depthGrad[i] /= gMax;

    // At pixels where depth has an edge (gradient > threshold), use a tight
    // guided filter to snap the depth boundary to the nearest photo edge.
    // At flat-depth regions, leave depth untouched (photo texture ≠ depth).
    const tightRadius = Math.max(1, Math.round(Math.min(w, h) / (180 - 80 * strength)));
    const refined = guidedFilterApply(guide, depth, w, h, tightRadius, 0.0045);

    // Blend: use refined only where depth gradient exists
    const output = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Sigmoid blending weight based on depth gradient
      const edgeWeight = Math.min(1, depthGrad[i] * (2.5 + 7.5 * strength));
      output[i] = depth[i] * (1 - edgeWeight) + refined[i] * edgeWeight;
    }
    return output;
  }

  /* ── Depth-only micro-detail enhancement.
       Uses high-pass from the depth map itself (NOT photo texture), so it
       restores structural depth detail without reintroducing hair/skin spikes. ── */
  function depthMicroDetail(depth, w, h, strength) {
    if (strength <= 0) return depth;

    const n = w * h;
    const radius = Math.max(1, Math.round(Math.min(w, h) / 220));
    const tmp = new Float32Array(n);
    const base = new Float32Array(n);
    boxMeanSep(depth, w, h, radius, base, tmp);

    // Gradient gate from depth itself: prioritize real depth transitions
    const depthGrad = new Float32Array(n);
    let gMax = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const gx = depth[idx + 1] - depth[idx - 1];
        const gy = depth[idx + w] - depth[idx - w];
        const g = Math.sqrt(gx * gx + gy * gy);
        depthGrad[idx] = g;
        if (g > gMax) gMax = g;
      }
    }
    if (gMax > 0) {
      for (let i = 0; i < n; i++) depthGrad[i] /= gMax;
    }

    const out = new Float32Array(n);
    const gain = 0.35 + strength * 1.25;
    for (let i = 0; i < n; i++) {
      const high = depth[i] - base[i];
      const gate = Math.min(1, depthGrad[i] * (1.2 + 2.8 * strength));
      out[i] = Math.max(0, Math.min(1, depth[i] + high * gain * gate));
    }
    return out;
  }

  /* ── Gentle depth contrast: stretch histogram to use full 0-1 range
       without amplifying noise or creating artifacts ── */
  function depthContrastStretch(depth, w, h, strength = 0) {
    const n = w * h;

    // Compute percentile-based min/max (1st and 99th percentile)
    // to avoid outliers dominating the range
    const sorted = Float32Array.from(depth).sort();
    const lo = sorted[Math.floor(n * 0.01)];
    const hi = sorted[Math.floor(n * 0.99)];
    const range = hi - lo || 1;

    const result = new Float32Array(n);
    // Mild S-curve based on strength to lift midtones without crushing extremes
    const gamma = Math.max(0.55, 1 - strength * 0.35); // stronger detail -> lower gamma (more pop)
    for (let i = 0; i < n; i++) {
      const norm = Math.max(0, Math.min(1, (depth[i] - lo) / range));
      result[i] = Math.pow(norm, gamma);
    }
    return result;
  }

  /* ── Depth local contrast: unsharp mask on depth itself (no RGB texture) ── */
  function depthLocalContrast(depth, w, h, strength) {
    if (strength <= 0) return depth;
    const n = w * h;
    const radius = Math.max(2, Math.round(Math.min(w, h) / (140 - 60 * strength)));
    const tmp = new Float32Array(n);
    const blur = new Float32Array(n);
    boxMeanSep(depth, w, h, radius, blur, tmp);

    const out = new Float32Array(n);
    const gain = 0.4 + strength * 1.6;
    for (let i = 0; i < n; i++) {
      const high = depth[i] - blur[i];
      out[i] = Math.max(0, Math.min(1, depth[i] + high * gain));
    }
    return out;
  }

  /* ── Legacy-style crisp detail, but safety-gated:
       inject guide-image high-frequency ONLY where depth already has edges.
       This recovers architecture/window detail while avoiding hair/skin spikes. ── */
  function photoGuidedDetailInject(depth, guide, w, h, strength) {
    if (strength <= 0) return depth;
    const n = w * h;

    // High-frequency component from guide image
    const r = Math.max(2, Math.round(Math.min(w, h) / (170 - 70 * strength)));
    const tmp = new Float32Array(n);
    const guideBase = new Float32Array(n);
    boxMeanSep(guide, w, h, r, guideBase, tmp);

    // Depth gradient gate
    const depthGrad = new Float32Array(n);
    let gMax = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = depth[i + 1] - depth[i - 1];
        const gy = depth[i + w] - depth[i - w];
        const g = Math.sqrt(gx * gx + gy * gy);
        depthGrad[i] = g;
        if (g > gMax) gMax = g;
      }
    }
    if (gMax > 0) {
      for (let i = 0; i < n; i++) depthGrad[i] /= gMax;
    }

    const out = new Float32Array(n);
    const injectGain = 0.04 + strength * 0.18;
    for (let i = 0; i < n; i++) {
      // Guide high-pass, clipped hard to avoid runaway texture spikes
      let hi = guide[i] - guideBase[i];
      if (hi > 0.20) hi = 0.20;
      if (hi < -0.20) hi = -0.20;

      // Gate strongly by existing depth edge evidence
      const gate = Math.min(1, Math.max(0, (depthGrad[i] - 0.05) * 4.5));
      out[i] = Math.max(0, Math.min(1, depth[i] + hi * injectGain * gate));
    }
    return out;
  }

  /* ── Helper: extract raw depth Float32Array from pipeline result,
       bilinearly upsampled to target (tw × th) ── */
  function extractDepthTile(result, tw, th) {
    const di = result.depth;
    const dw = di.width, dh = di.height, ch = di.channels, dd = di.data;
    const out = new Float32Array(tw * th);
    for (let y = 0; y < th; y++) {
      const sy = Math.min(Math.floor(y / th * dh), dh - 1);
      for (let x = 0; x < tw; x++) {
        const sx = Math.min(Math.floor(x / tw * dw), dw - 1);
        out[y * tw + x] = (ch === 1 ? dd[sy * dw + sx] : dd[(sy * dw + sx) * ch]) / 255;
      }
    }
    return out;
  }

  /* ── Flip a canvas horizontally and return a data URL ── */
  function flipCanvasH(canvas) {
    const fc = document.createElement('canvas');
    fc.width = canvas.width; fc.height = canvas.height;
    const ctx = fc.getContext('2d');
    ctx.translate(fc.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(canvas, 0, 0);
    return fc.toDataURL('image/png');
  }

  /* ── Flip a Float32 depth map horizontally in-place ── */
  function flipDepthH(depth, w, h) {
    const flipped = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        flipped[row + x] = depth[row + (w - 1 - x)];
      }
    }
    return flipped;
  }

  /* ── Per-tile affine alignment: find scale+shift to align tile to reference
       in the overlap region, using least-squares regression ── */
  function affineAlignTile(tileDepth, refDepth, mask, n) {
    // Collect paired values where both tile and ref have valid data
    let sumR = 0, sumT = 0, sumRT = 0, sumTT = 0, count = 0;
    for (let i = 0; i < n; i++) {
      if (mask[i] <= 0) continue;
      const r = refDepth[i], t = tileDepth[i];
      sumR += r; sumT += t; sumRT += r * t; sumTT += t * t;
      count++;
    }
    if (count < 100) return tileDepth; // not enough overlap

    const meanR = sumR / count, meanT = sumT / count;
    const covRT = sumRT / count - meanR * meanT;
    const varT  = sumTT / count - meanT * meanT;

    const scale = varT > 1e-8 ? covRT / varT : 1;
    const shift = meanR - scale * meanT;

    const aligned = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      aligned[i] = scale * tileDepth[i] + shift;
    }
    return aligned;
  }

  /* ═══════════════════════════════════════════════════════════════════
     FACE DETECTION FOR PORTRAIT MODE
     Primary:  browser's built-in FaceDetector (Chrome/Edge, no download)
     Optional: MediaPipe Face Landmarker loaded in background for 478-pt
               landmarks — never blocks the main inference pipeline
     ═══════════════════════════════════════════════════════════════════ */

  // Optional MediaPipe state — loaded in background, never blocks depth gen
  let mpFaceLandmarker = null;
  let mpLoadPromise    = null;

  function loadMediaPipeBackground() {
    if (mpFaceLandmarker || mpLoadPromise) return;
    // Loads asynchronously in the background — never blocks the main flow.
    // Used only to optionally refine landmark positions after detection.
    mpLoadPromise = (async () => {
      try {
        const mod = await import(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
        );
        const { FaceLandmarker, FilesetResolver } = mod;
        if (!FaceLandmarker || !FilesetResolver) return null;

        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        mpFaceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          outputFaceBlendshapes: false,
          runningMode: 'IMAGE',
          numFaces: 1,
        });
        return mpFaceLandmarker;
      } catch (err) {
        console.info('[DepthMap] MediaPipe optional landmark refinement unavailable:', err.message || err);
        return null;
      }
    })();
  }

  /* ── Primary face detection: browser-native FaceDetector API.
       Available in Chrome/Edge without any downloads.
       Returns {x,y,w,h,coverage} bbox in image pixels, or null. ── */
  async function detectFaceNative(imgEl) {
    if (!('FaceDetector' in window)) return null;
    try {
      const fd = new window.FaceDetector({ maxDetectedFaces: 1, fastMode: false });
      const faces = await fd.detect(imgEl);
      if (!faces || faces.length === 0) return null;

      const face = faces[0];
      const bbox = face.boundingBox;
      const W = imgEl.naturalWidth, H = imgEl.naturalHeight;
      const coverage = (bbox.width * bbox.height) / (W * H);

      if (coverage < 0.08) return null; // not a portrait

      return { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height, coverage };
    } catch (err) {
      console.info('[DepthMap] FaceDetector unavailable:', err.message);
      return null;
    }
  }

  /* ── Derive approximate landmark positions from bounding box using
       standard facial proportion rules (the "thirds" rule).
       Returns an object matching the named positions expected by
       buildAnatomicalPriors(), all in crop-normalized [0,1] coords. ── */
  function deriveLandmarksFromBox(faceBoxInCrop, cw, ch) {
    // faceBoxInCrop: {x,y,w,h} in crop pixel coords
    const {x: fx, y: fy, w: fw, h: fh} = faceBoxInCrop;

    // Normalize to [0,1] within the crop
    const l = fx / cw, r = (fx + fw) / cw;
    const t = fy / ch, b = (fy + fh) / ch;
    const cx = (l + r) * 0.5;

    // Vertical proportions (of face height):
    // forehead ~15%, eyes ~35%, nose ~50%, mouth ~65%, chin ~100%
    return {
      forehead:   { x: cx,          y: t + fh/ch * 0.12 },
      leftEye:    { x: cx - fw/cw * 0.175, y: t + fh/ch * 0.35 },
      rightEye:   { x: cx + fw/cw * 0.175, y: t + fh/ch * 0.35 },
      noseBridge: { x: cx,          y: t + fh/ch * 0.43 },
      noseTip:    { x: cx,          y: t + fh/ch * 0.52 },
      mouth:      { x: cx,          y: t + fh/ch * 0.65 },
      leftCheek:  { x: cx - fw/cw * 0.22, y: t + fh/ch * 0.55 },
      rightCheek: { x: cx + fw/cw * 0.22, y: t + fh/ch * 0.55 },
    };
  }

  /* ── Build depth priors from anatomical landmark positions.
       Works with either MediaPipe 478-pt landmarks or bbox-derived estimates.
       All values are small (≤ 0.08) residual offsets. ── */
  function buildAnatomicalPriors(lmPositions, tw, th, faceW, faceH) {
    const prior = new Float32Array(tw * th);

    // Gaussian blob helper
    function addG(cx, cy, sigX, sigY, amp) {
      const px = cx * tw, py = cy * th;
      const sx2 = (sigX * tw) ** 2, sy2 = (sigY * th) ** 2;
      for (let y = 0; y < th; y++) {
        const dy2 = (y - py) ** 2;
        if (sy2 > 0 && dy2 / sy2 > 9) continue;
        for (let x = 0; x < tw; x++) {
          const dx2 = (x - px) ** 2;
          if (sx2 > 0 && dx2 / sx2 > 9) continue;
          prior[y * tw + x] += amp * Math.exp(-0.5 * (dx2 / sx2 + dy2 / sy2));
        }
      }
    }

    const {noseTip, noseBridge, leftEye, rightEye, mouth, leftCheek, rightCheek, forehead} = lmPositions;

    // Scale sigma based on relative face size in crop (larger face = broader features)
    const relFaceW = (faceW / tw) || 0.5;
    const s = relFaceW; // scale factor for feature sizes

    addG(noseTip.x,    noseTip.y,    0.07*s, 0.07*s,  0.044); // nose protrusion
    addG(noseBridge.x, noseBridge.y, 0.06*s, 0.10*s,  0.025); // nose bridge
    addG(leftEye.x,    leftEye.y,    0.05*s, 0.04*s, -0.020); // left eye socket
    addG(rightEye.x,   rightEye.y,   0.05*s, 0.04*s, -0.020); // right eye socket
    addG(mouth.x,      mouth.y,      0.10*s, 0.04*s,  0.014); // lip ridge
    addG(leftCheek.x,  leftCheek.y,  0.10*s, 0.10*s,  0.013); // left cheek
    addG(rightCheek.x, rightCheek.y, 0.10*s, 0.10*s,  0.013); // right cheek
    addG(forehead.x,   forehead.y,   0.12*s, 0.08*s,  0.010); // forehead

    for (let i = 0; i < prior.length; i++) {
      prior[i] = Math.max(-0.08, Math.min(0.08, prior[i]));
    }
    return prior;
  }

  /* ── Convert MediaPipe 478-point landmarks to the named positions
       expected by buildAnatomicalPriors() ── */
  function mpLandmarksToNamed(mpLandmarks, W, H, cx0, cy0, cw, ch) {
    function toLandmark(idx) {
      const pt = mpLandmarks[idx] || { x:0.5, y:0.5 };
      return {
        x: (pt.x * W - cx0) / cw,
        y: (pt.y * H - cy0) / ch,
      };
    }
    const upperLip = toLandmark(13), lowerLip = toLandmark(14);
    return {
      noseTip:    toLandmark(4),
      noseBridge: toLandmark(6),
      leftEye:    toLandmark(159),
      rightEye:   toLandmark(386),
      mouth:      { x: (upperLip.x + lowerLip.x)*0.5, y: (upperLip.y + lowerLip.y)*0.5 },
      leftCheek:  { x: (toLandmark(159).x + toLandmark(61).x)*0.5,
                    y: (toLandmark(159).y + toLandmark(61).y)*0.5 },
      rightCheek: { x: (toLandmark(386).x + toLandmark(291).x)*0.5,
                    y: (toLandmark(386).y + toLandmark(291).y)*0.5 },
      forehead:   toLandmark(10),
    };
  }

  /* ── Detect face: try native FaceDetector, with MediaPipe as optional
       background enhancement. Hard 4s timeout — never blocks inference. ── */
  async function detectFace(imgEl) {
    const detectPromise = detectFaceNative(imgEl);
    const timeout = new Promise(r => setTimeout(() => r(null), 4000));
    return Promise.race([detectPromise, timeout]);
  }

  /* ── Portrait enhancement pipeline ── */
  async function portraitEnhance(pipe, globalDepth) {
    const img  = state.originalImg;
    const W    = img.naturalWidth, H = img.naturalHeight;
    const fb   = state.faceBox;
    if (!fb) return globalDepth;

    showProgress(100, '<span class="pulse">Portrait: running face depth pass…</span>');

    // Expand face bbox by 40% padding
    const padFrac = 0.40;
    const pxPad = Math.round(fb.w * padFrac), pyPad = Math.round(fb.h * padFrac);
    const cx0 = Math.max(0, Math.round(fb.x - pxPad));
    const cy0 = Math.max(0, Math.round(fb.y - pyPad));
    const cx1 = Math.min(W, Math.round(fb.x + fb.w + pxPad));
    const cy1 = Math.min(H, Math.round(fb.y + fb.h + pyPad));
    const cw  = cx1 - cx0, ch = cy1 - cy0;

    if (cw < 32 || ch < 32) return globalDepth;

    // Extract crop canvas
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cw; cropCanvas.height = ch;
    const cCtx = cropCanvas.getContext('2d');
    cCtx.imageSmoothingQuality = 'high';
    cCtx.drawImage(img, cx0, cy0, cw, ch, 0, 0, cw, ch);

    // Crop inference + TTA
    const cropRes  = await pipe(cropCanvas.toDataURL('image/png'));
    const cropNorm = extractDepthTile(cropRes, cw, ch);
    const flipRes  = await pipe(flipCanvasH(cropCanvas));
    const cropFlip = flipDepthH(extractDepthTile(flipRes, cw, ch), cw, ch);

    const cropTTA = new Float32Array(cw * ch);
    for (let i = 0; i < cw * ch; i++) cropTTA[i] = (cropNorm[i] + cropFlip[i]) * 0.5;

    // Reference patch from global depth
    const refPatch = new Float32Array(cw * ch);
    const mask     = new Float32Array(cw * ch);
    for (let ly = 0; ly < ch; ly++) {
      for (let lx = 0; lx < cw; lx++) {
        if (cx0 + lx < W && cy0 + ly < H) {
          refPatch[ly * cw + lx] = globalDepth[(cy0 + ly) * W + (cx0 + lx)];
          mask[ly * cw + lx] = 1;
        }
      }
    }

    // Affine-align crop → global range, then rescale to match global patch range
    const aligned = affineAlignTile(cropTTA, refPatch, mask, cw * ch);
    let sMin = Infinity, sMax = -Infinity, rMin = Infinity, rMax = -Infinity;
    for (let i = 0; i < cw * ch; i++) {
      if (aligned[i] < sMin) sMin = aligned[i];
      if (aligned[i] > sMax) sMax = aligned[i];
      if (refPatch[i] < rMin) rMin = refPatch[i];
      if (refPatch[i] > rMax) rMax = refPatch[i];
    }
    const sRange = sMax - sMin || 1, rRange = rMax - rMin || 1;
    const scaledCrop = new Float32Array(cw * ch);
    for (let i = 0; i < cw * ch; i++) {
      scaledCrop[i] = rMin + ((aligned[i] - sMin) / sRange) * rRange;
    }

    // Landmark priors — use MediaPipe 478-pt if available, else bbox anatomy
    const faceBoxInCrop = { x: fb.x - cx0, y: fb.y - cy0, w: fb.w, h: fb.h };
    let lmPositions;
    if (state.faceLandmarks && state.faceLandmarks.length > 0) {
      lmPositions = mpLandmarksToNamed(state.faceLandmarks, W, H, cx0, cy0, cw, ch);
    } else {
      lmPositions = deriveLandmarksFromBox(faceBoxInCrop, cw, ch);
    }
    const priorCrop = buildAnatomicalPriors(lmPositions, cw, ch, fb.w, fb.h);

    const enhancedCrop = new Float32Array(cw * ch);
    for (let i = 0; i < cw * ch; i++) {
      enhancedCrop[i] = scaledCrop[i] + priorCrop[i];
    }

    // Soft blend mask: full weight inside face bbox, cosine taper in padding
    const fxOff = fb.x - cx0, fyOff = fb.y - cy0;
    const fxEnd = fxOff + fb.w, fyEnd = fyOff + fb.h;
    const blendMask = new Float32Array(cw * ch);
    for (let ly = 0; ly < ch; ly++) {
      const dy = ly < fyOff ? (fyOff - ly) / Math.max(1, fyOff) :
                 ly > fyEnd ? (ly - fyEnd) / Math.max(1, ch - fyEnd) : 0;
      for (let lx = 0; lx < cw; lx++) {
        const dx = lx < fxOff ? (fxOff - lx) / Math.max(1, fxOff) :
                   lx > fxEnd ? (lx - fxEnd) / Math.max(1, cw - fxEnd) : 0;
        blendMask[ly * cw + lx] = Math.max(0,
          Math.cos(Math.min(1, Math.sqrt(dx*dx + dy*dy)) * Math.PI * 0.5));
      }
    }

    // Fuse back into global depth at 65% blend strength
    const BLEND = 0.65;
    const result = Float32Array.from(globalDepth);
    for (let ly = 0; ly < ch; ly++) {
      const gy = cy0 + ly;
      if (gy >= H) continue;
      for (let lx = 0; lx < cw; lx++) {
        const gx = cx0 + lx;
        if (gx >= W) continue;
        const bw = blendMask[ly * cw + lx] * BLEND;
        const gi = gy * W + gx;
        result[gi] = globalDepth[gi] * (1 - bw) + enhancedCrop[ly * cw + lx] * bw;
      }
    }

    // If MediaPipe is now available (loaded in background since detect started),
    // use it to refine the face landmarks for any future re-runs
    if (mpFaceLandmarker && !state.faceLandmarks) {
      try {
        const mpRes = mpFaceLandmarker.detect(img);
        if (mpRes && mpRes.faceLandmarks && mpRes.faceLandmarks.length > 0) {
          state.faceLandmarks = mpRes.faceLandmarks[0];
        }
      } catch { /* ignore */ }
    }

    return result;
  }

  /* ── Should portrait mode run for the current image? ── */
  function shouldRunPortrait() {
    if (state.portraitMode === 'off') return false;
    if (state.portraitMode === 'on')  return true;
    return state.portraitDetected; // auto
  }

  /* ── Update portrait badge visibility ── */
  function updatePortraitBadge() {
    const badge = document.getElementById('dm-portrait-badge');
    if (!badge) return;
    const show = state.portraitDetected || state.portraitMode === 'on';
    badge.classList.toggle('visible', show);
  }

  /* ── Tiled depth inference with flip-TTA, affine alignment, and
       global reference pass for maximum accuracy ── */
  async function tiledDepthInference(pipe) {
    const img = state.originalImg;
    const W = img.naturalWidth, H = img.naturalHeight;
    const grid = state.tileGrid;

    // ── Step 0: Global reference pass (full image at model's native 518px) ──
    showProgress(100, '<span class="pulse">Running global depth pass…</span>');
    const globalResult = await pipe(state.imageDataUrl);
    const globalDepth = extractDepthTile(globalResult, W, H);

    // Also run flipped for TTA
    showProgress(100, '<span class="pulse">Running flipped global pass…</span>');
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = W; srcCanvas.height = H;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.imageSmoothingQuality = 'high';
    srcCtx.drawImage(img, 0, 0);

    const globalFlipUrl = flipCanvasH(srcCanvas);
    const globalFlipResult = await pipe(globalFlipUrl);
    const globalFlipDepth = flipDepthH(extractDepthTile(globalFlipResult, W, H), W, H);

    // Average the two global passes (TTA)
    const globalRef = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      globalRef[i] = (globalDepth[i] + globalFlipDepth[i]) * 0.5;
    }
    // Normalize global reference to 0-1
    let gMin = Infinity, gMax = -Infinity;
    for (let i = 0; i < W * H; i++) {
      if (globalRef[i] < gMin) gMin = globalRef[i];
      if (globalRef[i] > gMax) gMax = globalRef[i];
    }
    const gRange = gMax - gMin || 1;
    for (let i = 0; i < W * H; i++) globalRef[i] = (globalRef[i] - gMin) / gRange;

    if (grid <= 1) {
      // No tiling — just return the TTA'd global pass
      return globalRef;
    }

    // ── Step 1: Tiled inference with flip-TTA and affine alignment ──
    const stepX = Math.ceil(W / grid);
    const stepY = Math.ceil(H / grid);
    const padX = Math.round(stepX * 0.33);  // 33% overlap
    const padY = Math.round(stepY * 0.33);

    const depthAccum  = new Float32Array(W * H);
    const weightAccum = new Float32Array(W * H);
    let tileIdx = 0;
    const total = grid * grid;

    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        tileIdx++;

        let x0 = gx * stepX - padX;
        let y0 = gy * stepY - padY;
        let x1 = (gx + 1) * stepX + padX;
        let y1 = (gy + 1) * stepY + padY;
        x0 = Math.max(0, x0); y0 = Math.max(0, y0);
        x1 = Math.min(W, x1); y1 = Math.min(H, y1);
        const tw = x1 - x0, th = y1 - y0;

        // Extract tile with bicubic quality
        const tc = document.createElement('canvas');
        tc.width = tw; tc.height = th;
        const tCtx = tc.getContext('2d');
        tCtx.imageSmoothingQuality = 'high';
        tCtx.drawImage(srcCanvas, x0, y0, tw, th, 0, 0, tw, th);

        // ── Normal inference ──
        showProgress(100,
          `<span class="pulse">Tile ${tileIdx}/${total} (normal)…</span>`);
        const tileResult = await pipe(tc.toDataURL('image/png'));
        const tileDepthNormal = extractDepthTile(tileResult, tw, th);

        // ── Flipped inference (TTA) ──
        showProgress(100,
          `<span class="pulse">Tile ${tileIdx}/${total} (flipped)…</span>`);
        const flipUrl = flipCanvasH(tc);
        const flipResult = await pipe(flipUrl);
        const tileDepthFlipRaw = extractDepthTile(flipResult, tw, th);
        const tileDepthFlip = flipDepthH(tileDepthFlipRaw, tw, th);

        // ── Average normal + flipped (TTA) ──
        const tileDepthTTA = new Float32Array(tw * th);
        for (let i = 0; i < tw * th; i++) {
          tileDepthTTA[i] = (tileDepthNormal[i] + tileDepthFlip[i]) * 0.5;
        }

        // ── Affine-align tile to global reference in this region ──
        // Build overlap mask from global reference
        const refPatch = new Float32Array(tw * th);
        const overlapMask = new Float32Array(tw * th);
        for (let ly = 0; ly < th; ly++) {
          for (let lx = 0; lx < tw; lx++) {
            const gxPos = x0 + lx, gyPos = y0 + ly;
            if (gxPos < W && gyPos < H) {
              refPatch[ly * tw + lx] = globalRef[gyPos * W + gxPos];
              overlapMask[ly * tw + lx] = 1;
            }
          }
        }
        const alignedTile = affineAlignTile(tileDepthTTA, refPatch, overlapMask, tw * th);

        // ── Blend into accumulator with cosine-ramp weights ──
        const ramp = Math.min(padX, padY);
        for (let ly = 0; ly < th; ly++) {
          const gyPos = y0 + ly;
          if (gyPos >= H) continue;
          for (let lx = 0; lx < tw; lx++) {
            const gxPos = x0 + lx;
            if (gxPos >= W) continue;

            const edgeDist = Math.min(lx, tw - 1 - lx, ly, th - 1 - ly);
            let wt = 1;
            if (ramp > 0 && edgeDist < ramp) {
              wt = 0.5 * (1 - Math.cos(Math.PI * edgeDist / ramp));
            }

            const idx = gyPos * W + gxPos;
            depthAccum[idx]  += alignedTile[ly * tw + lx] * wt;
            weightAccum[idx] += wt;
          }
        }
      }
    }

    // ── Step 2: Merge tiles and normalize to 0-1 ──
    const depth = new Float32Array(W * H);
    let minD = Infinity, maxD = -Infinity;
    for (let i = 0; i < W * H; i++) {
      depth[i] = weightAccum[i] > 0 ? depthAccum[i] / weightAccum[i] : globalRef[i];
      if (depth[i] < minD) minD = depth[i];
      if (depth[i] > maxD) maxD = depth[i];
    }
    const range = maxD - minD || 1;
    for (let i = 0; i < W * H; i++) depth[i] = (depth[i] - minD) / range;
    return depth;
  }

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
        } else if (info.status === 'done') { /* file done */ }
        else if (info.status === 'ready') { showProgress(100, 'Model ready'); }
      });

      // ── 2. Face detection for portrait mode (parallel with inference start) ──
      // Reset portrait state
      state.portraitDetected = false;
      state.faceBox = null;
      state.faceLandmarks = null;

      // Kick off face detection concurrently with model load completing
      // Only run if portrait mode isn't disabled
      const isMaybePortrait = state.portraitMode !== 'off';
      let faceDetectPromise = Promise.resolve(null);
      if (isMaybePortrait) {
        // Start loading MediaPipe in the background (non-blocking, for landmark refinement)
        loadMediaPipeBackground();
        showProgress(100, '<span class="pulse">Detecting faces…</span>');
        faceDetectPromise = detectFace(state.originalImg).then(fb => {
          if (fb) {
            state.portraitDetected = true;
            state.faceBox = fb;
            state.faceLandmarks = fb.landmarks || null;
          }
          updatePortraitBadge();
          return fb;
        }).catch(() => null);
      }

      // ── 3. Run tiled or single-pass inference ──
      cachedDepthFloat = await tiledDepthInference(pipe);

      // Wait for face detection to complete (usually already done by now)
      await faceDetectPromise;

      // ── 4. Portrait enhancement (if portrait mode is active) ──
      if (shouldRunPortrait() && state.faceBox) {
        cachedDepthFloat = await portraitEnhance(pipe, cachedDepthFloat);
      }

      // ── 5. Post-process and display ──
      showProgress(100, '<span class="pulse">Post-processing…</span>');
      processAndDisplayDepth();

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

  /* ── Full depth post-processing pipeline ── */
  function processAndDisplayDepth() {
    if (!cachedDepthFloat) return;
    const W = state.originalImg.naturalWidth;
    const H = state.originalImg.naturalHeight;
    let depth = cachedDepthFloat;
    const guide = getOrigGray();

    const strength = Math.max(0, Math.min(1, state.detailBoost));

    if (state.guidedFilter) {
      // Step 1: Multi-scale guided filter — snap depth edges to photo
      // edges, but only structural ones (high eps prevents texture leak)
      depth = multiScaleGuidedFilter(guide, depth, W, H);
    }

    // Step 2: Detail enhancement chain controlled by Detail slider
    if (strength > 0) {
      // Depth-aware edge snap
      depth = depthEdgeRefine(depth, guide, W, H, strength);
      // Depth-only micro enhancement
      depth = depthMicroDetail(depth, W, H, strength);
      // Legacy-style crisp detail, safety-gated by depth edges
      depth = photoGuidedDetailInject(depth, guide, W, H, strength);
    }

    // Step 3: Gentle contrast stretch with S-curve tuned by strength
    depth = depthContrastStretch(depth, W, H, strength);

    // Step 4: Depth-only local contrast (unsharp on depth)
    depth = depthLocalContrast(depth, W, H, strength);

    // Invert if enabled
    if (state.invert) {
      const inv = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) inv[i] = 1 - depth[i];
      depth = inv;
    }

    // Render to canvas
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const v = Math.max(0, Math.min(255, Math.round(depth[i] * 255)));
      imgData.data[i * 4]     = v;
      imgData.data[i * 4 + 1] = v;
      imgData.data[i * 4 + 2] = v;
      imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    state.depthFullCanvas = canvas;
    state.depthCanvas = canvas;

    // Show in result preview
    showDepthResult();

    // Setup or update 3D preview
    setup3DPreview();
  }

  function showDepthResult() {
    const wrapEl = document.getElementById('dm-result-wrap');

    // Show depth map as image
    const dataUrl = state.depthFullCanvas.toDataURL('image/png');
    const img = new Image();
    img.onload = () => {
      wrapEl.innerHTML = '';
      wrapEl.appendChild(img);
      // Always fit the depth map preview so it's centered
      requestAnimationFrame(() => pzInstances.result && pzInstances.result.fit());
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
      // Push along the surface normal for cleaner extrusion
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

  /* ── Create a smoothed depth canvas for 3D displacement ── */
  function createSmooth3DDepth(srcCanvas) {
    const w = srcCanvas.width, h = srcCanvas.height;
    // Downscale to a manageable size for the 3D mesh, then smooth
    const maxDim = 1024;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const sw = Math.round(w * scale), sh = Math.round(h * scale);

    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcCanvas, 0, 0, sw, sh);

    // Apply smoothing blur (3-pass box blur for approximate Gaussian)
    // This removes any remaining sharp depth artifacts for clean 3D mesh
    const imgData = ctx.getImageData(0, 0, sw, sh);
    const d = imgData.data;
    const gray = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) gray[i] = d[i * 4] / 255;

    const blurRadius = Math.max(2, Math.round(Math.min(sw, sh) / 150));
    let blurred = gray;
    for (let pass = 0; pass < 3; pass++) {
      const tmp = new Float32Array(sw * sh);
      const out = new Float32Array(sw * sh);
      // Horizontal
      for (let y = 0; y < sh; y++) {
        const row = y * sw;
        for (let x = 0; x < sw; x++) {
          let sum = 0, cnt = 0;
          for (let k = -blurRadius; k <= blurRadius; k++) {
            const xx = Math.min(sw - 1, Math.max(0, x + k));
            sum += blurred[row + xx]; cnt++;
          }
          tmp[row + x] = sum / cnt;
        }
      }
      // Vertical
      for (let x = 0; x < sw; x++) {
        for (let y = 0; y < sh; y++) {
          let sum = 0, cnt = 0;
          for (let k = -blurRadius; k <= blurRadius; k++) {
            const yy = Math.min(sh - 1, Math.max(0, y + k));
            sum += tmp[yy * sw + x]; cnt++;
          }
          out[y * sw + x] = sum / cnt;
        }
      }
      blurred = out;
    }

    const result = ctx.createImageData(sw, sh);
    const rd = result.data;
    for (let i = 0; i < sw * sh; i++) {
      const v = Math.max(0, Math.min(255, Math.round(blurred[i] * 255)));
      rd[i * 4] = v; rd[i * 4 + 1] = v; rd[i * 4 + 2] = v; rd[i * 4 + 3] = 255;
    }
    ctx.putImageData(result, 0, 0);
    return c;
  }

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
    const camera = new THREE.PerspectiveCamera(35, cw / ch, 0.01, 100);

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
    const segsX = 512;
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

    // Depth texture — use a smoothed version for 3D to avoid jagged mesh
    const smoothDepthCanvas = createSmooth3DDepth(state.depthCanvas);
    const depthTex = new THREE.CanvasTexture(smoothDepthCanvas);
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
    camZ *= 1.02; // minimal padding — fill the viewport
    camera.position.z = camZ;
    camera.lookAt(0, 0, 0);

    state.scene = scene;
    state.camera = camera;
    state.renderer = renderer;
    state.mesh = mesh;
    state.cameraBaseZ = camZ;
    state.orbitDist = camZ;
    state.orbitTheta = 0;
    state.orbitPhi = Math.PI / 2;
    state.orbitTargetTheta = 0;
    state.orbitTargetPhi = Math.PI / 2;
    state.swayTime = 0;
    state.currentMX = 0;
    state.currentMY = 0;

    // ── Mouse / touch interaction (orbit drag) ──
    canvas3d.addEventListener('mousedown', on3DMouseDown);
    canvas3d.addEventListener('mousemove', on3DMouseMove);
    canvas3d.addEventListener('mouseenter', () => { state.isHovering = true; });
    canvas3d.addEventListener('mouseleave', () => { state.isHovering = false; state.isDragging3D = false; });
    document.addEventListener('mouseup', on3DMouseUp);
    canvas3d.addEventListener('touchstart', on3DTouchStart, { passive: false });
    canvas3d.addEventListener('touchmove', on3DTouchMove, { passive: false });
    canvas3d.addEventListener('touchend', () => { state.isHovering = false; state.isDragging3D = false; });
    canvas3d.addEventListener('wheel', on3DWheel, { passive: false });

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

  function on3DMouseDown(e) {
    if (e.button !== 0) return;
    state.isDragging3D = true;
    state.lastDragX = e.clientX;
    state.lastDragY = e.clientY;
  }

  function on3DMouseMove(e) {
    state.isHovering = true;
    if (state.isDragging3D) {
      const dx = e.clientX - state.lastDragX;
      const dy = e.clientY - state.lastDragY;
      state.lastDragX = e.clientX;
      state.lastDragY = e.clientY;
      state.orbitTargetTheta -= dx * 0.005;
      state.orbitTargetPhi   -= dy * 0.005;
      // Clamp phi so camera doesn't flip
      state.orbitTargetPhi = Math.max(0.3, Math.min(Math.PI - 0.3, state.orbitTargetPhi));
    }
  }

  function on3DMouseUp() {
    state.isDragging3D = false;
  }

  function on3DTouchStart(e) {
    if (e.touches.length === 1) {
      e.preventDefault();
      state.isDragging3D = true;
      state.isHovering = true;
      state.lastDragX = e.touches[0].clientX;
      state.lastDragY = e.touches[0].clientY;
    }
  }

  function on3DTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && state.isDragging3D) {
      const dx = e.touches[0].clientX - state.lastDragX;
      const dy = e.touches[0].clientY - state.lastDragY;
      state.lastDragX = e.touches[0].clientX;
      state.lastDragY = e.touches[0].clientY;
      state.orbitTargetTheta -= dx * 0.005;
      state.orbitTargetPhi   -= dy * 0.005;
      state.orbitTargetPhi = Math.max(0.3, Math.min(Math.PI - 0.3, state.orbitTargetPhi));
    }
  }

  function on3DWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.08 : 1 / 1.08;
    state.orbitDist = Math.max(0.2, Math.min(5, state.orbitDist * factor));
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

    // Smooth lerp orbit angles
    state.orbitTheta += (state.orbitTargetTheta - state.orbitTheta) * 0.08;
    state.orbitPhi   += (state.orbitTargetPhi   - state.orbitPhi)   * 0.08;

    const r = state.orbitDist;
    const theta = state.orbitTheta;
    const phi = state.orbitPhi;
    state.camera.position.x = r * Math.sin(phi) * Math.sin(theta);
    state.camera.position.y = r * Math.cos(phi);
    state.camera.position.z = r * Math.sin(phi) * Math.cos(theta);
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

      // Auto-sway when not dragging
      if (!state.isDragging3D && state.autoSway) {
        state.orbitTargetTheta = Math.sin(state.swayTime) * 0.3;
        state.orbitTargetPhi   = Math.PI / 2 + Math.cos(state.swayTime * 0.7) * 0.15;
      }

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
  let dmLauncher = null;
  let isActive = false;

  function ensureLauncher() {
    injectStyles();
    if (dmLauncher && document.body.contains(dmLauncher)) return;
    dmLauncher = document.createElement('button');
    dmLauncher.className = 'dm-launcher';
    dmLauncher.type = 'button';
    dmLauncher.textContent = 'Depth Map';
    dmLauncher.addEventListener('click', activateDepthMap);
    document.body.appendChild(dmLauncher);
  }

  function syncLauncherVisibility() {
    ensureLauncher();
    if (!dmLauncher) return;
    dmLauncher.classList.toggle('hidden', !!document.querySelector('.depthmap-tab'));
  }

  function injectTab() {
    const navTabs = document.querySelector('.nav-tabs');
    syncLauncherVisibility();
    if (!navTabs) return;

    const existingTab = navTabs.querySelector('.depthmap-tab');
    if (existingTab) {
      dmTab = existingTab;
      syncLauncherVisibility();
      return;
    }

    dmTab = document.createElement('button');
    dmTab.className = 'nav-tab depthmap-tab';
    dmTab.textContent = 'Depth Map';
    dmTab.type = 'button';
    dmTab.addEventListener('click', activateDepthMap);
    navTabs.appendChild(dmTab);
    syncLauncherVisibility();

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
    ensureLauncher();
    injectTab();
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(injectTab, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
