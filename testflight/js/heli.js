/* ============================================================
   OZARK TOURS — AS350 / A-Star scroll fly-through
   --------------------------------------------------------------
   A scroll-driven Three.js showcase pinned to the bottom of the
   page. The camera flies around the helicopter as you scroll the
   #aircraft section, and captions swap per step.

   The real AS350 glTF (models/as350.glb) is lazy-loaded into the
   scene the first time the section nears the viewport. The camera
   rig, scroll logic, and captions are independent of the model.

   Degrades gracefully: if WebGL is unavailable the section still
   shows its heading + first caption over the CSS gradient.
   ============================================================ */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

(function () {
  'use strict';

  const section = document.getElementById('aircraft');
  const canvas  = document.getElementById('heliCanvas');
  if (!section || !canvas) return;

  const reduceMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Caption content, one per scroll step ---- */
  const STEPS = [
    {
      tag:   'Airbus H125 · AS350 “A-Star”',
      title: 'The mountain workhorse.',
      body:  'The single-engine helicopter trusted for high-altitude rescue and film work the world over — and your ride above the Ozarks.',
    },
    {
      tag:   'Built for the view',
      title: 'Glass on every side.',
      body:  'Wide panoramic windows and a whisper-smooth ride mean the scenery is the whole point — not something you crane your neck to catch.',
    },
    {
      tag:   'Land where roads can’t',
      title: 'Power to reach it.',
      body:  'Enough lift to set down on a ridge, a sandbar, or a private lawn — the places that make each experience yours alone.',
    },
    {
      tag:   'Safety, always first',
      title: 'FAA Part 135 operations.',
      body:  'Meticulously maintained, inspected daily, and flown only by seasoned pilots with thousands of hours in mountain air.',
    },
  ];

  const capEl   = document.getElementById('heliCaption');
  const capTag  = document.getElementById('heliCapTag');
  const capTtl  = document.getElementById('heliCapTitle');
  const capBody = document.getElementById('heliCapBody');
  const progEl  = document.getElementById('heliProgress');

  let activeStep = -1;
  function setStep(i) {
    if (i === activeStep) return;
    activeStep = i;
    const s = STEPS[i];
    if (!s || !capEl) return;
    capEl.classList.remove('is-visible');
    // brief out-then-in so the swap reads as intentional
    window.requestAnimationFrame(() => {
      capTag.textContent  = s.tag;
      capTtl.textContent  = s.title;
      capBody.textContent = s.body;
      capEl.classList.add('is-visible');
    });
  }
  setStep(0);

  /* ---- Three.js scene ---- */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) {
    // No WebGL — captions over the gradient is a fine fallback.
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  // Moody gradient sky so the orbit reads as flight and the cockpit-out view
  // actually has a view (instead of a black void).
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 2; skyCanvas.height = 256;
  const sctx = skyCanvas.getContext('2d');
  const sgrad = sctx.createLinearGradient(0, 0, 0, 256);
  sgrad.addColorStop(0.0, '#16263a');   // deep blue zenith
  sgrad.addColorStop(0.55, '#27384a');
  sgrad.addColorStop(0.82, '#5c6f63');  // hazy ridge horizon
  sgrad.addColorStop(1.0, '#34432f');   // forest below
  sctx.fillStyle = sgrad; sctx.fillRect(0, 0, 2, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(0x47564a, 16, 62);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.set(9, 4, 11);

  // Soft image-based lighting for believable reflections on the body.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // Direct lights for shape + warm Ozark rim.
  scene.add(new THREE.HemisphereLight(0x9fb8d6, 0x141009, 0.55));

  const key = new THREE.DirectionalLight(0xfff1d8, 2.3);
  key.position.set(6, 10, 6);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xe8a84e, 1.5);
  rim.position.set(-7, 3, -9);
  scene.add(rim);

  const fill = new THREE.DirectionalLight(0x88aacc, 0.5);
  fill.position.set(-8, 2, 5);
  scene.add(fill);

  // Warm cabin light so the cockpit interior (panel + seats) reads from inside.
  const cabinLight = new THREE.PointLight(0xfff0d8, 9, 9, 2);
  cabinLight.position.set(0, 0.8, 1.2);
  scene.add(cabinLight);

  /* ---- Helicopter group ----
     The real AS350 glTF is loaded into this group (loadHeliModel, below).
     There is no procedural placeholder anymore, so nothing flickers in
     before the model is ready. ---- */
  const heli = new THREE.Group();
  heli.position.y = 0.3;
  scene.add(heli);

  /* ---- Real model: AS350 glTF (converted from the X-Plane addon).
     Auto-centered + auto-scaled. Orientation tweaks below if it's off. ---- */
  const MODEL_URL    = 'models/as350.glb';
  const MODEL_TARGET = 6.4;          // longest dimension, world units
  const MODEL_YAW    = Math.PI;      // ↺ tweak these three (radians) if the
  const MODEL_PITCH  = 0;            //   aircraft sits at the wrong angle
  const MODEL_ROLL   = 0;
  const ROTOR_DROP   = 0.18;         // world units to lower the rotor-FX disc (it floated above the mast)
  const spinners = [];               // rotor/blade meshes to spin, if named
  let modelLoadStarted = false;

  /* A spinning rotor reads far better as a faint motion-blur disc + a few
     ghosted blade streaks than as thin flat blades (which flicker/vanish
     edge-on). Built in model-local units; spun via the spinners list. */
  function buildRotorFX(radius) {
    const g = new THREE.Group();
    const discMat = (op) => new THREE.MeshBasicMaterial({
      color: 0xcdd6dc, transparent: true, opacity: op,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), discMat(0.13));
    disc.rotation.x = -Math.PI / 2;
    g.add(disc);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.5, 48), discMat(0.10));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.002;
    g.add(inner);
    const bladeGeo = new THREE.BoxGeometry(radius * 2, radius * 0.01 + 0.004, radius * 0.055);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(bladeGeo, new THREE.MeshBasicMaterial({
        color: 0x1c2226, transparent: true, opacity: 0.32, depthWrite: false,
      }));
      b.rotation.y = (i * Math.PI * 2) / 3;
      g.add(b);
    }
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.05, radius * 0.06, radius * 0.05, 16),
      new THREE.MeshStandardMaterial({ color: 0x15191c, metalness: 0.6, roughness: 0.4 })
    );
    g.add(hub);
    return g;
  }

  function loadHeliModel() {
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load(
      MODEL_URL,
      (gltf) => {
        const model = gltf.scene;
        model.rotation.set(MODEL_PITCH, MODEL_YAW, MODEL_ROLL);
        const box  = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3(); box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        model.scale.setScalar(MODEL_TARGET / maxDim);
        // Recenter AFTER scale+rotate so the pivot lands at the origin.
        const box2 = new THREE.Box3().setFromObject(model);
        const c2 = new THREE.Vector3(); box2.getCenter(c2);
        model.position.sub(c2);
        model.traverse((o) => {
          if (!o.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            if (!m) return;
            m.side = THREE.DoubleSide;                  // X-Plane winding is unreliable
            if (/glass/i.test(m.name || o.name || '')) {
              m.transparent = true;
              if (m.opacity === 1) m.opacity = 0.35;    // see-through canopy
            }
          });
        });
        heli.add(model);

        // Swap the model's thin flat blades for a motion-blur rotor disc.
        model.updateWorldMatrix(true, true);
        const rotorNode = model.getObjectByName('main_rotor');
        if (rotorNode) {
          const wb = new THREE.Box3().setFromObject(rotorNode);
          const ws = new THREE.Vector3(); wb.getSize(ws);
          const sc = model.scale.x || 1;
          const radius = (Math.max(ws.x, ws.z) * 0.5 / sc) * 0.98;
          // Center the disc on the actual HUB (centroid of the top-most rotor
          // verts) — the blade bounding-box center is lopsided because the 3
          // rest blades sit at 120°, which pulled the disc off to one side.
          let hubMesh = null;
          rotorNode.traverse((o) => { if (!hubMesh && o.isMesh) hubMesh = o; });
          const hub = new THREE.Vector3();
          if (hubMesh && hubMesh.geometry.attributes.position) {
            const pos = hubMesh.geometry.attributes.position;
            let mn = Infinity, mx = -Infinity, sumY = 0;
            for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < mn) mn = y; if (y > mx) mx = y; sumY += y; }
            const cut = mx - (mx - mn) * 0.10;        // top verts → mast axis (centers X,Z)
            let sx = 0, sz = 0, n = 0;
            for (let i = 0; i < pos.count; i++) {
              if (pos.getY(i) >= cut) { sx += pos.getX(i); sz += pos.getZ(i); n++; }
            }
            // Y at the BLADE PLANE (avg of all verts), not the mast cap, so the
            // disc sits down on the rotor head instead of floating high above.
            hub.set(sx / n, sumY / pos.count, sz / n);
            hubMesh.localToWorld(hub);
          } else {
            wb.getCenter(hub);
          }
          hub.y -= ROTOR_DROP;                          // drop it down onto the mast (was floating in the sky)
          rotorNode.visible = false;
          const fx = buildRotorFX(radius);
          fx.position.copy(model.worldToLocal(hub));
          model.add(fx);
          spinners.length = 0;
          spinners.push(fx);
        }
      },
      undefined,
      (err) => { console.warn('[heli] model load failed', err); }
    );
  }

  /* ---- Drifting clouds for scale + motion ---- */
  const clouds = new THREE.Group();
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xe6edf2, transparent: true, opacity: 0.20, depthWrite: false,
  });
  for (let i = 0; i < 12; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), cloudMat);
    puff.scale.set(4 + Math.random() * 6, 0.8, 3 + Math.random() * 4);
    puff.position.set(
      (Math.random() - 0.5) * 48,
      -2.5 - Math.random() * 5,
      (Math.random() - 0.5) * 48
    );
    puff.userData.speed = 0.2 + Math.random() * 0.4;
    clouds.add(puff);
  }
  scene.add(clouds);

  /* ---- Scroll-driven camera keyframes ---- */
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const camPos = new THREE.Vector3();
  const camTgt = new THREE.Vector3();
  // Damped followers so the camera glides (organic feel).
  const camSmooth    = new THREE.Vector3(0, 1.8, 10);
  const camTgtSmooth = new THREE.Vector3(0, 0.45, 0);
  const lerp = (a, b, f) => a + (b - a) * f;
  const smooth = (t) => t * t * (3 - 2 * t);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();

  // Full 360° orbit → slide in low through the windshield → DWELL inside
  // looking out the cockpit → pull back to a hero shot. Nose is −Z, so the
  // orbit starts/ends at the front for a clean dive-in.
  const INSIDE = new THREE.Vector3(0, 0.32, 1.9);    // seated in the cabin, behind the panel (cockpit is +Z)
  function sampleCamera(p) {
    p = Math.min(Math.max(p, 0), 1);
    if (p < 0.55) {                                  // 360° exterior orbit
      const op = p / 0.55;
      const az = op * Math.PI * 2;                   // start & end at the FRONT (+Z)
      const r  = lerp(10, 7, smooth(Math.min(op * 1.2, 1)));
      const y  = 1.8 + Math.sin(op * Math.PI * 2) * 1.5;
      camPos.set(Math.sin(az) * r, y, Math.cos(az) * r);
      camTgt.set(0, 0.45, 0);
    } else if (p < 0.66) {                           // move into the cockpit
      const e = smooth((p - 0.55) / 0.11);
      _a.set(0, 1.8, 7);                             // orbit end (front)
      camPos.lerpVectors(_a, INSIDE, e);
      camTgt.set(0, lerp(0.45, 0.42, e), lerp(2, 9, e));
    } else if (p < 0.86) {                           // DWELL: cockpit interior — controls, windows, view out
      camPos.copy(INSIDE);
      camTgt.set(0, 0.50, 9);                        // ~level: windshield + side windows up top, panel below
    } else {                                         // pull back to hero 3/4
      const e = smooth((p - 0.86) / 0.14);
      _b.set(5.5, 2.0, 7.2);
      camPos.lerpVectors(INSIDE, _b, e);
      camTgt.set(0, lerp(0.42, 0.5, e), lerp(9, 0, e));
    }
  }

  /* ---- Scroll progress through the pinned section ---- */
  let progress = 0;
  function computeProgress() {
    const rect  = section.getBoundingClientRect();
    const total = section.offsetHeight - window.innerHeight;
    const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
    progress = total > 0 ? scrolled / total : 0;
    if (progEl) progEl.style.width = (progress * 100).toFixed(1) + '%';
    setStep(Math.min(Math.floor(progress * STEPS.length), STEPS.length - 1));
  }

  /* ---- Sizing ---- */
  function resize() {
    const w = section.clientWidth;
    const h = section.querySelector('.aircraft__viz').clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();
  computeProgress();

  /* ---- Render loop, gated to when the section is on screen ---- */
  const clock = new THREE.Clock();
  let inView = false; // toggled by the IntersectionObserver below

  function renderFrame() {
    const dt = clock.getDelta();
    const t  = clock.getElapsedTime();

    // Spin the model's rotor-FX disc (built in loadHeliModel)
    for (let i = 0; i < spinners.length; i++) spinners[i].rotation.y += dt * 24;

    // Idle sway — but settle to STILL during the cockpit phase so you can
    // sit inside steadily (full life again on the exterior hero shot).
    const sway = Math.min(
      (1 - THREE.MathUtils.smoothstep(progress, 0.50, 0.60)) +
      THREE.MathUtils.smoothstep(progress, 0.86, 0.93), 1);
    heli.position.y = 0.3 + Math.sin(t * 0.8) * 0.07 * sway;
    heli.rotation.y = Math.sin(t * 0.30) * 0.022 * sway;
    heli.rotation.z = Math.sin(t * 0.45) * 0.014 * sway;
    heli.rotation.x = Math.sin(t * 0.62) * 0.008 * sway;

    // Drift clouds
    clouds.children.forEach((c) => {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 22) c.position.x = -22;
    });

    // Camera: scroll keyframes + layered handheld drift, then damped toward
    // the target so it glides instead of snapping — feels alive, not stiff.
    sampleCamera(progress);
    const cd = sway;   // dead still inside the cockpit, gentle life on the exterior
    camPos.x += (Math.sin(t * 0.40) * 0.09 + Math.sin(t * 0.93) * 0.035) * cd;
    camPos.y += (Math.cos(t * 0.33) * 0.06 + Math.sin(t * 1.10) * 0.025) * cd;
    camSmooth.lerp(camPos, 0.10);
    camTgtSmooth.lerp(camTgt, 0.12);
    camera.position.copy(camSmooth);
    camera.lookAt(camTgtSmooth);

    renderer.render(scene, camera);
  }

  function loop() {
    if (inView) renderFrame();
    rafId = window.requestAnimationFrame(loop);
  }

  let rafId = null;

  // Only burn frames while the section is on screen — and lazy-load the
  // (heavy) model the first time we get close, so it doesn't block page load.
  const vis = new IntersectionObserver(
    (entries) => {
      inView = entries[0].isIntersecting;
      if (inView && !modelLoadStarted) { modelLoadStarted = true; loadHeliModel(); }
    },
    { threshold: 0, rootMargin: '700px 0px' }
  );
  vis.observe(section);

  let scrollRaf = null;
  window.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = window.requestAnimationFrame(() => {
      computeProgress();
      scrollRaf = null;
    });
  }, { passive: true });

  if (reduceMotion) {
    // One representative static frame, no animation loop.
    progress = 0.85;
    sampleCamera(progress);
    camera.position.copy(camPos);
    camera.lookAt(camTgt);
    renderer.render(scene, camera);
    setStep(STEPS.length - 1);
  } else {
    loop();
  }
})();
