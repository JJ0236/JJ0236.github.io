// umbra/app.js — the tool.
//
// The interesting part of this file is the readout: the lamp's emitter size and
// where you put it decide what the object can possibly resolve, so those numbers
// are computed on every change and shown plainly rather than discovered after a
// four-hour print.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseSvgText, parsePathData, boundsOf } from './svg.js';
import {
  LAMPS, optics, sharpness, meanStrokeWidth, makeSurface, rayAngleAtAnchor,
  tiltLimitForSheet, sheetErosion
} from './project.js';
import { exportStl, exportLaserSvg, setupText, download } from './export.js';

const $ = id => document.getElementById(id);
const MM_PER_IN = 25.4;
const DEG = Math.PI / 180;

/* ── Samples ─────────────────────────────────────────────────────────────── */

const star = (() => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * DEG, r = i % 2 ? 42 : 92;
    pts.push(`${(100 + r * Math.cos(a)).toFixed(1)},${(100 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<svg viewBox="0 0 200 200"><polygon points="${pts.join(' ')}"/></svg>`;
})();

const SAMPLES = [
  {
    id: 'star', label: 'Star', svg: star,
    icon: '<polygon points="13,2 16,10 24,10 17,15 20,23 13,18 6,23 9,15 2,10 10,10" stroke="none"/>'
  },
  {
    id: 'moon', label: 'Crescent',
    // Even-odd across two circles: the overlap cancels and leaves a crescent.
    svg: `<svg viewBox="0 0 200 200"><path fill-rule="evenodd" d="M15 100 A85 85 0 1 1 185 100 A85 85 0 1 1 15 100 Z M70 88 A72 72 0 1 1 214 88 A72 72 0 1 1 70 88 Z"/></svg>`,
    icon: '<path d="M18 3a10 10 0 100 20A13 13 0 0118 3z" stroke="none"/>'
  },
  {
    id: 'peaks', label: 'Line art',
    // Stroke-only on purpose — this is the case that builds nothing without
    // stroke outlining turned on.
    svg: `<svg viewBox="0 0 240 150"><g fill="none" stroke="#000" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 128 L74 44 L112 92 L152 34 L226 128"/>
      <path d="M14 128 L226 128"/>
      <circle cx="183" cy="40" r="17"/>
    </g></svg>`,
    icon: '<g fill="none" stroke-width="2.4"><path d="M2 21L8 8l5 7 5-9 6 15"/></g>'
  }
];

/* ── State ───────────────────────────────────────────────────────────────── */

const state = {
  unit: 'mm',
  shapes: null, name: 'star', sampleId: 'star',
  forceStroke: false,
  lampId: 'phone', lampDist: 1200, lampX: 0, lampY: 0,
  wallArtWidth: 420, objectFrac: 0.55,
  polarity: 'negative', yawDeg: 26, pitchDeg: -8,
  thickness: 3, marginMm: 12, bridgeMm: 2.4,
  spreadMm: 0, granularity: 'plate', bandCount: 5, seed: 3,
  view: 'room', showTarget: true
};

const emitter = () => (LAMPS.find(l => l.id === state.lampId) || LAMPS[0]).emitter;
const objectDist = () => state.lampDist * state.objectFrac;
const lampPos = () => [state.lampX, state.lampY, state.lampDist];

const fmtLen = mm => state.unit === 'mm'
  ? `${Math.round(mm * 10) / 10} mm`
  : `${Math.round(mm / MM_PER_IN * 100) / 100} in`;
const toDisplay = mm => state.unit === 'mm' ? mm : mm / MM_PER_IN;
const fromDisplay = v => state.unit === 'mm' ? v : v * MM_PER_IN;

/* ── Three.js ────────────────────────────────────────────────────────────── */

let renderer, scene, camera, controls, wall, objMesh, spot, lampGizmo, lampRay,
    targetLines, barLines, ready = false;

