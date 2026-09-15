// patch/app.js — UI: pick a block, assign fabrics, preview, cut.

import { LIBRARY, UNIT_LABELS, blockRegions, gridBlock } from './blocks.js';
import { INCH, DEFAULT_SEAM, blockPieces, bounds, fabricTotals } from './pieces.js';
import { layoutForCutting, toSVG } from './export.js';

const $ = id => document.getElementById(id);

const UNITS = {
  in: { per: INCH, dp: 2, step: 0.25, area: 'in²', areaPer: INCH * INCH },
  mm: { per: 1, dp: 1, step: 5, area: 'cm²', areaPer: 100 },
};
let unit = 'in';
const U = () => UNITS[unit];
const toDisp = mm => mm / U().per;
const fromDisp = v => v * U().per;
const fmt = (mm, dp = U().dp) => {
  const v = toDisp(mm);
  return (Math.round(v * 10 ** dp) / 10 ** dp).toString();
};

const CYCLE = ['plain', 'hst', 'qst', 'bar', 'sis', 'fourpatch'];

const state = {
  mode: 'library',
  blockKey: 'sawtooth-star',
  gridN: 3,
  cells: [],
  finished: 12 * INCH,
  seam: DEFAULT_SEAM,
  trim: false,
  grainLock: true,
  blocks: 1,
  sheet: { w: 600, h: 400, margin: 5 },
  spacing: INCH / 8,          // an eighth inch reads cleanly in both units
  assign: new Map(),          // regionIndex -> fabric id
  selected: null,             // fabric id being painted
};

// Fabrics: an id, a name, and either a colour or an uploaded image.
let fabrics = [
  { id: 'a', name: 'Background', color: '#EFE9DC', img: null },
  { id: 'b', name: 'Feature',    color: '#5C7A4E', img: null },
  { id: 'c', name: 'Accent',     color: '#8B6340', img: null },
  { id: 'd', name: 'Fourth',     color: '#A8553F', img: null },   // Card Trick needs four
];
const fabricById = id => fabrics.find(f => f.id === id) || fabrics[0];

function resetCells(n) {
  state.gridN = n;
  state.cells = Array.from({ length: n * n }, () => ({ type: 'plain', rot: 0 }));
}
resetCells(3);

const currentBlock = () =>
  state.mode === 'library' ? LIBRARY[state.blockKey] : gridBlock(state.gridN, state.cells);

// Region fabric: an explicit assignment wins, otherwise the block's own role.
const fabricFor = (i, r) => state.assign.get(i) ?? r.role;

function compute() {
  const block = currentBlock();
  return blockPieces(block, state.finished, {
    fabricFor, seamMm: state.seam, trimPoints: state.trim,
  });
}

// ── Block picker ────────────────────────────────────────────────────

function renderBlockList() {
  const wrap = $('blocks');
  wrap.innerHTML = '';
  for (const [key, b] of Object.entries(LIBRARY)) {
    const el = document.createElement('button');
    el.className = 'block-card' + (state.mode === 'library' && state.blockKey === key ? ' on' : '');
    el.innerHTML = `<canvas width="120" height="120"></canvas><span>${b.name}</span>`;
    el.onclick = () => {
      state.mode = 'library'; state.blockKey = key; state.assign.clear();
      renderBlockList(); renderGrid(); refresh();
    };
    wrap.appendChild(el);
    drawBlock(el.querySelector('canvas'), b, { plain: true });
  }
}

function renderGrid() {
  $('gridWrap').hidden = state.mode !== 'custom';
  $('blocks').hidden = state.mode !== 'library';
  for (const b of document.querySelectorAll('#modeSeg button'))
    b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
  if (state.mode !== 'custom') return;

  const g = $('grid');
  g.style.gridTemplateColumns = `repeat(${state.gridN}, 1fr)`;
  g.innerHTML = '';
  state.cells.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'cell';
    b.title = `${UNIT_LABELS[c.type]} — click to change, shift-click to rotate`;
    b.innerHTML = '<canvas width="80" height="80"></canvas>';
    b.onclick = e => {
      if (e.shiftKey) c.rot = (c.rot + 1) % 4;
      else {
        c.type = CYCLE[(CYCLE.indexOf(c.type) + 1) % CYCLE.length];
        c.rot = 0;
      }
      state.assign.clear();
      renderGrid(); refresh();
    };
    g.appendChild(b);
    drawBlock(b.querySelector('canvas'),
              { grid: 1, units: [{ type: c.type, x: 0, y: 0, rot: c.rot, scale: 1 }] },
              { plain: true });
  });
}

// ── Fabrics ─────────────────────────────────────────────────────────

