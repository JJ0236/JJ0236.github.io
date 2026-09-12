// crease/app.js — panel generation, preview, sheet fitting, downloads.

import { PATTERNS, defaults, build, totalLength } from './patterns.js';
import { assemble, toSvg, itemToSvg } from './export.js';

const $ = id => document.getElementById(id);

const SHEETS = [
  { id: 'a4',     name: 'A4 · 210×297',        w: 210,   h: 297 },
  { id: 'a3',     name: 'A3 · 297×420',        w: 297,   h: 420 },
  { id: 'letter', name: 'US Letter · 8.5×11"', w: 215.9, h: 279.4 },
  { id: 'tabloid',name: 'Tabloid · 11×17"',    w: 279.4, h: 431.8 },
  { id: 'sq12',   name: '12×12"',              w: 304.8, h: 304.8 },
  { id: 'gf',     name: 'Glowforge · 11×19.5"', w: 279.4, h: 495.3 },
  { id: 'r1224',  name: '12×24"',              w: 304.8, h: 609.6 },
  { id: 'custom', name: 'Custom' },
];

const state = {
  pattern: 'miura',
  params: defaults('miura'),
  sheet: { w: 210, h: 297 },
  margin: 5,
  strategy: 'same',
  dash: 3, gap: 1.5,
  swap: false, legend: false,
  visible: { mountain: true, valley: true, cut: true },
};

let pattern = null, asm = null;
let mode = 'pattern';
let foldView = null, foldLoading = null;
let activeStep = -1;

/* ── Fold steps ──────────────────────────────────────────────────────────── */

const SCORE = { t: 'Score on the laser', d: 'Cut layer at cutting power. Both score layers at a light setting that marks the surface without cutting through; test on scrap. Scored face is the front.' };
const PRE_M = { t: 'Pre-fold mountains', d: 'Fold every <b>red</b> line toward you, one at a time, and unfold. Scored paper turns crisply along the line.', hl: 'mountain' };
const PRE_V = { t: 'Pre-fold valleys', d: 'Flip the sheet and fold every <i>blue</i> line toward you (from the front they are valleys). Unfold and flip back.', hl: 'valley' };
const STEPS = {
  miura: [SCORE, PRE_M, PRE_V,
    { t: 'Collapse', d: 'Hold two opposite corners and push them together. The zigzag rows fold first and the verticals follow on their own. It closes in one motion; the slider shows the exact rigid path.', fold: 100, play: true }],
  yoshimura: [SCORE, PRE_M, PRE_V,
    { t: 'Pinch the diamonds', d: 'Row by row, pinch each row line as a mountain while pushing the diamond points inward. The sheet curls as you go.', fold: 55 },
    { t: 'Roll and join', d: 'Bring the left and right edges together so the half-diamonds meet, and tape or glue the overlap. The tube compresses and springs back along its length.', fold: 100, play: true }],
  waterbomb: [SCORE, PRE_M, PRE_V,
    { t: 'Accordion the rows', d: 'Fold every horizontal line so the sheet becomes a tight accordion: unit boundaries are mountains, midlines valleys.', fold: 25, hl: 'valley' },
    { t: 'Pop the units', d: 'With the accordion closed, pinch each X so its centre pushes toward you. Work along one row, then the next. The stagger makes the sheet curl.', fold: 100, play: true },
    { t: 'Close the ball', d: 'Bring the short edges together and tuck the half units into each other; a dab of glue holds it. Squeeze to see it stretch like a lattice.' }],
  circles: [SCORE,
    { t: 'Ease every ring', d: 'Starting from the inner cut, fold each ring a little: <b>red</b> rings toward you, <i>blue</i> rings away. Go around gently rather than creasing any one ring flat.', hl: 'mountain' },
    { t: 'Let it twist', d: 'Keep tightening the rings evenly. The annulus has no flat state, so it twists into a saddle on its own. Pushing two opposite edges together sets the final shape.' }],
};

/* ── Pattern picker ──────────────────────────────────────────────────────── */