function initThree() {
  const canvas = $('three-canvas');
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch {
    $('no-webgl').classList.add('show');
    return false;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  // VSM is the one map type that honours shadow.radius, which is how the
  // physical penumbra gets represented rather than guessed at.
  renderer.shadowMap.type = THREE.VSMShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x171B22);

  camera = new THREE.PerspectiveCamera(38, 1, 5, 30000);
  camera.position.set(1100, 620, 2100);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 400);

  wall = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 4000),
    new THREE.MeshStandardMaterial({ color: 0xd9d5cd, roughness: 1, metalness: 0 })
  );
  wall.receiveShadow = true;
  scene.add(wall);

  scene.add(new THREE.AmbientLight(0x3a4658, 0.5));

  spot = new THREE.SpotLight(0xfff4e4, 4, 0, 0.6, 0.02, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.bias = -0.0005;
  spot.target.position.set(0, 0, 0);
  scene.add(spot, spot.target);

  lampGizmo = new THREE.Mesh(
    new THREE.SphereGeometry(18, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xffe9b0 })
  );
  lampGizmo.name = 'lamp';
  scene.add(lampGizmo);

  lampRay = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x6b5d3a })
  );
  scene.add(lampRay);

  objMesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({ color: 0x8894a8, roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide })
  );
  objMesh.castShadow = true;
  scene.add(objMesh);

  targetLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x8FB0E8 })
  );
  scene.add(targetLines);

  barLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xD8A657 })
  );
  scene.add(barLines);

  addEventListener('resize', resize);
  resize();
  initLampDrag(canvas);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
  ready = true;
  return true;
}

function resize() {
  const w = $('three-canvas').clientWidth, h = $('three-canvas').clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

// Dragging the lamp is the primary way to place it, so it is a direct hit test
// on the gizmo rather than a mode you have to switch into.
function initLampDrag(canvas) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let dragging = false;
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();

  const setNdc = e => {
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1));
  };

  canvas.addEventListener('pointerdown', e => {
    if (state.view !== 'room') return;
    setNdc(e);
    ray.setFromCamera(ndc, camera);
    if (!ray.intersectObject(lampGizmo).length) return;
    dragging = true;
    controls.enabled = false;
    plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), lampGizmo.position);
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    setNdc(e);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    state.lampX = Math.max(-900, Math.min(900, hit.x));
    state.lampY = Math.max(-900, Math.min(900, hit.y));
    syncInputs();
    scheduleBuild();
  });

  const stop = () => { dragging = false; controls.enabled = true; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
}

function updateScene(o) {
  if (!ready) return;
  const [lx, ly, lz] = lampPos();
  spot.position.set(lx, ly, lz);
  lampGizmo.position.set(lx, ly, lz);
  lampRay.geometry.setFromPoints([new THREE.Vector3(lx, ly, lz), new THREE.Vector3(0, 0, 0)]);

  // Cone wide enough to clear the art, and no wider — a tight cone spends the
  // shadow map where it matters.
  const half = Math.hypot(state.wallArtWidth, state.wallArtWidth * 0.8) / 2 * 1.5;
  spot.angle = Math.min(1.3, Math.atan(half / lz) + 0.12);
  spot.shadow.camera.near = Math.max(5, lz * 0.05);
  spot.shadow.camera.far = lz * 2.4;
  spot.shadow.camera.fov = spot.angle * 2 / DEG;

  // Map the real penumbra onto the shadow map's blur radius so the preview's
  // softness tracks the physics instead of being decorative.
  const footprint = 2 * Math.tan(spot.angle) * lz;
  const texel = footprint / spot.shadow.mapSize.x;
  spot.shadow.radius = Math.max(0.6, Math.min(28, (o.blur || 1) / Math.max(texel, 1e-6)));
  spot.shadow.camera.updateProjectionMatrix();

  const wallView = state.view === 'wall';
  // In wall view the object would sit exactly in front of its own shadow, so it
  // stops drawing but keeps casting — the shadow pass does not use these flags.
  objMesh.material.colorWrite = !wallView;
  objMesh.material.depthWrite = !wallView;
  lampGizmo.visible = !wallView;
  lampRay.visible = !wallView;
  targetLines.visible = state.showTarget;
  barLines.visible = state.showTarget && !wallView;

  $('hint').textContent = wallView
    ? 'What the wall sees — the object is hidden but still casting'
    : 'Drag to orbit — drag the lamp to place it';
}

