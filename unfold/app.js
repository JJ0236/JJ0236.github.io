// unfold/app.js — model loading, sidebar, 3D fold view, net view, downloads.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseStl } from './stl.js';
import { buildMesh } from './mesh.js';
import { unfold, foldPositions, toPatterns, FLAT } from './unfold.js';
import { SAMPLES } from './samples.js';
import { assemble, toSvg, itemToSvg } from '../crease/export.js';
import { totalLength } from '../crease/patterns.js';

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
  sample: 'cube', modelName: 'cube',
  size: 40, nativeLongest: 40,
  sheet: { w: 210, h: 297 }, margin: 5,
  tabs: true, tabH: 6, tabAngle: 60, labels: true, marks: true,
  onePiece: true, minFaces: 20, searchSeconds: 15,
  scoreFace: 'inside', strategy: 'same', dash: 3, gap: 1.5, legend: false,
  view: '3d', fold: 0,
};

let mesh = null, result = null, patterns = null, assembled = null;

/* ── Model ───────────────────────────────────────────────────────────────── */

// Sample icons are drawn from the solids themselves: an orthographic view
// with front faces bright and back faces dim.
function meshIcon(soup) {
  const m = buildMesh(soup);
  const cx = Math.cos(-1.05), sx = Math.sin(-1.05), cz = Math.cos(0.6), sz = Math.sin(0.6);
  const proj = ([x, y, z]) => {
    const x1 = x * cz - y * sz, y1 = x * sz + y * cz;
    const y2 = y1 * cx - z * sx, z2 = y1 * sx + z * cx;
    return [x1, -y2, z2];
  };
  const pts = m.verts.map(proj);
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const [x, y] of pts) { lo[0] = Math.min(lo[0], x); lo[1] = Math.min(lo[1], y); hi[0] = Math.max(hi[0], x); hi[1] = Math.max(hi[1], y); }
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1]) || 1;
  const S = 30, pad = 2;
  const P = ([x, y]) => `${(pad + (x - lo[0]) / span * S + (S - (hi[0] - lo[0]) / span * S) / 2).toFixed(2)},${(pad + (y - lo[1]) / span * S + (S - (hi[1] - lo[1]) / span * S) / 2).toFixed(2)}`;
  const front = [], back = [];
  for (const f of m.faces) {
    const n = proj(f.normal);
    const d = 'M' + f.verts.map(i => P(pts[i])).join(' L') + ' Z';
    (n[2] > 0 ? front : back).push(d);
  }
  return `<svg viewBox="0 0 34 34" fill="none" stroke-width="1"><path class="b" d="${back.join(' ')}"/><path class="c" d="${front.join(' ')}"/></svg>`;
}

function loadPositions(positions, name) {
  $('modelMsg').className = 'msg';
  $('modelMsg').textContent = '';
  try {
    mesh = buildMesh(positions);
  } catch (err) {
    mesh = null;
    $('modelMsg').className = 'msg err';
    $('modelMsg').textContent = err.message;
    return;
  }
  state.modelName = name;
  solveCache.clear();
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  state.nativeDims = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  state.nativeLongest = Math.max(...state.nativeDims);
  state.positions = positions;
  state.size = +state.nativeLongest.toFixed(1);
  $('size').value = state.size;
  $('modelInfo').textContent = `${name}: ${mesh.triCount} triangles → ${mesh.faces.length} faces, ${mesh.edges.length} edges`;
  update(true);
}

function buildSamples() {
  const host = $('samples');
  for (const id of Object.keys(SAMPLES)) {
    const b = document.createElement('button');
    b.dataset.id = id;
    b.innerHTML = meshIcon(SAMPLES[id]()) + `<span>${id}</span>`;
    b.addEventListener('click', () => selectSample(id));
    host.appendChild(b);
  }
  const drop = $('drop'), file = $('file');
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  file.addEventListener('change', () => { if (file.files[0]) readFile(file.files[0]); file.value = ''; });
}

function readFile(f) {
  const rd = new FileReader();
  rd.onload = () => {
    for (const b of $('samples').children) b.classList.remove('active');
    state.sample = null;
    loadPositions(parseStl(rd.result), f.name.replace(/\.stl$/i, ''));
  };
  rd.readAsArrayBuffer(f);
}

function selectSample(id) {
  state.sample = id;
  for (const b of $('samples').children) b.classList.toggle('active', b.dataset.id === id);
  loadPositions(SAMPLES[id](), id);
}

