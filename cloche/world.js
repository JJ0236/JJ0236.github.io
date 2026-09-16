// cloche/world.js — a sunny kitchen windowsill: counter, window, fruit, jar,
// spill, cloth; lights; scent sources, food sites, egg sites, obstacles, a
// height map for climbing, picking, the shadow sweep and the poke ripple.
// Units are millimetres. The counter top is y = 0.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function loadGltf(url) { const g = await new GLTFLoader().loadAsync(url); return g.scene; }

// Bounding-volume hierarchy so raycasts against the set's real meshes are cheap.
let bvh = null;
export async function loadBvh() {
  if (bvh) return bvh;
  try {
    const m = await import('https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.8.3/build/index.module.js');
    THREE.BufferGeometry.prototype.computeBoundsTree = m.computeBoundsTree;
    THREE.BufferGeometry.prototype.disposeBoundsTree = m.disposeBoundsTree;
    THREE.Mesh.prototype.raycast = m.acceleratedRaycast;
    bvh = m;
  } catch (e) { console.warn('cloche: three-mesh-bvh unavailable, using the approximate surface', e); bvh = false; }
  return bvh;
}
export const MAX_SLOPE = Math.cos(THREE.MathUtils.degToRad(58));   // steeper than this is a wall

export const COUNTER = { x0: -180, x1: 180, z0: -98, z1: 102 };
export const WALK = { x0: -172, x1: 172, z0: -90, z1: 95 };
export const DROP_R = 3.4;
const DROP_COLOURS = { sugar: '#E8B85A', bitter: '#7E8E48', mixed: '#B09A44' };
const SCENT_COLOURS = { fruit: '#C97A4A', vinegar: '#8E9F5A' };

