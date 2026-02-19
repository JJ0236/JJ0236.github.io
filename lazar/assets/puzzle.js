/**
 * LAZAR Puzzle Generator
 * Generates jigsaw puzzle cut-line SVG patterns for laser cutting.
 * Injected into the LAZAR app — hooks into the "Puzzle" button under Cut / Prep.
 */
(function () {
  'use strict';

  // ─── Seeded PRNG (Mulberry32) ──────────────────────────────────────
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ─── Jigsaw Edge Builder ───────────────────────────────────────────
  // Builds an SVG sub-path for one cell edge with a tab (or straight if border).
  // (x0,y0) → (x1,y1).  dir = +1 tab pokes "left" of travel, -1 "right".
  // jitter ∈ [0,1] adds organic feel.
  function jigsawEdge(x0, y0, x1, y1, dir, tabScale, jitter, rng) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    // unit tangent & normal
    const tx = dx / len, ty = dy / len;
    const nx = -ty * dir, ny = tx * dir;

    const ts = tabScale * len;            // absolute tab size
    const j = jitter * len * 0.04;        // jitter magnitude

    // key fractions along the edge
    const a = 0.34 + (rng() - 0.5) * jitter * 0.06;
    const b = 0.66 + (rng() - 0.5) * jitter * 0.06;
    const neck = ts * (0.08 + rng() * jitter * 0.04);
    const bulge = ts * (0.90 + rng() * jitter * 0.15);

    // helper: point along edge + normal offset
    const p = (t, nOff) => {
      const jx = (rng() - 0.5) * j, jy = (rng() - 0.5) * j;
      return [
        x0 + dx * t + nx * nOff + jx,
        y0 + dy * t + ny * nOff + jy
      ];
    };

    const pA = p(a, 0);
    const pB = p(b, 0);

    // control points for the tab
    const c1 = p(a - 0.02, neck);
    const c2 = p(a - 0.02, bulge);
    const c3 = p(a + 0.06, bulge + ts * 0.12);
    const peak1 = p(0.5, bulge + ts * 0.14);
    const c4 = p(b - 0.06, bulge + ts * 0.12);
    const c5 = p(b + 0.02, bulge);
    const c6 = p(b + 0.02, neck);

    let d = '';
    d += `L ${pA[0].toFixed(2)} ${pA[1].toFixed(2)} `;
    d += `C ${c1[0].toFixed(2)} ${c1[1].toFixed(2)}, ${c2[0].toFixed(2)} ${c2[1].toFixed(2)}, ${c3[0].toFixed(2)} ${c3[1].toFixed(2)} `;
    d += `Q ${peak1[0].toFixed(2)} ${peak1[1].toFixed(2)}, ${c4[0].toFixed(2)} ${c4[1].toFixed(2)} `;
    d += `C ${c5[0].toFixed(2)} ${c5[1].toFixed(2)}, ${c6[0].toFixed(2)} ${c6[1].toFixed(2)}, ${pB[0].toFixed(2)} ${pB[1].toFixed(2)} `;
    d += `L ${x1.toFixed(2)} ${y1.toFixed(2)} `;
    return d;
  }

  // ─── Generate Puzzle Paths ──────────────────────────────────────────
  function generatePuzzleSVG(opts) {
    const {
      width = 200,     // mm or px
      height = 150,
      cols = 5,
      rows = 4,
      tabScale = 0.22,
      jitter = 0.5,
      seed = 42,
      strokeColor = '#e94560',
      strokeWidth = 0.5,
      cornerRadius = 0
    } = opts;

    const rng = mulberry32(seed);
    const cw = width / cols;
    const ch = height / rows;

    // Pre-compute random tab directions
    // Horizonal edges: (rows-1) × cols   — between row i and i+1
    // Vertical edges:  rows × (cols-1)   — between col j and j+1
    const hDirs = [];
    for (let i = 0; i < rows - 1; i++) {
      hDirs[i] = [];
      for (let j = 0; j < cols; j++) {
        hDirs[i][j] = rng() > 0.5 ? 1 : -1;
      }
    }
    const vDirs = [];
    for (let i = 0; i < rows; i++) {
      vDirs[i] = [];
      for (let j = 0; j < cols - 1; j++) {
        vDirs[i][j] = rng() > 0.5 ? 1 : -1;
      }
    }

    let paths = '';

    // ── Horizontal internal edges ────────────────────────────────────
    for (let i = 1; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const x0 = j * cw, y0 = i * ch;
        const x1 = (j + 1) * cw, y1 = i * ch;
        const dir = hDirs[i - 1][j];
        const d = `M ${x0.toFixed(2)} ${y0.toFixed(2)} ` + jigsawEdge(x0, y0, x1, y1, dir, tabScale, jitter, rng);
        paths += `<path d="${d}" />\n`;
      }
    }

    // ── Vertical internal edges ──────────────────────────────────────
    for (let i = 0; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        const x0 = j * cw, y0 = i * ch;
        const x1 = j * cw, y1 = (i + 1) * ch;
        const dir = vDirs[i][j - 1];
        const d = `M ${x0.toFixed(2)} ${y0.toFixed(2)} ` + jigsawEdge(x0, y0, x1, y1, dir, tabScale, jitter, rng);
        paths += `<path d="${d}" />\n`;
      }
    }

    // ── Border rectangle ─────────────────────────────────────────────
    if (cornerRadius > 0) {
      const r = Math.min(cornerRadius, cw / 2, ch / 2);
      paths += `<rect x="0" y="0" width="${width}" height="${height}" rx="${r}" ry="${r}" />\n`;
    } else {
      paths += `<rect x="0" y="0" width="${width}" height="${height}" />\n`;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <g fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
${paths}  </g>
</svg>`;
    return svg;
  }

  // ─── Inject CSS ────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('puzzle-styles')) return;
    const style = document.createElement('style');
    style.id = 'puzzle-styles';
    style.textContent = `
      /* ── Puzzle Modal Overlay ── */
      .puzzle-overlay {
        position: fixed; inset: 0;
        background: rgba(10,10,26,0.82);
        backdrop-filter: blur(6px);
        z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        animation: puzzleFadeIn .2s ease;
      }
      @keyframes puzzleFadeIn { from { opacity:0 } to { opacity:1 } }
      .puzzle-modal {
        background: var(--bg-card, #1e1e3a);
        border: 1px solid var(--border, #2a2a4a);
        border-radius: var(--radius-lg, 10px);
        box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,.4));
        width: 820px; max-width: 95vw;
        max-height: 92vh;
        display: flex; flex-direction: column;
        overflow: hidden;
        color: var(--text-primary, #e0e0e0);
        font-family: var(--font-family, 'Inter', sans-serif);
      }
      /* Header */
      .puzzle-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border, #2a2a4a);
        background: var(--bg-secondary, #16213e);
      }
      .puzzle-header h2 {
        font-size: 16px; font-weight: 600; margin: 0;
        display: flex; align-items: center; gap: 8px;
      }
      .puzzle-header h2 svg { color: var(--accent, #e94560); }
      .puzzle-close {
        background: var(--bg-tertiary, #0f3460);
        border: 1px solid var(--border, #2a2a4a);
        color: var(--text-secondary, #a0a0b0);
        width: 32px; height: 32px;
        border-radius: var(--radius, 6px);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; font-size: 18px; line-height: 1;
        transition: all .15s ease;
      }
      .puzzle-close:hover { background: var(--danger, #f44336); color: #fff; }
      /* Body */
      .puzzle-body {
        display: flex; flex: 1; overflow: hidden;
      }
      /* Controls sidebar */
      .puzzle-controls {
        width: 240px; min-width: 240px;
        padding: 16px;
        border-right: 1px solid var(--border, #2a2a4a);
        background: var(--bg-secondary, #16213e);
        overflow-y: auto;
        display: flex; flex-direction: column; gap: 14px;
      }
      .puzzle-control-group { display: flex; flex-direction: column; gap: 4px; }
      .puzzle-control-group label {
        font-size: 12px; font-weight: 500;
        color: var(--text-secondary, #a0a0b0);
        display: flex; justify-content: space-between;
      }
      .puzzle-control-group label span {
        color: var(--accent, #e94560); font-weight: 600;
      }
      .puzzle-control-group input[type=range] {
        -webkit-appearance: none; width: 100%; height: 6px;
        border-radius: 3px;
        background: var(--bg-input, #252545);
        outline: none;
      }
      .puzzle-control-group input[type=range]::-webkit-slider-thumb {
        -webkit-appearance: none; width: 16px; height: 16px;
        border-radius: 50%; background: var(--accent, #e94560);
        cursor: pointer; border: 2px solid var(--bg-card, #1e1e3a);
      }
      .puzzle-control-group input[type=number],
      .puzzle-control-group input[type=text],
      .puzzle-control-group select {
        background: var(--bg-input, #252545);
        border: 1px solid var(--border, #2a2a4a);
        border-radius: var(--radius, 6px);
        color: var(--text-primary, #e0e0e0);
        padding: 7px 10px; font-size: 13px;
        outline: none; width: 100%;
        transition: border-color .15s ease;
      }
      .puzzle-control-group input:focus,
      .puzzle-control-group select:focus {
        border-color: var(--accent, #e94560);
      }
      .puzzle-control-group .input-row {
        display: flex; gap: 8px;
      }
      .puzzle-control-group .input-row > * { flex: 1; }

      /* Dimension inputs */
      .puzzle-dim-row {
        display: flex; gap: 8px; align-items: center;
      }
      .puzzle-dim-row input {
        width: 70px !important; flex: none !important;
        text-align: center;
      }
      .puzzle-dim-row .dim-x {
        color: var(--text-muted, #6a6a80);
        font-size: 14px; font-weight: 600;
      }
      .puzzle-dim-row select {
        width: 60px !important; flex: none !important;
      }

      /* Piece count display */
      .puzzle-piece-count {
        text-align: center;
        padding: 8px;
        background: var(--bg-input, #252545);
        border-radius: var(--radius, 6px);
        font-size: 13px;
        color: var(--text-secondary, #a0a0b0);
        border: 1px solid var(--border, #2a2a4a);
      }
      .puzzle-piece-count strong {
        color: var(--accent, #e94560);
        font-size: 18px;
      }

      /* Buttons */
      .puzzle-btn {
        padding: 9px 16px;
        border-radius: var(--radius, 6px);
        font-size: 13px; font-weight: 500;
        cursor: pointer; border: none;
        transition: all .15s ease;
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }
      .puzzle-btn-primary {
        background: var(--accent, #e94560);
        color: #fff;
      }
      .puzzle-btn-primary:hover { background: var(--accent-hover, #ff6b81); }
      .puzzle-btn-secondary {
        background: var(--bg-tertiary, #0f3460);
        color: var(--text-primary, #e0e0e0);
        border: 1px solid var(--border, #2a2a4a);
      }
      .puzzle-btn-secondary:hover { background: var(--bg-input, #252545); }
      .puzzle-btn-group {
        display: flex; flex-direction: column; gap: 8px;
        margin-top: auto;
        padding-top: 12px;
        border-top: 1px solid var(--border, #2a2a4a);
      }

      /* Preview area */
      .puzzle-preview {
        flex: 1; display: flex; align-items: center; justify-content: center;
        background: var(--bg-dark, #0a0a1a);
        position: relative; overflow: hidden;
        min-height: 300px;
      }
      .puzzle-preview svg {
        max-width: 90%; max-height: 90%;
        filter: drop-shadow(0 0 8px rgba(233,69,96,0.15));
      }
      .puzzle-preview .checkerboard {
        position: absolute; inset: 0;
        background-image:
          linear-gradient(45deg, #151530 25%, transparent 25%),
          linear-gradient(-45deg, #151530 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #151530 75%),
          linear-gradient(-45deg, transparent 75%, #151530 75%);
        background-size: 20px 20px;
        background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
        opacity: 0.3;
      }
      .puzzle-preview-hint {
        color: var(--text-muted, #6a6a80);
        font-size: 13px; text-align: center;
        position: absolute;
        bottom: 12px; left: 0; right: 0;
      }

      /* Image upload area */
      .puzzle-upload-zone {
        border: 2px dashed var(--border-light, #3a3a5a);
        border-radius: var(--radius, 6px);
        padding: 12px;
        text-align: center;
        cursor: pointer;
        transition: all .15s ease;
        font-size: 12px;
        color: var(--text-muted, #6a6a80);
      }
      .puzzle-upload-zone:hover {
        border-color: var(--accent, #e94560);
        color: var(--text-secondary, #a0a0b0);
      }
      .puzzle-upload-zone.has-image {
        border-color: var(--success, #4caf50);
        color: var(--success, #4caf50);
      }

      /* Footer */
      .puzzle-footer {
        padding: 12px 20px;
        border-top: 1px solid var(--border, #2a2a4a);
        background: var(--bg-secondary, #16213e);
        display: flex; justify-content: space-between; align-items: center;
        font-size: 12px; color: var(--text-muted, #6a6a80);
      }

      /* Separator */
      .puzzle-sep {
        height: 1px;
        background: var(--border, #2a2a4a);
        margin: 2px 0;
      }

      /* Preset chips */
      .puzzle-presets {
        display: flex; flex-wrap: wrap; gap: 4px;
      }
      .puzzle-preset-chip {
        padding: 4px 10px;
        border-radius: 20px;
        font-size: 11px; font-weight: 500;
        background: var(--bg-input, #252545);
        color: var(--text-secondary, #a0a0b0);
        border: 1px solid var(--border, #2a2a4a);
        cursor: pointer;
        transition: all .15s ease;
      }
      .puzzle-preset-chip:hover,
      .puzzle-preset-chip.active {
        background: var(--accent, #e94560);
        color: #fff;
        border-color: var(--accent, #e94560);
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Build Modal HTML ──────────────────────────────────────────────
  function buildModal() {
    injectStyles();

    const overlay = document.createElement('div');
    overlay.className = 'puzzle-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay);
    });

    overlay.innerHTML = `
      <div class="puzzle-modal">
        <div class="puzzle-header">
          <h2>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M17 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/>
            </svg>
            Puzzle Cut Generator
          </h2>
          <button class="puzzle-close" id="puzzleClose">&times;</button>
        </div>
        <div class="puzzle-body">
          <div class="puzzle-controls">

            <!-- Image upload -->
            <div class="puzzle-control-group">
              <label>Background Image (optional)</label>
              <div class="puzzle-upload-zone" id="puzzleUploadZone">
                Click or drop image here
                <input type="file" accept="image/*" id="puzzleImageInput" style="display:none" />
              </div>
            </div>

            <div class="puzzle-sep"></div>

            <!-- Dimensions -->
            <div class="puzzle-control-group">
              <label>Canvas Size</label>
              <div class="puzzle-dim-row">
                <input type="number" id="puzzleWidth" value="200" min="20" max="2000" />
                <span class="dim-x">×</span>
                <input type="number" id="puzzleHeight" value="150" min="20" max="2000" />
                <select id="puzzleUnit">
                  <option value="mm" selected>mm</option>
                  <option value="in">in</option>
                  <option value="px">px</option>
                </select>
              </div>
            </div>

            <!-- Presets -->
            <div class="puzzle-control-group">
              <label>Presets</label>
              <div class="puzzle-presets">
                <button class="puzzle-preset-chip" data-cols="3" data-rows="2">6 pc</button>
                <button class="puzzle-preset-chip" data-cols="4" data-rows="3">12 pc</button>
                <button class="puzzle-preset-chip active" data-cols="5" data-rows="4">20 pc</button>
                <button class="puzzle-preset-chip" data-cols="6" data-rows="5">30 pc</button>
                <button class="puzzle-preset-chip" data-cols="8" data-rows="6">48 pc</button>
                <button class="puzzle-preset-chip" data-cols="10" data-rows="8">80 pc</button>
              </div>
            </div>

            <!-- Grid -->
            <div class="puzzle-control-group">
              <label>Columns <span id="colsVal">5</span></label>
              <input type="range" id="puzzleCols" min="2" max="20" value="5" />
            </div>
            <div class="puzzle-control-group">
              <label>Rows <span id="rowsVal">4</span></label>
              <input type="range" id="puzzleRows" min="2" max="20" value="4" />
            </div>

            <div class="puzzle-piece-count">
              <strong id="pieceCount">20</strong> pieces
            </div>

            <div class="puzzle-sep"></div>

            <!-- Tab size -->
            <div class="puzzle-control-group">
              <label>Tab Size <span id="tabVal">22%</span></label>
              <input type="range" id="puzzleTab" min="10" max="40" value="22" />
            </div>

            <!-- Jitter / organic feel -->
            <div class="puzzle-control-group">
              <label>Organic Feel <span id="jitterVal">50%</span></label>
              <input type="range" id="puzzleJitter" min="0" max="100" value="50" />
            </div>

            <!-- Stroke width -->
            <div class="puzzle-control-group">
              <label>Stroke Width <span id="strokeVal">0.5</span></label>
              <input type="range" id="puzzleStroke" min="1" max="30" value="5" step="1" />
            </div>

            <!-- Stroke color -->
            <div class="puzzle-control-group">
              <label>Cut Color</label>
              <div class="input-row">
                <select id="puzzleColor">
                  <option value="#e94560">Red (default)</option>
                  <option value="#ff0000">Pure Red</option>
                  <option value="#0000ff">Blue</option>
                  <option value="#000000">Black</option>
                  <option value="#00ff00">Green</option>
                  <option value="custom">Custom…</option>
                </select>
              </div>
            </div>

            <!-- Seed -->
            <div class="puzzle-control-group">
              <label>Random Seed <span id="seedVal">42</span></label>
              <input type="range" id="puzzleSeed" min="1" max="999" value="42" />
            </div>

            <!-- Corner radius -->
            <div class="puzzle-control-group">
              <label>Corner Radius <span id="cornerVal">0</span></label>
              <input type="range" id="puzzleCorner" min="0" max="20" value="0" />
            </div>

            <div class="puzzle-btn-group">
              <button class="puzzle-btn puzzle-btn-secondary" id="puzzleRandomize">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                Randomize
              </button>
              <button class="puzzle-btn puzzle-btn-primary" id="puzzleDownload">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download SVG
              </button>
              <button class="puzzle-btn puzzle-btn-secondary" id="puzzleApply">
                Apply to Canvas
              </button>
            </div>
          </div>
          <div class="puzzle-preview" id="puzzlePreview">
            <div class="checkerboard"></div>
            <div id="puzzleSvgContainer"></div>
            <div class="puzzle-preview-hint">Live preview — adjust controls to update</div>
          </div>
        </div>
        <div class="puzzle-footer">
          <span>Paths are vector — ideal for laser cut layers</span>
          <span id="puzzlePathInfo"></span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    return overlay;
  }

  // ─── Close Modal ───────────────────────────────────────────────────
  function closeModal(overlay) {
    overlay.style.animation = 'puzzleFadeIn .15s ease reverse';
    setTimeout(() => overlay.remove(), 140);
  }

  // ─── Controller ────────────────────────────────────────────────────
  function openPuzzleModal() {
    const overlay = buildModal();

    // Elements
    const $ = (id) => document.getElementById(id);
    const cols      = $('puzzleCols');
    const rows      = $('puzzleRows');
    const colsVal   = $('colsVal');
    const rowsVal   = $('rowsVal');
    const tabSlider = $('puzzleTab');
    const tabVal    = $('tabVal');
    const jitter    = $('puzzleJitter');
    const jitterVal = $('jitterVal');
    const stroke    = $('puzzleStroke');
    const strokeVal = $('strokeVal');
    const seedSlider = $('puzzleSeed');
    const seedVal   = $('seedVal');
    const corner    = $('puzzleCorner');
    const cornerVal = $('cornerVal');
    const widthIn   = $('puzzleWidth');
    const heightIn  = $('puzzleHeight');
    const colorSel  = $('puzzleColor');
    const container = $('puzzleSvgContainer');
    const pieceCount = $('pieceCount');
    const pathInfo  = $('puzzlePathInfo');
    const uploadZone = $('puzzleUploadZone');
    const imageInput = $('puzzleImageInput');

    let bgImageDataURL = null;

    // Try to grab the current image from LAZAR's canvas
    try {
      const lazarCanvas = document.querySelector('.canvas-area canvas, .preview-canvas canvas, canvas');
      if (lazarCanvas && lazarCanvas.width > 0 && lazarCanvas.height > 0) {
        bgImageDataURL = lazarCanvas.toDataURL('image/png');
        // Auto-set dimensions from canvas
        widthIn.value = lazarCanvas.width;
        heightIn.value = lazarCanvas.height;
        uploadZone.textContent = 'Using current canvas image';
        uploadZone.classList.add('has-image');
      }
    } catch (e) { /* cross-origin or no canvas */ }

    function getOpts() {
      const w = parseInt(widthIn.value) || 200;
      const h = parseInt(heightIn.value) || 150;
      return {
        width: w,
        height: h,
        cols: parseInt(cols.value),
        rows: parseInt(rows.value),
        tabScale: parseInt(tabSlider.value) / 100,
        jitter: parseInt(jitter.value) / 100,
        seed: parseInt(seedSlider.value),
        strokeColor: colorSel.value === 'custom' ? '#e94560' : colorSel.value,
        strokeWidth: parseInt(stroke.value) / 10,
        cornerRadius: parseInt(corner.value)
      };
    }

    function render() {
      const opts = getOpts();
      const svg = generatePuzzleSVG(opts);

      // If we have a background image, inject it into the SVG
      let displaySvg = svg;
      if (bgImageDataURL) {
        const imgTag = `<image href="${bgImageDataURL}" x="0" y="0" width="${opts.width}" height="${opts.height}" preserveAspectRatio="xMidYMid slice" opacity="0.5"/>`;
        displaySvg = svg.replace('<g ', imgTag + '\n  <g ');
      }

      container.innerHTML = displaySvg;
      colsVal.textContent = opts.cols;
      rowsVal.textContent = opts.rows;
      tabVal.textContent = opts.tabScale * 100 + '%';
      jitterVal.textContent = Math.round(opts.jitter * 100) + '%';
      strokeVal.textContent = opts.strokeWidth.toFixed(1);
      seedVal.textContent = opts.seed;
      cornerVal.textContent = opts.cornerRadius;
      pieceCount.textContent = opts.cols * opts.rows;

      // Count paths
      const pathCount = (svg.match(/<path/g) || []).length + (svg.match(/<rect/g) || []).length;
      pathInfo.textContent = `${pathCount} paths • ${opts.cols}×${opts.rows} grid`;
    }

    // Debounced render for range sliders
    let renderTimer;
    function debouncedRender() {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 30);
    }

    // Bind controls
    [cols, rows, tabSlider, jitter, stroke, seedSlider, corner].forEach(el => {
      el.addEventListener('input', debouncedRender);
    });
    [widthIn, heightIn].forEach(el => {
      el.addEventListener('change', render);
    });
    colorSel.addEventListener('change', render);

    // Presets
    overlay.querySelectorAll('.puzzle-preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        overlay.querySelectorAll('.puzzle-preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        cols.value = chip.dataset.cols;
        rows.value = chip.dataset.rows;
        render();
      });
    });

    // Randomize
    $('puzzleRandomize').addEventListener('click', () => {
      seedSlider.value = Math.floor(Math.random() * 999) + 1;
      render();
    });

    // Download SVG
    $('puzzleDownload').addEventListener('click', () => {
      const opts = getOpts();
      let svg = generatePuzzleSVG(opts);

      // Add unit to SVG dimensions
      const unit = $('puzzleUnit').value;
      if (unit !== 'px') {
        svg = svg.replace(
          `width="${opts.width}" height="${opts.height}"`,
          `width="${opts.width}${unit}" height="${opts.height}${unit}"`
        );
      }

      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `puzzle-${opts.cols}x${opts.rows}-${opts.seed}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Apply to canvas — try to overlay on LAZAR's existing canvas
    $('puzzleApply').addEventListener('click', () => {
      const opts = getOpts();
      const svg = generatePuzzleSVG(opts);

      // Try to find LAZAR's canvas and draw the puzzle lines on top
      try {
        const lazarCanvas = document.querySelector('.canvas-area canvas, .preview-canvas canvas, canvas');
        if (lazarCanvas) {
          const ctx = lazarCanvas.getContext('2d');
          const img = new Image();
          const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
          const svgUrl = URL.createObjectURL(svgBlob);
          img.onload = () => {
            ctx.drawImage(img, 0, 0, lazarCanvas.width, lazarCanvas.height);
            URL.revokeObjectURL(svgUrl);
            closeModal(overlay);
          };
          img.src = svgUrl;
        } else {
          // Fallback: just download
          $('puzzleDownload').click();
        }
      } catch (e) {
        $('puzzleDownload').click();
      }
    });

    // Image upload
    uploadZone.addEventListener('click', () => imageInput.click());
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.style.borderColor = 'var(--accent)'; });
    uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = ''; });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = '';
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) loadImage(file);
    });
    imageInput.addEventListener('change', (e) => {
      if (e.target.files[0]) loadImage(e.target.files[0]);
    });

    function loadImage(file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        bgImageDataURL = ev.target.result;
        uploadZone.textContent = file.name;
        uploadZone.classList.add('has-image');

        // Auto-detect dimensions
        const img = new Image();
        img.onload = () => {
          widthIn.value = img.naturalWidth;
          heightIn.value = img.naturalHeight;
          render();
        };
        img.src = bgImageDataURL;
      };
      reader.readAsDataURL(file);
    }

    // Close
    $('puzzleClose').addEventListener('click', () => closeModal(overlay));
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        closeModal(overlay);
        document.removeEventListener('keydown', escHandler);
      }
    });

    // Initial render
    render();
  }

  // ─── Hook into LAZAR's Puzzle button ───────────────────────────────
  function hookPuzzleButton() {
    // Use event delegation on the body to catch clicks on the Puzzle dropdown item
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-dropdown-item');
      if (btn && btn.textContent.trim() === 'Puzzle') {
        e.preventDefault();
        e.stopPropagation();
        // Small delay to let LAZAR's dropdown close
        setTimeout(() => openPuzzleModal(), 50);
      }
    }, true);  // capture phase to intercept before React's handler
  }

  // ─── Init ──────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookPuzzleButton);
  } else {
    hookPuzzleButton();
  }

  // Also expose globally for debugging
  window.LAZAR_Puzzle = { openPuzzleModal, generatePuzzleSVG };

})();
