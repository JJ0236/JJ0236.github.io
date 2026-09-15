// arrange/app.js — UI wiring and canvas preview.

import { parseSVG } from './svgin.js';
import { toSVG } from './export.js';
import { bounds } from './geom.js';

const $ = id => document.getElementById(id);
const parts = [];              // { id, name, outer, holes, qty, rotation, area }
let worker = null, running = false, startedAt = 0, timer = null;
let result = null;             // { sheets: [[ [ring,...] ]], placed, unplaced }

const SHEETS = {
  '300x300':   [300, 300],
  '600x300':   [600, 300],
  '600x400':   [600, 400],
  '812x508':   [812, 508],
  '900x600':   [900, 600],
  '1219x610':  [1219, 610],
  'custom':    null,
};

const ringArea = r => {
  let a = 0;
  for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return Math.abs(a / 2);
};

// ── Part list ───────────────────────────────────────────────────────

function addParts(incoming) {
  for (const p of incoming) {
    parts.push({
      ...p,
      qty: 1,
      rotation: '',                       // '' = follow the global setting
      area: ringArea(p.outer) - p.holes.reduce((s, h) => s + ringArea(h), 0),
    });
  }
  renderParts();
}

function renderParts() {
  const list = $('parts');
  list.innerHTML = '';
  $('empty').hidden = parts.length > 0;
  $('run').disabled = parts.length === 0;

  parts.forEach((p, i) => {
    const b = bounds(p.outer);
    const row = document.createElement('div');
    row.className = 'part';
    row.innerHTML = `
      <canvas class="thumb" width="72" height="72"></canvas>
      <div class="part-main">
        <div class="part-name" title="${p.name}">${p.name}</div>
        <div class="part-meta">${b.w.toFixed(0)}×${b.h.toFixed(0)}mm${p.holes.length ? ` · ${p.holes.length}h` : ''}</div>
      </div>
      <label class="qty"><span>qty</span><input type="number" min="1" max="999" value="${p.qty}" data-i="${i}" class="qty-input"></label>
      <select class="rot-input" data-i="${i}" title="rotation for this part">
        <option value="">global</option>
        <option value="none">0° only</option>
        <option value="grain">grain (0/180)</option>
        <option value="quarter">90° steps</option>
        <option value="free">free</option>
      </select>
      <button class="del" data-i="${i}" title="remove" aria-label="remove ${p.name}">×</button>`;
    list.appendChild(row);
    row.querySelector('.rot-input').value = p.rotation;
    thumb(row.querySelector('.thumb'), p);
  });

  list.querySelectorAll('.qty-input').forEach(el => el.onchange = e => {
    parts[+e.target.dataset.i].qty = Math.max(1, Math.min(999, +e.target.value || 1));
    e.target.value = parts[+e.target.dataset.i].qty;
    updateTotals();
  });
  list.querySelectorAll('.rot-input').forEach(el => el.onchange = e => {
    parts[+e.target.dataset.i].rotation = e.target.value;
  });
  list.querySelectorAll('.del').forEach(el => el.onclick = e => {
    parts.splice(+e.target.dataset.i, 1);
    renderParts();
  });
  updateTotals();
}

function thumb(cv, p) {
  const ctx = cv.getContext('2d');
  const b = bounds(p.outer);
  const s = Math.min(64 / Math.max(b.w, 1e-6), 64 / Math.max(b.h, 1e-6));
  ctx.clearRect(0, 0, 72, 72);
  ctx.save();
  ctx.translate(36 - ((b.minX + b.maxX) / 2) * s, 36 - ((b.minY + b.maxY) / 2) * s);
  ctx.scale(s, s);
  ctx.beginPath();
  trace(ctx, p.outer);
  for (const h of p.holes) trace(ctx, h);
  ctx.fillStyle = '#E8DFCE';
  ctx.fill('evenodd');
  ctx.lineWidth = 1 / s;
  ctx.strokeStyle = '#8B6340';
  ctx.stroke();
  ctx.restore();
}

const trace = (ctx, r) => {
  ctx.moveTo(r[0], r[1]);
  for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1]);
  ctx.closePath();
};

function updateTotals() {
  const n = parts.reduce((s, p) => s + p.qty, 0);
  const a = parts.reduce((s, p) => s + p.area * p.qty, 0);
  $('totals').textContent = parts.length
    ? `${n} part${n === 1 ? '' : 's'} · ${(a / 100).toFixed(1)} cm² of material`
    : '';
}

// ── Sheet settings ──────────────────────────────────────────────────

function sheetSpec() {
  const preset = $('sheet').value;
  const [w, h] = preset === 'custom'
    ? [+$('sheetW').value || 300, +$('sheetH').value || 300]
    : SHEETS[preset];
  return { w, h, margin: Math.max(0, +$('margin').value || 0) };
}

$('sheet').onchange = () => {
  const custom = $('sheet').value === 'custom';
  $('customSize').hidden = !custom;
  if (!custom) { const [w, h] = SHEETS[$('sheet').value]; $('sheetW').value = w; $('sheetH').value = h; }
  draw();
};

// ── Running ─────────────────────────────────────────────────────────

$('file').onchange = async e => {
  const files = Array.from(e.target.files || []);
  let failed = [];
  for (const f of files) {
    try {
      const { parts: got, warnings } = parseSVG(await f.text(), { name: f.name.replace(/\.svg$/i, '') });
      if (!got.length) { failed.push(`${f.name}: no closed shapes found`); continue; }
      addParts(got);
      if (warnings.length) note(`${f.name}: ${warnings.join('; ')}`);
    } catch (err) {
      failed.push(`${f.name}: ${err.message}`);
    }
  }
  if (failed.length) note(failed.join(' · '), true);
  e.target.value = '';
};