function iconFor(id) {
  const small = { miura: { cols: 3, rows: 3, w: 10, h: 9, angle: 30 }, yoshimura: { cols: 3, rows: 3, w: 12, h: 9 },
    waterbomb: { cols: 3, rows: 3, w: 12, h: 10 }, circles: { rings: 4, inner: 4, spacing: 3 } }[id];
  const p = build(id, small);
  const pad = Math.max(p.w, p.h) * 0.06;
  const size = Math.max(p.w, p.h) + 2 * pad;
  const ox = (size - p.w) / 2, oy = (size - p.h) / 2;
  const g = (cls, items) => `<g class="${cls}" fill="none" stroke-width="${(size / 34).toFixed(3)}" transform="translate(${ox},${oy})">${items.map(itemToSvg).join('')}</g>`;
  return `<svg viewBox="0 0 ${size} ${size}">${g('c', p.cuts)}${g('m', p.mountains)}${g('v', p.valleys)}</svg>`;
}

function buildPicker() {
  const host = $('patterns');
  host.innerHTML = '';
  for (const id of Object.keys(PATTERNS)) {
    const b = document.createElement('button');
    b.dataset.id = id;
    b.innerHTML = iconFor(id) + `<span>${PATTERNS[id].name}</span>`;
    b.addEventListener('click', () => selectPattern(id));
    host.appendChild(b);
  }
}

function selectPattern(id) {
  state.pattern = id;
  state.params = defaults(id);
  for (const b of $('patterns').children) b.classList.toggle('active', b.dataset.id === id);
  $('blurb').textContent = PATTERNS[id].blurb;
  buildParams();
  activeStep = -1;
  renderSteps();
  update(true);
}

/* ── Parameter panel ─────────────────────────────────────────────────────── */

function buildParams() {
  const host = $('params');
  host.innerHTML = '';
  for (const p of PATTERNS[state.pattern].params) {
    const row = document.createElement('div');
    row.className = 'range-row';
    row.innerHTML = `
      <div class="ctrl-row">
        <span class="ctrl-label">${p.label}${p.unit ? `<span class="unit">${p.unit}</span>` : ''}</span>
        <input class="ctrl-input" type="number" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" />
      </div>
      <input type="range" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" />`;
    const [num, range] = row.querySelectorAll('input');
    num.value = range.value = state.params[p.key];
    const on = src => () => {
      let v = parseFloat(src.value);
      if (!Number.isFinite(v)) return;
      v = Math.min(p.max, Math.max(p.min, v));
      state.params[p.key] = v;
      num.value = range.value = v;
      update();
    };
    num.addEventListener('change', on(num));
    range.addEventListener('input', on(range));
    host.appendChild(row);
  }
}

function syncParamInputs() {
  for (const inp of $('params').querySelectorAll('input')) {
    const v = state.params[inp.dataset.key];
    inp.value = inp.type === 'range' ? v : +v.toFixed(2);
  }
}

/* ── Sheet ───────────────────────────────────────────────────────────────── */

function buildSheet() {
  const sel = $('preset');
  for (const s of SHEETS) {
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.name;
    sel.appendChild(o);
  }
  sel.value = 'a4';
  $('sheetW').value = state.sheet.w; $('sheetH').value = state.sheet.h;
  sel.addEventListener('change', () => {
    const s = SHEETS.find(x => x.id === sel.value);
    if (s.w) { state.sheet = { w: s.w, h: s.h }; $('sheetW').value = s.w; $('sheetH').value = s.h; update(); }
  });
  const custom = () => {
    const w = parseFloat($('sheetW').value), h = parseFloat($('sheetH').value);
    if (w > 0 && h > 0) { state.sheet = { w, h }; sel.value = 'custom'; update(); }
  };
  $('sheetW').addEventListener('change', custom);
  $('sheetH').addEventListener('change', custom);
  $('margin').addEventListener('change', () => { state.margin = Math.max(0, parseFloat($('margin').value) || 0); update(); });
  $('fit').addEventListener('click', fitToSheet);
}

// Uniform scale of every mm parameter so the page (pattern + margin) fills
// the sheet. Tries the sheet both ways and keeps whichever gives the bigger
// pattern, swapping the sheet dimensions if landscape wins.
function fitToSheet() {
  const p = build(state.pattern, state.params);
  const m = state.margin;
  const fits = (W, H) => Math.min((W - 2 * m) / p.w, (H - 2 * m) / p.h);
  let s = fits(state.sheet.w, state.sheet.h);
  const sRot = fits(state.sheet.h, state.sheet.w);
  if (sRot > s * 1.02) { s = sRot; state.sheet = { w: state.sheet.h, h: state.sheet.w }; $('sheetW').value = state.sheet.w; $('sheetH').value = state.sheet.h; }
  if (!(s > 0)) return;
  for (const q of PATTERNS[state.pattern].params) {
    if (!q.scales) continue;
    const v = Math.min(q.max, Math.max(q.min, state.params[q.key] * s));
    state.params[q.key] = Math.round(v / q.step) * q.step;
  }
  syncParamInputs();
  update(true);
}

