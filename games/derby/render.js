// Drawing. Three.js, one scene: the quarry, the platform, the cars built
// from their parts, dents, loose and flying parts, smoke, fire, sparks and
// dust, the chase camera and the kill-cam.
//
// It reads a view (the same shape on the host and on guests) and a stream
// of events. Debris lives only here: it never touches the physics, so it
// can never push a car or disagree between players.

import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { CLASSES, PART_IDS, WHEEL_PARTS, partsFor, wheelMounts, CAR_COLOURS } from './cars.js?v=1';
import * as A from './arena.js?v=1';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const tmpV = V(), tmpV2 = V(), tmpQ = new THREE.Quaternion();
const GRAV = 9.81;
const DEBRIS_MAX = 60;
const REPLAY_SECONDS = 4;

// Seeded noise, so every player's car gets the same rust.
function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }

export function createRenderer(canvas) {
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  gl.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFShadowMap;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color('#D7A07A');
  scene.fog = new THREE.Fog(HORIZON, 90, 330);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.2, 900);
  camera.position.set(0, 40, 70);

  // ── Light: a low sun through dust ──
  scene.add(new THREE.HemisphereLight('#F5D2A8', '#4A3A2A', 1.15));
  const sun = new THREE.DirectionalLight('#FFD9A8', 2.6);
  sun.position.set(-60, 55, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 220;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  scene.add(sky());
  scene.add(quarry());

  // ── The platform ──
  const dirt = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
  const rock = new THREE.MeshStandardMaterial({ color: '#7A6350', roughness: 1, flatShading: true });
  let floorMesh = null, cliffMesh = null, crackMesh = null;
  let cells = A.startCells();
  let fallenShown = -1, crackShown = -1;
  const crackMat = new THREE.MeshBasicMaterial({ color: '#B8321E', transparent: true, opacity: 0.35, depthWrite: false });

  function buildFloor() {
    if (floorMesh) { scene.remove(floorMesh); floorMesh.geometry.dispose(); }
    if (cliffMesh) { scene.remove(cliffMesh); cliffMesh.geometry.dispose(); }
    const { vertices, indices } = A.floorMesh(cells);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(vertices.slice(), 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    const col = new Float32Array(vertices.length);
    const base = new THREE.Color('#A3805A'), dark = new THREE.Color('#7D5F42'), pale = new THREE.Color('#C29C70');
    const c = new THREE.Color();
    for (let i = 0; i < vertices.length / 3; i++) {
      const x = vertices[i * 3], y = vertices[i * 3 + 1], z = vertices[i * 3 + 2];
      const n = hash(Math.floor(x * 0.7) * 31 + Math.floor(z * 0.7) * 17);
      c.copy(base).lerp(n > 0.5 ? pale : dark, Math.abs(n - 0.5) * 0.9);
      if (y < -0.3) c.lerp(dark, Math.min(0.5, -y * 0.2));          // the bowl is darker, churned
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    floorMesh = new THREE.Mesh(g, dirt);
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);
    cliffMesh = new THREE.Mesh(cliffGeometry(cells), rock);
    cliffMesh.receiveShadow = true;
    scene.add(cliffMesh);
  }

  function buildCracks(ring) {
    if (crackMesh) { scene.remove(crackMesh); crackMesh.geometry.dispose(); crackMesh = null; }
    if (ring < 0) return;
    const pos = [];
    for (let j = 0; j < A.N; j++) for (let i = 0; i < A.N; i++) {
      if (!cells[j * A.N + i] || A.ringOf(i, j) !== ring) continue;
      const x0 = -A.HALF + i * A.CELL, z0 = -A.HALF + j * A.CELL;
      const y = A.heightAt(x0 + 2, z0 + 2) + 0.05;
      pos.push(x0 + 0.15, y, z0 + 0.15, x0 + 0.15, y, z0 + 3.85, x0 + 3.85, y, z0 + 0.15,
        x0 + 3.85, y, z0 + 0.15, x0 + 0.15, y, z0 + 3.85, x0 + 3.85, y, z0 + 3.85);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    crackMesh = new THREE.Mesh(g, crackMat);
    crackMesh.renderOrder = 2;
    scene.add(crackMesh);
  }

  // Slabs that break away when a ring crumbles.
  const slabGeo = new THREE.BoxGeometry(A.CELL * 0.96, 2.2, A.CELL * 0.96);
  const slabs = new THREE.InstancedMesh(slabGeo, rock, A.N * 4 * 2);
  slabs.castShadow = true;
  slabs.count = 0;
  slabs.frustumCulled = false;
  scene.add(slabs);
  const slabList = [];

  function dropSlabs(removed) {
    for (const k of removed) {
      if (slabList.length >= slabs.instanceMatrix.count) break;
      const i = k % A.N, j = (k / A.N) | 0;
      const x = A.cellCentre(i), z = A.cellCentre(j);
      slabList.push({ p: V(x, A.heightAt(x, z) - 1.1, z), v: V(0, -Math.random() * 2, 0), q: new THREE.Quaternion(), w: V(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(1.2), delay: Math.random() * 0.8 });
      if (Math.random() < 0.3) puff('dust', V(x, A.heightAt(x, z) + 0.5, z), 3, 2.5);
    }
  }

  function setFallen(fallen) {
    if (fallen === fallenShown) return;
    const removed = [];
    if (fallen < fallenShown) cells = A.startCells();
    for (let r = 0; r <= fallen; r++) removed.push(...A.dropRings(cells, r));
    const animate = fallen > fallenShown && fallenShown >= -1 && removed.length < 200;
    fallenShown = fallen;
    buildFloor();
    if (animate) dropSlabs(removed);
    crackShown = -2;
  }

  // ── Ramps, crushers ──
  const rampMat = new THREE.MeshStandardMaterial({ color: '#8C7456', roughness: 0.9, flatShading: true });
  const stripe = stripeTexture();
  for (const r of A.RAMPS) {
    const g = new ConvexGeometry(A.rampPoints(r).map(p => V(...p)));
    const m = new THREE.Mesh(g, rampMat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  const steel = new THREE.MeshStandardMaterial({ color: '#5E6468', roughness: 0.55, metalness: 0.6, flatShading: true });
  const plateMat = [steel, steel, new THREE.MeshStandardMaterial({ color: '#4A4F52', roughness: 0.6, metalness: 0.5 }), new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.7 }), steel, steel];
  const padMat = new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.8, transparent: true, opacity: 0.85, depthWrite: false });
  const crushers = A.CRUSHERS.map(c => {
    const g = new THREE.Group();
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.45, 12, 8), steel);
      post.position.set(c.x + sx * (A.PLATE.half + 0.5), 5.5, c.z + sz * (A.PLATE.half + 0.5));
      post.castShadow = true;
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(A.PLATE.half * 2 + 2, 1.1, A.PLATE.half * 2 + 2), steel);
    beam.position.set(c.x, 12, c.z);
    beam.castShadow = true;
    g.add(beam);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(A.PLATE.half * 2, A.PLATE.thick, A.PLATE.half * 2), plateMat);
    plate.castShadow = true;
    g.add(plate);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 10), new THREE.MeshStandardMaterial({ color: '#C9CED1', metalness: 0.9, roughness: 0.25 }));
    g.add(rod);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(A.PLATE.half * 2, A.PLATE.half * 2), padMat.clone());
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(c.x, A.heightAt(c.x, c.z) + 0.04, c.z);
    pad.renderOrder = 1;
    g.add(pad);
    scene.add(g);
    return { c, plate, rod, pad, lastPhase: 'idle' };
  });

  function updateCrushers(t) {
    for (const k of crushers) {
      const st = A.crusherState(k.c.k, Math.max(0, t));
      const floor = A.heightAt(k.c.x, k.c.z);
      const shake = st.shake ? (Math.random() - 0.5) * 0.12 * st.shake : 0;
      const y = floor + st.y + A.PLATE.thick / 2;
      k.plate.position.set(k.c.x + shake, y, k.c.z + shake);
      const top = 11.4, bottom = y + A.PLATE.thick / 2;
      k.rod.scale.y = Math.max(0.1, top - bottom);
      k.rod.position.set(k.c.x, (top + bottom) / 2, k.c.z);
      const hot = st.phase === 'warn' || st.phase === 'slam';
      k.pad.material.color.set(hot ? (Math.sin(t * 22) > 0 ? '#FF6040' : '#FFFFFF') : '#FFFFFF');
      if (k.lastPhase === 'slam' && st.phase === 'hold') {
        puff('dust', V(k.c.x, floor + 0.3, k.c.z), 26, 7);
        shakeAt(V(k.c.x, floor, k.c.z), 0.9);
      }
      k.lastPhase = st.phase;
    }
  }

  // ── Containers ──
  const boxColours = ['#9B3B26', '#2E5E8C', '#3E7A4A', '#B07A23', '#6C6F73'];
  const boxGeo = new THREE.BoxGeometry(6, 2.6, 2.5, 12, 1, 1);
  const corrugate = corrugatedTexture();
  const boxes = new Map();
  const warnGeo = new THREE.RingGeometry(2.2, 3.2, 40);
  const warnMat = new THREE.MeshBasicMaterial({ color: '#E0402A', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
  const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false });

  function syncBoxes(list) {
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      let o = boxes.get(b.id);
      if (!o) {
        const mat = new THREE.MeshStandardMaterial({ color: boxColours[b.id % boxColours.length], map: corrugate, roughness: 0.7, metalness: 0.3 });
        const mesh = new THREE.Mesh(boxGeo, mat);
        mesh.castShadow = mesh.receiveShadow = true;
        const ring = new THREE.Mesh(warnGeo, warnMat);
        ring.rotation.x = -Math.PI / 2;
        const shadow = new THREE.Mesh(new THREE.CircleGeometry(3, 24), shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        scene.add(mesh, ring, shadow);
        o = { mesh, ring, shadow, landed: false };
        boxes.set(b.id, o);
      }
      o.mesh.position.set(...b.pos);
      o.mesh.quaternion.set(...b.quat);
      const falling = (b.vy ?? -1) < -1 && b.pos[1] > 4;
      const gy = A.heightAt(b.pos[0], b.pos[2]) + 0.06;
      o.ring.visible = o.shadow.visible = falling;
      if (falling) {
        const k = Math.min(1, Math.max(0.2, (b.pos[1] - gy) / 30));
        o.ring.position.set(b.pos[0], gy, b.pos[2]);
        o.ring.scale.setScalar(0.6 + k * 0.8);
        o.shadow.position.set(b.pos[0], gy - 0.01, b.pos[2]);
        o.shadow.scale.setScalar(1.2 - k * 0.6);
      }
      if (!falling && !o.landed && b.pos[1] < 6) {
        o.landed = true;
        puff('dust', V(b.pos[0], gy + 0.5, b.pos[2]), 30, 6);
        shakeAt(V(b.pos[0], gy, b.pos[2]), 1.2);
      }
    }
    for (const [id, o] of boxes) {
      if (seen.has(id)) continue;
      scene.remove(o.mesh, o.ring, o.shadow);
      o.mesh.material.dispose();
      boxes.delete(id);
    }
  }

  // ── Pickups ──
  const pickupObjs = new Map();
  const PICK_COL = { repair: '#46A35A', armour: '#3D7BC4', plough: '#E07A2A', boost: '#E8C33A' };
  function pickupMesh(kind) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: PICK_COL[kind], emissive: PICK_COL[kind], emissiveIntensity: 0.45, roughness: 0.4, flatShading: true });
    const white = new THREE.MeshStandardMaterial({ color: '#F4EFE6', emissive: '#F4EFE6', emissiveIntensity: 0.3 });
    if (kind === 'repair') {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), mat));
      const a = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.22, 0.7), white); g.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.7, 0.22), white); g.add(b);
    } else if (kind === 'armour') {
      g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.85), mat));
    } else if (kind === 'plough') {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.3, 4), mat); m.rotation.z = Math.PI / 2; g.add(m);
    } else {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.3, 10), mat));
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 8), white); cap.position.y = 0.8; g.add(cap);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.75, 32), new THREE.MeshBasicMaterial({ color: PICK_COL[kind], transparent: true, opacity: 0.55, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    const root = new THREE.Group();
    root.add(g, ring);
    g.traverse(o => { o.castShadow = true; });
    return { root, spin: g, ring };
  }
  function syncPickups(list, time) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let o = pickupObjs.get(p.id);
      if (!o) { o = pickupMesh(p.kind); pickupObjs.set(p.id, o); scene.add(o.root); }
      const gy = A.heightAt(p.x, p.z);
      o.root.position.set(p.x, gy, p.z);
      o.spin.position.y = 1.3 + Math.sin(time * 2.4 + p.id) * 0.2;
      o.spin.rotation.y = time * 1.6;
      o.ring.position.y = 0.06;
    }
    for (const [id, o] of pickupObjs) {
      if (seen.has(id)) continue;
      scene.remove(o.root);
      pickupObjs.delete(id);
    }
  }

  // ── Cars ──
  const cars = [];          // by idx
  const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
  wheelGeo.rotateX(Math.PI / 2);
  const tyreMat = new THREE.MeshStandardMaterial({ color: '#1E1D1B', roughness: 0.9, flatShading: true });
  const hubMat = new THREE.MeshStandardMaterial({ color: '#B8B4AA', roughness: 0.4, metalness: 0.7 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#6F8697', roughness: 0.18, metalness: 0.35, flatShading: true, vertexColors: true });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#34322F', roughness: 0.7, metalness: 0.4, flatShading: true, vertexColors: true });
  const headMat = new THREE.MeshStandardMaterial({ color: '#FFF4D6', emissive: '#FFE9B0', emissiveIntensity: 1.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: '#8A1E14', emissive: '#E0301E', emissiveIntensity: 0.6 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: '#B8BDC0', metalness: 0.85, roughness: 0.3, flatShading: true });

  function segs(n) { return Math.max(1, Math.min(10, Math.round(n / 0.32))); }

  function buildCar(v, players) {
    const C = CLASSES[v.cls];
    const colour = CAR_COLOURS[v.idx % CAR_COLOURS.length];
    const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.55, metalness: 0.2, flatShading: true, vertexColors: true });
    const root = new THREE.Group();
    const parts = {};
    const seed = v.idx * 97 + 13;
    for (const p of partsFor(v.cls)) {
      if (p.wheel) continue;
      const g = new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2], segs(p.size[0]), segs(p.size[1]), segs(p.size[2]));
      weather(g, p.pos, seed, p.id === 'body' ? 0.55 : 0.3);
      // A bus's long cabin is painted, with a band of windows; a car's is all glass.
      const glass = p.glass && v.cls !== 'bus';
      const mat = glass ? glassMat : p.id.startsWith('bumper') ? trimMat : paint;
      const mesh = new THREE.Mesh(g, p.id === 'roof' ? roofMaterials(paint, v.idx + 1) : mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.rest = g.attributes.position.array.slice();
      if (p.glass && v.cls === 'bus') {
        const [L, H, W] = p.size;
        const band = H * 0.42;
        for (const z of [-1, 1]) {
          const w = new THREE.Mesh(new THREE.BoxGeometry(L * 0.92, band, 0.04), glassMat);
          w.position.set(0, H * 0.12, z * (W / 2 + 0.01));
          mesh.add(w);
        }
        const front = new THREE.Mesh(new THREE.BoxGeometry(0.04, band * 1.3, W * 0.86), glassMat);
        front.position.set(L / 2 + 0.01, H * 0.1, 0);
        mesh.add(front);
      }
      const pivot = new THREE.Group();
      const h = p.hinge ? p.hinge.p : p.pos;
      pivot.position.set(...h);
      mesh.position.set(p.pos[0] - h[0], p.pos[1] - h[1], p.pos[2] - h[2]);
      pivot.add(mesh);
      root.add(pivot);
      parts[p.id] = { def: p, pivot, mesh, state: 0, swing: 0, swingV: 0 };
    }
    // Lights on the tub, so they stay with the car.
    const hl = C.L / 2, hw = C.W / 2, hh = C.H / 2;
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.3), headMat);
      h.position.set(hl - 0.02, hh - 0.18, s * (hw - 0.3));
      root.add(h);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.26), tailMat);
      t.position.set(-hl + 0.02, hh - 0.16, s * (hw - 0.28));
      root.add(t);
    }
    // The plough blade, shown while the pickup is active.
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, C.W + 0.5), bladeMat);
    blade.position.set(hl + C.bumper + 0.18, -hh + 0.3, 0);
    blade.rotation.z = -0.35;
    blade.visible = false;
    blade.castShadow = true;
    root.add(blade);
    // Armour glow.
    const shell = new THREE.Mesh(new THREE.BoxGeometry(C.L + 0.7, C.H + C.cabin.H + 0.5, C.W + 0.6), new THREE.MeshBasicMaterial({ color: '#6FA8E8', transparent: true, opacity: 0.16, depthWrite: false }));
    shell.position.set(0, C.cabin.H / 2, 0);
    shell.visible = false;
    root.add(shell);

    const wheels = wheelMounts(v.cls).map((mt, i) => {
      const g = new THREE.Group();
      const tyre = new THREE.Mesh(wheelGeo, tyreMat);
      tyre.scale.set(C.wheel.r, C.wheel.r, C.wheel.r * 0.95);
      const hub = new THREE.Mesh(wheelGeo, hubMat);
      hub.scale.set(C.wheel.r * 0.55, C.wheel.r * 0.55, C.wheel.r * 1.0);
      const spin = new THREE.Group();
      spin.add(tyre, hub);
      // A spoke so the spin shows.
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(C.wheel.r * 1.3, C.wheel.r * 0.2, C.wheel.r * 1.02), hubMat);
      spin.add(spoke);
      g.add(spin);
      tyre.castShadow = true;
      g.position.set(mt[0], mt[1] - C.wheel.rest, mt[2] + Math.sign(mt[2]) * 0.12);
      root.add(g);
      return { g, spin, mount: mt, rot: 0, gone: false };
    });

    const player = players && players[v.id];
    const tag = player && player.name ? nameTag(player.name, colour) : null;
    if (tag) { tag.position.set(0, hh + C.cabin.H + 1.4, 0); root.add(tag); }

    root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(root);
    return { idx: v.idx, id: v.id, cls: v.cls, C, root, parts, wheels, paint, blade, shell, tag, smokeT: 0, dustT: 0, fireT: 0, speed: 0, lastPos: null, out: null, dents: 0 };
  }

  function disposeCar(c) {
    scene.remove(c.root);
    c.root.traverse(o => { if (o.isMesh && o.geometry !== wheelGeo) o.geometry.dispose(); });
    c.paint.dispose();
  }

  /** Push a car's panels in around a point, in the car's own frame. */
  function dent(c, p, d, depth, wide) {
    const radius = wide ? 2.2 : 0.55 + depth * 2.6;
    for (const id in c.parts) {
      const part = c.parts[id];
      if (part.state === 2) continue;
      const g = part.mesh.geometry;
      const pos = g.attributes.position;
      const a = pos.array, rest = part.mesh.userData.rest;
      const o = part.def.pos;
      let touched = false;
      for (let i = 0; i < a.length; i += 3) {
        const x = a[i] + o[0], y = a[i + 1] + o[1], z = a[i + 2] + o[2];
        const dist = Math.hypot(x - p[0], y - p[1], z - p[2]);
        if (dist >= radius) continue;
        const f = 1 - dist / radius;
        const push = depth * f * f;
        let nx = a[i] + d[0] * push, ny = a[i + 1] + d[1] * push, nz = a[i + 2] + d[2] * push;
        // Never further than 0.6 m from where it started.
        const ox = nx - rest[i], oy = ny - rest[i + 1], oz = nz - rest[i + 2];
        const off = Math.hypot(ox, oy, oz);
        if (off > 0.6) { const k = 0.6 / off; nx = rest[i] + ox * k; ny = rest[i + 1] + oy * k; nz = rest[i + 2] + oz * k; }
        a[i] = nx; a[i + 1] = ny; a[i + 2] = nz;
        touched = true;
      }
      if (touched) { pos.needsUpdate = true; g.computeBoundingSphere(); }
    }
    c.dents++;
  }

  // ── Debris: parts that came off ──
  const debris = [];
  function throwPart(c, pid, vel) {
    let obj, size;
    const q = c.root.quaternion;
    if (WHEEL_PARTS.includes(pid)) {
      const w = c.wheels[WHEEL_PARTS.indexOf(pid)];
      if (w.gone) return;
      w.gone = true;
      w.g.updateWorldMatrix(true, false);
      obj = w.g;
      obj.getWorldPosition(tmpV);
      obj.getWorldQuaternion(tmpQ);
      c.root.remove(obj);
      obj.position.copy(tmpV);
      obj.quaternion.copy(tmpQ);
      size = c.C.wheel.r;
    } else {
      const part = c.parts[pid];
      if (!part || part.state === 2) return;
      part.state = 2;
      obj = part.mesh;
      obj.updateWorldMatrix(true, false);
      obj.getWorldPosition(tmpV);
      obj.getWorldQuaternion(tmpQ);
      part.pivot.remove(obj);
      obj.position.copy(tmpV);
      obj.quaternion.copy(tmpQ);
      size = Math.max(...part.def.size) / 2;
    }
    scene.add(obj);
    const out = V().subVectors(obj.position, c.root.position).setY(0).normalize();
    const v = V(...(vel || [0, 0, 0])).addScaledVector(out, 3 + Math.random() * 4);
    v.y += 3 + Math.random() * 4;
    debris.push({ obj, v, w: V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(9), r: Math.max(0.15, Math.min(0.6, size * 0.4)), age: 0, rest: 0 });
    sparks(obj.position, 16);
    while (debris.length > DEBRIS_MAX) {
      const d = debris.shift();
      scene.remove(d.obj);
    }
  }

  function stepDebris(dt, carViews) {
    for (const d of debris) {
      d.age += dt;
      if (d.rest > 1.5) continue;
      d.v.y -= GRAV * dt;
      d.obj.position.addScaledVector(d.v, dt);
      const p = d.obj.position;
      const alive = A.cellAlive(cells, p.x, p.z);
      const gy = alive ? A.heightAt(p.x, p.z) + d.r : -1e9;
      if (p.y < gy) {
        p.y = gy;
        if (d.v.y < -1.2) { d.v.y *= -0.32; d.w.multiplyScalar(0.6); }
        else d.v.y = 0;
        d.v.x *= Math.pow(0.08, dt); d.v.z *= Math.pow(0.08, dt);
        d.w.multiplyScalar(Math.pow(0.05, dt));
        if (d.v.lengthSq() < 0.05) d.rest += dt; else d.rest = 0;
      }
      tmpQ.setFromAxisAngle(tmpV2.copy(d.w).normalize(), d.w.length() * dt);
      if (d.w.lengthSq() > 1e-6) d.obj.quaternion.premultiply(tmpQ);
      // Cars shove what they drive into.
      for (const c of carViews) {
        const dx = p.x - c.pos[0], dz = p.z - c.pos[2];
        const reach = CLASSES[c.cls].L / 2 + 0.4;
        if (dx * dx + dz * dz < reach * reach && Math.abs(p.y - c.pos[1]) < 2) {
          const sp = Math.hypot(c.vel[0], c.vel[2]);
          if (sp > 2) {
            d.v.set(c.vel[0] * 1.1 + dx * 0.8, 2 + sp * 0.12, c.vel[2] * 1.1 + dz * 0.8);
            d.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(sp);
            d.rest = 0;
          }
        }
      }
      if (p.y < -70) d.rest = 99;
    }
    for (let i = debris.length - 1; i >= 0; i--) {
      if (debris[i].obj.position.y < -70) { scene.remove(debris[i].obj); debris.splice(i, 1); }
    }
    // Slabs
    let n = 0;
    const m = new THREE.Matrix4();
    for (let i = slabList.length - 1; i >= 0; i--) {
      const s = slabList[i];
      s.delay -= dt;
      if (s.delay < 0) { s.v.y -= GRAV * dt; s.p.addScaledVector(s.v, dt); tmpQ.setFromAxisAngle(tmpV2.copy(s.w).normalize(), s.w.length() * dt); s.q.premultiply(tmpQ); }
      if (s.p.y < -90) { slabList.splice(i, 1); continue; }
    }
    for (const s of slabList) { m.compose(s.p, s.q, tmpV.set(1, 1, 1)); slabs.setMatrixAt(n++, m); }
    slabs.count = n;
    slabs.instanceMatrix.needsUpdate = true;
  }

  function clearDebris() {
    for (const d of debris) scene.remove(d.obj);
    debris.length = 0;
    slabList.length = 0;
  }

  // ── Particles ──
  const smoke = particles(1400, THREE.NormalBlending);
  const glow = particles(1400, THREE.AdditiveBlending);
  scene.add(smoke.points, glow.points);

  function puff(kind, at, n, spread = 1) {
    for (let i = 0; i < n; i++) {
      const v = V((Math.random() - 0.5) * spread, Math.random() * spread * 0.5 + 0.5, (Math.random() - 0.5) * spread);
      if (kind === 'dust') smoke.emit(at, v, 1.6 + Math.random() * 1.6, [0.72, 0.58, 0.42, 0.55], 1.8 + Math.random(), 2.2);
      else if (kind === 'grey') smoke.emit(at, v.multiplyScalar(0.4).add(V(0, 1.5, 0)), 0.9, [0.55, 0.55, 0.55, 0.5], 2.2, 2.5);
      else if (kind === 'black') smoke.emit(at, v.multiplyScalar(0.4).add(V(0, 2.2, 0)), 1.2, [0.1, 0.09, 0.08, 0.7], 2.8, 3.2);
    }
  }
  function sparks(at, n) {
    for (let i = 0; i < n; i++) {
      const v = V(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 9);
      glow.emit(at, v, 0.14 + Math.random() * 0.1, [1, 0.62 + Math.random() * 0.3, 0.25, 1], 0.35 + Math.random() * 0.35, 0, 1);
    }
  }
  function fire(at, n) {
    for (let i = 0; i < n; i++) {
      const v = V((Math.random() - 0.5) * 0.8, 1.8 + Math.random() * 1.5, (Math.random() - 0.5) * 0.8);
      glow.emit(at.clone().add(V((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), v, 0.7 + Math.random() * 0.5, [1, 0.45 + Math.random() * 0.25, 0.12, 0.9], 0.5 + Math.random() * 0.3, -0.5);
    }
  }

  // ── Camera ──
  const cam = { pos: V(0, 40, 70), look: V(0, 0, 0), yaw: 0, shake: 0, orbit: 0, spectate: 0, back: false };
  function shakeAt(p, k) {
    const d = camera.position.distanceTo(p);
    cam.shake = Math.min(1.4, cam.shake + k * Math.max(0, 1 - d / 60));
  }

  function followCar(v, dt, back) {
    const C = CLASSES[v.cls];
    const q = tmpQ.set(...v.quat);
    const f = tmpV.set(1, 0, 0).applyQuaternion(q);
    f.y = 0;
    if (f.lengthSq() < 0.01) f.set(Math.cos(cam.yaw), 0, Math.sin(cam.yaw));
    f.normalize();
    let yaw = Math.atan2(f.z, f.x);
    if (back) yaw += Math.PI;
    let dy = yaw - cam.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    cam.yaw += dy * (1 - Math.exp(-dt * (back ? 20 : 4.5)));
    const dist = 5.5 + C.L * 0.9, height = 2.4 + C.H * 1.6;
    const target = V(v.pos[0], Math.max(v.pos[1], A.FALL_Y + 2), v.pos[2]);
    const want = V(target.x - Math.cos(cam.yaw) * dist, target.y + height, target.z - Math.sin(cam.yaw) * dist);
    const floor = A.cellAlive(cells, want.x, want.z) ? A.heightAt(want.x, want.z) + 1 : -100;
    want.y = Math.max(want.y, floor);
    const k = 1 - Math.exp(-dt * 7);
    cam.pos.lerp(want, k);
    cam.look.lerp(target.add(V(Math.cos(cam.yaw) * 3, 0.8, Math.sin(cam.yaw) * 3)), 1 - Math.exp(-dt * 12));
  }

  function orbit(dt, time) {
    cam.orbit += dt * 0.06;
    const r = 62, a = cam.orbit;
    cam.pos.lerp(V(Math.cos(a) * r, 30 + Math.sin(time * 0.1) * 4, Math.sin(a) * r), 1 - Math.exp(-dt * 2));
    cam.look.lerp(V(0, -2, 0), 1 - Math.exp(-dt * 2));
  }

  // ── Kill-cam: the last few seconds, again, slowly ──
  const history = [];         // { t, cars: [{pos, quat}] }
  const replay = { on: false, t: 0, from: 0, to: 0, focus: -1, other: -1, label: '' };

  function record(view, time) {
    history.push({ t: time, cars: view.cars.map(c => ({ pos: c.pos.slice(), quat: c.quat.slice(), out: c.out })) });
    while (history.length && time - history[0].t > REPLAY_SECONDS + 0.5) history.shift();
  }

  function startReplay(focus, other, label, time) {
    if (history.length < 20) return false;
    replay.on = true;
    replay.from = Math.max(history[0].t, time - 2.6);
    replay.to = time;
    replay.t = replay.from;
    replay.focus = focus; replay.other = other; replay.label = label;
    replay.angle = Math.random() < 0.5 ? 1 : -1;
    return true;
  }

  function replayFrame() {
    let i = 0;
    while (i < history.length - 1 && history[i + 1].t < replay.t) i++;
    return history[i];
  }

  // ── Events ──
  let players = {};
  function addEvents(events, view, opts = {}) {
    for (const e of events) {
      if (e.type === 'round') resetRound();
      const c = e.c !== undefined ? cars[e.c] : null;
      const cv = view && e.c !== undefined ? view.cars[e.c] : null;
      if (e.type === 'hit' && c) {
        dent(c, e.p, e.d, e.s, e.wide);
        if (cv) {
          const wp = V(...e.p).applyQuaternion(tmpQ.set(...cv.quat)).add(V(...cv.pos));
          sparks(wp, e.big ? 22 : 7);
          if (e.big) { puff('dust', wp, 4, 1.5); shakeAt(wp, e.s * 1.4); }
        }
      } else if (e.type === 'detach' && c) {
        throwPart(c, e.part, e.v);
      } else if (e.type === 'wreck' && c && cv) {
        const wp = V(...cv.pos);
        fire(wp, 30); puff('black', wp, 10, 2); sparks(wp, 30);
        shakeAt(wp, 0.8);
      } else if (e.type === 'crush' && c && cv) {
        const wp = V(...cv.pos);
        sparks(wp.clone().setY(wp.y + 1), 30);
      } else if (e.type === 'pickup' && cv) {
        sparks(V(...cv.pos).setY(cv.pos[1] + 1), 20);
      }
    }
  }

  function resetRound() {
    for (const c of cars) if (c) disposeCar(c);
    cars.length = 0;
    clearDebris();
    for (const [, o] of boxes) scene.remove(o.mesh, o.ring, o.shadow);
    boxes.clear();
    cells = A.startCells();
    fallenShown = -1;
    buildFloor();
    buildCracks(-1);
    history.length = 0;
    replay.on = false;
  }

  // ── Per frame ──
  function syncCars(view, dt, time) {
    for (const v of view.cars) {
      let c = cars[v.idx];
      if (!c || c.cls !== v.cls || c.id !== v.id) {
        if (c) disposeCar(c);
        c = cars[v.idx] = buildCar(v, players);
      }
      c.root.position.set(...v.pos);
      c.root.quaternion.set(...v.quat);
      const sp = Math.hypot(v.vel[0], v.vel[2]);
      const fwd = tmpV.set(1, 0, 0).applyQuaternion(c.root.quaternion);
      const signed = fwd.x * v.vel[0] + fwd.z * v.vel[2];
      c.speed = signed;
      // Parts: hanging ones swing, gone ones go (if we missed the event).
      for (let i = 0; i < PART_IDS.length; i++) {
        const pid = PART_IDS[i];
        const st = v.parts[i];
        if (WHEEL_PARTS.includes(pid)) { if (st === 2 && !c.wheels[WHEEL_PARTS.indexOf(pid)].gone) throwPart(c, pid, v.vel); continue; }
        const part = c.parts[pid];
        if (st === 2 && part.state !== 2) { throwPart(c, pid, v.vel); continue; }
        if (part.state === 2) continue;
        part.state = st;
        if (st === 1 && part.def.hinge) {
          const h = part.def.hinge;
          // A loose part flaps: a spring with the car's jolts driving it.
          const target = 0.42 + Math.min(0.5, sp * 0.02);
          part.swingV += ((target - part.swing) * 40 - part.swingV * 5) * dt + (Math.random() - 0.5) * sp * 0.4 * dt * 20;
          part.swing += part.swingV * dt;
          part.swing = Math.max(0, Math.min(pid.startsWith('bumper') ? 0.32 : 1.2, part.swing));
          part.pivot.quaternion.setFromAxisAngle(tmpV2.set(...h.axis), h.sign * part.swing);
        }
      }
      // Wheels: suspension, steering and spin.
      for (let i = 0; i < 4; i++) {
        const w = c.wheels[i];
        if (w.gone) continue;
        const susp = v.susp ? v.susp[i] : c.C.wheel.rest;
        w.g.position.y = w.mount[1] - Math.max(0.05, Math.min(c.C.wheel.rest + 0.3, susp));
        w.g.rotation.y = i < 2 ? v.steer : 0;
        w.rot -= signed / c.C.wheel.r * dt;
        w.spin.rotation.z = w.rot;
      }
      c.blade.visible = !!v.plough;
      c.shell.visible = !!v.armour;
      if (c.shell.visible) c.shell.material.opacity = 0.1 + Math.sin(time * 6) * 0.05;
      if (c.tag) c.tag.visible = !v.out && opts.labels !== false && v.idx !== opts.meIdx;

      // Smoke and fire from the engine bay.
      const hood = V(c.C.L * 0.32, c.C.H / 2 + 0.2, 0).applyQuaternion(c.root.quaternion).add(c.root.position);
      c.smokeT -= dt;
      if (v.pos[1] > A.FALL_Y && c.smokeT <= 0) {
        if (v.out === 'wreck') {
          c.fireT += dt;
          if (c.fireT < 12) { fire(hood, 2); puff('black', hood, 1); } else puff('grey', hood, 1);
          c.smokeT = 0.08;
        } else if (v.engine < 15) { fire(hood, 1); puff('black', hood, 1); c.smokeT = 0.07; }
        else if (v.engine < 40) { puff('grey', hood, 1); c.smokeT = 0.14 + v.engine / 200; }
      }
      // Boost flame and dust.
      if (v.boosting) {
        const ex = V(-c.C.L / 2 - 0.2, -c.C.H / 4, 0).applyQuaternion(c.root.quaternion).add(c.root.position);
        for (let k = 0; k < 3; k++) glow.emit(ex, fwd.clone().multiplyScalar(-6).add(V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)), 0.5, [1, 0.55, 0.2, 1], 0.18, 0);
      }
      c.dustT -= dt;
      if (sp > 7 && !v.out && c.dustT <= 0 && v.pos[1] - A.heightAt(v.pos[0], v.pos[2]) < 2.2) {
        const back = V(-c.C.L / 2, -c.C.H / 2, 0).applyQuaternion(c.root.quaternion).add(c.root.position);
        smoke.emit(back, V((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2), 1 + sp * 0.05, [0.74, 0.6, 0.44, 0.32], 1.4, 1.2);
        c.dustT = 0.05;
      }
    }
  }

  let opts = {};
  function draw(view, o = {}) {
    opts = o;
    players = o.players || players;
    const dt = o.dt || 0;
    const time = o.time || 0;
    if (!floorMesh) buildFloor();
    if (view) {
      setFallen(view.fallen ?? -1);
      const crack = A.crumbleRing(view.t).cracking;
      if (crack !== crackShown) { crackShown = crack; buildCracks(crack); }
      if (crackMesh) crackMat.opacity = 0.25 + Math.sin(time * 9) * 0.15;
      record(view, time);
      syncCars(view, dt, time);
      syncBoxes(view.boxes || []);
      syncPickups(view.pickups || [], time);
      updateCrushers(view.t);
      stepDebris(dt, view.cars);
    }
    smoke.step(dt); glow.step(dt);

    // Camera
    if (replay.on && view) {
      replay.t += dt * 0.45;
      if (replay.t >= replay.to) replay.on = false;
      const fr = replayFrame();
      if (fr) {
        for (let i = 0; i < fr.cars.length; i++) {
          const c = cars[i];
          if (!c) continue;
          c.root.position.set(...fr.cars[i].pos);
          c.root.quaternion.set(...fr.cars[i].quat);
        }
        const f = fr.cars[replay.focus];
        if (f) {
          const o2 = fr.cars[replay.other] || f;
          const mid = V((f.pos[0] + o2.pos[0]) / 2, (f.pos[1] + o2.pos[1]) / 2, (f.pos[2] + o2.pos[2]) / 2);
          const a = time * 0.25 * replay.angle + 0.8;
          cam.pos.lerp(V(mid.x + Math.cos(a) * 9, Math.max(mid.y, -2) + 3.2, mid.z + Math.sin(a) * 9), 1 - Math.exp(-dt * 5));
          cam.look.lerp(mid, 1 - Math.exp(-dt * 8));
        }
      }
    } else if (view && o.follow !== undefined && o.follow >= 0 && view.cars[o.follow]) {
      followCar(view.cars[o.follow], dt, o.back);
    } else {
      orbit(dt, time);
    }
    camera.position.copy(cam.pos);
    if (cam.shake > 0.01) {
      camera.position.add(V((Math.random() - 0.5) * cam.shake * 0.5, (Math.random() - 0.5) * cam.shake * 0.5, (Math.random() - 0.5) * cam.shake * 0.5));
      cam.shake *= Math.exp(-dt * 6);
    }
    camera.lookAt(cam.look);
    // Keep the shadow box around what we are looking at.
    sun.target.position.set(cam.look.x, 0, cam.look.z);
    sun.position.set(cam.look.x - 60, 55, cam.look.z + 30);
    smoke.setScale(gl.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
    glow.setScale(gl.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
    gl.render(scene, camera);
  }

  function resize() {
    const el = gl.domElement.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    gl.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  buildFloor();

  return {
    draw, resize, addEvents, resetRound,
    startReplay: (focus, other, label, time) => startReplay(focus, other, label, time),
    replay: () => (replay.on ? replay.label : ''),
    stopReplay: () => { replay.on = false; },
    shake: k => { cam.shake = Math.min(1.5, cam.shake + k); },
  };
}

// ── Pieces of scenery ──────────────────────────────────────

function sky() {
  const g = new THREE.SphereGeometry(800, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#5E7FA6') }, mid: { value: new THREE.Color('#E8B488') }, low: { value: new THREE.Color('#B57A55') } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vp;
      void main(){ float h = vp.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*1.6,0.0,1.0), 0.7)) : mix(mid, low, clamp(-h*3.0,0.0,1.0));
      float sun = pow(max(dot(vp, normalize(vec3(-0.75,0.28,0.4))), 0.0), 60.0);
      c += vec3(1.0,0.8,0.5) * sun * 0.9;
      gl_FragColor = vec4(c,1.0); }`,
  });
  return new THREE.Mesh(g, m);
}

/** The quarry around and below the platform: rough walls and a far floor. */
function quarry() {
  const group = new THREE.Group();
  const wallGeo = new THREE.CylinderGeometry(210, 170, 150, 56, 8, true);
  const pos = wallGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const n = Math.sin(a * 7) * 6 + Math.sin(a * 17 + y * 0.05) * 4 + (hash(i) - 0.5) * 9;
    const k = 1 + n / 200;
    pos.setXYZ(i, x * k, y + (hash(i + 7) - 0.5) * 6, z * k);
  }
  wallGeo.computeVertexNormals();
  const wall = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ color: '#9A7255', roughness: 1, flatShading: true, side: THREE.BackSide }));
  wall.position.y = -40;
  group.add(wall);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(220, 40), new THREE.MeshStandardMaterial({ color: '#6B4E36', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -110;
  group.add(floor);
  // Scrap heaps on the quarry floor, and the pillar the platform stands on.
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(30, 44, 104, 10, 3), new THREE.MeshStandardMaterial({ color: '#6E5846', roughness: 1, flatShading: true }));
  pillar.position.y = -59;
  group.add(pillar);
  const heapMat = new THREE.MeshStandardMaterial({ color: '#5B4A3C', roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2 + hash(i) * 0.3, r = 90 + hash(i + 3) * 60;
    const h = new THREE.Mesh(new THREE.ConeGeometry(8 + hash(i + 5) * 10, 6 + hash(i + 9) * 8, 6), heapMat);
    h.position.set(Math.cos(a) * r, -108, Math.sin(a) * r);
    group.add(h);
  }
  return group;
}

/** Rock faces under every edge of the floor, down into the dark. */
function cliffGeometry(cells) {
  const pos = [];
  const depth = -9;
  const alive = (i, j) => i >= 0 && j >= 0 && i < A.N && j < A.N && cells[j * A.N + i] === 1;
  for (let j = 0; j < A.N; j++) for (let i = 0; i < A.N; i++) {
    if (!alive(i, j)) continue;
    const x0 = -A.HALF + i * A.CELL, z0 = -A.HALF + j * A.CELL, x1 = x0 + A.CELL, z1 = z0 + A.CELL;
    const edge = (ax, az, bx, bz) => {
      const ya = A.heightAt(ax, az), yb = A.heightAt(bx, bz);
      pos.push(ax, ya, az, bx, yb, bz, ax, depth, az, bx, yb, bz, bx, depth, bz, ax, depth, az);
    };
    if (!alive(i, j - 1)) edge(x0, z0, x1, z0);
    if (!alive(i, j + 1)) edge(x1, z1, x0, z1);
    if (!alive(i - 1, j)) edge(x0, z1, x0, z0);
    if (!alive(i + 1, j)) edge(x1, z0, x1, z1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Rust and grime, painted into a panel's vertex colours. */
function weather(g, offset, seed, amount) {
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offset[0], y = pos.getY(i) + offset[1], z = pos.getZ(i) + offset[2];
    const n = hash(Math.floor(x * 2.2) * 13 + Math.floor(y * 2.2) * 7 + Math.floor(z * 2.2) * 29 + seed);
    let r = 1, gg = 1, b = 1;
    if (n > 1 - amount * 0.35) { r = 0.62; gg = 0.4; b = 0.26; }            // rust
    else if (n < amount * 0.3) { r = gg = b = 0.72; }                         // grime
    if (y < -0.1) { const k = Math.min(0.35, -y * 0.5); r -= k * 0.3; gg -= k * 0.4; b -= k * 0.5; }   // mud low down
    col.set([r, gg, b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function roofMaterials(paint, n) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#F2EEE4';
  x.beginPath(); x.arc(64, 64, 46, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#1B1A18';
  x.font = '900 64px "Public Sans", system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(n), 64, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const top = paint.clone();
  top.map = tex;
  return [paint, paint, top, paint, paint, paint];
}

function nameTag(name, colour) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const x = cv.getContext('2d');
  x.font = '800 30px "Public Sans", system-ui, sans-serif';
  const w = Math.min(240, x.measureText(name).width + 34);
  x.fillStyle = 'rgba(20,18,15,0.72)';
  x.beginPath(); x.roundRect((256 - w) / 2, 10, w, 44, 8); x.fill();
  x.fillStyle = colour;
  x.fillRect((256 - w) / 2 + 10, 25, 12, 14);
  x.fillStyle = '#F2EDE1';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(name, 128 + 9, 33);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.14, 0.035, 1);
  s.renderOrder = 5;
  return s;
}

function stripeTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = '#E5B72C'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#1D1B18';
  for (let i = -128; i < 256; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 16, 0); x.lineTo(i + 16 + 128, 128); x.lineTo(i + 128, 128); x.fill(); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

function corrugatedTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 16;
  const x = cv.getContext('2d');
  for (let i = 0; i < 256; i++) {
    const v = 200 + Math.sin(i / 256 * Math.PI * 2 * 24) * 40;
    x.fillStyle = `rgb(${v},${v},${v})`;
    x.fillRect(i, 0, 1, 16);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A pool of round, fading particles with their own sizes and colours. */
function particles(max, blending) {
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 4), size = new Float32Array(max);
  const vel = new Float32Array(max * 3), life = new Float32Array(max), total = new Float32Array(max), grow = new Float32Array(max), grav = new Float32Array(max), base = new Float32Array(max * 4), size0 = new Float32Array(max);
  let n = 0;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending,
    uniforms: { scale: { value: 500 } },
    vertexShader: `attribute float size; attribute vec4 color; varying vec4 vc; uniform float scale;
      void main(){ vc = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec4 vc; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; gl_FragColor = vec4(vc.rgb, vc.a * smoothstep(0.5, 0.1, d)); }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  return {
    points,
    setScale(s) { mat.uniforms.scale.value = s; },
    emit(p, v, s, c, l, growth = 1, gravity = 0) {
      if (n >= max) return;
      const i = n++;
      pos.set([p.x, p.y, p.z], i * 3); vel.set([v.x, v.y, v.z], i * 3);
      base.set(c, i * 4); size0[i] = s; life[i] = total[i] = l; grow[i] = growth; grav[i] = gravity;
    },
    step(dt) {
      for (let i = 0; i < n; i++) {
        life[i] -= dt;
        if (life[i] <= 0) {
          // Move the last particle into this slot.
          const j = --n;
          if (i !== j) {
            pos.copyWithin(i * 3, j * 3, j * 3 + 3); vel.copyWithin(i * 3, j * 3, j * 3 + 3);
            base.copyWithin(i * 4, j * 4, j * 4 + 4);
            size0[i] = size0[j]; life[i] = life[j]; total[i] = total[j]; grow[i] = grow[j]; grav[i] = grav[j];
            i--;
          }
          continue;
        }
        vel[i * 3 + 1] -= grav[i] * GRAV * dt;
        const drag = Math.exp(-dt * 1.2);
        vel[i * 3] *= drag; vel[i * 3 + 2] *= drag;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        const k = 1 - life[i] / total[i];
        size[i] = size0[i] * (1 + grow[i] * k);
        col[i * 4] = base[i * 4]; col[i * 4 + 1] = base[i * 4 + 1]; col[i * 4 + 2] = base[i * 4 + 2];
        col[i * 4 + 3] = base[i * 4 + 3] * (1 - k) * Math.min(1, k * 12 + 0.2);
      }
      g.setDrawRange(0, n);
      g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.size.needsUpdate = true;
    },
  };
}