function setView(v) {
  state.view = v;
  $('v-room').classList.toggle('active', v === 'room');
  $('v-wall').classList.toggle('active', v === 'wall');
  if (!ready) return;
  if (v === 'wall') {
    const d = Math.max(state.wallArtWidth, 300) * 1.7;
    camera.position.set(0, 0, d);
    controls.target.set(0, 0, 0);
  } else {
    camera.position.set(state.lampDist * 0.9, state.lampDist * 0.5, state.lampDist * 1.7);
    controls.target.set(0, 0, state.lampDist * 0.35);
  }
  controls.update();
  updateScene(currentOptics());
}

function ringsToLineGeometry(mp, z) {
  const pts = [];
  for (const poly of mp) for (const ring of poly) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      pts.push(a[0], a[1], z, b[0], b[1], z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

/* ── Build ───────────────────────────────────────────────────────────────── */

let worker = null, buildTimer = null, buildSeq = 0, fallbackMesh = null;

function getWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => onBuilt(e.data);
    worker.onerror = () => { worker = null; };
  } catch { worker = null; }
  return worker;
}

const currentOptics = () => optics({
  lampDist: state.lampDist, objectDist: objectDist(),
  emitter: emitter(), wallArtWidth: state.wallArtWidth
});

function buildPayload() {
  const o = currentOptics();
  return {
    shapes: state.shapes,
    wallArtWidth: state.wallArtWidth,
    forceStroke: state.forceStroke,
    strokeOverride: 0,
    build: {
      L: lampPos(), objectDist: objectDist(),
      yaw: state.yawDeg * DEG, pitch: state.pitchDeg * DEG,
      thickness: state.thickness, polarity: state.polarity,
      marginMm: state.marginMm, bridgeMm: state.bridgeMm,
      spreadMm: state.spreadMm, granularity: state.granularity,
      bandCount: state.bandCount, seed: state.seed,
      magnification: Number.isFinite(o.M) ? o.M : 1
    }
  };
}

function scheduleBuild() {
  updateReadout();
  if (!state.shapes) return;
  clearTimeout(buildTimer);
  buildTimer = setTimeout(runBuild, 110);
}

async function runBuild() {
  const seq = ++buildSeq;
  $('overlay').classList.add('show');
  $('stage').className = 'stage';
  $('stage').textContent = 'Building…';
  const payload = buildPayload();
  const w = getWorker();
  if (w) { w.postMessage(payload); return; }

  // Module workers are not everywhere yet; fall back to the main thread rather
  // than failing outright.
  try {
    if (!fallbackMesh) fallbackMesh = await import('./mesh.js');
    const { shapesToPolygons, fitToWall, buildSolid, polyStats } = fallbackMesh;
    const art = shapesToPolygons(payload.shapes, { forceStroke: payload.forceStroke });
    if (!art.length) throw new Error('That SVG produced no filled area. If it is line art, turn on "outline strokes".');
    const fit = fitToWall(art, payload.wallArtWidth);
    const r = buildSolid(fit.mp, payload.build);
    if (seq === buildSeq) {
      onBuilt({ ok: true, ...r, art: fit.mp, stats: polyStats(fit.mp), bounds: fit.bounds });
    }
  } catch (err) {
    if (seq === buildSeq) onBuilt({ ok: false, error: err.message || String(err) });
  }
}

let last = null;

function onBuilt(d) {
  $('overlay').classList.remove('show');
  if (!d.ok) {
    last = null;
    $('overlay').classList.add('show');
    $('stage').className = 'stage err';
    $('stage').textContent = d.error;
    $('b-stl').disabled = true;
    $('b-svg').disabled = true;
    return;
  }
  last = d;

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.positions, 3));
  g.computeVertexNormals();
  objMesh.geometry.dispose();
  objMesh.geometry = g;

  targetLines.geometry.dispose();
  targetLines.geometry = ringsToLineGeometry(d.art, 1.2);

  const barPts = [];
  for (const [a, b] of d.bars || []) barPts.push(a[0], a[1], 2.0, b[0], b[1], 2.0);
  barLines.geometry.dispose();
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(barPts, 3));
  barLines.geometry = bg;

  $('b-stl').disabled = false;
  updateReadout();
  updateScene(currentOptics());

  const bb = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position'));
  const size = bb.getSize(new THREE.Vector3());
  $('stats').textContent =
    `${(d.positions.length / 9).toLocaleString()} triangles\n` +
    `object ${fmtLen(size.x)} x ${fmtLen(size.y)} x ${fmtLen(size.z)}` +
    (d.groupCount > 1 ? `\n${d.groupCount} depth groups` : '');
  $('notes').textContent = (d.warnings || []).join('\n');
}