/* ── Laser panel ─────────────────────────────────────────────────────────── */

const HINTS = {
  same: 'Both folds scored from the front. Paper folds either way across a score; valleys are a touch less crisp. Layers stay separate so you can give them different power.',
  perf: 'Valleys become real dashes, so the fold is symmetric whichever way it goes. Many short moves: slower on the laser.',
  two:  'Two files. Front: cut + mountains. Back: valleys mirrored, with corner crosses to line the sheet up after you flip it.',
};

function buildLaser() {
  for (const b of $('strategy').children) b.addEventListener('click', () => {
    state.strategy = b.dataset.v;
    for (const o of $('strategy').children) o.classList.toggle('active', o === b);
    update();
  });
  $('dash').addEventListener('change', () => { state.dash = Math.max(0.5, parseFloat($('dash').value) || 3); update(); });
  $('gap').addEventListener('change', () => { state.gap = Math.max(0.3, parseFloat($('gap').value) || 1.5); update(); });
  $('swap').addEventListener('click', () => { state.swap = !state.swap; $('swap').classList.toggle('on', state.swap); update(); });
  $('legend').addEventListener('click', () => { state.legend = !state.legend; $('legend').classList.toggle('on', state.legend); });
}

/* ── Preview ─────────────────────────────────────────────────────────────── */

const view = { k: 1, tx: 0, ty: 0 };   // screen = mm * k + t
const svg = $('preview');

function renderPreview() {
  const { page } = asm;
  const sheet = state.sheet;
  const layers = asm.files.reduce((acc, f) => {
    for (const l of ['mountain', 'valley', 'cut']) acc[l] = acc[l].concat(f.layers[l]);
    return acc;
  }, { mountain: [], valley: [], cut: [] });
  // The back file is mirrored for the laser; for the preview only the front's
  // cut outline is wanted, and the valleys need un-mirroring.
  if (state.strategy === 'two') {
    const [front, back] = asm.files;
    layers.cut = front.layers.cut;
    layers.valley = back.layers.valley.map(s => s.k === 'P' ? { ...s, pts: s.pts.map(([x, y]) => [page.w - x, y]) } : s);
  }
  const g = (cls, items) => `<g class="${cls}${state.visible[cls] ? '' : ' hidden'}">${items.map(itemToSvg).join('')}</g>`;
  svg.innerHTML = `<g id="world" transform="matrix(${view.k} 0 0 ${view.k} ${view.tx} ${view.ty})">
    <rect class="sheet" x="0" y="0" width="${sheet.w}" height="${sheet.h}" rx="0.6"/>
    <rect class="page" x="0" y="0" width="${page.w}" height="${page.h}"/>
    ${g('mountain', layers.mountain)}${g('valley', layers.valley)}${g('cut', layers.cut)}
  </g>`;
  applyDashes();
}

// Diagram convention: mountain dash-dot, valley dashed. Dasharrays are in mm,
// so they are recomputed from the zoom to stay a fixed size on screen.
function applyDashes() {
  const px = n => (n / view.k).toFixed(3);
  const m = svg.querySelector('.mountain'), v = svg.querySelector('.valley');
  if (m) m.style.strokeDasharray = `${px(7)} ${px(3)} ${px(1.5)} ${px(3)}`;
  if (v) v.style.strokeDasharray = state.strategy === 'perf' ? 'none' : `${px(5)} ${px(4)}`;
}

function setView(k, tx, ty) {
  view.k = k; view.tx = tx; view.ty = ty;
  const world = svg.querySelector('#world');
  if (world) world.setAttribute('transform', `matrix(${k} 0 0 ${k} ${tx} ${ty})`);
  applyDashes();
}

function fitView() {
  const W = svg.clientWidth, H = svg.clientHeight;
  const bw = Math.max(state.sheet.w, asm.page.w), bh = Math.max(state.sheet.h, asm.page.h);
  const k = Math.min((W - 60) / bw, (H - 60) / bh);
  setView(k, (W - bw * k) / 2, (H - bh * k) / 2);
}