/* ── Sidebar ─────────────────────────────────────────────────────────────── */

const HINTS = {
  same: 'Both folds scored from the same face. Paper folds either way across a score; layers stay separate for different power.',
  perf: 'Valleys become real dashes so the fold is symmetric whichever way it goes. Many short moves: slower.',
  two:  'Two files per sheet. Front: cut + mountains. Back: valleys mirrored, with corner crosses to line the sheet up after flipping.',
};
const FACE_HINTS = {
  outside: 'Scores land on the visible face. Convex edges are mountains.',
  inside: 'The net is mirrored and the folds swapped, so scores hide inside the finished model.',
};

function num(id, key, min, max) {
  $(id).addEventListener('change', () => {
    const v = parseFloat($(id).value);
    if (!Number.isFinite(v)) return;
    state[key] = Math.min(max, Math.max(min, v));
    $(id).value = state[key];
    update();
  });
}
function toggle(id, key) {
  $(id).addEventListener('click', () => { state[key] = !state[key]; $(id).classList.toggle('on', state[key]); update(); });
}
function seg(id, key) {
  for (const b of $(id).children) b.addEventListener('click', () => {
    state[key] = b.dataset.v;
    for (const o of $(id).children) o.classList.toggle('active', o === b);
    update();
  });
}

function buildSidebar() {
  const sel = $('preset');
  for (const s of SHEETS) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); }
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
  num('margin', 'margin', 0, 50);
  num('size', 'size', 5, 2000);
  num('tabH', 'tabH', 1, 40);
  num('tabAngle', 'tabAngle', 30, 90);
  num('dash', 'dash', 0.5, 30);
  num('gap', 'gap', 0.3, 30);
  toggle('tabs', 'tabs');
  toggle('labels', 'labels');
  toggle('marks', 'marks');
  toggle('onePiece', 'onePiece');
  num('minFaces', 'minFaces', 4, 3000);
  num('searchSeconds', 'searchSeconds', 3, 120);
  $('more').addEventListener('click', keepSearching);
  $('legend').addEventListener('click', () => { state.legend = !state.legend; $('legend').classList.toggle('on', state.legend); });
  seg('scoreFace', 'scoreFace');
  seg('strategy', 'strategy');
}

/* ── 3D view ─────────────────────────────────────────────────────────────── */

const canvas = $('three-canvas');
let renderer, scene, camera, controls, faceMesh, foldLines, cutLines, needsRender = true, webgl = true;
const COL = { paper: 0xE9E4D8, paperBack: 0xCFC8B8, mountain: 0x4A86E8, valley: 0x4A86E8, cut: 0xD23B3B };

function initThree() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (err) {
    webgl = false;
    $('noWebgl').classList.add('show');
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x171B22);
  camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
  controls = new OrbitControls(camera, canvas);
  controls.addEventListener('change', () => { needsRender = true; });
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(1, 1.2, 2); scene.add(sun);
  const grid = new THREE.GridHelper(1000, 50, 0x26304a, 0x1f2634);
  grid.rotation.x = Math.PI / 2; grid.position.z = -0.5; scene.add(grid);
  faceMesh = new THREE.Mesh(new THREE.BufferGeometry(), [
    new THREE.MeshLambertMaterial({ color: COL.paper, side: THREE.FrontSide }),
    new THREE.MeshLambertMaterial({ color: COL.paperBack, side: THREE.BackSide }),
  ]);
  scene.add(faceMesh);
  foldLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }));
  cutLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COL.cut }));
  scene.add(foldLines, cutLines);
  const resize = () => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    needsRender = true;
  };
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();
  const loop = () => { requestAnimationFrame(loop); if (playing) stepPlay(); if (needsRender && state.view === '3d') { renderer.render(scene, camera); needsRender = false; } };
  loop();
}

