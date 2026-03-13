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
      desc: '~25 MB · fastest',
    },
    base: {
      id: 'onnx-community/depth-anything-v2-base',
      label: 'Base',
      desc: '~100 MB · balanced',
    },
    large: {
      id: 'onnx-community/depth-anything-v2-large',
      label: 'Large',
      desc: '~350 MB · best detail',
    },
  };

  /* ═══════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════ */
  const state = {
    modelSize: 'base',
    tileGrid: 2,
    depthContrast: 1.1,
    foregroundBoost: 0.2,
    backgroundFlatten: 0.7,
    planarSmoothing: 0.58,
    windowRecess: 0.32,
    edgeDenoise: 0.45,
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
    previewStage: 'final',
    processedDepthFloat: null,
    debugOutputs: null,
    origFeatures: null,
    forceDepthPreview: false,
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
    .dm-select {
      width: 100%; margin: 4px 0 2px; padding: 8px 10px;
      background: var(--bg-input, #0f0f23);
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px);
      color: var(--text-primary, #e0e0e0);
      font: inherit;
    }

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
            Small<span class="desc">~25 MB · fastest</span>
          </button>
          <button class="dm-opt-btn ${state.modelSize==='base'?'active':''}" data-val="base">
            Base<span class="desc">~100 MB · balanced</span>
          </button>
          <button class="dm-opt-btn ${state.modelSize==='large'?'active':''}" data-val="large">
            Large<span class="desc">~350 MB · best</span>
          </button>
        </div>
        <div class="dm-field-hint">Model downloads on first use, then cached</div>
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
        <label class="dm-slider-label">
          Depth Contrast
          <span class="dm-slider-val" id="dm-depth-contrast-val">${state.depthContrast.toFixed(2)}</span>
        </label>
        <input type="range" id="dm-depth-contrast" min="0.7" max="1.8" step="0.05"
          value="${state.depthContrast}" class="dm-range" />
        <div class="dm-field-hint">Overall relief separation between near and far geometry</div>
      </div>

      <div class="dm-field">
        <label class="dm-slider-label">
          Foreground Boost
          <span class="dm-slider-val" id="dm-foreground-boost-val">${(state.foregroundBoost * 100).toFixed(0)}%</span>
        </label>
        <input type="range" id="dm-foreground-boost" min="0" max="1" step="0.05"
          value="${state.foregroundBoost}" class="dm-range" />
        <div class="dm-field-hint">Pushes columns, roof edges, and front-most structure higher</div>
      </div>

      <div class="dm-field">
        <label class="dm-slider-label">
          Background Flattening
          <span class="dm-slider-val" id="dm-background-flatten-val">${(state.backgroundFlatten * 100).toFixed(0)}%</span>
        </label>
        <input type="range" id="dm-background-flatten" min="0" max="1" step="0.05"
          value="${state.backgroundFlatten}" class="dm-range" />
        <div class="dm-field-hint">Forces sky and distant clutter to a clean far-depth plane</div>
      </div>

      <div class="dm-field">
        <label class="dm-slider-label">
          Planar Smoothing
          <span class="dm-slider-val" id="dm-planar-smoothing-val">${(state.planarSmoothing * 100).toFixed(0)}%</span>
        </label>
        <input type="range" id="dm-planar-smoothing" min="0" max="1" step="0.05"
          value="${state.planarSmoothing}" class="dm-range" />
        <div class="dm-field-hint">Smooths pavement, walls, and glass into believable planes</div>
      </div>

      <div class="dm-field">
        <label class="dm-slider-label">
          Window Recess Depth
          <span class="dm-slider-val" id="dm-window-recess-val">${(state.windowRecess * 100).toFixed(0)}%</span>
        </label>
        <input type="range" id="dm-window-recess" min="0" max="1" step="0.05"
          value="${state.windowRecess}" class="dm-range" />
        <div class="dm-field-hint">Biases glazing, doors, and dark vestibules deeper than outer framing</div>
      </div>

      <div class="dm-field">
        <label class="dm-slider-label">
          Edge-Preserving Denoise
          <span class="dm-slider-val" id="dm-edge-denoise-val">${(state.edgeDenoise * 100).toFixed(0)}%</span>
        </label>
        <input type="range" id="dm-edge-denoise" min="0" max="1" step="0.05"
          value="${state.edgeDenoise}" class="dm-range" />
        <div class="dm-field-hint">Removes relief noise without creating glowing outline halos</div>
      </div>

      <div class="dm-field">
        <label>Preview Stage</label>
        <select id="dm-stage-select" class="dm-select">
          <option value="final" ${state.previewStage === 'final' ? 'selected' : ''}>Final height map</option>
          <option value="raw" ${state.previewStage === 'raw' ? 'selected' : ''}>Raw model depth</option>
          <option value="normalized" ${state.previewStage === 'normalized' ? 'selected' : ''}>Normalized depth</option>
          <option value="masks" ${state.previewStage === 'masks' ? 'selected' : ''}>Segmentation masks</option>
          <option value="smoothed" ${state.previewStage === 'smoothed' ? 'selected' : ''}>Planar-smoothed depth</option>
        </select>
        <div class="dm-field-hint">Deterministic debug stages for tuning the bas-relief pipeline</div>
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
          Download 16-bit PNG
        </button>
        <button class="dm-btn dm-btn-secondary" id="dm-download-preview-btn" style="display:none">
          Preview PNG
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
    const downloadPreviewBtn = document.getElementById('dm-download-preview-btn');
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
    downloadPreviewBtn.addEventListener('click', downloadPreviewStage);

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

    const rerenderIfReady = () => {
      state.forceDepthPreview = true;
      if (cachedDepthFloat) processAndDisplayDepth();
    };
    const sliderBindings = [
      ['dm-depth-contrast', 'depthContrast', 'dm-depth-contrast-val', (v) => v.toFixed(2)],
      ['dm-foreground-boost', 'foregroundBoost', 'dm-foreground-boost-val', (v) => `${(v * 100).toFixed(0)}%`],
      ['dm-background-flatten', 'backgroundFlatten', 'dm-background-flatten-val', (v) => `${(v * 100).toFixed(0)}%`],
      ['dm-planar-smoothing', 'planarSmoothing', 'dm-planar-smoothing-val', (v) => `${(v * 100).toFixed(0)}%`],
      ['dm-window-recess', 'windowRecess', 'dm-window-recess-val', (v) => `${(v * 100).toFixed(0)}%`],
      ['dm-edge-denoise', 'edgeDenoise', 'dm-edge-denoise-val', (v) => `${(v * 100).toFixed(0)}%`],
    ];
    sliderBindings.forEach(([id, key, outId, format]) => {
      const el = document.getElementById(id);
      el.addEventListener('input', (e) => {
        state[key] = parseFloat(e.target.value);
        document.getElementById(outId).textContent = format(state[key]);
        rerenderIfReady();
      });
    });
    document.getElementById('dm-stage-select').addEventListener('change', (e) => {
      state.previewStage = e.target.value;
      if (state.debugOutputs) showDepthResult();
    });

    /* ── Toggles ── */
    document.getElementById('dm-auto-sway').addEventListener('change', (e) => {
      state.autoSway = e.target.checked;
    });
    document.getElementById('dm-invert').addEventListener('change', (e) => {
      state.invert = e.target.checked;
      rerenderIfReady();
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
    state.origFeatures = null;
    state.debugOutputs = null;
    state.processedDepthFloat = null;

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
        document.getElementById('dm-download-preview-btn').style.display = 'none';

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

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp01((x - edge0) / ((edge1 - edge0) || 1e-6));
    return t * t * (3 - 2 * t);
  }

  function normalize01(src) {
    const n = src.length;
    const out = new Float32Array(n);
    let minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < n; i++) {
      if (src[i] < minV) minV = src[i];
      if (src[i] > maxV) maxV = src[i];
    }
    const range = maxV - minV || 1;
    for (let i = 0; i < n; i++) out[i] = (src[i] - minV) / range;
    return out;
  }

  function robustNormalize(src, lowQ = 0.01, highQ = 0.99) {
    const n = src.length;
    let minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < n; i++) {
      if (src[i] < minV) minV = src[i];
      if (src[i] > maxV) maxV = src[i];
    }
    const hist = new Uint32Array(1024);
    const span = maxV - minV || 1;
    for (let i = 0; i < n; i++) {
      const bin = Math.max(0, Math.min(1023, Math.floor(((src[i] - minV) / span) * 1023)));
      hist[bin]++;
    }
    const lowTarget = Math.floor(n * lowQ);
    const highTarget = Math.floor(n * highQ);
    let acc = 0;
    let lowBin = 0;
    let highBin = 1023;
    for (let i = 0; i < hist.length; i++) {
      acc += hist[i];
      if (acc >= lowTarget) { lowBin = i; break; }
    }
    acc = 0;
    for (let i = 0; i < hist.length; i++) {
      acc += hist[i];
      if (acc >= highTarget) { highBin = i; break; }
    }
    const low = minV + (lowBin / 1023) * span;
    const high = minV + (highBin / 1023) * span;
    const out = new Float32Array(n);
    const denom = high - low || 1;
    for (let i = 0; i < n; i++) out[i] = clamp01((src[i] - low) / denom);
    return out;
  }

  function gradientMagnitude(src, w, h) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - 1);
        const x1 = Math.min(w - 1, x + 1);
        const dx = src[y * w + x1] - src[y * w + x0];
        const dy = src[y1 * w + x] - src[y0 * w + x];
        out[y * w + x] = Math.sqrt(dx * dx + dy * dy);
      }
    }
    return out;
  }

  function blurFloat(src, w, h, radius) {
    const out = new Float32Array(w * h);
    const tmp = new Float32Array(w * h);
    boxMeanSep(src, w, h, radius, out, tmp);
    return out;
  }

  function floatToCanvas(src, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = Math.max(0, Math.min(255, Math.round(clamp01(src[i]) * 255)));
      imgData.data[i * 4] = v;
      imgData.data[i * 4 + 1] = v;
      imgData.data[i * 4 + 2] = v;
      imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  function masksToCanvas(backgroundMask, planeMask, windowMask, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      imgData.data[i * 4] = Math.round(clamp01(backgroundMask[i]) * 255);
      imgData.data[i * 4 + 1] = Math.round(clamp01(planeMask[i]) * 255);
      imgData.data[i * 4 + 2] = Math.round(clamp01(windowMask[i]) * 255);
      imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

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

  function getOrigFeatures() {
    if (state.origFeatures) return state.origFeatures;
    const img = state.originalImg;
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const gray = new Float32Array(W * H);
    const sat = new Float32Array(W * H);
    const val = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = d[i * 4] / 255;
      const g = d[i * 4 + 1] / 255;
      const b = d[i * 4 + 2] / 255;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const delta = maxC - minC;
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      val[i] = maxC;
      sat[i] = maxC > 1e-6 ? delta / maxC : 0;
    }
    state.origFeatures = { gray, sat, val };
    return state.origFeatures;
  }

  function buildBasReliefDepthMap(rawDepth, w, h) {
    const { gray, sat, val } = getOrigFeatures();
    const raw = normalize01(rawDepth);
    const normalized = robustNormalize(rawDepth, 0.01, 0.995);
    let depth = normalized.slice();

    const grayFine = blurFloat(gray, w, h, Math.max(2, Math.round(Math.min(w, h) / 220)));
    const grayMed = blurFloat(gray, w, h, Math.max(5, Math.round(Math.min(w, h) / 80)));
    const imgGrad = gradientMagnitude(gray, w, h);
    const depthGrad = gradientMagnitude(depth, w, h);

    const n = w * h;
    const backgroundMask = new Float32Array(n);
    const planeMask = new Float32Array(n);
    const windowMask = new Float32Array(n);
    const entranceMask = new Float32Array(n);
    const denoiseMask = new Float32Array(n);

    for (let y = 0; y < h; y++) {
      const yn = y / Math.max(1, h - 1);
      const topWeight = 1 - smoothstep(0.25, 0.65, yn);
      const bottomWeight = smoothstep(0.45, 0.95, yn);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const xn = x / Math.max(1, w - 1);
        const centerWeight = 1 - smoothstep(0.28, 0.55, Math.abs(xn - 0.5));
        const lowTexture = 1 - smoothstep(0.025, 0.11, imgGrad[i]);
        const lowDepthEdge = 1 - smoothstep(0.018, 0.09, depthGrad[i]);
        const textureResidual = Math.abs(gray[i] - grayFine[i]);
        const planeLike = lowTexture * lowDepthEdge * (1 - smoothstep(0.03, 0.14, textureResidual));

        const brightLowSat = smoothstep(0.62, 0.98, val[i]) * (1 - smoothstep(0.10, 0.32, sat[i]));
        const farAlready = 1 - smoothstep(0.18, 0.55, depth[i]);
        backgroundMask[i] = clamp01(Math.max(
          brightLowSat * lowTexture * topWeight,
          farAlready * topWeight * 0.8,
          farAlready * smoothstep(0.55, 1.0, sat[i]) * 0.45
        ));

        denoiseMask[i] = clamp01(planeLike * (0.45 + 0.55 * bottomWeight));
        planeMask[i] = clamp01(Math.max(
          planeLike * (0.35 + 0.65 * bottomWeight),
          planeLike * smoothstep(0.14, 0.82, depth[i]) * (1 - backgroundMask[i])
        ));

        const cavity = clamp01((grayMed[i] - gray[i] - 0.02) / 0.18);
        const facadeMask = (1 - backgroundMask[i]) * (1 - smoothstep(0.22, 0.65, sat[i]));
        const regularity = 1 - smoothstep(0.06, 0.22, textureResidual);
        windowMask[i] = clamp01(cavity * facadeMask * regularity * smoothstep(0.14, 0.85, depth[i]));
        entranceMask[i] = clamp01(cavity * facadeMask * centerWeight * smoothstep(0.55, 1.0, yn));
      }
    }

    for (let i = 0; i < n; i++) {
      depth[i] = lerp(depth[i], 0.02, state.backgroundFlatten * backgroundMask[i]);
    }

    const smallDenoise = blurFloat(depth, w, h, Math.max(2, Math.round(Math.min(w, h) / 260)));
    for (let i = 0; i < n; i++) {
      depth[i] = lerp(depth[i], smallDenoise[i], state.edgeDenoise * denoiseMask[i]);
    }

    const planeSmoothed = blurFloat(depth, w, h, Math.max(6, Math.round(Math.min(w, h) / 46)));
    for (let i = 0; i < n; i++) {
      const blend = state.planarSmoothing * planeMask[i] * (1 - 0.65 * windowMask[i]);
      depth[i] = lerp(depth[i], planeSmoothed[i], blend);
    }
    const smoothed = depth.slice();

    for (let i = 0; i < n; i++) {
      const recess = state.windowRecess * (0.14 * windowMask[i] + 0.22 * entranceMask[i]);
      depth[i] = clamp01(depth[i] - recess);
    }

    for (let i = 0; i < n; i++) {
      const nearMask = smoothstep(0.55, 0.95, depth[i]) * (1 - backgroundMask[i]);
      depth[i] = clamp01(depth[i] + state.foregroundBoost * nearMask * (1 - depth[i]) * 0.55);
      depth[i] = clamp01((depth[i] - 0.5) * state.depthContrast + 0.5);
      depth[i] = lerp(depth[i], 0.02, state.backgroundFlatten * backgroundMask[i] * 0.5);
    }

    const finalDepth = robustNormalize(depth, 0.003, 0.997);
    return {
      raw,
      normalized,
      smoothed,
      final: finalDepth,
      masksCanvas: masksToCanvas(backgroundMask, planeMask, windowMask, w, h),
    };
  }

  /* ── Multi-scale guided filter — 3 coarse→fine passes for progressive
       edge-detail transfer from the original image into the depth map ── */
  function multiScaleGuidedFilter(guide, src, w, h) {
    const dim = Math.min(w, h);
    const scales = [
      { radius: Math.max(8,  Math.round(dim / 20)),  eps: 0.02   },
      { radius: Math.max(4,  Math.round(dim / 60)),  eps: 0.004  },
      { radius: Math.max(2,  Math.round(dim / 160)), eps: 0.0008 }
    ];
    let result = src;
    for (const { radius, eps } of scales) {
      result = guidedFilterApply(guide, result, w, h, radius, eps);
    }
    return result;
  }

  /* ── Detail injection — extract high-frequency texture from original
       image at two scales and blend it into the depth map ── */
  function injectDetail(depth, guide, w, h, strength) {
    if (strength <= 0) return depth;
    const n = w * h;
    const blur1 = new Float32Array(n);
    const blur2 = new Float32Array(n);
    const tmp   = new Float32Array(n);
    const r1 = Math.max(2, Math.round(Math.min(w, h) / 150)); // fine texture
    const r2 = Math.max(5, Math.round(Math.min(w, h) / 50));  // medium features

    boxMeanSep(guide, w, h, r1, blur1, tmp);
    boxMeanSep(guide, w, h, r2, blur2, tmp);

    const result = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const fineDetail = guide[i] - blur1[i];    // fine edges & texture
      const medDetail  = blur1[i] - blur2[i];    // medium features
      result[i] = depth[i] + strength * (0.65 * fineDetail + 0.35 * medDetail);
    }

    // Renormalize to 0-1
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) {
      if (result[i] < mn) mn = result[i];
      if (result[i] > mx) mx = result[i];
    }
    const range = mx - mn || 1;
    for (let i = 0; i < n; i++) result[i] = (result[i] - mn) / range;
    return result;
  }

  /* ── Adaptive local contrast enhancement on depth ── */
  function depthContrastEnhance(depth, w, h) {
    const n = w * h;
    const blurred = new Float32Array(n);
    const tmp     = new Float32Array(n);
    const radius  = Math.max(6, Math.round(Math.min(w, h) / 30));
    boxMeanSep(depth, w, h, radius, blurred, tmp);

    // Compute local standard deviation for adaptive gain
    const sq = new Float32Array(n);
    for (let i = 0; i < n; i++) sq[i] = depth[i] * depth[i];
    const meanSq = new Float32Array(n);
    boxMeanSep(sq, w, h, radius, meanSq, tmp);

    // Global statistics
    let gMean = 0;
    for (let i = 0; i < n; i++) gMean += depth[i];
    gMean /= n;
    let gVar = 0;
    for (let i = 0; i < n; i++) gVar += (depth[i] - gMean) * (depth[i] - gMean);
    const gStd = Math.sqrt(gVar / n) || 0.01;

    const result = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const localVar = Math.max(0, meanSq[i] - blurred[i] * blurred[i]);
      const localStd = Math.sqrt(localVar) || 0.001;
      // Adaptive gain: stretch local contrast toward global contrast
      const gain = Math.min(3.0, gStd / localStd);
      result[i] = gMean + gain * (depth[i] - blurred[i]);
    }

    // Clip to 0-1
    for (let i = 0; i < n; i++) result[i] = Math.max(0, Math.min(1, result[i]));
    return result;
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

      // ── 2. Run tiled or single-pass inference ──
      cachedDepthFloat = await tiledDepthInference(pipe);

      // ── 3. Post-process and display ──
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

  /* ── Full geometry-first bas-relief post-processing pipeline ── */
  function processAndDisplayDepth() {
    if (!cachedDepthFloat) return;
    const W = state.originalImg.naturalWidth;
    const H = state.originalImg.naturalHeight;
    const forceDepthPreview = state.forceDepthPreview;
    state.forceDepthPreview = false;
    const stages = buildBasReliefDepthMap(cachedDepthFloat, W, H);
    let depth = stages.final;

    // Invert if enabled
    if (state.invert) {
      const inv = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) inv[i] = 1 - depth[i];
      depth = inv;
    }

    const finalCanvas = floatToCanvas(depth, W, H);
    state.processedDepthFloat = depth;
    state.depthCanvas = finalCanvas;
    state.debugOutputs = {
      raw: floatToCanvas(stages.raw, W, H),
      normalized: floatToCanvas(stages.normalized, W, H),
      masks: stages.masksCanvas,
      smoothed: floatToCanvas(stages.smoothed, W, H),
      final: finalCanvas,
    };
    state.depthFullCanvas = state.debugOutputs[state.previewStage] || finalCanvas;

    // Show in result preview
    showDepthResult();

    // Setup or update 3D preview
    setup3DPreview();
    if (forceDepthPreview) {
      setResultView('depth');
    }
  }

  function showDepthResult() {
    const wrapEl = document.getElementById('dm-result-wrap');
    const stageCanvas = state.debugOutputs?.[state.previewStage] || state.depthFullCanvas;
    if (!stageCanvas) return;

    // Show depth map as image
    const dataUrl = stageCanvas.toDataURL('image/png');
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
      `${stageCanvas.width} × ${stageCanvas.height} px · ${state.previewStage}`;
    document.getElementById('dm-download-btn').style.display = '';
    document.getElementById('dm-download-preview-btn').style.display = '';

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

    // Apply a light Gaussian-ish blur (2-pass box blur, radius ~2-3 px)
    const imgData = ctx.getImageData(0, 0, sw, sh);
    const d = imgData.data;
    const gray = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) gray[i] = d[i * 4] / 255;

    const blurRadius = Math.max(1, Math.round(Math.min(sw, sh) / 250));
    let blurred = gray;
    for (let pass = 0; pass < 2; pass++) {
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

    // Preserve the current preview mode so parameter tweaks can be watched live
    setResultView(state.resultView || 'depth');
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
  function crc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return (crc ^ -1) >>> 0;
  }

  function pngChunk(type, data) {
    const typeBytes = new TextEncoder().encode(type);
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set(typeBytes, 4);
    chunk.set(data, 8);
    const crc = crc32(chunk.subarray(4, 8 + data.length));
    view.setUint32(8 + data.length, crc);
    return chunk;
  }

  async function encodeGrayscale16PNG(src, w, h) {
    const stride = 1 + w * 2;
    const raw = new Uint8Array(stride * h);
    for (let y = 0; y < h; y++) {
      const row = y * stride;
      raw[row] = 0;
      for (let x = 0; x < w; x++) {
        const v16 = Math.max(0, Math.min(65535, Math.round(clamp01(src[y * w + x]) * 65535)));
        raw[row + 1 + x * 2] = (v16 >> 8) & 255;
        raw[row + 2 + x * 2] = v16 & 255;
      }
    }
    const compressed = await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))
    ).arrayBuffer();
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = new Uint8Array(13);
    const ihdrView = new DataView(ihdr.buffer);
    ihdrView.setUint32(0, w);
    ihdrView.setUint32(4, h);
    ihdr[8] = 16;
    ihdr[9] = 0;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    return new Blob([
      signature,
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', new Uint8Array(compressed)),
      pngChunk('IEND', new Uint8Array(0)),
    ], { type: 'image/png' });
  }

  async function downloadDepthMap() {
    if (!state.processedDepthFloat || !state.originalImg) return;
    const stem = state.file?.name ? state.file.name.replace(/\.[^.]+$/, '') : 'image';
    const filename = `${stem}_heightmap16_${state.modelSize}${state.invert ? '_inv' : ''}.png`;
    let blob;
    try {
      blob = await encodeGrayscale16PNG(
        state.processedDepthFloat,
        state.originalImg.naturalWidth,
        state.originalImg.naturalHeight,
      );
    } catch {
      blob = await new Promise((resolve) => state.depthCanvas.toBlob(resolve, 'image/png'));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function downloadPreviewStage() {
    const canvas = state.debugOutputs?.[state.previewStage];
    if (!canvas) return;
    const stem = state.file?.name ? state.file.name.replace(/\.[^.]+$/, '') : 'image';
    const filename = `${stem}_${state.previewStage}.png`;
    canvas.toBlob((blob) => {
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