/* ── The readout ─────────────────────────────────────────────────────────── */

function updateReadout() {
  const o = currentOptics();
  const wallStroke = last ? meanStrokeWidth(last.stats.area, last.stats.perimeter) : 0;
  const objectStroke = Number.isFinite(o.M) && o.M > 0 ? wallStroke / o.M : 0;
  const s = sharpness(objectStroke, o);

  const rows = [
    ['magnification', `${o.M.toFixed(2)}x`],
    ['object art', fmtLen(o.objectArtWidth)],
    ['blur on wall', fmtLen(o.blur)],
    ['finest detail', fmtLen(o.minFeatureObject) + ' on object'],
    ['your strokes', wallStroke ? fmtLen(objectStroke) + ' on object' : '—'],
    ['detail budget', `${Math.round(o.resolvableFeatures)} across`]
  ];
  $('readout').innerHTML = rows
    .map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

  const v = $('verdict');
  if (!last) {
    v.className = 'verdict soft';
    v.textContent = 'Load some art to see whether this lamp can resolve it.';
  } else if (s.verdict === 'sharp') {
    v.className = 'verdict sharp';
    v.textContent = `Sharp — strokes are ${s.ratio.toFixed(1)}x the penumbra.`;
  } else if (s.verdict === 'soft') {
    v.className = 'verdict soft';
    v.textContent = `Soft — strokes are only ${s.ratio.toFixed(1)}x the penumbra. Move the object toward the wall, or use a smaller emitter.`;
  } else {
    v.className = 'verdict bad';
    v.textContent = `Washed out — strokes are ${s.ratio.toFixed(1)}x the penumbra. A ${emitter()} mm emitter cannot draw this. Try bolder art, a smaller source, or a lower magnification.`;
  }

  // The cut file is only honest while the sheet's perpendicular kerf stays
  // small against the finest feature, so say when it stops being so.
  const S = makeSurface({ L: lampPos(), objectDist: objectDist(), yaw: state.yawDeg * DEG, pitch: state.pitchDeg * DEG });
  const ang = rayAngleAtAnchor(S);
  const err = sheetErosion(state.thickness, ang);
  const limit = tiltLimitForSheet(state.thickness, o.minFeatureObject) / DEG;
  const flat = state.spreadMm <= 0 || state.polarity === 'negative';
  $('b-svg').disabled = !last || !flat;
  $('svg-hint').textContent = !flat
    ? 'Cut files are flat only — set Depth spread to zero to enable.'
    : `Kerf runs square to the sheet, so expect about ${fmtLen(err)} of edge error at this tilt. Stays usable to roughly ${Math.round(limit)}° of ray angle.`;
}

/* ── Art loading ─────────────────────────────────────────────────────────── */

function loadSvgText(text, name) {
  try {
    state.shapes = parseSvgText(text);
    state.name = name;
    // Stroke-only art builds nothing unless outlining is on, so turn it on
    // rather than handing back an empty object.
    const anyFill = state.shapes.some(s => s.filled);
    if (!anyFill) { state.forceStroke = true; $('t-stroke').classList.add('on'); }
    scheduleBuild();
  } catch (err) {
    $('overlay').classList.add('show');
    $('stage').className = 'stage err';
    $('stage').textContent = err.message;
  }
}

function loadSample(id) {
  const s = SAMPLES.find(x => x.id === id) || SAMPLES[0];
  state.sampleId = id;
  state.forceStroke = id === 'peaks';
  $('t-stroke').classList.toggle('on', state.forceStroke);
  $('word').value = '';
  document.querySelectorAll('#samples button').forEach(b => b.classList.toggle('active', b.dataset.id === id));
  loadSvgText(s.svg, s.label.toLowerCase());
}

let opentypeLib = null, antonFont = null;