// Face triangles and edge lines from the current fold fraction. Face
// polygons are convex enough for fans in every low-poly model this tool is
// meant for; concave merged faces still render, just with a few wrong tris.
function updateGeometry() {
  if (!result || !webgl) return;
  const polys = foldPositions(result, state.fold);
  const tri = [], fold = [], foldCol = [], cut = [];
  const mc = new THREE.Color(COL.mountain), vc = new THREE.Color(COL.valley);
  const edgeType = new Map();
  for (const e of result.foldEdges) if (Math.abs(e.dihedral) >= FLAT) edgeType.set(e.id, e.dihedral >= 0 ? mc : vc);
  const flatSet = new Set(result.foldEdges.filter(e => Math.abs(e.dihedral) < FLAT).map(e => e.id));
  const cutSet = new Set(result.cutEdges.map(e => e.id));
  // Map each face's edge index to the mesh edge so lines get the right colour.
  const faceEdge = result.mesh.faces.map(() => []);
  for (const e of result.mesh.edges) for (const s of e.sides) faceEdge[s.face][s.index] = e;
  polys.forEach((poly, fi) => {
    for (let i = 1; i + 1 < poly.length; i++) tri.push(...poly[0], ...poly[i], ...poly[i + 1]);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const e = faceEdge[fi][i];
      if (e && edgeType.has(e.id)) {
        if (e.sides[0].face !== fi) continue;      // draw each fold once
        fold.push(...a, ...b);
        const c = edgeType.get(e.id); foldCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
      } else if (e && flatSet.has(e.id)) continue;      // flat seam: draw nothing
      else cut.push(...a, ...b);
    }
  });
  const set = (obj, arr, col) => {
    obj.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    obj.geometry = g;
  };
  set(faceMesh, tri);
  faceMesh.geometry.addGroup(0, tri.length / 3, 0);
  faceMesh.geometry.addGroup(0, tri.length / 3, 1);
  faceMesh.geometry.computeVertexNormals();
  set(foldLines, fold, foldCol);
  set(cutLines, cut);
  needsRender = true;
}

function frame3d() {
  if (!result || !webgl) return;
  const box = new THREE.Box3();
  for (const poly of result.flat3) for (const p of poly) box.expandByPoint(new THREE.Vector3(...p));
  for (const p of result.target) box.expandByPoint(new THREE.Vector3(...p));
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length();
  controls.target.copy(c);
  camera.position.set(c.x, c.y - s * 1.1, c.z + s * 0.9);
  camera.up.set(0, 0, 1);
  camera.near = s / 100; camera.far = s * 20; camera.updateProjectionMatrix();
  controls.update();
  needsRender = true;
}

let playing = false, playDir = 1;
function stepPlay() {
  state.fold = Math.max(0, Math.min(1, state.fold + playDir * 0.006));
  if (state.fold >= 1 || state.fold <= 0) { playing = false; $('play').textContent = 'Play'; }
  $('fold').value = Math.round(state.fold * 100);
  $('foldVal').textContent = `${Math.round(state.fold * 100)}%`;
  updateGeometry();
}

function bindFold() {
  $('fold').addEventListener('input', () => { state.fold = $('fold').value / 100; $('foldVal').textContent = `${$('fold').value}%`; playing = false; $('play').textContent = 'Play'; updateGeometry(); });
  $('play').addEventListener('click', () => {
    if (playing) { playing = false; $('play').textContent = 'Play'; return; }
    playDir = state.fold >= 1 ? -1 : 1;
    playing = true; $('play').textContent = 'Pause';
  });
}

/* ── Net view ────────────────────────────────────────────────────────────── */

const svg = $('preview');
const view = { k: 1, tx: 0, ty: 0 };

function renderNet() {
  if (!assembled) return;
  const GAP = 20;
  let x = 0;
  const parts = [];
  assembled.forEach((asm, si) => {
    const { page } = asm;
    const layers = { mountain: [], valley: [], cut: [], label: [] };
    const front = asm.files[0];
    for (const l of ['mountain', 'valley', 'cut', 'label']) layers[l] = layers[l].concat(front.layers[l] || []);
    if (state.strategy === 'two') {
      layers.valley = asm.files[1].layers.valley.map(s => s.k === 'P' ? { ...s, pts: s.pts.map(([px, py]) => [page.w - px, py]) } : s);
    }
    const m = state.margin;
    const tabs = patterns[si].tabPolys.map(tp => ({ k: 'P', pts: tp.map(([px, py]) => [px + m, py + m]), closed: true }));
    const g = (cls, items) => `<g class="${cls}">${items.map(itemToSvg).join('')}</g>`;
    const ref = state.onePiece ? `<rect class="sheet-ref" x="0" y="0" width="${state.sheet.w}" height="${state.sheet.h}"/>` : '';
    parts.push(`<g transform="translate(${x} 0)">
      ${ref}<rect class="sheet" x="0" y="0" width="${page.w}" height="${page.h}" rx="0.6"/>
      ${g('tabs', tabs)}${g('mountain', layers.mountain)}${g('valley', layers.valley)}${g('cut', layers.cut)}${g('label', layers.label)}
      <text class="sheet-no" x="2" y="${page.h - 2}" font-size="4" fill="#9a948a" font-family="IBM Plex Mono, monospace">sheet ${si + 1}</text>
    </g>`);
    x += page.w + GAP;
  });
  svg.innerHTML = `<g id="world" transform="matrix(${view.k} 0 0 ${view.k} ${view.tx} ${view.ty})">${parts.join('')}</g>`;
  applyDashes();
}