function renderFabrics() {
  const list = $('fabrics');
  list.innerHTML = '';
  for (const fb of fabrics) {
    const el = document.createElement('div');
    el.className = 'fabric' + (state.selected === fb.id ? ' on' : '');
    el.innerHTML = `
      <button class="swatch" title="select, then click block areas"></button>
      <input class="fab-name" value="${fb.name}" aria-label="fabric name">
      <label class="swap ghost small" title="use a fabric photo">photo<input type="file" accept="image/*" hidden></label>`;
    const sw = el.querySelector('.swatch');
    if (fb.img) { sw.style.backgroundImage = `url(${fb.img.src})`; sw.style.backgroundSize = 'cover'; }
    else sw.style.background = fb.color;
    sw.onclick = () => { state.selected = state.selected === fb.id ? null : fb.id; renderFabrics(); };
    el.querySelector('.fab-name').onchange = e => { fb.name = e.target.value; renderFabrics(); };
    el.querySelector('input[type=file]').onchange = async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode().catch(() => {});
      fb.img = img;
      renderFabrics(); refresh();
    };
    list.appendChild(el);
  }
  $('paintHint').textContent = state.selected
    ? `click areas of the block to fill them with ${fabricById(state.selected).name}`
    : 'pick a fabric, then click areas of the block';
}

// ── Preview ─────────────────────────────────────────────────────────

let hitRegions = [];

