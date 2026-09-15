// arrange/app.js — UI wiring and canvas preview.

import { parseSVG } from './svgin.js';
import { toSVG } from './export.js';
import { bounds } from './geom.js';

const $ = id => document.getElementById(id);
const parts = [];              // { id, name, outer, holes, qty, rotation, area }
let worker = null, running = false, startedAt = 0, timer = null;
let result = null;             // { sheets: [[ [ring,...] ]], placed, unplaced }

// ── Units ───────────────────────────────────────────────────────────
//
// Everything internal — part geometry, sheet, margin, spacing — is millimetres.
// The unit setting only changes what is shown and what is typed, so switching
// it never moves a part or rescales a sheet.

const UNITS = {
  mm: { per: 1,    dp: 1, step: 0.5,  areaLabel: 'cm²', areaPer: 100 },
  in: { per: 25.4, dp: 3, step: 0.05, areaLabel: 'in²', areaPer: 645.16 },
};
let unit = 'mm';
const U = () => UNITS[unit];
const toDisp = mm => mm / U().per;
const fromDisp = v => v * U().per;
const fmt = (mm, dp = U().dp) => {
  const v = toDisp(mm);
  return (Math.round(v * 10 ** dp) / 10 ** dp).toString();
};

// Stock presets are physical sizes; only their labels change with the unit.
// Imperial stock is stored at its exact metric equivalent, so a 32×20" bed
// reads as 32×20 in and not 31.97.
const PRESETS = [
  [300, 300], [600, 300], [600, 400],
  [812.8, 508, '32×20 in'], [900, 600], [1219.2, 609.6, '4×2 ft'],
];

// Settings live here in mm, not in the input values.
const settings = { w: 600, h: 400, margin: 5, spacing: 2, preset: '600x400' };
// Preset keys are built from the same numbers, so they round-trip exactly.

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
  $('clear').hidden = parts.length === 0;
  $('run').disabled = parts.length === 0;

  parts.forEach((p, i) => {
    const b = bounds(p.outer);
    const row = document.createElement('div');
    row.className = 'part';
    row.innerHTML = `
      <canvas class="thumb" width="72" height="72"></canvas>
      <div class="part-name" title="${p.name}">${p.name}</div>
      <button class="del" data-i="${i}" title="remove" aria-label="remove ${p.name}">×</button>
      <div class="part-meta">${fmt(b.w, unit === 'mm' ? 0 : 2)}×${fmt(b.h, unit === 'mm' ? 0 : 2)}${unit}${p.holes.length ? ` · ${p.holes.length}h` : ''}</div>
      <div class="part-ctrls">
        <label class="qty"><span>×</span><input type="number" min="1" max="999" value="${p.qty}" data-i="${i}" class="qty-input"></label>
        <select class="rot-input" data-i="${i}" title="rotation for this part">
        <option value="">global</option>
        <option value="none">0° only</option>
        <option value="grain">grain (0/180)</option>
        <option value="quarter">90° steps</option>
          <option value="free">free</option>
        </select>
      </div>`;
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
    ? `${n} part${n === 1 ? '' : 's'} · ${(a / U().areaPer).toFixed(1)} ${U().areaLabel} of material`
    : '';
}

// ── Sheet settings ──────────────────────────────────────────────────

function sheetSpec() {
  return { w: settings.w, h: settings.h, margin: settings.margin };
}

function buildPresets() {
  const sel = $('sheet');
  sel.innerHTML = '';
  for (const [w, h, note] of PRESETS) {
    const o = document.createElement('option');
    o.value = `${w}x${h}`;
    const dp = unit === 'mm' ? 0 : 2;
    // Drop the note once the label already says the same thing, so inches do
    // not read "32 × 20 in (32×20 in)".
    const useful = note && !(unit === 'in' && note.endsWith(' in'));
    o.textContent = `${fmt(w, dp)} × ${fmt(h, dp)} ${unit}` + (useful ? ` (${note})` : '');
    sel.appendChild(o);
  }
  const c = document.createElement('option');
  c.value = 'custom';
  c.textContent = 'custom…';
  sel.appendChild(c);
  sel.value = settings.preset;
}

// Push the mm-valued settings into the inputs, in whatever unit is showing.
function syncInputs() {
  const u = U();
  for (const el of document.querySelectorAll('[data-unit-label]')) el.textContent = unit;
  for (const [id, mm] of [['sheetW', settings.w], ['sheetH', settings.h],
                          ['margin', settings.margin], ['spacing', settings.spacing]]) {
    const el = $(id);
    el.step = u.step;
    el.value = fmt(mm);
  }
  $('customSize').hidden = settings.preset !== 'custom';
}

$('sheet').onchange = () => {
  settings.preset = $('sheet').value;
  if (settings.preset !== 'custom') {
    const [w, h] = settings.preset.split('x').map(Number);
    settings.w = w; settings.h = h;
  }
  syncInputs();
  draw();
};

const readField = (id, key, min, max) => {
  $(id).oninput = () => {
    const mm = fromDisp(parseFloat($(id).value));
    if (!Number.isFinite(mm)) return;
    settings[key] = Math.min(max, Math.max(min, mm));
    // Typing a custom width while a preset is selected means a custom sheet.
    if ((key === 'w' || key === 'h') && settings.preset !== 'custom') {
      settings.preset = 'custom';
      $('sheet').value = 'custom';
      $('customSize').hidden = false;
    }
    draw();
  };
};
readField('sheetW', 'w', 10, 5000);
readField('sheetH', 'h', 10, 5000);
readField('margin', 'margin', 0, 100);
readField('spacing', 'spacing', 0, 50);

for (const b of document.querySelectorAll('#unitSeg button')) {
  b.onclick = () => {
    if (unit === b.dataset.unit) return;
    unit = b.dataset.unit;
    for (const o of document.querySelectorAll('#unitSeg button'))
      o.setAttribute('aria-pressed', String(o === b));
    buildPresets();
    syncInputs();
    renderParts();     // part dimensions are shown in the active unit
    draw();            // so are the sheet labels
  };
}

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

$('clear').onclick = () => {
  if (running) stopRun();
  parts.length = 0;
  // The preview and the export buttons describe a nest of parts that are gone.
  result = null;
  renderParts();
  draw();
  $('export').disabled = true;
  $('exportOne').disabled = true;
  $('density').textContent = '—';
  $('sheetCount').textContent = '—';
  $('placed').textContent = '—';
  $('placed').classList.remove('bad');
  $('status').textContent = 'idle';
  $('elapsed').textContent = '';
  $('note').hidden = true;
};

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
      spacing: settings.spacing,
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
    ctx.fillText(`sheet ${i + 1} · ${fmt(sh.w, unit === 'mm' ? 0 : 2)}×${fmt(sh.h, unit === 'mm' ? 0 : 2)}${unit}`, cx, cy + 11);
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
buildPresets();
syncInputs();
draw();
