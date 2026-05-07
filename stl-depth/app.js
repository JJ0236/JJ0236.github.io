import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  mesh: null,
  modelLoaded: false,
  depthAxis: 'pz',       // pz | py | px | nz | ny | nx
  projection: 'ortho',   // ortho | persp
  polarity: 'near',      // near | far  (near=white is default)
  resolution: 1024,
  depthBuffer: null,     // Float32Array of linear [0-1] depth values
  depthWidth: 0,
  depthHeight: 0,
  debounceTimer: null,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const viewport       = document.getElementById('viewport');
const dropOverlay    = document.getElementById('drop-overlay');
const stlInput       = document.getElementById('stl-input');
const depthCanvas    = document.getElementById('depth-canvas');
const depthPlaceholder = document.getElementById('depth-placeholder');
const depthSpinner   = document.getElementById('depth-spinner');
const btnDownload    = document.getElementById('btn-download');
const statusEl       = document.getElementById('status');
const infoStrip      = document.getElementById('info-strip');
const selRes         = document.getElementById('sel-res');

// ─── Three.js setup ───────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0F1209);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
camera.position.set(0, 0, 4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.addEventListener('end', scheduleDepthUpdate);

// Lights
const ambient = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambient);
const dirA = new THREE.DirectionalLight(0xffffff, 1.0);
dirA.position.set(5, 8, 6);
scene.add(dirA);
const dirB = new THREE.DirectionalLight(0x8FAF6E, 0.35);
dirB.position.set(-4, -3, -5);
scene.add(dirB);

// ─── Resize ───────────────────────────────────────────────────────────────────
function onResize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
const ro = new ResizeObserver(onResize);
ro.observe(viewport);
onResize();

// ─── Render loop ──────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ─── STL loading ─────────────────────────────────────────────────────────────
const loader = new STLLoader();

