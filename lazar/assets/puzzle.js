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

  // ─── Edge Shape Catalog ─────────────────────────────────────────────
  // Each shape function returns an SVG sub-path string from (x0,y0)→(x1,y1).
  // dir: +1/-1 (which side the tab pokes), rng: seeded random, j: jitter scale

  const EDGE_STYLES = {

    // ── 0. Classic rounded tab ──────────────────────────────────────
    classic(x0, y0, x1, y1, dir, ts, j, rng) {
      const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx*dx+dy*dy);
      const nx = (-dy/len)*dir, ny = (dx/len)*dir;
      const jm = j * len * 0.04;
      const p = (t, n) => {
        const jx = (rng()-.5)*jm, jy = (rng()-.5)*jm;
        return [x0+dx*t+nx*n+jx, y0+dy*t+ny*n+jy];
      };
      const a = 0.34 + (rng()-.5)*j*0.06;
      const b = 0.66 + (rng()-.5)*j*0.06;
      const neck = ts*(0.08+rng()*j*0.04), bulge = ts*(0.90+rng()*j*0.15);
      const pA=p(a,0), pB=p(b,0);
      const c1=p(a-.02,neck), c2=p(a-.02,bulge), c3=p(a+.06,bulge+ts*.12);
      const pk=p(.5,bulge+ts*.14);
      const c4=p(b-.06,bulge+ts*.12), c5=p(b+.02,bulge), c6=p(b+.02,neck);
      const f = n => n.toFixed(2);
      return `L ${f(pA[0])} ${f(pA[1])} C ${f(c1[0])} ${f(c1[1])}, ${f(c2[0])} ${f(c2[1])}, ${f(c3[0])} ${f(c3[1])} Q ${f(pk[0])} ${f(pk[1])}, ${f(c4[0])} ${f(c4[1])} C ${f(c5[0])} ${f(c5[1])}, ${f(c6[0])} ${f(c6[1])}, ${f(pB[0])} ${f(pB[1])} L ${f(x1)} ${f(y1)} `;
    },

    // ── 1. Mushroom / wide head tab ─────────────────────────────────
    mushroom(x0, y0, x1, y1, dir, ts, j, rng) {
      const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx*dx+dy*dy);
      const nx = (-dy/len)*dir, ny = (dx/len)*dir;
      const jm = j * len * 0.035;
      const p = (t, n) => {
        const jx = (rng()-.5)*jm, jy = (rng()-.5)*jm;
        return [x0+dx*t+nx*n+jx, y0+dy*t+ny*n+jy];
      };
      const f = n => n.toFixed(2);
      const center = 0.5 + (rng()-.5)*j*0.08; // off-center tab!
      const neckW = 0.06 + rng()*j*0.03;  // narrow neck
      const headW = 0.16 + rng()*j*0.06;  // wide head
      const stemH = ts * (0.55 + rng()*j*0.2);
      const headH = ts * (0.35 + rng()*j*0.15);
      const pA = p(center-neckW, 0), pB = p(center+neckW, 0);
      // go up the narrow stem
      const s1 = p(center-neckW, stemH), s2 = p(center+neckW, stemH);
      // flare out to the mushroom cap
      const h1 = p(center-headW, stemH+headH*0.3);
      const h2 = p(center-headW*0.8, stemH+headH);
      const hTop = p(center, stemH+headH*1.1);
      const h3 = p(center+headW*0.8, stemH+headH);
      const h4 = p(center+headW, stemH+headH*0.3);
      return `L ${f(pA[0])} ${f(pA[1])} L ${f(s1[0])} ${f(s1[1])} C ${f(h1[0])} ${f(h1[1])}, ${f(h2[0])} ${f(h2[1])}, ${f(hTop[0])} ${f(hTop[1])} C ${f(h3[0])} ${f(h3[1])}, ${f(h4[0])} ${f(h4[1])}, ${f(s2[0])} ${f(s2[1])} L ${f(pB[0])} ${f(pB[1])} L ${f(x1)} ${f(y1)} `;
    },

    // ── 2. Pointed / arrow tab ──────────────────────────────────────
    arrow(x0, y0, x1, y1, dir, ts, j, rng) {
      const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx*dx+dy*dy);
      const nx = (-dy/len)*dir, ny = (dx/len)*dir;
      const jm = j * len * 0.03;
      const p = (t, n) => {
        const jx = (rng()-.5)*jm, jy = (rng()-.5)*jm;
        return [x0+dx*t+nx*n+jx, y0+dy*t+ny*n+jy];
      };
      const f = n => n.toFixed(2);
      const center = 0.5 + (rng()-.5)*j*0.1;
      const baseW = 0.12 + rng()*j*0.05;
      const tipH  = ts * (1.0 + rng()*j*0.3);
      const shoulder = ts * (0.4 + rng()*j*0.15);
      const pA = p(center-baseW, 0), pB = p(center+baseW, 0);
      const sA = p(center-baseW*1.3, shoulder);
      const tip = p(center, tipH);
      const sB = p(center+baseW*1.3, shoulder);
      return `L ${f(pA[0])} ${f(pA[1])} L ${f(sA[0])} ${f(sA[1])} L ${f(tip[0])} ${f(tip[1])} L ${f(sB[0])} ${f(sB[1])} L ${f(pB[0])} ${f(pB[1])} L ${f(x1)} ${f(y1)} `;
    },

    // ── 3. Curvy / s-curve double-bulge ─────────────────────────────
    curvy(x0, y0, x1, y1, dir, ts, j, rng) {
      const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx*dx+dy*dy);
      const nx = (-dy/len)*dir, ny = (dx/len)*dir;
      const jm = j * len * 0.04;
      const p = (t, n) => {
        const jx = (rng()-.5)*jm, jy = (rng()-.5)*jm;
        return [x0+dx*t+nx*n+jx, y0+dy*t+ny*n+jy];
      };
      const f = n => n.toFixed(2);
      const asym = (rng()-.5)*j*0.08; // asymmetry shift
      const h = ts * (0.85 + rng()*j*0.2);
      const c1 = p(0.2+asym, h*0.3);
      const c2 = p(0.3+asym, h*1.1);
      const mid = p(0.5+asym, h*0.95);
      const c3 = p(0.7+asym, h*1.1);
      const c4 = p(0.8+asym, h*0.3);
      return `C ${f(c1[0])} ${f(c1[1])}, ${f(c2[0])} ${f(c2[1])}, ${f(mid[0])} ${f(mid[1])} C ${f(c3[0])} ${f(c3[1])}, ${f(c4[0])} ${f(c4[1])}, ${f(x1)} ${f(y1)} `;
    },

    // ── 4. Keyhole tab ──────────────────────────────────────────────
    keyhole(x0, y0, x1, y1, dir, ts, j, rng) {
      const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx*dx+dy*dy);
      const nx = (-dy/len)*dir, ny = (dx/len)*dir;
      const jm = j * len * 0.03;
      const p = (t, n) => {
        const jx = (rng()-.5)*jm, jy = (rng()-.5)*jm;
        return [x0+dx*t+nx*n+jx, y0+dy*t+ny*n+jy];
      };
      const f = n => n.toFixed(2);
      const center = 0.5 + (rng()-.5)*j*0.06;
      const slotW = 0.04 + rng()*j*0.02; // very narrow slot
      const circR = 0.10 + rng()*j*0.04; // round head
      const stemH = ts * (0.5 + rng()*j*0.15);
      const circH = ts * (0.4 + rng()*j*0.1);
      const pA = p(center-slotW, 0), pB = p(center+slotW, 0);
      const s1 = p(center-slotW, stemH), s2 = p(center+slotW, stemH);
      // draw circle via two arcs
      const cTop = p(center, stemH+circH);
      const cLeft = p(center-circR, stemH+circH*0.5);
      const cRight = p(center+circR, stemH+circH*0.5);
      return `L ${f(pA[0])} ${f(pA[1])} L ${f(s1[0])} ${f(s1[1])} C ${f(s1[0])} ${f(s1[1])}, ${f(cLeft[0])} ${f(cLeft[1])}, ${f(cTop[0])} ${f(cTop[1])} C ${f(cRight[0])} ${f(cRight[1])}, ${f(s2[0])} ${f(s2[1])}, ${f(s2[0])} ${f(s2[1])} L ${f(pB[0])} ${f(pB[1])} L ${f(x1)} ${f(y1)} `;
    },

    // ── 5. Wavy / sine edge ─────────────────────────────────────────
    wavy(x0, y0, x1, y1, dir, ts, j, rng) {
      const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx*dx+dy*dy);
      const nx = (-dy/len)*dir, ny = (dx/len)*dir;
      const f = n => n.toFixed(2);
      const waves = 3 + Math.floor(rng() * 3); // 3-5 half-waves
      const amp = ts * (0.7 + rng()*j*0.3);
      let d = '';
      const segments = waves * 4; // 4 segments per half-wave for smooth curves
      for (let k = 1; k <= segments; k++) {
        const t = k / segments;
        const midT = (k - 0.5) / segments;
        // Proper sine wave: sin(t * π * waves) oscillates and returns to 0 at t=1
        const nOff = Math.sin(t * Math.PI * waves) * amp;
        const cOff = Math.sin(midT * Math.PI * waves) * amp;
        const jx = (rng()-.5)*j*len*0.01;
        const jy = (rng()-.5)*j*len*0.01;
        const px = x0 + dx*t + nx*nOff + jx;
        const py = y0 + dy*t + ny*nOff + jy;
        const cx = x0 + dx*midT + nx*cOff;
        const cy = y0 + dy*midT + ny*cOff;
        d += `Q ${f(cx)} ${f(cy)}, ${f(px)} ${f(py)} `;
      }
      d += `L ${f(x1)} ${f(y1)} `;
      return d;
    },

    // ── 6. Puzzle diamond tab ───────────────────────────────────────
    diamond(x0, y0, x1, y1, dir, ts, j, rng) {
      const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx*dx+dy*dy);
      const nx = (-dy/len)*dir, ny = (dx/len)*dir;
      const jm = j * len * 0.03;
      const p = (t, n) => {
        const jx = (rng()-.5)*jm, jy = (rng()-.5)*jm;
        return [x0+dx*t+nx*n+jx, y0+dy*t+ny*n+jy];
      };
      const f = n => n.toFixed(2);
      const center = 0.5 + (rng()-.5)*j*0.08;
      const w = 0.12 + rng()*j*0.05;
      const h = ts * (0.9 + rng()*j*0.25);
      const pA = p(center-w*0.3, 0), pB = p(center+w*0.3, 0);
      const left  = p(center-w, h*0.5);
      const top   = p(center, h);
      const right = p(center+w, h*0.5);
      return `L ${f(pA[0])} ${f(pA[1])} L ${f(left[0])} ${f(left[1])} L ${f(top[0])} ${f(top[1])} L ${f(right[0])} ${f(right[1])} L ${f(pB[0])} ${f(pB[1])} L ${f(x1)} ${f(y1)} `;
    },

    // ── 7. Heart-shaped tab ─────────────────────────────────────────
    heart(x0, y0, x1, y1, dir, ts, j, rng) {
      const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx*dx+dy*dy);
      const nx = (-dy/len)*dir, ny = (dx/len)*dir;
      const jm = j * len * 0.025;
      const p = (t, n) => {
        const jx = (rng()-.5)*jm, jy = (rng()-.5)*jm;
        return [x0+dx*t+nx*n+jx, y0+dy*t+ny*n+jy];
      };
      const f = n => n.toFixed(2);
      const center = 0.5 + (rng()-.5)*j*0.05;
      const w = 0.14 + rng()*j*0.04;
      const h = ts * (0.9 + rng()*j*0.2);
      // Entry & exit points on the edge
      const pA = p(center - w*0.25, 0);
      const pB = p(center + w*0.25, 0);
      // Left lobe: cubic bézier from pA curving out-left and up
      const cL1 = p(center - w*1.5, h*0.05);
      const cL2 = p(center - w*1.3, h*1.05);
      const topL = p(center - w*0.35, h*0.98);
      // Center notch (dip between the two lobes)
      const notch = p(center, h*0.65);
      // Right lobe: symmetric
      const topR = p(center + w*0.35, h*0.98);
      const cR1 = p(center + w*1.3, h*1.05);
      const cR2 = p(center + w*1.5, h*0.05);
      return `L ${f(pA[0])} ${f(pA[1])} ` +
        `C ${f(cL1[0])} ${f(cL1[1])}, ${f(cL2[0])} ${f(cL2[1])}, ${f(topL[0])} ${f(topL[1])} ` +
        `Q ${f(notch[0])} ${f(notch[1])}, ${f(topR[0])} ${f(topR[1])} ` +
        `C ${f(cR1[0])} ${f(cR1[1])}, ${f(cR2[0])} ${f(cR2[1])}, ${f(pB[0])} ${f(pB[1])} ` +
        `L ${f(x1)} ${f(y1)} `;
    }
  };

  const STYLE_NAMES = Object.keys(EDGE_STYLES);

  // ─── Unified edge dispatcher ──────────────────────────────────────
  // edgeStyle: 'classic' | 'mushroom' | ... | 'mixed' (random per edge)
  function jigsawEdge(x0, y0, x1, y1, dir, tabScale, jitter, rng, edgeStyle) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ts = tabScale * len;

    let style = edgeStyle;
    if (style === 'mixed') {
      // pick a random style for this edge
      style = STYLE_NAMES[Math.floor(rng() * STYLE_NAMES.length)];
    }
    const fn = EDGE_STYLES[style] || EDGE_STYLES.classic;
    return fn(x0, y0, x1, y1, dir, ts, jitter, rng);
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
      strokeColor = '#ff0000',
      strokeWidth = 0.035,
      cornerRadius = 0,
      edgeStyle = 'mixed',  // 'classic'|'mushroom'|'arrow'|'curvy'|'keyhole'|'wavy'|'diamond'|'heart'|'mixed'
      wobble = 0.35         // grid vertex wobble 0-1
    } = opts;

    const rng = mulberry32(seed);
    const cw = width / cols;
    const ch = height / rows;

    // ── Build wobbled grid vertices ──────────────────────────────────
    // vertices[i][j] = { x, y } — border vertices stay fixed
    const vertices = [];
    const wobbleX = wobble * cw * 0.18;
    const wobbleY = wobble * ch * 0.18;
    for (let i = 0; i <= rows; i++) {
      vertices[i] = [];
      for (let j = 0; j <= cols; j++) {
        let x = j * cw;
        let y = i * ch;
        // only wobble interior vertices (not borders)
        if (i > 0 && i < rows && j > 0 && j < cols) {
          x += (rng() - 0.5) * 2 * wobbleX;
          y += (rng() - 0.5) * 2 * wobbleY;
        }
        vertices[i][j] = { x, y };
      }
    }

    // Pre-compute random tab directions
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
        const v0 = vertices[i][j];
        const v1 = vertices[i][j + 1];
        const dir = hDirs[i - 1][j];
        const d = `M ${v0.x.toFixed(2)} ${v0.y.toFixed(2)} ` +
          jigsawEdge(v0.x, v0.y, v1.x, v1.y, dir, tabScale, jitter, rng, edgeStyle);
        paths += `<path d="${d}" />\n`;
      }
    }

    // ── Vertical internal edges ──────────────────────────────────────
    for (let i = 0; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        const v0 = vertices[i][j];
        const v1 = vertices[i + 1][j];
        const dir = vDirs[i][j - 1];
        const d = `M ${v0.x.toFixed(2)} ${v0.y.toFixed(2)} ` +
          jigsawEdge(v0.x, v0.y, v1.x, v1.y, dir, tabScale, jitter, rng, edgeStyle);
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
        width: 920px; max-width: 95vw;
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
        display: flex; flex: 1; overflow: hidden; min-height: 0;
      }
      /* Controls sidebar */
      .puzzle-controls {
        width: 260px; min-width: 260px;
        padding: 16px;
        border-right: 1px solid var(--border, #2a2a4a);
        background: var(--bg-secondary, #16213e);
        overflow-y: auto; overflow-x: hidden;
        display: flex; flex-direction: column; gap: 14px;
        flex-shrink: 0;
        scrollbar-width: thin;
        scrollbar-color: var(--border-light, #3a3a5a) transparent;
      }
      .puzzle-controls::-webkit-scrollbar { width: 6px; }
      .puzzle-controls::-webkit-scrollbar-track { background: transparent; }
      .puzzle-controls::-webkit-scrollbar-thumb {
        background: var(--border-light, #3a3a5a); border-radius: 3px;
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
        cursor: grab;
      }
      .puzzle-preview.grabbing { cursor: grabbing; }
      .puzzle-preview-pan {
        position: absolute;
        transform-origin: 0 0;
        transition: none;
        display: flex; align-items: center; justify-content: center;
        width: 100%; height: 100%;
        pointer-events: none;
      }
      .puzzle-preview-pan svg {
        max-width: 80%; max-height: 80%;
        filter: drop-shadow(0 0 8px rgba(233,69,96,0.15));
        pointer-events: none;
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
        pointer-events: none;
      }
      .puzzle-preview-hint {
        color: var(--text-muted, #6a6a80);
        font-size: 13px; text-align: center;
        position: absolute;
        bottom: 12px; left: 0; right: 0;
        pointer-events: none;
      }
      /* Zoom controls */
      .puzzle-zoom-controls {
        position: absolute; top: 10px; right: 10px;
        display: flex; gap: 4px; z-index: 2;
      }
      .puzzle-zoom-btn {
        width: 30px; height: 30px;
        border-radius: var(--radius, 6px);
        background: var(--bg-tertiary, #0f3460);
        border: 1px solid var(--border, #2a2a4a);
        color: var(--text-secondary, #a0a0b0);
        font-size: 16px; font-weight: 700;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; transition: all .15s ease;
      }
      .puzzle-zoom-btn:hover {
        background: var(--accent, #e94560); color: #fff;
        border-color: var(--accent, #e94560);
      }
      .puzzle-zoom-level {
        padding: 0 8px; line-height: 30px;
        font-size: 11px; font-weight: 600;
        color: var(--text-muted, #6a6a80);
        background: var(--bg-tertiary, #0f3460);
        border: 1px solid var(--border, #2a2a4a);
        border-radius: var(--radius, 6px);
        pointer-events: none;
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

      /* ── Collapsible controls toggle (hidden on desktop) ── */
      .puzzle-toggle-controls {
        display: none;
        width: 100%;
        padding: 10px 16px;
        background: var(--bg-secondary, #16213e);
        border: none;
        border-bottom: 1px solid var(--border, #2a2a4a);
        color: var(--text-primary, #e0e0e0);
        font-size: 13px; font-weight: 600;
        cursor: pointer;
        align-items: center; justify-content: center; gap: 6px;
        transition: background .15s ease;
      }
      .puzzle-toggle-controls:hover {
        background: var(--bg-tertiary, #0f3460);
      }
      .puzzle-toggle-controls svg {
        transition: transform .2s ease;
      }
      .puzzle-toggle-controls.open svg {
        transform: rotate(180deg);
      }

      /* ── Medium screens (tablets / narrow windows) ── */
      @media (max-width: 860px) {
        .puzzle-modal {
          width: 98vw; max-width: 98vw;
          max-height: 96vh;
          border-radius: 8px;
        }
        .puzzle-controls {
          width: 220px; min-width: 220px;
          padding: 12px;
          gap: 10px;
        }
        .puzzle-header { padding: 12px 16px; }
        .puzzle-header h2 { font-size: 14px; }
        .puzzle-footer { padding: 8px 16px; font-size: 11px; }
      }

      /* ── Small screens (phones / very narrow) ── */
      @media (max-width: 640px) {
        .puzzle-overlay {
          align-items: flex-end;
        }
        .puzzle-modal {
          width: 100vw; max-width: 100vw;
          max-height: 100vh; height: 100vh;
          border-radius: 12px 12px 0 0;
        }
        .puzzle-header {
          padding: 10px 14px;
          position: sticky; top: 0; z-index: 3;
        }
        .puzzle-header h2 { font-size: 14px; gap: 6px; }
        .puzzle-header h2 svg { width: 16px; height: 16px; }

        /* Stack body vertically */
        .puzzle-body {
          flex-direction: column;
          overflow-y: auto;
          overflow-x: hidden;
        }

        /* Show the toggle button */
        .puzzle-toggle-controls {
          display: flex;
        }

        /* Controls become collapsible full-width panel */
        .puzzle-controls {
          width: 100% !important; min-width: 0 !important;
          max-height: 0;
          overflow: hidden;
          border-right: none;
          border-bottom: 1px solid var(--border, #2a2a4a);
          padding: 0 14px;
          gap: 10px;
          transition: max-height .3s ease, padding .3s ease;
        }
        .puzzle-controls.expanded {
          max-height: 2000px;
          padding: 14px;
          overflow-y: auto;
        }

        /* Controls use 2-column grid on small screens */
        .puzzle-controls-inner {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .puzzle-controls-inner .puzzle-control-group.full-width,
        .puzzle-controls-inner .puzzle-sep,
        .puzzle-controls-inner .puzzle-piece-count,
        .puzzle-controls-inner .puzzle-btn-group {
          grid-column: 1 / -1;
        }

        /* Preview takes remaining space */
        .puzzle-preview {
          min-height: 250px;
          flex: 1;
        }

        /* Bigger touch targets */
        .puzzle-btn {
          padding: 12px 16px;
          font-size: 14px;
          min-height: 44px;
        }
        .puzzle-close {
          width: 36px; height: 36px;
          font-size: 20px;
        }
        .puzzle-preset-chip {
          padding: 6px 12px;
          font-size: 12px;
          min-height: 32px;
        }
        .puzzle-control-group input[type=range] {
          height: 8px;
        }
        .puzzle-control-group input[type=range]::-webkit-slider-thumb {
          width: 22px; height: 22px;
        }
        .puzzle-control-group select,
        .puzzle-control-group input[type=number] {
          padding: 10px 12px;
          font-size: 14px;
          min-height: 40px;
        }
        .puzzle-zoom-btn {
          width: 36px; height: 36px;
          font-size: 18px;
        }
        .puzzle-zoom-level {
          line-height: 36px;
          font-size: 12px;
        }
        .puzzle-footer {
          padding: 8px 14px;
          font-size: 11px;
          flex-wrap: wrap; gap: 4px;
        }
        .puzzle-dim-row {
          flex-wrap: wrap;
        }
        .puzzle-dim-row input {
          width: 60px !important;
        }
        .puzzle-upload-zone {
          padding: 14px;
          font-size: 13px;
        }
      }

      /* ── Very small screens ── */
      @media (max-width: 380px) {
        .puzzle-controls.expanded {
          padding: 10px;
        }
        .puzzle-controls-inner {
          grid-template-columns: 1fr;
        }
        .puzzle-header h2 { font-size: 13px; }
        .puzzle-btn { font-size: 13px; }
      }

      /* ── Short screens (landscape phone) ── */
      @media (max-height: 500px) {
        .puzzle-overlay { align-items: stretch; }
        .puzzle-modal {
          max-height: 100vh; height: 100vh;
          border-radius: 0;
        }
        .puzzle-body { flex-direction: row; }
        .puzzle-controls {
          width: 200px !important; min-width: 200px !important;
          max-height: none !important;
          overflow-y: auto;
          padding: 10px !important;
          gap: 8px;
        }
        .puzzle-toggle-controls { display: none !important; }
        .puzzle-header { padding: 6px 14px; }
        .puzzle-footer { padding: 6px 14px; }
        .puzzle-btn { padding: 6px 12px; font-size: 12px; min-height: 32px; }
        .puzzle-control-group label { font-size: 11px; }
        .puzzle-control-group select,
        .puzzle-control-group input[type=number] {
          padding: 5px 8px; font-size: 12px; min-height: 30px;
        }
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
          <button class="puzzle-toggle-controls" id="puzzleToggleControls">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            Controls
          </button>
          <div class="puzzle-controls" id="puzzleControlsPanel">

            <!-- Image upload -->
            <div class="puzzle-control-group full-width">
              <label>Background Image (optional)</label>
              <div class="puzzle-upload-zone" id="puzzleUploadZone">
                Click or drop image here
                <input type="file" accept="image/*" id="puzzleImageInput" style="display:none" />
              </div>
            </div>

            <div class="puzzle-sep"></div>

            <!-- Dimensions -->
            <div class="puzzle-control-group">
              <label>Canvas Size <span id="puzzleLockIcon" style="cursor:pointer;opacity:0.8" title="Toggle proportional lock">🔗</span></label>
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

            <!-- Edge Style -->
            <div class="puzzle-control-group">
              <label>Edge Style</label>
              <select id="puzzleEdgeStyle">
                <option value="mixed" selected>Mixed (funky!)</option>
                <option value="classic">Classic</option>
                <option value="mushroom">Mushroom</option>
                <option value="arrow">Arrow / Pointed</option>
                <option value="curvy">Curvy S-Bend</option>
                <option value="keyhole">Keyhole</option>
                <option value="wavy">Wavy</option>
                <option value="diamond">Diamond</option>
                <option value="heart">Heart</option>
              </select>
            </div>

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

            <!-- Grid wobble -->
            <div class="puzzle-control-group">
              <label>Grid Wobble <span id="wobbleVal">35%</span></label>
              <input type="range" id="puzzleWobble" min="0" max="100" value="35" />
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
            <div class="puzzle-preview-pan" id="puzzlePanLayer">
              <div id="puzzleSvgContainer"></div>
            </div>
            <div class="puzzle-zoom-controls">
              <button class="puzzle-zoom-btn" id="puzzleZoomIn" title="Zoom in">+</button>
              <span class="puzzle-zoom-level" id="puzzleZoomLevel">100%</span>
              <button class="puzzle-zoom-btn" id="puzzleZoomOut" title="Zoom out">&minus;</button>
              <button class="puzzle-zoom-btn" id="puzzleZoomFit" title="Fit to view">&#8596;</button>
            </div>
            <div class="puzzle-preview-hint">Scroll to zoom • drag to pan</div>
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

    const seedSlider = $('puzzleSeed');
    const seedVal   = $('seedVal');
    const corner    = $('puzzleCorner');
    const cornerVal = $('cornerVal');
    const wobbleSlider = $('puzzleWobble');
    const wobbleVal = $('wobbleVal');
    const edgeStyleSel = $('puzzleEdgeStyle');
    const widthIn   = $('puzzleWidth');
    const heightIn  = $('puzzleHeight');
    const unitSel   = $('puzzleUnit');
    let currentUnit = unitSel.value; // track for conversion

    const container = $('puzzleSvgContainer');
    const pieceCount = $('pieceCount');
    const pathInfo  = $('puzzlePathInfo');
    const uploadZone = $('puzzleUploadZone');
    const imageInput = $('puzzleImageInput');

    let bgImageDataURL = null;
    let aspectRatio = parseInt(widthIn.value) / parseInt(heightIn.value) || (4/3);
    let aspectLocked = true; // proportional by default
    const lockIcon = $('puzzleLockIcon');
    function updateLockUI() {
      lockIcon.textContent = aspectLocked ? '🔗' : '🔓';
      lockIcon.title = aspectLocked ? 'Proportions locked — click to unlock' : 'Proportions unlocked — click to lock';
    }
    updateLockUI();
    lockIcon.addEventListener('click', () => {
      aspectLocked = !aspectLocked;
      if (aspectLocked) aspectRatio = parseFloat(widthIn.value) / parseFloat(heightIn.value) || 1;
      updateLockUI();
    });

    // Keep dimensions proportional
    let dimChanging = false;
    function roundForUnit(v) {
      return currentUnit === 'in' ? parseFloat(v.toFixed(2)) : Math.round(v);
    }
    widthIn.addEventListener('input', () => {
      if (!aspectLocked || dimChanging) return;
      dimChanging = true;
      const w = parseFloat(widthIn.value) || 1;
      heightIn.value = roundForUnit(w / aspectRatio);
      dimChanging = false;
      debouncedRender();
    });
    heightIn.addEventListener('input', () => {
      if (!aspectLocked || dimChanging) return;
      dimChanging = true;
      const h = parseFloat(heightIn.value) || 1;
      widthIn.value = roundForUnit(h * aspectRatio);
      dimChanging = false;
      debouncedRender();
    });

    // Try to grab the current image from LAZAR's canvas
    try {
      const lazarCanvas = document.querySelector('.canvas-area canvas, .preview-canvas canvas, canvas');
      if (lazarCanvas && lazarCanvas.width > 0 && lazarCanvas.height > 0) {
        bgImageDataURL = lazarCanvas.toDataURL('image/png');
        // Auto-set dimensions from canvas
        widthIn.value = lazarCanvas.width;
        heightIn.value = lazarCanvas.height;
        aspectRatio = lazarCanvas.width / lazarCanvas.height;
        uploadZone.textContent = 'Using current canvas image';
        uploadZone.classList.add('has-image');
      }
    } catch (e) { /* cross-origin or no canvas */ }

    function getOpts() {
      const w = parseFloat(widthIn.value) || 200;
      const h = parseFloat(heightIn.value) || 150;
      return {
        width: w,
        height: h,
        cols: parseInt(cols.value),
        rows: parseInt(rows.value),
        tabScale: parseInt(tabSlider.value) / 100,
        jitter: parseInt(jitter.value) / 100,
        seed: parseInt(seedSlider.value),
        cornerRadius: parseInt(corner.value),
        edgeStyle: edgeStyleSel.value,
        wobble: parseInt(wobbleSlider.value) / 100
      };
    }

    function render() {
      const opts = getOpts();
      // Generate with export settings (thin red lines)
      const exportSvg = generatePuzzleSVG(opts);
      // Generate preview with thick visible lines
      const previewOpts = Object.assign({}, opts, { strokeColor: '#e94560', strokeWidth: Math.max(opts.width, opts.height) * 0.004 });
      const previewSvg = generatePuzzleSVG(previewOpts);

      // If we have a background image, inject it into the preview SVG
      let displaySvg = previewSvg;
      if (bgImageDataURL) {
        const imgTag = `<image href="${bgImageDataURL}" x="0" y="0" width="${opts.width}" height="${opts.height}" preserveAspectRatio="xMidYMid slice" opacity="0.5"/>`;
        displaySvg = previewSvg.replace('<g ', imgTag + '\n  <g ');
      }

      container.innerHTML = displaySvg;
      colsVal.textContent = opts.cols;
      rowsVal.textContent = opts.rows;
      tabVal.textContent = opts.tabScale * 100 + '%';
      jitterVal.textContent = Math.round(opts.jitter * 100) + '%';
      seedVal.textContent = opts.seed;
      cornerVal.textContent = opts.cornerRadius;
      wobbleVal.textContent = Math.round(opts.wobble * 100) + '%';
      pieceCount.textContent = opts.cols * opts.rows;

      // Count paths
      const pathCount = (exportSvg.match(/<path/g) || []).length + (exportSvg.match(/<rect/g) || []).length;
      pathInfo.textContent = `${pathCount} paths • ${opts.cols}×${opts.rows} • ${opts.edgeStyle} • export: red 0.1pt`;
    }

    // Debounced render for range sliders
    let renderTimer;
    function debouncedRender() {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 30);
    }

    // Bind controls
    [cols, rows, tabSlider, jitter, seedSlider, corner, wobbleSlider].forEach(el => {
      el.addEventListener('input', debouncedRender);
    });
    widthIn.addEventListener('change', render);
    heightIn.addEventListener('change', render);
    edgeStyleSel.addEventListener('change', render);

    // Unit conversion: when user switches mm ↔ in ↔ px, convert the numbers
    unitSel.addEventListener('change', () => {
      const newUnit = unitSel.value;
      const toMM = { mm: 1, in: 25.4, px: 25.4/96 };
      const w = parseFloat(widthIn.value) || 200;
      const h = parseFloat(heightIn.value) || 150;
      // Convert old-unit → mm → new-unit
      const wMM = w * toMM[currentUnit];
      const hMM = h * toMM[currentUnit];
      const fromMM = 1 / toMM[newUnit];
      // Round sensibly: mm/px to integers, inches to 2 decimals
      if (newUnit === 'in') {
        widthIn.value = (wMM * fromMM).toFixed(2);
        heightIn.value = (hMM * fromMM).toFixed(2);
        widthIn.step = '0.01';
        heightIn.step = '0.01';
      } else {
        widthIn.value = Math.round(wMM * fromMM);
        heightIn.value = Math.round(hMM * fromMM);
        widthIn.step = '1';
        heightIn.step = '1';
      }
      currentUnit = newUnit;
      aspectRatio = parseFloat(widthIn.value) / parseFloat(heightIn.value) || 1;
      render();
    });

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

    // Download SVG — exports with red #ff0000 lines, background image embedded
    $('puzzleDownload').addEventListener('click', () => {
      const opts = getOpts();
      const unit = $('puzzleUnit').value;

      // Stroke width: always 0.1pt ≈ 0.035mm.
      // Convert to whatever coordinate units the viewBox uses.
      if (unit === 'in') {
        opts.strokeWidth = 0.035 / 25.4;  // mm → in
      } else if (unit === 'px') {
        // 1px SVG user-unit at 96dpi ≈ 0.265mm, so 0.035mm ≈ 0.13px
        opts.strokeWidth = 0.13;
      } else {
        opts.strokeWidth = 0.035;          // mm (0.1pt)
      }

      let svg = generatePuzzleSVG(opts);

      // Embed background image behind the cut lines
      if (bgImageDataURL) {
        const imgTag = `  <image href="${bgImageDataURL}" x="0" y="0" width="${opts.width}" height="${opts.height}" preserveAspectRatio="xMidYMid slice"/>\n`;
        svg = svg.replace('  <g ', imgTag + '  <g ');
      }

      // Always stamp real units onto width/height so the SVG
      // opens at the correct physical size, not enormous px.
      svg = svg.replace(
        `width="${opts.width}" height="${opts.height}"`,
        `width="${opts.width}${unit}" height="${opts.height}${unit}"`
      );

      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `puzzle-${opts.cols}x${opts.rows}-${opts.seed}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Apply to canvas — uses export settings (red 0.1pt)
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
          aspectRatio = img.naturalWidth / img.naturalHeight;
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

    // ── Controls toggle (mobile) ──────────────────────────────────
    const toggleBtn = $('puzzleToggleControls');
    const controlsPanel = $('puzzleControlsPanel');
    toggleBtn.addEventListener('click', () => {
      controlsPanel.classList.toggle('expanded');
      toggleBtn.classList.toggle('open');
      toggleBtn.querySelector('svg');
    });

    // Initial render
    render();

    // ── Zoom & Pan ─────────────────────────────────────────────────
    const preview   = $('puzzlePreview');
    const panLayer  = $('puzzlePanLayer');
    const zoomLabel = $('puzzleZoomLevel');
    let zoom = 1, panX = 0, panY = 0;
    let isPanning = false, startX = 0, startY = 0, startPanX = 0, startPanY = 0;

    function applyTransform() {
      panLayer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      zoomLabel.textContent = Math.round(zoom * 100) + '%';
    }

    function clampZoom(z) { return Math.max(0.05, Math.min(50, z)); }

    // Scroll to zoom (centered on cursor)
    preview.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = preview.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const oldZoom = zoom;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoom = clampZoom(zoom * delta);

      // Adjust pan so zoom is centered on cursor
      panX = mx - (mx - panX) * (zoom / oldZoom);
      panY = my - (my - panY) * (zoom / oldZoom);
      applyTransform();
    }, { passive: false });

    // Mouse drag to pan
    preview.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isPanning = true;
      startX = e.clientX; startY = e.clientY;
      startPanX = panX; startPanY = panY;
      preview.classList.add('grabbing');
    });
    window.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      panX = startPanX + (e.clientX - startX);
      panY = startPanY + (e.clientY - startY);
      applyTransform();
    });
    window.addEventListener('mouseup', () => {
      isPanning = false;
      preview.classList.remove('grabbing');
    });

    // Touch drag to pan + pinch to zoom
    let lastTouchDist = 0;
    preview.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isPanning = true;
        startX = e.touches[0].clientX; startY = e.touches[0].clientY;
        startPanX = panX; startPanY = panY;
      } else if (e.touches.length === 2) {
        isPanning = false;
        lastTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });
    preview.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && isPanning) {
        panX = startPanX + (e.touches[0].clientX - startX);
        panY = startPanY + (e.touches[0].clientY - startY);
        applyTransform();
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (lastTouchDist > 0) {
          zoom = clampZoom(zoom * (dist / lastTouchDist));
          applyTransform();
        }
        lastTouchDist = dist;
      }
    }, { passive: true });
    preview.addEventListener('touchend', () => { isPanning = false; lastTouchDist = 0; });

    // Zoom buttons
    $('puzzleZoomIn').addEventListener('click', () => {
      zoom = clampZoom(zoom * 1.25); applyTransform();
    });
    $('puzzleZoomOut').addEventListener('click', () => {
      zoom = clampZoom(zoom * 0.8); applyTransform();
    });
    $('puzzleZoomFit').addEventListener('click', () => {
      zoom = 1; panX = 0; panY = 0; applyTransform();
    });
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