function bindView() {
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    const k = Math.min(200, Math.max(0.05, view.k * f));
    const s = k / view.k;
    setView(k, mx - (mx - view.tx) * s, my - (my - view.ty) * s);
  }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }; svg.setPointerCapture(e.pointerId); svg.classList.add('dragging'); });
  svg.addEventListener('pointermove', e => { if (drag) setView(view.k, drag.tx + e.clientX - drag.x, drag.ty + e.clientY - drag.y); });
  const end = () => { drag = null; svg.classList.remove('dragging'); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  $('fitView').addEventListener('click', fitView);
  for (const b of document.querySelectorAll('.view-tools [data-layer]')) b.addEventListener('click', () => {
    const l = b.dataset.layer;
    state.visible[l] = !state.visible[l];
    b.classList.toggle('active', state.visible[l]);
    svg.querySelector('.' + l)?.classList.toggle('hidden', !state.visible[l]);
  });
  new ResizeObserver(() => { if (asm) fitView(); }).observe(svg);
}

/* ── Readouts ────────────────────────────────────────────────────────────── */

const fmt = n => n >= 1000 ? (n / 1000).toFixed(2) + ' m' : n.toFixed(0) + ' mm';

function renderReadouts() {
  const { page } = asm, s = state.sheet;
  $('sizeReadout').innerHTML = `
    <div><span class="k">pattern</span><span class="v">${pattern.w.toFixed(1)} × ${pattern.h.toFixed(1)} mm</span></div>
    <div><span class="k">with margin</span><span class="v">${page.w.toFixed(1)} × ${page.h.toFixed(1)} mm</span></div>
    <div><span class="k">sheet</span><span class="v">${s.w} × ${s.h} mm</span></div>`;
  const v = $('sizeVerdict');
  const overW = page.w - s.w, overH = page.h - s.h;
  if (overW > 1e-6 || overH > 1e-6) {
    v.className = 'verdict bad';
    v.textContent = `Overflows the sheet by ${Math.max(overW, 0).toFixed(1)} × ${Math.max(overH, 0).toFixed(1)} mm. Fit to sheet, or reduce cell size or counts.`;
  } else {
    const use = (page.w * page.h) / (s.w * s.h);
    v.className = 'verdict ' + (use > 0.45 ? 'good' : 'warn');
    v.textContent = use > 0.45 ? `Fits. Uses ${(use * 100).toFixed(0)}% of the sheet.` : `Fits, but only uses ${(use * 100).toFixed(0)}% of the sheet. Fit to sheet to scale it up.`;
  }

  const mLen = totalLength(pattern.mountains), vLen = totalLength(pattern.valleys), cLen = totalLength(pattern.cuts);
  const mCount = state.swap ? pattern.valleys.length : pattern.mountains.length;
  const vCount = state.swap ? pattern.mountains.length : pattern.valleys.length;
  const scoreM = state.swap ? vLen : mLen, scoreV = state.swap ? mLen : vLen;
  $('stats').innerHTML = `
    <div><span class="k">mountain creases</span><span class="v m">${mCount} · ${fmt(scoreM)}</span></div>
    <div><span class="k">valley creases</span><span class="v vv">${vCount} · ${fmt(scoreV)}</span></div>
    <div><span class="k">cut length</span><span class="v">${fmt(cLen)}</span></div>
    <div><span class="k">files</span><span class="v">${asm.files.length === 2 ? 'front + back' : 'one SVG'}</span></div>`;
  $('viewStats').textContent = `${PATTERNS[state.pattern].name}\n${mCount + vCount} creases · score ${fmt(scoreM + scoreV)}\ncut ${fmt(cLen)}`;
  $('strategyHint').textContent = HINTS[state.strategy];
  $('dashRows').style.display = state.strategy === 'perf' ? '' : 'none';
}

/* ── Downloads ───────────────────────────────────────────────────────────── */

function fileBase() {
  const p = state.params;
  const dims = state.pattern === 'circles' ? `${p.rings}r` : `${p.cols}x${p.rows}`;
  return `crease-${state.pattern}-${dims}`;
}