function drawBlock(cv, block, { plain = false, size } = {}) {
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const css = size || cv.clientWidth || cv.width;
  cv.width = Math.round(css * dpr);
  cv.height = Math.round(css * dpr);
  if (size) { cv.style.width = `${css}px`; cv.style.height = `${css}px`; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, css, css);

  const regions = blockRegions(block);
  const s = css / block.grid;
  const out = [];

  regions.forEach((r, i) => {
    const pts = r.poly.map(([x, y]) => [x * s, y * s]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.closePath();

    const fb = plain
      ? { color: { b: '#5C7A4E', c: '#8B6340', d: '#A8553F' }[r.role] || '#EFE9DC', img: null }
      : fabricById(fabricFor(i, r));

    if (fb.img && fb.img.complete && fb.img.naturalWidth) {
      ctx.save(); ctx.clip();
      // Fabric shown at a consistent scale across the block, so a print reads
      // the way it will once cut.
      const scale = Math.max(css / fb.img.naturalWidth, css / fb.img.naturalHeight) * 1.1;
      const w = fb.img.naturalWidth * scale, h = fb.img.naturalHeight * scale;
      ctx.drawImage(fb.img, (css - w) / 2, (css - h) / 2, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = fb.color;
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(60,40,10,0.35)';
    ctx.stroke();
    out.push({ index: i, pts });
  });
  return out;
}

function refresh() {
  const block = currentBlock();
  hitRegions = drawBlock($('preview'), block, { size: $('preview').parentElement.clientWidth });

  const { pieces } = compute();
  const list = $('pieces');
  list.innerHTML = '';
  let total = 0;
  for (const p of pieces) {
    total += p.count;
    const b = bounds(p.cut);
    const row = document.createElement('div');
    row.className = 'piece';
    row.innerHTML = `
      <span class="pc-swatch"></span>
      <span class="pc-main">
        <span class="pc-name">${UNIT_LABELS[p.unitType] || p.unitType} · ${fabricById(p.fabric).name}</span>
        <span class="pc-meta">cut ${fmt(b.w)} × ${fmt(b.h)} ${unit}</span>
      </span>
      <span class="pc-count">×${p.count * state.blocks}</span>`;
    const fb = fabricById(p.fabric);
    const sw = row.querySelector('.pc-swatch');
    if (fb.img) { sw.style.backgroundImage = `url(${fb.img.src})`; sw.style.backgroundSize = 'cover'; }
    else sw.style.background = fb.color;
    list.appendChild(row);
  }

  const totals = fabricTotals(pieces);
  $('pieceTotal').textContent =
    `${total * state.blocks} pieces · ` +
    [...totals.entries()].map(([id, a]) =>
      `${fabricById(id).name} ${(a * state.blocks / U().areaPer).toFixed(1)} ${U().area}`).join(' · ');

  const cell = state.finished / block.grid;
  $('unitNote').textContent =
    `${block.grid}×${block.grid} grid · each unit finishes ${fmt(cell)} ${unit}`;
}

$('preview').onclick = e => {
  if (!state.selected) return;
  const r = e.target.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  // topmost region wins, so small pieces sitting over big ones stay clickable
  for (let i = hitRegions.length - 1; i >= 0; i--) {
    if (inPoly(hitRegions[i].pts, x, y)) {
      state.assign.set(hitRegions[i].index, state.selected);
      refresh();
      return;
    }
  }
};

const inPoly = (pts, x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// ── Settings ────────────────────────────────────────────────────────

function syncInputs() {
  for (const el of document.querySelectorAll('[data-unit-label]')) el.textContent = unit;
  const u = U();
  for (const [id, mm] of [['finished', state.finished], ['seam', state.seam],
                          ['sheetW', state.sheet.w], ['sheetH', state.sheet.h],
                          ['spacing', state.spacing]]) {
    // Seam and gap are small; two decimals would show an eighth inch as 0.13.
    const fine = id === 'seam' || id === 'spacing';
    const el = $(id);
    el.step = fine ? (unit === 'in' ? 0.125 : 1) : u.step;
    el.value = fmt(mm, fine ? (unit === 'in' ? 3 : 2) : u.dp);
  }
  $('blocksN').value = state.blocks;
}

const bindLen = (id, apply, min, max) => {
  $(id).oninput = () => {
    const mm = fromDisp(parseFloat($(id).value));
    if (!Number.isFinite(mm)) return;
    apply(Math.min(max, Math.max(min, mm)));
    refresh();
  };
};
bindLen('finished', v => { state.finished = v; }, 25, 1500);
bindLen('seam', v => { state.seam = v; }, 0, 25);
bindLen('sheetW', v => { state.sheet.w = v; }, 50, 3000);
bindLen('sheetH', v => { state.sheet.h = v; }, 50, 3000);
bindLen('spacing', v => { state.spacing = v; }, 0, 50);

$('blocksN').oninput = () => { state.blocks = Math.max(1, Math.min(99, +$('blocksN').value || 1)); refresh(); };
$('trim').onchange = () => { state.trim = $('trim').checked; refresh(); };
$('grainLock').onchange = () => { state.grainLock = $('grainLock').checked; };
$('gridN').onchange = () => { resetCells(+$('gridN').value); state.assign.clear(); renderGrid(); refresh(); };

for (const b of document.querySelectorAll('#unitSeg button')) {
  b.onclick = () => {
    if (unit === b.dataset.unit) return;
    unit = b.dataset.unit;
    for (const o of document.querySelectorAll('#unitSeg button'))
      o.setAttribute('aria-pressed', String(o === b));
    syncInputs(); refresh();
  };
}
for (const b of document.querySelectorAll('#modeSeg button')) {
  b.onclick = () => { state.mode = b.dataset.mode; state.assign.clear(); renderGrid(); refresh(); };
}
$('resetFabrics').onclick = () => { state.assign.clear(); refresh(); };

// ── Cut ─────────────────────────────────────────────────────────────

let lastFiles = null;

$('cut').onclick = async () => {
  $('cut').disabled = true;
  $('cutStatus').textContent = 'laying out…';
  await new Promise(r => setTimeout(r, 20));      // let the label paint
  try {
    const { pieces } = compute();
    const layout = layoutForCutting(pieces, state.sheet, {
      spacing: state.spacing, grainLock: state.grainLock,
      timeMs: 1200, blocks: state.blocks,
    });
    lastFiles = toSVG(layout, state.sheet, { grainMarks: $('grainMarks').checked });
    const sheets = layout.reduce((s, l) => s + l.sheets.length, 0);
    const missed = layout.reduce((s, l) => s + l.unplaced, 0);
    $('cutStatus').textContent = missed
      ? `${sheets} sheet(s) — ${missed} piece(s) did not fit; enlarge the fabric`
      : `${sheets} sheet(s) across ${layout.length} fabric(s)`;
    $('cutStatus').classList.toggle('bad', !!missed);
    $('download').disabled = false;
    drawLayout(layout);
  } catch (err) {
    $('cutStatus').textContent = err.message;
    $('cutStatus').classList.add('bad');
  }
  $('cut').disabled = false;
};

function drawLayout(layout) {
  const cv = $('layout');
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = cv.parentElement.clientWidth;
  const all = layout.flatMap(l => l.sheets.map(s => ({ fabric: l.fabric, placements: s })));
  const cols = Math.min(all.length, Math.max(1, Math.floor(cssW / 200))) || 1;
  const rows = Math.ceil(all.length / cols) || 1;
  const gap = 12, labelH = 18;
  const cellW = (cssW - gap * (cols - 1)) / cols;
  const scale = cellW / state.sheet.w;
  const cellH = state.sheet.h * scale;
  const cssH = rows * (cellH + labelH) + gap * (rows - 1);

  cv.width = Math.round(cssW * dpr); cv.height = Math.round(Math.max(1, cssH) * dpr);
  cv.style.height = `${Math.max(1, cssH)}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  all.forEach((sheet, i) => {
    const x = (i % cols) * (cellW + gap);
    const y = Math.floor(i / cols) * (cellH + labelH + gap);
    ctx.save(); ctx.translate(x, y + labelH);
    ctx.fillStyle = '#F8F4EE'; ctx.fillRect(0, 0, cellW, cellH);
    ctx.strokeStyle = '#C8CAD0'; ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, cellW - 1, cellH - 1);
    const fb = fabricById(sheet.fabric);
    for (const p of sheet.placements) {
      ctx.beginPath();
      p.poly.forEach(([px, py], k) => k ? ctx.lineTo(px * scale, py * scale) : ctx.moveTo(px * scale, py * scale));
      ctx.closePath();
      ctx.fillStyle = fb.img ? 'rgba(92,122,78,0.18)' : fb.color;
      ctx.fill();
      ctx.lineWidth = 0.8; ctx.strokeStyle = '#c0392b'; ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#8C919A';
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText(`${fb.name} · sheet ${i + 1}`, x, y + 12);
  });
}

$('download').onclick = () => {
  if (!lastFiles) return;
  for (const f of lastFiles) {
    const url = URL.createObjectURL(new Blob([f.svg], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url; a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

addEventListener('resize', () => refresh());
renderBlockList(); renderGrid(); renderFabrics(); syncInputs(); refresh();