function applyDashes() {
  const px = n => (n / view.k).toFixed(3);
  for (const m of svg.querySelectorAll('.mountain')) m.style.strokeDasharray = `${px(7)} ${px(3)} ${px(1.5)} ${px(3)}`;
  for (const v of svg.querySelectorAll('.valley')) v.style.strokeDasharray = state.strategy === 'perf' ? 'none' : `${px(5)} ${px(4)}`;
}

function setView(k, tx, ty) {
  view.k = k; view.tx = tx; view.ty = ty;
  const world = svg.querySelector('#world');
  if (world) world.setAttribute('transform', `matrix(${k} 0 0 ${k} ${tx} ${ty})`);
  applyDashes();
}

function fitNet() {
  if (!assembled) return;
  const W = svg.clientWidth, H = svg.clientHeight;
  const bw = assembled.reduce((a, asm) => a + asm.page.w, 0) + 20 * (assembled.length - 1);
  const bh = Math.max(...assembled.map(asm => asm.page.h));
  const k = Math.min((W - 60) / bw, (H - 60) / bh);
  setView(k, (W - bw * k) / 2, (H - bh * k) / 2);
}

function bindNet() {
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.min(200, Math.max(0.05, view.k * Math.exp(-e.deltaY * 0.0015)));
    const s = k / view.k;
    setView(k, mx - (mx - view.tx) * s, my - (my - view.ty) * s);
  }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }; svg.setPointerCapture(e.pointerId); svg.classList.add('dragging'); });
  svg.addEventListener('pointermove', e => { if (drag) setView(view.k, drag.tx + e.clientX - drag.x, drag.ty + e.clientY - drag.y); });
  const end = () => { drag = null; svg.classList.remove('dragging'); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
}

/* ── View switching ──────────────────────────────────────────────────────── */

function setViewMode(mode) {
  state.view = mode;
  $('view3d').classList.toggle('active', mode === '3d');
  $('viewNet').classList.toggle('active', mode === 'net');
  canvas.classList.toggle('hidden', mode !== '3d');
  svg.classList.toggle('hidden', mode !== 'net');
  $('foldBar').classList.toggle('hidden', mode !== '3d');
  $('hint').textContent = mode === '3d' ? 'Drag to orbit · scroll to zoom' : 'Scroll to zoom · drag to pan';
  if (mode === 'net') fitNet(); else needsRender = true;
}

/* ── Readouts and downloads ──────────────────────────────────────────────── */

const fmt = n => n >= 1000 ? (n / 1000).toFixed(2) + ' m' : n.toFixed(0) + ' mm';

function renderReadouts() {
  const s = result.stats;
  const cut = patterns.reduce((a, p) => a + totalLength(p.cuts), 0);
  const mnt = patterns.reduce((a, p) => a + totalLength(p.mountains), 0);
  const val = patterns.reduce((a, p) => a + totalLength(p.valleys), 0);
  const simplified = result.simplifiedFrom && result.simplifiedFrom !== s.faces;
  const fitsSheet = (s.netW <= result.sheetW && s.netH <= result.sheetH) || (s.netW <= result.sheetH && s.netH <= result.sheetW);
  $('stats').innerHTML = `
    <div><span class="k">faces</span><span class="v">${simplified ? `${result.simplifiedFrom} → ${s.faces}` : s.faces}</span></div>
    <div><span class="k">pieces</span><span class="v">${s.islands}${state.onePiece && s.tries ? ` · ${s.tries} tries` : ''}</span></div>
    ${state.onePiece ? `<div><span class="k">net</span><span class="v ${fitsSheet ? '' : 'warn'}">${s.netW.toFixed(0)} × ${s.netH.toFixed(0)} mm${fitsSheet ? '' : ' · over sheet'}</span></div>` : `<div><span class="k">sheets</span><span class="v">${s.sheets}</span></div>`}
    <div><span class="k">tabs</span><span class="v">${s.tabs}${s.noTab ? ` · ${s.noTab} edges without` : ''}</span></div>
    <div><span class="k">mountain scores</span><span class="v m">${fmt(mnt)}</span></div>
    <div><span class="k">valley scores</span><span class="v vv">${fmt(val)}</span></div>
    <div><span class="k">cut length</span><span class="v">${fmt(cut)}</span></div>`;
  $('warnings').textContent = result.warnings.join('\n');
  $('viewStats').textContent = `${state.modelName}\n${simplified ? `${result.simplifiedFrom} → ` : ''}${s.faces} faces · ${s.islands} piece${s.islands === 1 ? '' : 's'}${state.onePiece ? ` · net ${s.netW.toFixed(0)}×${s.netH.toFixed(0)} mm` : ` · ${s.sheets} sheet${s.sheets === 1 ? '' : 's'}`}\ncut ${fmt(cut)} · score ${fmt(mnt + val)}`;
  $('strategyHint').textContent = HINTS[state.strategy];
  $('faceHint').textContent = FACE_HINTS[state.scoreFace];
  $('dashRows').style.display = state.strategy === 'perf' ? '' : 'none';
}