function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 4;
  return t;
}
const paintedWood = () => canvasTex(512, 512, (g) => {
  g.fillStyle = '#E3D8C2'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(150,130,100,${0.05 + Math.random() * 0.08})`; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); const y = Math.random() * 512; g.moveTo(0, y); g.bezierCurveTo(170, y + (Math.random() - 0.5) * 30, 340, y + (Math.random() - 0.5) * 30, 512, y + (Math.random() - 0.5) * 10); g.stroke(); }
}, [2, 1]);
const tiles = () => canvasTex(256, 256, (g) => {
  g.fillStyle = '#C9CFD3'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? '#F4F6F4' : '#EEF2EF'; g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122); }
}, [6, 2]);
const skyTex = () => canvasTex(1024, 512, (g) => {
  const grad = g.createLinearGradient(0, 0, 0, 512); grad.addColorStop(0, '#5B9BDD'); grad.addColorStop(0.5, '#BEDCF4'); grad.addColorStop(0.58, '#A6C98F'); grad.addColorStop(0.75, '#6E9A55'); grad.addColorStop(1, '#4E7A3E');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);
  // a lawn, a hedge line, and tree canopies against the sky
  g.fillStyle = '#7FB05C'; g.fillRect(0, 330, 1024, 182);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(60,110,45,${0.15 + Math.random() * 0.2})`; g.fillRect(0, 335 + i * 4.4, 1024, 2); }
  for (let x = -20; x < 1050; x += 26) { const r = 26 + Math.random() * 10; g.fillStyle = `rgb(${52 + Math.random() * 20},${100 + Math.random() * 25},${45 + Math.random() * 15})`; g.beginPath(); g.ellipse(x, 322, r, r * 0.8, 0, 0, 6.28); g.fill(); }
  for (let t = 0; t < 7; t++) { const cx = 60 + t * 150 + Math.random() * 60, cy = 200 + Math.random() * 40, R = 70 + Math.random() * 50; g.fillStyle = '#5B4630'; g.fillRect(cx - 6, cy, 12, 130); for (let k = 0; k < 14; k++) { const a = Math.random() * 6.28, d = Math.random() * R * 0.6; g.fillStyle = `rgba(${45 + Math.random() * 40},${105 + Math.random() * 45},${40 + Math.random() * 25},0.9)`; g.beginPath(); g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, R * 0.45, R * 0.35, 0, 0, 6.28); g.fill(); } }
  // soft clouds
  for (let i = 0; i < 9; i++) { const x = Math.random() * 1024, y = 40 + Math.random() * 150; for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 30, 40 + Math.random() * 50, 16 + Math.random() * 16, 0, 0, 6.28); g.fill(); } }
});
const bananaTex = () => canvasTex(256, 64, (g) => {
  g.fillStyle = '#F2D34A'; g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(90,60,20,${0.15 + Math.random() * 0.45})`; g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 64, 2 + Math.random() * 6, 1 + Math.random() * 3, Math.random() * 3, 0, 6.28); g.fill(); }
  const grad = g.createLinearGradient(200, 0, 256, 0); grad.addColorStop(0, 'rgba(90,60,20,0)'); grad.addColorStop(1, 'rgba(70,45,15,0.75)'); g.fillStyle = grad; g.fillRect(180, 0, 76, 64);
}, [1, 1]);
const clothTex = () => canvasTex(128, 128, (g) => {
  g.fillStyle = '#EEEAE0'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(120,150,190,0.55)'; for (let i = 0; i < 4; i++) { g.fillRect(i * 32, 0, 8, 128); g.fillRect(0, i * 32, 128, 8); }
}, [4, 3]);

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  // Deliberately a bright sky in both themes: the flies live on a sunny
  // windowsill, and that is the whole idea. It does not follow the page.
  scene.background = new THREE.Color('#CFE3F5');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(38, 1, 1, 2000);
  camera.position.set(30, 125, 265);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 12, -5);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 30; controls.maxDistance = 560;
  controls.maxPolarAngle = 1.5; controls.minPolarAngle = 0.15;
  controls.enablePan = true; controls.panSpeed = 0.6;
  controls.update();

  // ---- light: sun through the window (behind, high), soft daylight fill, warm front key
  const sun = new THREE.DirectionalLight('#FFF2DC', 2.2);
  sun.position.set(-70, 200, -170);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -230; sun.shadow.camera.right = 230; sun.shadow.camera.top = 230; sun.shadow.camera.bottom = -230;
  sun.shadow.camera.near = 20; sun.shadow.camera.far = 600; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
  scene.add(sun);
  const key = new THREE.DirectionalLight('#FFF7EC', 0.9); key.position.set(120, 140, 160); scene.add(key);
  scene.add(new THREE.HemisphereLight('#DDEBFA', '#B9A98F', 0.7));

  // ---- counter, wall, window
  const counterMat = new THREE.MeshStandardMaterial({ map: paintedWood(), color: '#E8E0CF', roughness: 0.6 });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(COUNTER.x1 - COUNTER.x0, 12, COUNTER.z1 - COUNTER.z0), counterMat);
  counter.position.set((COUNTER.x0 + COUNTER.x1) / 2, -6, (COUNTER.z0 + COUNTER.z1) / 2); counter.receiveShadow = true; counter.castShadow = true; scene.add(counter);
  const front = new THREE.Mesh(new THREE.BoxGeometry(COUNTER.x1 - COUNTER.x0, 60, 6), new THREE.MeshStandardMaterial({ color: '#E3DCCB', roughness: 0.7 }));
  front.position.set(0, -42, COUNTER.z1 - 3); front.receiveShadow = true; scene.add(front);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(600, 300), new THREE.MeshStandardMaterial({ map: tiles(), color: '#DCE2E0', roughness: 0.4 }));
  wall.position.set(0, 120, COUNTER.z0 - 1); wall.receiveShadow = true; scene.add(wall);
  // window: frame + glass + view
  const frameMat = new THREE.MeshStandardMaterial({ color: '#E9E4D8', roughness: 0.65 });
  const win = new THREE.Group(); win.position.set(0, 0, COUNTER.z0 - 0.5);
  const W = 230, H = 190, y0 = 18;
  for (const [x, y, w, h] of [[-W / 2, y0 + H / 2, 8, H + 8], [W / 2, y0 + H / 2, 8, H + 8], [0, y0, W + 8, 10], [0, y0 + H, W + 8, 8], [0, y0 + H / 2, 6, H], [0, y0 + H * 0.55, W, 5]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 12), frameMat); m.position.set(x, y, 0); m.castShadow = true; m.receiveShadow = true; win.add(m);
  }
  const view = new THREE.Mesh(new THREE.PlaneGeometry(1400, 700), new THREE.MeshBasicMaterial({ map: skyTex() }));
  view.position.set(0, y0 + H / 2 + 60, COUNTER.z0 - 300); scene.add(view);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshPhysicalMaterial({ color: '#FFFFFF', transmission: 0.95, roughness: 0.03, thickness: 0.5, ior: 1.5, envMapIntensity: 0.4 }));
  glass.position.set(0, y0 + H / 2, -6); win.add(glass);
  scene.add(win);

  // ---- objects (each: mesh, obstacle circle, height function, scents, food, egg site)
  const objects = [];
  const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };

  // banana: a bent tube along a curve, lying on the counter
  const bananaPts = [new THREE.Vector3(-150, 9, 15), new THREE.Vector3(-115, 12, 7), new THREE.Vector3(-80, 12, 11), new THREE.Vector3(-49, 9, 23)];
  const bananaCurve = new THREE.CatmullRomCurve3(bananaPts);
  const bananaGeo = new THREE.TubeGeometry(bananaCurve, 48, 11, 7, false);
  const bananaMat = new THREE.MeshStandardMaterial({ map: bananaTex(), roughness: 0.45 });
  const banana = mesh(bananaGeo, bananaMat);
  const bananaTip = bananaCurve.getPoint(0.97);
  const bananaStem = mesh(new THREE.CylinderGeometry(2.2, 3, 12, 8), new THREE.MeshStandardMaterial({ color: '#6B5A2E', roughness: 0.8 }));
  const p0 = bananaCurve.getPoint(0.01); bananaStem.position.set(p0.x - 6, p0.y + 2, p0.z); bananaStem.rotation.z = 1.2;
  objects.push({
    name: 'banana', kind: 'fruit', mesh: banana,
    height(x, z) { let best = 0; for (let t = 0; t <= 1; t += 0.02) { const p = bananaCurve.getPoint(t); const d = Math.hypot(p.x - x, p.z - z); if (d < 11) { const y = p.y + Math.sqrt(121 - d * d) - 9; if (y > best) best = y; } } return best; },
    scents: [{ kind: 'fruit', x: bananaTip.x, z: bananaTip.z, strength: 1, sigma: 22 }, { kind: 'fruit', x: -105, z: 10, strength: 0.5, sigma: 24 }],
    food: [{ x: bananaTip.x + 2, z: bananaTip.z, r: 12, sugar: 1 }],
    eggSite: { x: bananaTip.x - 12, z: bananaTip.z - 2, r: 14 },
    obstacle: null,
  });

  // plate with two apple slices
  const plate = mesh(new THREE.CylinderGeometry(34, 30, 4, 48), new THREE.MeshStandardMaterial({ color: '#F6F7F4', roughness: 0.25 }));
  plate.position.set(60, 2, 40);
  const rim = mesh(new THREE.TorusGeometry(33, 1.6, 10, 64), new THREE.MeshStandardMaterial({ color: '#5F8BC4', roughness: 0.3 }));
  rim.rotation.x = Math.PI / 2; rim.position.set(60, 4.2, 40);
  const sliceShape = new THREE.Shape(); sliceShape.absarc(0, 0, 22, -0.75, 0.75, false); sliceShape.lineTo(0, 0);
  const sliceGeo = new THREE.ExtrudeGeometry(sliceShape, { depth: 10, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.2, bevelSegments: 3 });
  const fleshMat = new THREE.MeshStandardMaterial({ color: '#F3E3B8', roughness: 0.5 });
  const slices = [];
  for (const [x, z, rot] of [[52, 34, 0.6], [70, 48, 2.9]]) {
    const s = mesh(sliceGeo, fleshMat); s.rotation.x = -Math.PI / 2; s.rotation.z = rot; s.position.set(x, 4, z); slices.push({ x, z, rot });
    const skin = mesh(new THREE.TorusGeometry(22, 1.4, 8, 40, 1.5), new THREE.MeshStandardMaterial({ color: '#C8352E', roughness: 0.4 }));
    skin.rotation.x = -Math.PI / 2; skin.rotation.z = rot - 0.75; skin.position.set(x, 9, z);
  }
  objects.push({
    name: 'apple', kind: 'fruit', mesh: plate,
    height(x, z) { const d = Math.hypot(x - 60, z - 40); if (d > 34) return 0; let y = 4; for (const s of slices) { const dx = x - s.x, dz = z - s.z; const r = Math.hypot(dx, dz); const a = Math.atan2(-dz, dx) - s.rot; const an = Math.atan2(Math.sin(a), Math.cos(a)); if (r < 21 && Math.abs(an) < 0.72) y = 15; } return y; },
    scents: [{ kind: 'fruit', x: 60, z: 40, strength: 0.6, sigma: 22 }],
    food: slices.map(s => ({ x: s.x + Math.cos(s.rot) * 9, z: s.z - Math.sin(s.rot) * 9, r: 13, sugar: 0.8 })),
    eggSite: { x: 60, z: 40, r: 22 },
    obstacle: null,
  });

  // jam jar with a drip at its base
  const jarPts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; jarPts.push(new THREE.Vector2(20 + Math.sin(t * Math.PI) * 2.5 - (t > 0.85 ? (t - 0.85) * 30 : 0), t * 62)); }
  const jarGlass = new THREE.MeshPhysicalMaterial({ color: '#F4F8FA', transmission: 0.85, roughness: 0.08, thickness: 1.2, ior: 1.5, envMapIntensity: 0.5, transparent: true, opacity: 0.85 });
  const jar = mesh(new THREE.LatheGeometry(jarPts, 40), jarGlass); jar.position.set(140, 0, -60);
  const jam = mesh(new THREE.CylinderGeometry(17.5, 17.5, 34, 32), new THREE.MeshStandardMaterial({ color: '#6B1C38', roughness: 0.3 })); jam.position.set(140, 17, -60);
  const lid = mesh(new THREE.CylinderGeometry(22, 22, 5, 40), new THREE.MeshStandardMaterial({ color: '#B8B0A2', metalness: 0.6, roughness: 0.35 })); lid.position.set(108, 2.5, -30); lid.rotation.z = 0.1;
  const drip = mesh(new THREE.SphereGeometry(6, 20, 12), new THREE.MeshStandardMaterial({ color: '#8E2A4A', emissive: '#4A0F24', emissiveIntensity: 0.3, roughness: 0.15, clearcoat: 1 }));
  drip.scale.set(1.4, 0.35, 1.1); drip.position.set(116, 1.5, -60);
  objects.push({
    name: 'jar', kind: 'jar', mesh: jar, height: () => 0,
    scents: [{ kind: 'fruit', x: 116, z: -60, strength: 0.5, sigma: 16 }, { kind: 'vinegar', x: 116, z: -60, strength: 0.7, sigma: 16 }],
    food: [{ x: 116, z: -60, r: 9, sugar: 1 }], eggSite: null,
    obstacle: { x: 140, z: -60, r: 24 },
  });

  // spilled juice
  const puddle = mesh(new THREE.CircleGeometry(15, 40), new THREE.MeshStandardMaterial({ color: '#D9922E', emissive: '#6E4310', emissiveIntensity: 0.25, roughness: 0.1 }));
  puddle.rotation.x = -Math.PI / 2; puddle.position.set(-40, 0.15, 72); puddle.scale.set(1.3, 0.8, 1);
  objects.push({ name: 'spill', kind: 'spill', mesh: puddle, height: () => 0, scents: [{ kind: 'vinegar', x: -40, z: 72, strength: 1, sigma: 18 }], food: [{ x: -40, z: 72, r: 16, sugar: 0.7 }], eggSite: null, obstacle: null });

  // folded cloth
  const cloth = mesh(new THREE.BoxGeometry(44, 9, 34), new THREE.MeshStandardMaterial({ map: clothTex(), roughness: 0.9 })); cloth.position.set(-150, 4.5, -70);
  objects.push({ name: 'cloth', kind: 'cloth', mesh: cloth, height: () => 0, scents: [], food: [], eggSite: null, obstacle: { x: -150, z: -70, r: 28 } });
  // fruit bowl (only drawn by the Blender set)
  objects.push({ name: 'bowl', kind: 'bowl', mesh: null, height: () => 0, scents: [{ kind: 'fruit', x: 150, z: 55, strength: 0.35, sigma: 22 }], food: [], eggSite: null, obstacle: { x: 150, z: 55, r: 31 } });
  // the new props (drawn by the Blender set; walls come from their geometry, circles are a cheap pre-check)
  objects.push({ name: 'mug', kind: 'mug', mesh: null, height: () => 0, scents: [], food: [], eggSite: null, obstacle: { x: -100, z: -55, r: 26 } });
  objects.push({ name: 'coffee ring', kind: 'coffee', mesh: null, height: () => 0, scents: [], food: [{ x: -80, z: -36, r: 20, sugar: 0.5, bitter: true }], eggSite: null, obstacle: null });
  objects.push({ name: 'sugar bowl', kind: 'sugar', mesh: null, height: () => 0, scents: [], food: [{ x: 38, z: -52, r: 17, sugar: 1 }], eggSite: null, obstacle: { x: 20, z: -70, r: 25 } });
  objects.push({ name: 'orange', kind: 'fruit', mesh: null, height: () => 0, scents: [{ kind: 'fruit', x: -10, z: 8, strength: 0.9, sigma: 26 }], food: [{ x: -10, z: 8, r: 20, sugar: 0.9, top: 18.6 }], eggSite: { x: -10, z: 8, r: 20 }, obstacle: null });
  objects.push({ name: 'grapes', kind: 'fruit', mesh: null, height: () => 0, scents: [{ kind: 'fruit', x: 100, z: 5, strength: 0.6, sigma: 24 }], food: [{ x: 100, z: 5, r: 24, sugar: 0.7 }], eggSite: { x: 100, z: 5, r: 24 }, obstacle: null });
  objects.push({ name: 'pot', kind: 'pot', mesh: null, height: () => 0, scents: [], food: [], eggSite: { x: -160, z: 45, r: 22 }, obstacle: null });
  objects.push({ name: 'crumbs', kind: 'crumbs', mesh: null, height: () => 0, scents: [], food: [{ x: -60, z: -22, r: 24, sugar: 0.4 }], eggSite: null, obstacle: null });
  const procedural = [counter, front, wall, win, banana, bananaStem, plate, rim, jar, jam, lid, drip, puddle, cloth, ...slicesMeshes(), ...scene.children.filter(c => c.geometry && c.geometry.type === 'TorusGeometry' && c !== rim)];
  let setScene = null, pickMeshes = null, walkMeshes = null;
  function applySet(gltfScene) {
    for (const m of procedural) m.visible = false;
    setScene = gltfScene; scene.add(gltfScene);
    pickMeshes = []; walkMeshes = [];
    gltfScene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = !/window_glass|jar$/.test(o.name); o.receiveShadow = true;
      if (o.material?.map) o.material.map.anisotropy = 8;
      if (o.name === 'window_glass') { o.material.transparent = true; o.material.opacity = 0.18; o.material.transmission = 0; o.material.depthWrite = false; }
      if (o.name === 'jar') { o.material.transparent = true; o.material.opacity = 0.35; o.material.transmission = 0.6; o.material.thickness = 1.5; o.material.roughness = 0.05; o.material.depthWrite = false; }
      if (/^(counter|banana|plate|slice_1|slice_2|cloth|sill|orange_half|orange_face|soil|sugar_spill|coffee_ring|spill)$/.test(o.name)) pickMeshes.push(o);
      // glTF export shares identical index buffers between meshes (the counter, apron, sill and frames
      // all have one), and building a BVH reorders the index in place, so each mesh gets its own copy
      if (o.geometry.computeBoundsTree && !o.geometry.boundsTree) { if (o.geometry.index) o.geometry.setIndex(o.geometry.index.clone()); o.geometry.computeBoundsTree(); }
      // everything a fly can stand on: not the wall, window, apron or glass
      if (!/^(wall|window_glass|apron|frame_|mullion|transom|curtain|curtain_rod)/.test(o.name)) walkMeshes.push(o);
    });
    gltfScene.updateMatrixWorld(true);
    buildSolids();
  }

  // ---- flight: every static mesh in the set is solid, and routes keep clear of all of them
  let solids = [];
  function buildSolids() {
    solids = [];
    setScene.traverse(o => {
      if (!o.isMesh || !o.geometry.boundsTree) return;
      o.geometry.computeBoundingSphere();
      const scale = o.matrixWorld.getMaxScaleOnAxis();
      solids.push({ mesh: o, center: o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld), radius: o.geometry.boundingSphere.radius * scale, inv: o.matrixWorld.clone().invert(), scale });
    });
  }
  const _lp = new THREE.Vector3(), _hit = {};
  /** Distance from p to the nearest solid surface, capped at `max` (cheap when nothing is that close). */
  function clearance(p, max) {
    let best = max;
    for (const sd of solids) {
      if (p.distanceTo(sd.center) - sd.radius >= best) continue;
      _lp.copy(p).applyMatrix4(sd.inv);
      const cap = best / sd.scale;
      const r = sd.mesh.geometry.boundsTree.closestPointToPoint(_lp, _hit, 0, cap * cap);   // this version compares squared distances
      if (r && r.distance < cap) best = r.distance * sd.scale;
    }
    return best;
  }
  const FLY_TOP = 140;
  function inAir(p, clear) {
    if (p.x < WALK.x0 || p.x > WALK.x1 || p.z < WALK.z0 || p.z > WALK.z1 || p.y > FLY_TOP) return false;
    if (p.y < surfaceAt(p.x, p.z).y + clear * 0.6) return false;           // never under or inside anything
    return clearance(p, clear) >= clear;
  }
  function landingSpot(x, z) {
    if (x < WALK.x0 + 6 || x > WALK.x1 - 6 || z < WALK.z0 + 6 || z > WALK.z1 - 6) return null;
    for (const o of objects) { const ob = o.obstacle; if (ob && Math.hypot(x - ob.x, z - ob.z) < ob.r + 3) return null; }
    const sf = surfaceAt(x, z);
    if (sf.ny < 0.86) return null;
    // room to stand: the surface is level for a body length around, and nothing hangs just above
    for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) { if (Math.abs(surfaceAt(x + dx, z + dz).y - sf.y) > 1.5) return null; }
    if (clearance(new THREE.Vector3(x, sf.y + 6, z), 5.2) < 5.2) return null;
    return sf;
  }
  function catmull(pts, u) {
    const n = pts.length - 1, sgm = u * n, i = Math.min(n - 1, Math.floor(sgm)), f = sgm - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
    const c = k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f * f * f);
    return new THREE.Vector3(c('x'), c('y'), c('z'));
  }
  /**
   * A collision-free flight from a standing fly to a landing spot elsewhere on the counter.
   * Returns { samples, step, length } with samples every `step` mm along the path, or null.
   */
  function planFlight(sx, sy, sz, { tries = 90, minDist = 45, target = null } = {}) {
    const CLEAR = 6, STEP = 1.5;
    const start = new THREE.Vector3(sx, sy, sz);
    for (let k = 0; k < tries; k++) {
      let lx, lz;
      if (target && k < tries / 2) { const a = Math.random() * 6.28, r = 6 + Math.random() * 18; lx = target.x + Math.cos(a) * r; lz = target.z + Math.sin(a) * r; }
      else { lx = WALK.x0 + Math.random() * (WALK.x1 - WALK.x0); lz = WALK.z0 + Math.random() * (WALK.z1 - WALK.z0); }
      if (!target && Math.hypot(lx - sx, lz - sz) < minDist) continue;
      const land = landingSpot(lx, lz); if (!land) continue;
      const L = new THREE.Vector3(lx, land.y, lz);
      const cruise = Math.min(FLY_TOP - 10, Math.max(sy, land.y) + 30 + Math.random() * 50);
      const lift = new THREE.Vector3(sx, sy + 12, sz), above = new THREE.Vector3(lx, land.y + 16, lz);
      const dir = new THREE.Vector3(lx - sx, 0, lz - sz); const dist = dir.length(); dir.normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const mids = [0.35, 0.68].map(f => new THREE.Vector3(sx + (lx - sx) * f, cruise + (Math.random() - 0.5) * 14, sz + (lz - sz) * f).addScaledVector(side, (Math.random() - 0.5) * Math.min(60, dist * 0.5)));
      const pts = [start, lift, ...mids, above, L];
      // the margin grows from 2.5 mm at takeoff and touchdown to the full 6 mm in open air,
      // so a fly standing beside the mug can still rise straight up and away
      const need = q => Math.min(CLEAR, 2.5 + Math.min(q.distanceTo(start), q.distanceTo(L)) * 0.14);
      if (!pts.slice(1, -1).every(q => inAir(q, need(q)))) continue;
      // sample the curve, check every point away from the two ends, resample by arc length
      const dense = []; for (let i = 0; i <= 360; i++) dense.push(catmull(pts, i / 360));
      let ok = true;
      for (const q of dense) {
        if (q.distanceTo(start) < 4 || q.distanceTo(L) < 5) { if (q.y < Math.min(sy, land.y) - 0.5) { ok = false; break; } continue; }
        if (!inAir(q, need(q))) { ok = false; break; }
      }
      if (!ok) continue;
      const cum = [0]; for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + dense[i].distanceTo(dense[i - 1]));
      const length = cum[cum.length - 1], samples = [];
      for (let d = 0, j = 0; d <= length; d += STEP) { while (j < cum.length - 2 && cum[j + 1] < d) j++; const f = (d - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]); samples.push(dense[j].clone().lerp(dense[j + 1], f)); }
      samples.push(L.clone());
      return { samples, step: STEP, length: STEP * (samples.length - 1) };
    }
    return null;
  }
  /** An escape hop: a short arc to clear ground nearby that passes through nothing. */
  function planHop(sx, sy, sz, heading) {
    for (let k = 0; k < 24; k++) {
      const a = heading + (Math.random() - 0.5) * (k < 12 ? 2.4 : 6.28), dist = 8 + Math.random() * 12;
      const lx = sx + Math.sin(a) * dist, lz = sz + Math.cos(a) * dist;
      const land = landingSpot(lx, lz); if (!land) continue;
      const h = 7 + Math.random() * 6 + Math.max(0, land.y - sy);
      let ok = true;
      for (let i = 1; i < 14 && ok; i++) {
        const u = i / 14, q = new THREE.Vector3(sx + (lx - sx) * u, sy + (land.y - sy) * u + h * 4 * u * (1 - u), sz + (lz - sz) * u);
        if (Math.hypot(q.x - sx, q.z - sz) < 3 || Math.hypot(q.x - lx, q.z - lz) < 3) continue;
        if (!inAir(q, 3)) ok = false;
      }
      if (ok) return { x1: lx, z1: lz, y0: sy, y1: land.y, h };
    }
    const up = new THREE.Vector3(sx, sy + 6, sz);
    return clearance(up, 3) >= 3 ? { x1: sx, z1: sz, y0: sy, y1: sy, h: 6 } : null;     // straight up and back down
  }
  // ---- the surface under a point: exact when the set is loaded, approximate otherwise
  const downRay = new THREE.Raycaster(); downRay.firstHitOnly = true;
  const rayOrigin = new THREE.Vector3(), rayDir = new THREE.Vector3(0, -1, 0);
  const hitNormal = new THREE.Vector3();
  function surfaceAt(x, z, fromY = 200) {
    if (walkMeshes && walkMeshes.length) {
      rayOrigin.set(x, fromY, z); downRay.set(rayOrigin, rayDir); downRay.far = fromY + 40;
      const hits = downRay.intersectObjects(walkMeshes, false);
      if (hits.length) {
        const h = hits[0];
        hitNormal.copy(h.face.normal).transformDirection(h.object.matrixWorld);
        if (hitNormal.y < 0) hitNormal.negate();
        return { y: h.point.y, nx: hitNormal.x, ny: hitNormal.y, nz: hitNormal.z, mesh: h.object.name };
      }
    }
    const y = heightAt(x, z), e = 0.6;
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    const n = new THREE.Vector3(-dx, 1, -dz).normalize();
    return { y, nx: n.x, ny: n.y, nz: n.z, mesh: null };
  }
  /** Can something walk from (x0,z0) to (x1,z1)? Blocked by walls (steep faces) and cliffs. */
  function walkable(x0, z0, x1, z1, fromY = 200) {
    if (x1 < WALK.x0 || x1 > WALK.x1 || z1 < WALK.z0 || z1 > WALK.z1) return { ok: false, reason: 'edge' };
    for (const o of objects) { const ob = o.obstacle; if (ob && Math.hypot(x1 - ob.x, z1 - ob.z) < ob.r) return { ok: false, reason: 'object' }; }
    const a = surfaceAt(x0, z0, fromY), b = surfaceAt(x1, z1, fromY);
    if (b.ny < MAX_SLOPE) return { ok: false, reason: 'steep', s: b };
    const d = Math.hypot(x1 - x0, z1 - z0) || 1e-6;
    if (Math.abs(b.y - a.y) / d > 1.8) return { ok: false, reason: 'cliff', s: b };
    return { ok: true, s: b };
  }

  // ---- height, obstacles, food, scent
  function heightAt(x, z) { let y = 0; for (const o of objects) { const h = o.height(x, z); if (h > y) y = h; } return y; }
  function pushOut(p) {
    for (const o of objects) { const ob = o.obstacle; if (!ob) continue; const dx = p.x - ob.x, dz = p.z - ob.z, d = Math.hypot(dx, dz); if (d < ob.r) { const k = ob.r / Math.max(d, 1e-3); p.x = ob.x + dx * k; p.z = ob.z + dz * k; } }
    p.x = Math.max(WALK.x0, Math.min(WALK.x1, p.x)); p.z = Math.max(WALK.z0, Math.min(WALK.z1, p.z));
    return p;
  }
  const foodOverrides = [];   // bitter drops on food, timed
  function foodAt(x, z) {
    for (const d of droplets) if (Math.hypot(d.x - x, d.z - z) < d.radius + 1.5) return { sugar: 1, bitter: d.bitter, droplet: d };
    for (const o of objects) for (const f of o.food) if (Math.hypot(f.x - x, f.z - z) < f.r) return { sugar: f.sugar, bitter: !!f.bitter || foodOverrides.some(b => b.x === f.x && b.z === f.z && b.until > performance.now()), site: f };
    return null;
  }
  function eggSiteAt(x, z) { for (const o of objects) if (o.eggSite && Math.hypot(o.eggSite.x - x, o.eggSite.z - z) < o.eggSite.r) return o.eggSite; return null; }
  function bitterAt(x, z) { for (const o of objects) for (const f of o.food) if (Math.hypot(f.x - x, f.z - z) < f.r + 6) { foodOverrides.push({ x: f.x, z: f.z, until: performance.now() + 60000 }); return f; } return null; }

  // ---- droplets and puffs (as before, opaque)
  const droplets = [], scents = [];
  const dropGeo = new THREE.SphereGeometry(1, 28, 18);
  function addDroplet(kind, x, z) {
    for (const d of droplets) if (Math.hypot(d.x - x, d.z - z) < d.radius + 3) { if (kind === 'bitter' && !d.bitter) { d.bitter = true; d.mesh.material.color.set(DROP_COLOURS.mixed); d.mesh.material.emissive.set(DROP_COLOURS.mixed); d.rejected = false; d.changed = true; } return d; }
    if (kind === 'bitter' && bitterAt(x, z)) return null;
    const mat = new THREE.MeshPhysicalMaterial({ color: DROP_COLOURS[kind], emissive: DROP_COLOURS[kind], emissiveIntensity: 0.22, roughness: 0.08, clearcoat: 1, ior: 1.36 });
    const m = new THREE.Mesh(dropGeo, mat); m.castShadow = true; m.receiveShadow = true;
    const d = { kind, x, z, y: heightAt(x, z), radius: DROP_R, bitter: kind === 'bitter', mesh: m, rejected: false, changed: false, gone: false };
    d.shrink = amt => { d.radius = Math.max(0, d.radius - amt); if (d.radius <= 0.25) removeDroplet(d); };
    droplets.push(d); scene.add(m); return d;
  }
  function removeDroplet(d) { d.gone = true; scene.remove(d.mesh); const k = droplets.indexOf(d); if (k >= 0) droplets.splice(k, 1); }
  const moteGeo = new THREE.SphereGeometry(0.22, 6, 4);
  function addScent(kind, x, z) {
    const col = new THREE.Color(SCENT_COLOURS[kind]);
    const stain = new THREE.Mesh(new THREE.CircleGeometry(5.5, 40), new THREE.MeshStandardMaterial({ color: col.clone().lerp(new THREE.Color('#EDE6D6'), 0.6), roughness: 0.9 }));
    const sf = surfaceAt(x, z); stain.position.set(x, sf.y + 0.05, z); stain.lookAt(x + sf.nx, sf.y + 0.05 + sf.ny, z + sf.nz); stain.receiveShadow = true;
    const motes = [];
    for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(moteGeo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.6 })); m.userData = { a: Math.random() * 6.28, r: 1 + Math.random() * 3.5, h: Math.random() * 9, v: 1.2 + Math.random() * 1.2 }; motes.push(m); scene.add(m); }
    const sc = { kind, x, z, sigma: 9, strength: 1, age: 0, life: 120, stain, motes, gone: false };
    scents.push(sc); scene.add(stain); return sc;
  }
  function removeScent(sc) { sc.gone = true; scene.remove(sc.stain); for (const m of sc.motes) scene.remove(m); const k = scents.indexOf(sc); if (k >= 0) scents.splice(k, 1); }
  function smellAt(x, z) {
    const out = { fruit: 0, vinegar: 0 };
    const add = (s) => { const dd = (s.x - x) ** 2 + (s.z - z) ** 2; out[s.kind] += s.strength * Math.exp(-dd / (2 * s.sigma * s.sigma)); };
    for (const sc of scents) add(sc);
    for (const o of objects) for (const s of o.scents) add(s);
    out.fruit = Math.min(1, out.fruit); out.vinegar = Math.min(1, out.vinegar); return out;
  }
  function smellGradient(kind, x, z) {
    let gx = 0, gz = 0;
    const add = (s) => { if (s.kind !== kind) return; const dx = s.x - x, dz = s.z - z; const w = s.strength * Math.exp(-(dx * dx + dz * dz) / (2 * s.sigma * s.sigma)) / (s.sigma * s.sigma); gx += dx * w; gz += dz * w; };
    for (const sc of scents) add(sc);
    for (const o of objects) for (const s of o.scents) add(s);
    return { x: gx, z: gz };
  }

  // ---- shadow sweep (an occluder between sun and counter), poke ripple
  const occluder = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  occluder.castShadow = true; occluder.visible = false; occluder.lookAt(sun.position); scene.add(occluder);
  let sweep = null;
  function sweepShadow(dx = 1, dz = 0, atX = 0, atZ = 0) { const l = Math.hypot(dx, dz) || 1; sweep = { t: 0, dur: 560, dx: dx / l, dz: dz / l, x: atX, z: atZ }; occluder.visible = true; }
  const ripples = [];
  function ripple(x, z) { const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.1, 40), new THREE.MeshBasicMaterial({ color: '#4A86E8', side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.set(x, heightAt(x, z) + 0.1, z); scene.add(m); ripples.push({ m, t: 0 }); }

  // ---- picking
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  const flyObjects = [];
  function addFlyObject(o) { flyObjects.push(o); scene.add(o); }
  function removeFlyObject(o) { const k = flyObjects.indexOf(o); if (k >= 0) flyObjects.splice(k, 1); scene.remove(o); }
  const walkables = [counter, banana, plate, ...[]];
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (flyObjects.length) { const h = ray.intersectObjects(flyObjects, true); if (h.length) { let o = h[0].object; while (o && !o.userData.fly) o = o.parent; return { hitFly: o?.userData.fly || null, hitBase: false, point: h[0].point }; } }
    const h = ray.intersectObjects(pickMeshes || [counter, banana, plate, ...slicesMeshes()], false);
    if (h.length) { const p = h[0].point; if (p.x >= COUNTER.x0 && p.x <= COUNTER.x1 && p.z >= COUNTER.z0 && p.z <= COUNTER.z1) return { hitFly: null, hitBase: true, point: p }; }
    return { hitFly: null, hitBase: false, point: null };
  }
  function slicesMeshes() { return scene.children.filter(c => c.geometry === sliceGeo); }

  let gustT = 0;
  function gust() { gustT = 1; }
  function resize() { const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  function render(dt) {
    controls.update();
    if (gustT > 0) { gustT = Math.max(0, gustT - dt / 2600); const c = setScene?.getObjectByName('curtain'); if (c) { c.rotation.x = 0.35 * gustT * Math.sin(gustT * 14) * (1 - gustT * 0.5); c.position.z = 6 * gustT * Math.max(0, Math.sin(gustT * 7)); } }
    if (sweep) { sweep.t += dt; const u = Math.min(1, sweep.t / sweep.dur); const s = -160 + 320 * u; const dir = sun.position.clone().normalize(); occluder.position.copy(dir.multiplyScalar(90)).add(new THREE.Vector3(sweep.x + sweep.dx * s, 0, sweep.z + sweep.dz * s)); if (u >= 1) { sweep = null; occluder.visible = false; } }
    for (let i = ripples.length - 1; i >= 0; i--) { const r = ripples[i]; r.t += dt; const u = r.t / 500; r.m.scale.setScalar((1 + u * 6) * 2.6); r.m.material.color.setScalar(1 - u).multiply(new THREE.Color('#4A86E8')); if (u >= 1) { scene.remove(r.m); ripples.splice(i, 1); } }
    for (const d of droplets) { d.mesh.position.set(d.x, d.y + d.radius * 0.3, d.z); d.mesh.scale.set(d.radius, d.radius * 0.42, d.radius); }
    for (let i = scents.length - 1; i >= 0; i--) {
      const sc = scents[i]; sc.age += dt / 1000; sc.strength = Math.max(0, 1 - sc.age / sc.life);
      if (sc.strength <= 0) { removeScent(sc); continue; }
      for (const m of sc.motes) { const u = m.userData; u.h += u.v * dt / 1000; if (u.h > 10) { u.h = 0; u.a = Math.random() * 6.28; } m.position.set(sc.x + Math.cos(u.a + u.h * 0.4) * u.r, sc.stain.position.y + 0.3 + u.h, sc.z + Math.sin(u.a + u.h * 0.4) * u.r); m.scale.setScalar(Math.max(0.05, (1 - u.h / 10) * sc.strength)); }
      sc.stain.scale.setScalar(0.6 + 0.4 * sc.strength);
    }
    renderer.render(scene, camera);
  }
  resize();
  return { scene, camera, renderer, controls, objects, droplets, scents, addDroplet, removeDroplet, addScent, removeScent, smellAt, smellGradient, heightAt, surfaceAt, walkable, pushOut, foodAt, eggSiteAt, sweepShadow, ripple, pick, addFlyObject, removeFlyObject, applySet, gust, clearance, planFlight, planHop, render, resize, WALK };
}
