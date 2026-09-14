// cloche/world.js — a sunny kitchen windowsill: counter, window, fruit, jar,
// spill, cloth; lights; scent sources, food sites, egg sites, obstacles, a
// height map for climbing, picking, the shadow sweep and the poke ripple.
// Units are millimetres. The counter top is y = 0.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function loadGltf(url) { const g = await new GLTFLoader().loadAsync(url); return g.scene; }

export const COUNTER = { x0: -125, x1: 125, z0: -68, z1: 72 };
export const WALK = { x0: -118, x1: 118, z0: -62, z1: 66 };
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
const skyTex = () => canvasTex(512, 512, (g) => {
  const grad = g.createLinearGradient(0, 0, 0, 512); grad.addColorStop(0, '#6FA8E0'); grad.addColorStop(0.55, '#BFDDF5'); grad.addColorStop(0.62, '#9FC28A'); grad.addColorStop(1, '#5F8A4E');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(70,120,60,${0.2 + Math.random() * 0.3})`; g.beginPath(); g.ellipse(Math.random() * 512, 330 + Math.random() * 120, 30 + Math.random() * 60, 20 + Math.random() * 40, 0, 0, 6.28); g.fill(); }
  for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.ellipse(Math.random() * 512, 60 + Math.random() * 120, 50 + Math.random() * 60, 18 + Math.random() * 14, 0, 0, 6.28); g.fill(); }
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
  scene.background = new THREE.Color('#CFE3F5');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(38, 1, 1, 2000);
  camera.position.set(40, 120, 205);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 12, -5);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 40; controls.maxDistance = 420;
  controls.maxPolarAngle = 1.5; controls.minPolarAngle = 0.15;
  controls.enablePan = true; controls.panSpeed = 0.6;
  controls.update();

  // ---- light: sun through the window (behind, high), soft daylight fill, warm front key
  const sun = new THREE.DirectionalLight('#FFF2DC', 2.2);
  sun.position.set(-60, 190, -140);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -170; sun.shadow.camera.right = 170; sun.shadow.camera.top = 170; sun.shadow.camera.bottom = -170;
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
  const view = new THREE.Mesh(new THREE.PlaneGeometry(W * 3, H * 3), new THREE.MeshBasicMaterial({ map: skyTex() }));
  view.position.set(0, y0 + H / 2 + 30, -260); win.add(view);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshPhysicalMaterial({ color: '#FFFFFF', transmission: 0.95, roughness: 0.03, thickness: 0.5, ior: 1.5, envMapIntensity: 0.4 }));
  glass.position.set(0, y0 + H / 2, -6); win.add(glass);
  scene.add(win);

  // ---- objects (each: mesh, obstacle circle, height function, scents, food, egg site)
  const objects = [];
  const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };

  // banana: a bent tube along a curve, lying on the counter
  const bananaPts = [new THREE.Vector3(-105, 9, 10), new THREE.Vector3(-70, 12, 2), new THREE.Vector3(-35, 12, 6), new THREE.Vector3(-4, 9, 18)];
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
    scents: [{ kind: 'fruit', x: bananaTip.x, z: bananaTip.z, strength: 1, sigma: 22 }, { kind: 'fruit', x: -60, z: 5, strength: 0.5, sigma: 24 }],
    food: [{ x: bananaTip.x + 2, z: bananaTip.z, r: 12, sugar: 1 }],
    eggSite: { x: bananaTip.x - 12, z: bananaTip.z - 2, r: 14 },
    obstacle: null,
  });

  // plate with two apple slices
  const plate = mesh(new THREE.CylinderGeometry(34, 30, 4, 48), new THREE.MeshStandardMaterial({ color: '#F6F7F4', roughness: 0.25 }));
  plate.position.set(58, 2, 28);
  const rim = mesh(new THREE.TorusGeometry(33, 1.6, 10, 64), new THREE.MeshStandardMaterial({ color: '#5F8BC4', roughness: 0.3 }));
  rim.rotation.x = Math.PI / 2; rim.position.set(58, 4.2, 28);
  const sliceShape = new THREE.Shape(); sliceShape.absarc(0, 0, 22, -0.75, 0.75, false); sliceShape.lineTo(0, 0);
  const sliceGeo = new THREE.ExtrudeGeometry(sliceShape, { depth: 10, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.2, bevelSegments: 3 });
  const fleshMat = new THREE.MeshStandardMaterial({ color: '#F3E3B8', roughness: 0.5 });
  const slices = [];
  for (const [x, z, rot] of [[50, 22, 0.6], [68, 36, 2.9]]) {
    const s = mesh(sliceGeo, fleshMat); s.rotation.x = -Math.PI / 2; s.rotation.z = rot; s.position.set(x, 4, z); slices.push({ x, z, rot });
    const skin = mesh(new THREE.TorusGeometry(22, 1.4, 8, 40, 1.5), new THREE.MeshStandardMaterial({ color: '#C8352E', roughness: 0.4 }));
    skin.rotation.x = -Math.PI / 2; skin.rotation.z = rot - 0.75; skin.position.set(x, 9, z);
  }
  objects.push({
    name: 'apple', kind: 'fruit', mesh: plate,
    height(x, z) { const d = Math.hypot(x - 58, z - 28); if (d > 34) return 0; let y = 4; for (const s of slices) { const dx = x - s.x, dz = z - s.z; const r = Math.hypot(dx, dz); const a = Math.atan2(-dz, dx) - s.rot; const an = Math.atan2(Math.sin(a), Math.cos(a)); if (r < 21 && Math.abs(an) < 0.72) y = 15; } return y; },
    scents: [{ kind: 'fruit', x: 58, z: 28, strength: 0.6, sigma: 22 }],
    food: slices.map(s => ({ x: s.x + Math.cos(s.rot) * 9, z: s.z - Math.sin(s.rot) * 9, r: 13, sugar: 0.8 })),
    eggSite: { x: 58, z: 28, r: 22 },
    obstacle: null,
  });

  // jam jar with a drip at its base
  const jarPts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; jarPts.push(new THREE.Vector2(20 + Math.sin(t * Math.PI) * 2.5 - (t > 0.85 ? (t - 0.85) * 30 : 0), t * 62)); }
  const jarGlass = new THREE.MeshPhysicalMaterial({ color: '#F4F8FA', transmission: 0.85, roughness: 0.08, thickness: 1.2, ior: 1.5, envMapIntensity: 0.5, transparent: true, opacity: 0.85 });
  const jar = mesh(new THREE.LatheGeometry(jarPts, 40), jarGlass); jar.position.set(96, 0, -32);
  const jam = mesh(new THREE.CylinderGeometry(17.5, 17.5, 34, 32), new THREE.MeshStandardMaterial({ color: '#6B1C38', roughness: 0.3 })); jam.position.set(96, 17, -32);
  const lid = mesh(new THREE.CylinderGeometry(22, 22, 5, 40), new THREE.MeshStandardMaterial({ color: '#B8B0A2', metalness: 0.6, roughness: 0.35 })); lid.position.set(64, 2.5, -4); lid.rotation.z = 0.1;
  const drip = mesh(new THREE.SphereGeometry(6, 20, 12), new THREE.MeshStandardMaterial({ color: '#8E2A4A', emissive: '#4A0F24', emissiveIntensity: 0.3, roughness: 0.15, clearcoat: 1 }));
  drip.scale.set(1.4, 0.35, 1.1); drip.position.set(72, 1.5, -32);
  objects.push({
    name: 'jar', kind: 'jar', mesh: jar, height: () => 0,
    scents: [{ kind: 'fruit', x: 72, z: -32, strength: 0.5, sigma: 16 }, { kind: 'vinegar', x: 72, z: -32, strength: 0.7, sigma: 16 }],
    food: [{ x: 72, z: -32, r: 9, sugar: 1 }], eggSite: null,
    obstacle: { x: 96, z: -32, r: 24 },
  });

  // spilled juice
  const puddle = mesh(new THREE.CircleGeometry(15, 40), new THREE.MeshStandardMaterial({ color: '#D9922E', emissive: '#6E4310', emissiveIntensity: 0.25, roughness: 0.1 }));
  puddle.rotation.x = -Math.PI / 2; puddle.position.set(-30, 0.15, 48); puddle.scale.set(1.3, 0.8, 1);
  objects.push({ name: 'spill', kind: 'spill', mesh: puddle, height: () => 0, scents: [{ kind: 'vinegar', x: -30, z: 48, strength: 1, sigma: 18 }], food: [{ x: -30, z: 48, r: 16, sugar: 0.7 }], eggSite: null, obstacle: null });

  // folded cloth
  const cloth = mesh(new THREE.BoxGeometry(44, 9, 34), new THREE.MeshStandardMaterial({ map: clothTex(), roughness: 0.9 })); cloth.position.set(-96, 4.5, -44);
  objects.push({ name: 'cloth', kind: 'cloth', mesh: cloth, height: () => 0, scents: [], food: [], eggSite: null, obstacle: { x: -96, z: -44, r: 28 } });
  // fruit bowl (only drawn by the Blender set)
  objects.push({ name: 'bowl', kind: 'bowl', mesh: null, height: () => 0, scents: [{ kind: 'fruit', x: 100, z: 45, strength: 0.35, sigma: 22 }], food: [], eggSite: null, obstacle: { x: 100, z: 45, r: 31 } });
  const procedural = [counter, front, wall, win, banana, bananaStem, plate, rim, jar, jam, lid, drip, puddle, cloth, ...slicesMeshes(), ...scene.children.filter(c => c.geometry && c.geometry.type === 'TorusGeometry' && c !== rim)];
  let setScene = null, pickMeshes = null;
  function applySet(gltfScene) {
    for (const m of procedural) m.visible = false;
    setScene = gltfScene; scene.add(gltfScene);
    pickMeshes = [];
    gltfScene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = !/window_glass|jar$/.test(o.name); o.receiveShadow = true;
      if (o.material?.map) o.material.map.anisotropy = 8;
      if (o.name === 'window_glass') { o.material.transparent = true; o.material.opacity = 0.18; o.material.transmission = 0; o.material.depthWrite = false; }
      if (o.name === 'jar') { o.material.transparent = true; o.material.opacity = 0.35; o.material.transmission = 0.6; o.material.thickness = 1.5; o.material.roughness = 0.05; o.material.depthWrite = false; }
      if (/^(counter|banana|plate|slice_1|slice_2|cloth|sill)$/.test(o.name)) pickMeshes.push(o);
    });
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
    for (const o of objects) for (const f of o.food) if (Math.hypot(f.x - x, f.z - z) < f.r) return { sugar: f.sugar, bitter: foodOverrides.some(b => b.x === f.x && b.z === f.z && b.until > performance.now()), site: f };
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
    stain.rotation.x = -Math.PI / 2; stain.position.set(x, heightAt(x, z) + 0.05, z); stain.receiveShadow = true;
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

  function resize() { const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  function render(dt) {
    controls.update();
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
  return { scene, camera, renderer, controls, objects, droplets, scents, addDroplet, removeDroplet, addScent, removeScent, smellAt, smellGradient, heightAt, pushOut, foodAt, eggSiteAt, sweepShadow, ripple, pick, addFlyObject, removeFlyObject, applySet, render, resize, WALK };
}