function renderDownloads() {
  const host = $('downloads');
  host.innerHTML = '';
  assembled.forEach((asm, si) => asm.files.forEach((f, fi) => {
    const b = document.createElement('button');
    b.className = 'btn' + (si || fi ? ' btn-sub' : '');
    const label = assembled.length > 1 ? `sheet ${si + 1}` : 'SVG';
    b.textContent = asm.files.length === 2 ? `Download ${label} ${f.name}` : `Download ${label}`;
    b.addEventListener('click', () => {
      const text = toSvg(f, asm.page, { title: `unfold ${state.modelName}`, legend: state.legend });
      const blob = new Blob([text], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `unfold-${state.modelName.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}` + (assembled.length > 1 ? `-sheet${si + 1}` : '') + (asm.files.length === 2 ? `-${f.name}` : '') + '.svg';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    host.appendChild(b);
  }));
}

/* ── Update ──────────────────────────────────────────────────────────────── */

/* ── One-piece solving, off the main thread when possible ────────────────── */

const solveCache = new Map();
let updateToken = 0, solving = null, worker = null, workerBroken = false, lastSolveKey = null;
const busy = msg => { const el = $('busy'); el.classList.toggle('show', !!msg); el.querySelector('.stage').textContent = msg || ''; };
const progressText = p => `Searching for a one-piece net… ${p.faces} faces · ${p.overlaps ?? '?'} overlaps (best ${p.best ?? '?'})${p.rounds ? ` · simplified ${p.rounds}×` : ''} · ${((p.elapsed || 0) / 1000).toFixed(0)} s`;

function getWorker() {
  if (worker || workerBroken) return worker;
  try { worker = new Worker('./worker.js', { type: 'module' }); }
  catch { workerBroken = true; }
  return worker;
}

// Runs the solver (in the worker, or inline if workers are unavailable) and
// resolves with { mesh, tree, overlaps, simplifiedFrom, rounds }.
function runSolver(msg) {
  const w = getWorker();
  if (w) return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const onMsg = e => {
      if (e.data.id !== id) return;
      if (e.data.type === 'progress') busy(progressText(e.data));
      else { w.removeEventListener('message', onMsg); if (e.data.type === 'error') reject(new Error(e.data.message)); else resolve(e.data); }
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, ...msg });
  });
  return import('./solver.js').then(async ({ solveOnePiece, continueSearch }) => {
    if (msg.type === 'solve') { const r = await solveOnePiece(msg.positions, { ...msg.opts, onProgress: p => busy(progressText(p)) }); runSolver.state = r.state; return r; }
    return continueSearch(runSolver.state, { timeLimit: msg.timeLimit, onProgress: p => busy(progressText(p)) });
  });
}

function baseOpts() {
  const scale = state.size / state.nativeLongest;
  return {
    scale, sheet: state.sheet, margin: state.margin,
    tabs: state.tabs, tabH: state.tabH, tabAngle: state.tabAngle, labels: state.labels, mvMarks: state.marks, scoreFace: state.scoreFace,
  };
}

