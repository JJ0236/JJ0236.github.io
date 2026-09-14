// cloche/scene.js — the dome: wooden base, glass cloche, lights, droplets,
// the shadow sweep and pointer picking. Units are millimetres.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const BASE_R = 40, DOME_R = 42, DOME_H = 64, WALK_R = 33;
export const DROP_R = 3.4;
const FLY_RING = 2.6, RING_COLOUR = new THREE.Color('#8FB0E8');
const DROP_COLOURS = { sugar: '#E8B85A', bitter: '#7E8E48', mixed: '#B09A44' };

function woodTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#4E3A28'; g.fillRect(0, 0, 512, 512);
  for (let r = 6; r < 380; r += 7 + Math.random() * 9) {
    g.beginPath(); g.arc(256 + Math.sin(r) * 6, 256 + Math.cos(r * 0.7) * 5, r, 0, Math.PI * 2);
    g.strokeStyle = `rgba(${18 + Math.random() * 16}, ${12 + Math.random() * 10}, ${6 + Math.random() * 8}, ${0.28 + Math.random() * 0.3})`;
    g.lineWidth = 1 + Math.random() * 2.2; g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101318');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(36, 1, 1, 1000);
  camera.position.set(62, 46, 108);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 12, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 60; controls.maxDistance = 230;
  controls.maxPolarAngle = 1.45; controls.minPolarAngle = 0.25;
  controls.enablePan = false;
  controls.update();

  // lights
  const key = new THREE.DirectionalLight('#FFE9C8', 2.6);
  key.position.set(45, 95, 40);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -60; key.shadow.camera.right = 60;
  key.shadow.camera.top = 60; key.shadow.camera.bottom = -60;
  key.shadow.camera.near = 20; key.shadow.camera.far = 220;
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
  scene.add(key);
  scene.add(new THREE.HemisphereLight('#8FB0E8', '#3A2E22', 0.55));
  const fill = new THREE.DirectionalLight('#8FB0E8', 0.5); fill.position.set(-60, 30, -40); scene.add(fill);

  // base: a wooden disc with a bevel ring, top face at y = 0
  const base = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), color: '#C9A77E', roughness: 0.58, metalness: 0.02 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(BASE_R, BASE_R, 6, 96), wood);
  disc.position.y = -3; disc.receiveShadow = true; disc.castShadow = true;
  base.add(disc);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(DOME_R + 0.6, 1.1, 12, 96), new THREE.MeshStandardMaterial({ color: '#4A3826', roughness: 0.55 }));
  lip.rotation.x = Math.PI / 2; lip.position.y = -0.2; lip.receiveShadow = true; lip.castShadow = true;
  base.add(lip);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(BASE_R + 4, BASE_R + 6, 4, 96), new THREE.MeshStandardMaterial({ color: '#3B2C1E', roughness: 0.7 }));
  foot.position.y = -8; foot.receiveShadow = true; foot.castShadow = true;
  base.add(foot);
  scene.add(base);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(160, 64), new THREE.ShadowMaterial({ opacity: 0.45 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -10; floor.receiveShadow = true;
  scene.add(floor);

  // glass cloche: a stretched hemisphere
  const glassGeo = new THREE.SphereGeometry(DOME_R, 96, 64, 0, Math.PI * 2, 0, Math.PI / 2);
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#FFFFFF', transmission: 0.97, thickness: 0.6, roughness: 0.02, ior: 1.45,
    clearcoat: 0.3, clearcoatRoughness: 0.03, envMapIntensity: 0.26, metalness: 0, specularIntensity: 0.5,
    side: THREE.FrontSide, transparent: false,
  });
  const dome = new THREE.Mesh(glassGeo, glass);
  dome.scale.set(1, DOME_H / DOME_R, 1);
  dome.castShadow = false; dome.receiveShadow = false;
  scene.add(dome);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 16), glass);
  knob.position.y = DOME_H + 1.4; scene.add(knob);

  // droplets
  const droplets = [];
  const dropGeo = new THREE.SphereGeometry(1, 28, 18);
  function addDroplet(kind, x, z) {
    const r = Math.hypot(x, z); if (r > WALK_R) { x *= WALK_R / r; z *= WALK_R / r; }
    for (const d of droplets) {
      if (Math.hypot(d.x - x, d.z - z) < d.radius + 3) {
        if (kind === 'bitter' && !d.bitter) { d.bitter = true; d.mesh.material.color.set(DROP_COLOURS.mixed); d.mesh.material.emissive.set(DROP_COLOURS.mixed); d.rejected = false; d.changed = true; }
        return d;
      }
    }
    // opaque on purpose: the glass dome is rendered from a buffer of opaque
    // objects only, so anything transparent inside it would vanish
    const mat = new THREE.MeshPhysicalMaterial({ color: DROP_COLOURS[kind], emissive: DROP_COLOURS[kind], emissiveIntensity: 0.22, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, ior: 1.36 });
    const mesh = new THREE.Mesh(dropGeo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const d = { kind, x, z, radius: DROP_R, bitter: kind === 'bitter', mesh, rejected: false, changed: false, gone: false };
    d.shrink = amt => { d.radius = Math.max(0, d.radius - amt); if (d.radius <= 0.25) removeDroplet(d); };
    droplets.push(d); scene.add(mesh); layoutDroplet(d);
    return d;
  }
  function layoutDroplet(d) { d.mesh.position.set(d.x, d.radius * 0.3, d.z); d.mesh.scale.set(d.radius, d.radius * 0.42, d.radius); }
  function removeDroplet(d) { d.gone = true; scene.remove(d.mesh); const k = droplets.indexOf(d); if (k >= 0) droplets.splice(k, 1); }

  // shadow sweep: an invisible occluder passes between the key light and the base
  const occluder = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  occluder.castShadow = true; occluder.visible = false;
  occluder.lookAt(key.position);
  scene.add(occluder);
  let sweep = null;
  function sweepShadow(dx = 1, dz = 0) {
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    sweep = { t: 0, dur: 520, dx, dz };
    occluder.visible = true;
  }

  // poke ripple
  const ripples = [];
  function ripple(x, z) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.1, 40), new THREE.MeshBasicMaterial({ color: '#8FB0E8', side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.05, z); scene.add(m);
    ripples.push({ m, t: 0 });
  }

  // picking
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let flyObj = null;
  function setFly(obj) { flyObj = obj; scene.add(obj); }
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (flyObj) {
      const h = ray.intersectObject(flyObj, true);
      if (h.length) return { hitFly: true, hitBase: false, point: h[0].point };
    }
    const h = ray.intersectObject(disc, false);
    if (h.length) {
      const p = h[0].point;
      if (p.y > -0.5 && Math.hypot(p.x, p.z) <= BASE_R) return { hitFly: false, hitBase: true, point: p };
    }
    return { hitFly: false, hitBase: false, point: null };
  }

  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function render(dt) {
    controls.update();
    if (sweep) {
      sweep.t += dt;
      const u = Math.min(1, sweep.t / sweep.dur);
      const s = -90 + 180 * u;
      const lightDir = key.position.clone().normalize();
      occluder.position.copy(lightDir.multiplyScalar(46)).add(new THREE.Vector3(sweep.dx * s, 0, sweep.dz * s));
      if (u >= 1) { sweep = null; occluder.visible = false; }
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]; r.t += dt;
      const u = r.t / 500; r.m.scale.setScalar((1 + u * 6) * FLY_RING); r.m.material.color.setScalar(1 - u).multiply(RING_COLOUR);
      if (u >= 1) { scene.remove(r.m); ripples.splice(i, 1); }
    }
    for (const d of droplets) layoutDroplet(d);
    renderer.render(scene, camera);
  }
  resize();
  return { scene, camera, renderer, controls, base: disc, dome, droplets, addDroplet, removeDroplet, pick, sweepShadow, ripple, setFly, render, resize };
}