async function loadWord(word) {
  if (!word.trim()) return;
  $('overlay').classList.add('show');
  $('stage').className = 'stage';
  $('stage').textContent = 'Loading the typeface…';
  try {
    if (!opentypeLib) opentypeLib = await import('https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.module.js');
    if (!antonFont) {
      const buf = await (await fetch(new URL('./vendor/Anton-Regular.ttf', import.meta.url))).arrayBuffer();
      antonFont = opentypeLib.parse(buf);
    }
    const path = antonFont.getPath(word.toUpperCase(), 0, 0, 100);
    const sub = parsePathData(path.toPathData(3), 0.08);
    if (!sub.length) throw new Error('Nothing to draw for those characters.');
    state.shapes = [{
      rings: sub.map(s => s.points), closed: sub.map(() => true),
      fillRule: 'nonzero', filled: true, strokeWidth: 0
    }];
    state.name = word.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'word';
    state.sampleId = null;
    state.forceStroke = false;
    $('t-stroke').classList.remove('on');
    document.querySelectorAll('#samples button').forEach(b => b.classList.remove('active'));
    scheduleBuild();
  } catch (err) {
    $('stage').className = 'stage err';
    $('stage').textContent = `Could not set that word: ${err.message}`;
  }
}

/* ── Wiring ──────────────────────────────────────────────────────────────── */

function syncInputs() {
  $('r-lampdist').value = state.lampDist;
  $('r-lampx').value = state.lampX;
  $('r-lampy').value = state.lampY;
  $('r-artw').value = state.wallArtWidth;
  $('r-objdist').value = Math.round(state.objectFrac * 100);
  $('r-yaw').value = state.yawDeg;
  $('r-pitch').value = state.pitchDeg;
  $('r-spread').value = state.spreadMm;
  $('i-thick').value = Math.round(toDisplay(state.thickness) * 100) / 100;
  $('i-margin').value = Math.round(toDisplay(state.marginMm) * 100) / 100;
  $('i-bridge').value = Math.round(toDisplay(state.bridgeMm) * 100) / 100;
  $('i-seed').value = state.seed;

  $('v-lampdist').textContent = fmtLen(state.lampDist);
  $('v-lampx').textContent = fmtLen(state.lampX);
  $('v-lampy').textContent = fmtLen(state.lampY);
  $('v-artw').textContent = fmtLen(state.wallArtWidth);
  $('v-objdist').textContent = `${fmtLen(objectDist())} — ${currentOptics().M.toFixed(2)}x`;
  $('v-yaw').textContent = `${state.yawDeg}°`;
  $('v-pitch').textContent = `${state.pitchDeg}°`;
  $('v-spread').textContent = fmtLen(state.spreadMm);
  $('emitter-hint').textContent = `${emitter()} mm emitter — this is the number that limits detail.`;

  const flat = state.polarity === 'negative';
  $('r-spread').disabled = flat;
  $('depth-hint').textContent = flat
    ? 'A cut plate is one rigid piece, so depth needs Solid art.'
    : 'Depth is what stops the object looking like the picture from other angles.';
  $('polarity-hint').textContent = flat
    ? 'Glowing art in a dark field. One plate holds everything.'
    : 'Dark art on a lit wall. Every island needs a bridge.';
}