async function update(reframe = false) {
  if (!mesh) return;
  const token = ++updateToken;
  if (state.onePiece) {
    // The search depends only on topology and the face floor, never on scale
    // or tabs, so one solve serves every later slider change.
    const key = `${state.modelName}|${mesh.triCount}|${state.minFaces}`;
    let solved = solveCache.get(key);
    if (!solved) {
      busy('Searching for a one-piece net…');
      let r;
      try {
        r = await runSolver({ type: 'solve', positions: state.positions, opts: { minFaces: state.minFaces, timeLimit: state.searchSeconds * 1000 } });
      } catch (err) {
        busy(null); $('modelMsg').className = 'msg err'; $('modelMsg').textContent = err.message; return;
      }
      if (token !== updateToken) return;
      solved = { mesh: r.mesh, tree: r.tree, simplifiedFrom: r.simplifiedFrom, overlaps: r.overlaps, rounds: r.rounds };
      solveCache.set(key, solved);
      lastSolveKey = key;
      busy(null);
    }
    result = unfold(solved.mesh, { ...baseOpts(), onePiece: true, tree: solved.tree });
    if (solved.overlaps) result.warnings.push(`${solved.overlaps} overlap${solved.overlaps > 1 ? 's' : ''} remain at ${solved.mesh.faces.length} faces (the floor). Keep searching, lower the minimum faces, or accept the pieces.`);
    result.simplifiedFrom = solved.simplifiedFrom;
    $('more').style.display = solved.overlaps ? '' : 'none';
  } else {
    result = unfold(mesh, baseOpts());
    $('more').style.display = 'none';
  }
  patterns = toPatterns(result);
  assembled = patterns.map(p => assemble(p, { strategy: state.strategy, dash: state.dash, gap: state.gap, margin: state.margin }));
  updateGeometry();
  renderNet();
  renderReadouts();
  renderDims();
  renderDownloads();
  if (reframe) { frame3d(); fitNet(); }
}

async function keepSearching() {
  if (!lastSolveKey || !solveCache.has(lastSolveKey)) return;
  const token = ++updateToken;
  busy('Searching for a one-piece net… continuing');
  let r;
  try { r = await runSolver({ type: 'more', timeLimit: state.searchSeconds * 1000 }); }
  catch (err) { busy(null); $('modelMsg').className = 'msg err'; $('modelMsg').textContent = err.message; return; }
  if (token !== updateToken) return;
  busy(null);
  solveCache.set(lastSolveKey, { mesh: r.mesh, tree: r.tree, simplifiedFrom: r.simplifiedFrom, overlaps: r.overlaps, rounds: r.rounds });
  update();
}

/* ── Dimensions overlay: inches, uniform scaling from any axis ───────────── */

function renderDims() {
  const s = state.size / state.nativeLongest;
  const names = ['W', 'D', 'H'];
  const host = $('dims');
  if (!host.dataset.built) {
    host.dataset.built = '1';
    host.innerHTML = '<div class="dims-title">Built size</div>' + names.map((n, k) =>
      `<div class="dims-row"><span class="dims-k">${n}</span><input class="ctrl-input dims-in" data-k="${k}" type="number" step="0.05" min="0.1" /><span class="dims-unit">in</span><span class="dims-mm" data-k="${k}"></span></div>`).join('') +
      '<div class="dims-net" id="dimsNet"></div>';
    for (const inp of host.querySelectorAll('.dims-in')) inp.addEventListener('change', () => {
      const k = +inp.dataset.k, inches = parseFloat(inp.value);
      if (!(inches > 0)) return;
      // Uniform: this axis becomes the typed size and the others follow.
      state.size = Math.min(2000, Math.max(5, inches * 25.4 * state.nativeLongest / state.nativeDims[k]));
      $('size').value = +state.size.toFixed(1);
      update();
    });
  }
  for (const inp of host.querySelectorAll('.dims-in')) { const k = +inp.dataset.k; if (document.activeElement !== inp) inp.value = (state.nativeDims[k] * s / 25.4).toFixed(2); }
  for (const el of host.querySelectorAll('.dims-mm')) el.textContent = `${(state.nativeDims[+el.dataset.k] * s).toFixed(1)} mm`;
  if (result) $('dimsNet').textContent = `net ${(result.stats.netW / 25.4).toFixed(1)} × ${(result.stats.netH / 25.4).toFixed(1)} in`;
}

buildSamples();
buildSidebar();
initThree();
bindFold();
bindNet();
if (!webgl) setViewMode('net');
$('view3d').addEventListener('click', () => setViewMode('3d'));
$('viewNet').addEventListener('click', () => setViewMode('net'));
$('fitView').addEventListener('click', () => { if (state.view === '3d') frame3d(); else fitNet(); });
selectSample('cube');