function note(msg, bad = false) {
  const el = $('note');
  el.textContent = msg;
  el.hidden = false;
  el.classList.toggle('bad', bad);
}

$('run').onclick = () => (running ? stopRun() : startRun());

function startRun() {
  const items = [];
  parts.forEach((p, i) => { for (let k = 0; k < p.qty; k++) items.push({ part: i, inst: `${i}-${k}` }); });
  if (!items.length) return;

  $('note').hidden = true;
  running = true;
  startedAt = Date.now();
  $('run').textContent = 'stop';
  $('run').classList.add('running');
  $('status').textContent = 'nesting…';

  worker?.terminate();
  worker = new Worker('./worker.js', { type: 'module' });
  // Progress can arrive faster than a full canvas repaint takes. Drawing every
  // message makes the main thread fall behind and keeps repainting long after
  // the worker has finished, so keep only the newest frame and paint on rAF.
  let pending = null, scheduled = false;
  const paint = () => {
    scheduled = false;
    if (!pending) return;
    const m = pending;
    pending = null;
    result = m;
    draw();
    stats(m);
  };

  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'error') { note(m.message, true); stopRun(); return; }
    pending = m;
    if (m.type === 'done') { paint(); stopRun(); return; }
    if (!scheduled) { scheduled = true; requestAnimationFrame(paint); }
  };

  worker.postMessage({
    type: 'nest',
    raw: parts.map(p => ({ id: p.id, name: p.name, outer: Array.from(p.outer), holes: p.holes.map(h => Array.from(h)), rotation: p.rotation || null })),
    items,
    sheet: sheetSpec(),
    opts: {
      spacing: Math.max(0, +$('spacing').value || 0),
      rotation: $('rotation').value,
      timeMs: Math.round((+$('budget').value || 8) * 1000),
      seed: Math.max(1, +$('seed').value || 1),
    },
  });

  clearInterval(timer);
  timer = setInterval(() => {
    if (running) $('elapsed').textContent = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  }, 100);
}

function stopRun() {
  running = false;
  worker?.postMessage({ type: 'stop' });
  clearInterval(timer);
  $('run').textContent = 'nest';
  $('run').classList.remove('running');
  $('status').textContent = result ? 'done' : 'stopped';
  $('export').disabled = !result;
  $('exportOne').disabled = !result;
}

function stats(m) {
  const sh = sheetSpec();
  const used = m.sheets.flat().flat().length ? m.sheets.reduce((s, sheetRings) =>
    s + sheetRings.reduce((t, rings) => t + ringArea(rings[0]) - rings.slice(1).reduce((u, h) => u + ringArea(h), 0), 0), 0) : 0;
  const total = m.sheets.length * sh.w * sh.h;
  $('density').textContent = total ? `${((used / total) * 100).toFixed(1)}%` : '—';
  $('sheetCount').textContent = String(m.sheets.length);
  $('placed').textContent = `${m.placed}/${m.total}`;
  $('placed').classList.toggle('bad', !!m.unplaced);
}

// ── Preview ─────────────────────────────────────────────────────────

function draw() {
  const cv = $('view');
  const ctx = cv.getContext('2d');
  const sh = sheetSpec();
  const dpr = window.devicePixelRatio || 1;
  const cssW = cv.clientWidth || 600;

  const n = Math.max(1, result?.sheets.length || 1);
  const cols = Math.min(n, Math.max(1, Math.floor(cssW / 260)));
  const rows = Math.ceil(n / cols);
  const gap = 14;
  const cellW = (cssW - gap * (cols - 1)) / cols;
  const scale = cellW / sh.w;
  const cellH = sh.h * scale;
  const cssH = rows * cellH + gap * (rows - 1) + 22 * rows;

  cv.width = Math.round(cssW * dpr);
  cv.height = Math.round(cssH * dpr);
  cv.style.height = `${cssH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  for (let i = 0; i < n; i++) {
    const cx = (i % cols) * (cellW + gap);
    const cy = Math.floor(i / cols) * (cellH + gap + 22);

    ctx.save();
    ctx.translate(cx, cy + 18);

    ctx.fillStyle = '#F8F4EE';
    ctx.fillRect(0, 0, cellW, cellH);
    ctx.strokeStyle = '#C8CAD0';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, cellW - 1, cellH - 1);

    if (sh.margin > 0) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#DCD5C6';
      ctx.strokeRect(sh.margin * scale, sh.margin * scale,
                     (sh.w - 2 * sh.margin) * scale, (sh.h - 2 * sh.margin) * scale);
      ctx.setLineDash([]);
    }

    for (const rings of result?.sheets[i] || []) {
      ctx.save();
      ctx.scale(scale, scale);
      ctx.beginPath();
      for (const r of rings) trace(ctx, r);
      ctx.fillStyle = '#E3E8D8';
      ctx.fill('evenodd');
      ctx.lineWidth = 0.9 / scale;
      ctx.strokeStyle = '#5C7A4E';
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    ctx.fillStyle = '#8C919A';
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText(`sheet ${i + 1} · ${sh.w}×${sh.h}mm`, cx, cy + 11);
  }
}

// ── Export ──────────────────────────────────────────────────────────

function save(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('export').onclick = () => {
  if (!result) return;
  for (const f of toSVG(result.sheets, sheetSpec(), { merge: $('merge').checked })) save(f.name, f.svg);
};
$('exportOne').onclick = () => {
  if (!result) return;
  const [f] = toSVG(result.sheets, sheetSpec(), { merge: $('merge').checked, combined: true });
  save(f.name, f.svg);
};

addEventListener('resize', () => draw());
$('sheetW').oninput = $('sheetH').oninput = $('margin').oninput = () => draw();
draw();