function wire() {
  $('samples').innerHTML = SAMPLES.map(s =>
    `<button data-id="${s.id}" title="${s.label}"><svg viewBox="0 0 26 26" stroke-linecap="round" stroke-linejoin="round">${s.icon}</svg></button>`
  ).join('');
  $('samples').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) loadSample(b.dataset.id);
  });

  $('lamp').innerHTML = LAMPS.map(l =>
    `<option value="${l.id}">${l.label}</option>`).join('');
  $('lamp').value = state.lampId;
  $('lamp').addEventListener('change', e => { state.lampId = e.target.value; syncInputs(); scheduleBuild(); });

  const drop = $('drop'), file = $('file');
  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (f) loadSvgText(await f.text(), f.name.replace(/\.svg$/i, ''));
  });
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', async e => {
    const f = e.dataTransfer.files[0];
    if (f) loadSvgText(await f.text(), f.name.replace(/\.svg$/i, ''));
  });

  let wordTimer = null;
  $('word').addEventListener('input', e => {
    clearTimeout(wordTimer);
    const v = e.target.value;
    wordTimer = setTimeout(() => loadWord(v), 420);
  });

  $('t-stroke').addEventListener('click', () => {
    state.forceStroke = !state.forceStroke;
    $('t-stroke').classList.toggle('on', state.forceStroke);
    scheduleBuild();
  });

  const range = (id, key, transform = v => v) => $(id).addEventListener('input', e => {
    state[key] = transform(parseFloat(e.target.value));
    syncInputs(); scheduleBuild();
    if (ready) updateScene(currentOptics());
  });
  range('r-lampdist', 'lampDist');
  range('r-lampx', 'lampX');
  range('r-lampy', 'lampY');
  range('r-artw', 'wallArtWidth');
  range('r-objdist', 'objectFrac', v => v / 100);
  range('r-yaw', 'yawDeg');
  range('r-pitch', 'pitchDeg');
  range('r-spread', 'spreadMm');

  const num = (id, key, conv = true) => $(id).addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) { syncInputs(); return; }
    state[key] = conv ? fromDisplay(v) : v;
    syncInputs(); scheduleBuild();
  });
  num('i-thick', 'thickness');
  num('i-margin', 'marginMm');
  num('i-bridge', 'bridgeMm');
  num('i-seed', 'seed', false);

  $('seg-polarity').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    state.polarity = b.dataset.v;
    [...$('seg-polarity').children].forEach(c => c.classList.toggle('active', c === b));
    syncInputs(); scheduleBuild();
  });
  $('seg-gran').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    state.granularity = b.dataset.v;
    [...$('seg-gran').children].forEach(c => c.classList.toggle('active', c === b));
    scheduleBuild();
  });

  $('v-room').addEventListener('click', () => setView('room'));
  $('v-wall').addEventListener('click', () => setView('wall'));
  $('v-overlay').addEventListener('click', () => {
    state.showTarget = !state.showTarget;
    $('v-overlay').classList.toggle('active', state.showTarget);
    updateScene(currentOptics());
  });

  const setUnit = u => {
    state.unit = u;
    $('u-mm').classList.toggle('active', u === 'mm');
    $('u-in').classList.toggle('active', u === 'in');
    syncInputs(); updateReadout();
    if (last) onBuiltStatsOnly();
  };
  $('u-mm').addEventListener('click', () => setUnit('mm'));
  $('u-in').addEventListener('click', () => setUnit('in'));

  $('b-stl').addEventListener('click', () => {
    if (!last) return;
    download(exportStl(last.positions, { name: state.name, setup: currentSetup() }),
      `umbra-${state.name}.stl`);
  });
  $('b-svg').addEventListener('click', () => {
    if (!last) return;
    try {
      download(exportLaserSvg(last.material, {
        L: lampPos(), objectDist: objectDist(),
        yaw: state.yawDeg * DEG, pitch: state.pitchDeg * DEG,
        sheetMm: state.thickness, name: state.name, setup: currentSetup()
      }), `umbra-${state.name}-cut.svg`);
    } catch (err) {
      $('notes').textContent = err.message;
    }
  });
}

function onBuiltStatsOnly() {
  const g = objMesh.geometry.getAttribute('position');
  if (!g) return;
  const bb = new THREE.Box3().setFromBufferAttribute(g);
  const size = bb.getSize(new THREE.Vector3());
  $('stats').textContent =
    `${(last.positions.length / 9).toLocaleString()} triangles\n` +
    `object ${fmtLen(size.x)} x ${fmtLen(size.y)} x ${fmtLen(size.z)}` +
    (last.groupCount > 1 ? `\n${last.groupCount} depth groups` : '');
}

const currentSetup = () => setupText({
  lampDist: state.lampDist, lampX: state.lampX, lampY: state.lampY,
  objectDist: objectDist(), yawDeg: state.yawDeg, pitchDeg: state.pitchDeg,
  emitter: emitter(), M: currentOptics().M, wallArtWidth: state.wallArtWidth
});

/* ── Go ──────────────────────────────────────────────────────────────────── */

wire();
syncInputs();
if (initThree()) {
  setView('room');
  loadSample('star');
} else {
  $('overlay').classList.remove('show');
}