function loadGeometry(buffer) {
  setStatus('Parsing STL…');
  let geometry;
  try {
    geometry = loader.parse(buffer);
  } catch (e) {
    setStatus('Error: Could not parse STL.');
    return;
  }

  // Remove previous mesh
  if (state.mesh) {
    scene.remove(state.mesh);
    state.mesh.geometry.dispose();
    state.mesh.material.dispose();
    state.mesh = null;
  }

  geometry.computeBoundingBox();
  geometry.computeVertexNormals();

  // Center at origin and normalise scale to fit in a unit sphere of radius 1.5
  const bbox = geometry.boundingBox;
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);

  const size = new THREE.Vector3();
  bbox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 3.0 / maxDim;
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();

  const material = new THREE.MeshStandardMaterial({
    color: 0x8FAF6E,
    roughness: 0.55,
    metalness: 0.1,
  });
  state.mesh = new THREE.Mesh(geometry, material);
  scene.add(state.mesh);

  // Reset camera
  camera.position.set(0, 0, 5);
  controls.reset();

  state.modelLoaded = true;
  dropOverlay.classList.add('hidden');

  const verts = geometry.attributes.position.count;
  const tris  = Math.floor(verts / 3);
  infoStrip.innerHTML =
    `Triangles: ${tris.toLocaleString()}<br>` +
    `Size (original): ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;

  setStatus('Model loaded');
  scheduleDepthUpdate();
}

// ─── File input wiring ────────────────────────────────────────────────────────
stlInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  readFile(file);
  e.target.value = '';
});

viewport.addEventListener('dragover', e => { e.preventDefault(); viewport.classList.add('drag-over'); });
viewport.addEventListener('dragleave', () => viewport.classList.remove('drag-over'));
viewport.addEventListener('drop', e => {
  e.preventDefault();
  viewport.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) readFile(file);
});

function readFile(file) {
  if (!file.name.toLowerCase().endsWith('.stl')) {
    setStatus('Please load an .stl file.');
    return;
  }
  setStatus('Reading file…');
  const reader = new FileReader();
  reader.onload = ev => loadGeometry(ev.target.result);
  reader.readAsArrayBuffer(file);
}

// ─── Depth map generation ─────────────────────────────────────────────────────
function scheduleDepthUpdate() {
  if (!state.modelLoaded) return;
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(generateDepthMap, 60);
}

function axisToCamera(axis, bbox) {
  // Returns { pos, up } looking toward model origin from the selected axis direction
  const d = 8; // distance — will be overridden per projection below
  const dirs = {
    pz: { pos: new THREE.Vector3(0, 0,  d), up: new THREE.Vector3(0, 1, 0) },
    nz: { pos: new THREE.Vector3(0, 0, -d), up: new THREE.Vector3(0, 1, 0) },
    py: { pos: new THREE.Vector3(0,  d, 0), up: new THREE.Vector3(0, 0, -1) },
    ny: { pos: new THREE.Vector3(0, -d, 0), up: new THREE.Vector3(0, 0,  1) },
    px: { pos: new THREE.Vector3( d, 0, 0), up: new THREE.Vector3(0, 1, 0) },
    nx: { pos: new THREE.Vector3(-d, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  };
  return dirs[axis] || dirs['pz'];
}

async function generateDepthMap() {
  if (!state.modelLoaded || !state.mesh) return;

  depthSpinner.classList.add('active');

  // Defer one tick so spinner paints
  await new Promise(r => setTimeout(r, 0));

  const res = state.resolution;
  const geo = state.mesh.geometry;
  geo.computeBoundingBox();
  const bbox = geo.boundingBox;

  const size = new THREE.Vector3();
  bbox.getSize(size);
  const halfW = Math.max(size.x, size.z) / 2 + 0.3;
  const halfH = size.y / 2 + 0.3;

  const { pos, up } = axisToCamera(state.depthAxis, bbox);
  const dist = 10;

  // Build offscreen camera
  let offCam;
  if (state.projection === 'ortho') {
    // Determine half-extents based on the axis to get tight framing
    let hw, hh;
    switch (state.depthAxis) {
      case 'pz': case 'nz': hw = size.x / 2 + 0.3; hh = size.y / 2 + 0.3; break;
      case 'py': case 'ny': hw = size.x / 2 + 0.3; hh = size.z / 2 + 0.3; break;
      case 'px': case 'nx': hw = size.z / 2 + 0.3; hh = size.y / 2 + 0.3; break;
      default:              hw = halfW; hh = halfH;
    }
    offCam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.01, 40);
  } else {
    offCam = new THREE.PerspectiveCamera(45, 1, 0.01, 40);
  }

  offCam.position.copy(pos).normalize().multiplyScalar(dist);
  offCam.up.copy(up);
  offCam.lookAt(0, 0, 0);
  offCam.updateProjectionMatrix();

  // Offscreen render target
  const rt = new THREE.WebGLRenderTarget(res, res, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });

  // Swap to depth material
  const origMat = state.mesh.material;
  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  state.mesh.material = depthMat;

  // Render to target
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0xffffff, 1);
  renderer.render(scene, offCam);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x0F1209, 1);

  // Read pixels
  const pixels = new Uint8Array(res * res * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, res, res, pixels);

  // Restore
  state.mesh.material = origMat;
  depthMat.dispose();
  rt.dispose();

  // Unpack RGBADepthPacking → float
  // THREE.js RGBADepthPacking: depth = dot(RGBA / 255, [1, 1/255, 1/65025, 1/16581375])
  const depth = new Float32Array(res * res);
  const inv = 1.0 / 255.0;
  for (let i = 0; i < res * res; i++) {
    const idx = i * 4;
    const r = pixels[idx]     * inv;
    const g = pixels[idx + 1] * inv;
    const b = pixels[idx + 2] * inv;
    const a = pixels[idx + 3] * inv;
    depth[i] = r + g / 255.0 + b / 65025.0 + a / 16581375.0;
  }

  // Clamp [0,1] and flip Y (WebGL reads bottom-to-top)
  // Also linearise: depth is already linear from OrthographicCamera,
  // and approximately linear from Perspective for small FOV.
  // We remap to the actual min/max occupied depth to use full range.
  let dMin = Infinity, dMax = -Infinity;
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] < 0.9999) { // ignore background (white pixels)
      if (depth[i] < dMin) dMin = depth[i];
      if (depth[i] > dMax) dMax = depth[i];
    }
  }
  if (!isFinite(dMin) || dMax === dMin) { dMin = 0; dMax = 1; }
  const dRange = dMax - dMin;

  const normalised = new Float32Array(res * res);
  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      // Flip Y
      const srcIdx = (res - 1 - row) * res + col;
      const dstIdx = row * res + col;
      const raw = depth[srcIdx];
      let v;
      if (raw >= 0.9999) {
        v = 0; // background → black
      } else {
        v = (raw - dMin) / dRange;
        // near = white → invert so closest surface = 1.0
        v = 1.0 - v;
      }
      if (state.polarity === 'far') v = 1.0 - v;
      normalised[dstIdx] = Math.max(0, Math.min(1, v));
    }
  }

  state.depthBuffer = normalised;
  state.depthWidth  = res;
  state.depthHeight = res;

  // Draw 8-bit preview
  drawPreview(normalised, res, res);

  depthSpinner.classList.remove('active');
  depthPlaceholder.style.display = 'none';
  btnDownload.disabled = false;
  setStatus('Depth map ready');
}

// ─── Preview canvas (8-bit display) ──────────────────────────────────────────
function drawPreview(normalised, w, h) {
  depthCanvas.width  = w;
  depthCanvas.height = h;
  const ctx  = depthCanvas.getContext('2d');
  const img  = ctx.createImageData(w, h);
  const data = img.data;
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(normalised[i] * 255);
    data[i * 4]     = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// ─── 16-bit PNG encoder ───────────────────────────────────────────────────────
// Standard PNG format, grayscale 16-bit (color type 0, bit depth 16)
// Uses CompressionStream('deflate-raw') for IDAT.

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })());
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function writeUint32BE(arr, offset, value) {
  arr[offset]     = (value >>> 24) & 0xFF;
  arr[offset + 1] = (value >>> 16) & 0xFF;
  arr[offset + 2] = (value >>>  8) & 0xFF;
  arr[offset + 3] =  value         & 0xFF;
}

function makeChunk(typeStr, data) {
  const type = new TextEncoder().encode(typeStr);
  const length = data.length;
  const chunk = new Uint8Array(4 + 4 + length + 4);
  writeUint32BE(chunk, 0, length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  const crcBuf = new Uint8Array(4 + length);
  crcBuf.set(type, 0);
  crcBuf.set(data, 4);
  writeUint32BE(chunk, 8 + length, crc32(crcBuf));
  return chunk;
}

async function encodePNG16(normalised, width, height) {
  // IHDR
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8]  = 16; // bit depth
  ihdr[9]  = 0;  // color type: grayscale
  ihdr[10] = 0;  // compression method
  ihdr[11] = 0;  // filter method
  ihdr[12] = 0;  // interlace method

  // Raw scanlines (filter byte 0 + big-endian uint16 per pixel)
  const scanlineLen = 1 + width * 2;
  const raw = new Uint8Array(height * scanlineLen);
  for (let y = 0; y < height; y++) {
    raw[y * scanlineLen] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const v16 = Math.round(normalised[y * width + x] * 65535);
      const pos = y * scanlineLen + 1 + x * 2;
      raw[pos]     = (v16 >>> 8) & 0xFF;
      raw[pos + 1] =  v16        & 0xFF;
    }
  }

  // Compress raw scanlines with deflate-raw
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(raw);
  writer.close();

  const chunks = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Wrap in zlib framing (CMF + FLG + deflate data + Adler-32)
  // Compute Adler-32 of raw
  let s1 = 1, s2 = 0;
  for (let i = 0; i < raw.length; i++) {
    s1 = (s1 + raw[i]) % 65521;
    s2 = (s2 + s1)     % 65521;
  }
  const adler = new Uint8Array(4);
  adler[0] = (s2 >>> 8) & 0xFF;
  adler[1] =  s2        & 0xFF;
  adler[2] = (s1 >>> 8) & 0xFF;
  adler[3] =  s1        & 0xFF;

  const deflateLen = chunks.reduce((a, b) => a + b.length, 0);
  const zlib = new Uint8Array(2 + deflateLen + 4);
  zlib[0] = 0x78; // CMF: deflate, window 32K
  zlib[1] = 0x9C; // FLG: default compression, no dict; 0x789C is divisible by 31
  let off = 2;
  for (const c of chunks) { zlib.set(c, off); off += c.length; }
  zlib.set(adler, off);

  // Assemble PNG bytes
  const sig   = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const IHDR  = makeChunk('IHDR', ihdr);
  const IDAT  = makeChunk('IDAT', zlib);
  const IEND  = makeChunk('IEND', new Uint8Array(0));

  const total = sig.length + IHDR.length + IDAT.length + IEND.length;
  const png   = new Uint8Array(total);
  let p = 0;
  for (const part of [sig, IHDR, IDAT, IEND]) { png.set(part, p); p += part.length; }
  return png;
}

// ─── Download ─────────────────────────────────────────────────────────────────
btnDownload.addEventListener('click', async () => {
  if (!state.depthBuffer) return;
  btnDownload.disabled = true;
  setStatus('Encoding 16-bit PNG…');
  try {
    const png = await encodePNG16(state.depthBuffer, state.depthWidth, state.depthHeight);
    const blob = new Blob([png], { type: 'image/png' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `depth-map-${state.depthAxis}-${state.resolution}px.png`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Downloaded.');
  } catch (e) {
    setStatus('PNG encoding failed: ' + e.message);
    console.error(e);
  }
  btnDownload.disabled = false;
});

// ─── UI controls ──────────────────────────────────────────────────────────────
// Axis buttons
document.querySelectorAll('.axis-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.axis-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.depthAxis = btn.dataset.axis;
    scheduleDepthUpdate();
  });
});
// Set default active
document.querySelector('.axis-btn[data-axis="pz"]').classList.add('active');

// Projection toggle
document.querySelectorAll('[data-proj]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-proj]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.projection = btn.dataset.proj;
    scheduleDepthUpdate();
  });
});

// Polarity toggle
document.querySelectorAll('[data-pol]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-pol]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.polarity = btn.dataset.pol;
    scheduleDepthUpdate();
  });
});

// Resolution select
selRes.addEventListener('change', () => {
  state.resolution = parseInt(selRes.value, 10);
  scheduleDepthUpdate();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setStatus(msg) {
  statusEl.textContent = msg;
}