function renderDownloads() {
  const host = $('downloads');
  host.innerHTML = '';
  asm.files.forEach((f, i) => {
    const b = document.createElement('button');
    b.className = 'btn' + (i ? ' btn-sub' : '');
    b.textContent = asm.files.length === 2 ? `Download ${f.name} SVG` : 'Download SVG';
    b.addEventListener('click', () => {
      const text = toSvg(f, asm.page, { title: PATTERNS[state.pattern].name, legend: state.legend });
      const blob = new Blob([text], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileBase() + (asm.files.length === 2 ? `-${f.name}` : '') + '.svg';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    host.appendChild(b);
  });
}

/* ── Fold view ───────────────────────────────────────────────────────────── */

function renderSteps() {
  const host = $('steps');
  const steps = STEPS[state.pattern];
  host.innerHTML = '<div class="panel-title">How to fold</div>' + steps.map((st, i) =>
    `<div class="step${i === activeStep ? ' active' : ''}" data-i="${i}"><span class="step-n">${i + 1}</span><span class="step-t">${st.t}</span><div class="step-d">${st.d}</div></div>`).join('');
  for (const el of host.querySelectorAll('.step')) el.addEventListener('click', () => runStep(+el.dataset.i));
}

function runStep(i) {
  activeStep = i;
  renderSteps();
  const st = STEPS[state.pattern][i];
  if (!foldView) return;
  foldView.setHighlight(st.hl || null);
  foldView.pause();
  if (st.fold !== undefined) {
    if (st.play) { setFoldUI(0); foldView.play(); }
    else setFoldUI(st.fold);
  }
}

function setFoldUI(pct) {
  $('foldRange').value = pct;
  $('foldVal').textContent = `${Math.round(pct)}%`;
  foldView?.setFold(pct);
}

async function ensureFoldView() {
  if (foldView) return foldView;
  if (!foldLoading) {
    foldLoading = import('./foldview.js').then(({ FoldView }) => {
      foldView = new FoldView($('three-host'), onFoldStatus);
      foldView.onFold = pct => { $('foldRange').value = pct; $('foldVal').textContent = `${Math.round(pct)}%`; };
      return foldView;
    });
  }
  return foldLoading;
}

function onFoldStatus(st) {
  const msg = $('foldMsg');
  if (!st.ok) {
    msg.classList.add('show');
    msg.querySelector('span').textContent = `${st.reason} Follow the steps on the right; this pattern has no flat-foldable simulation.`;
    $('viewStats').textContent = `${PATTERNS[state.pattern].name}\nno simulation for curved creases`;
  } else {
    msg.classList.remove('show');
    $('viewStats').textContent = `${PATTERNS[state.pattern].name}\n${st.faces} facets · ${st.creases} hinges\nfull fold = ${st.maxAngle}° per crease`;
  }
}

async function refreshFold() {
  const fv = await ensureFoldView();
  fv.setModel(state.pattern, pattern, state.params);
  fv.show();
  fv.setHighlight(activeStep >= 0 ? STEPS[state.pattern][activeStep].hl || null : null);
}

function setMode(m) {
  mode = m;
  for (const b of $('mode').children) b.classList.toggle('active', b.dataset.mode === m);
  const fold = m === 'fold';
  $('fold-wrap').classList.toggle('show', fold);
  $('preview').style.display = fold ? 'none' : '';
  $('viewHint').textContent = fold ? 'Drag to orbit · scroll to zoom · pick a step' : 'Scroll to zoom · drag to pan';
  for (const b of document.querySelectorAll('.view-tools [data-layer], #fitView')) b.style.display = fold ? 'none' : '';
  if (fold) refreshFold();
  else { foldView?.hide(); renderReadouts(); }
}

function bindFold() {
  for (const b of $('mode').children) b.addEventListener('click', () => setMode(b.dataset.mode));
  $('foldRange').addEventListener('input', () => { foldView?.pause(); setFoldUI(parseFloat($('foldRange').value)); });
  $('foldPlay').addEventListener('click', () => { if (!foldView) return; if (foldView.playing) foldView.pause(); else foldView.play(); });
  $('foldReset').addEventListener('click', () => foldView?.resetCamera());
}

/* ── Update loop ─────────────────────────────────────────────────────────── */

function update(refit = false) {
  pattern = build(state.pattern, state.params);
  asm = assemble(pattern, { swap: state.swap, strategy: state.strategy, dash: state.dash, gap: state.gap, margin: state.margin });
  renderPreview();
  renderReadouts();
  renderDownloads();
  if (refit) fitView();
  if (mode === 'fold') refreshFold();
}

buildPicker();
buildSheet();
buildLaser();
bindView();
bindFold();

// Deep links: /crease/?pattern=waterbomb&mode=fold&fold=60
const q = new URLSearchParams(location.search);
selectPattern(PATTERNS[q.get('pattern')] ? q.get('pattern') : 'miura');
if (q.get('mode') === 'fold') {
  setMode('fold');
  if (q.has('fold')) ensureFoldView().then(() => setFoldUI(parseFloat(q.get('fold')) || 0));
}
