// cloche/brainview.js — the brain window: every neuron as a point, lit when
// it spikes, coloured by class, slowly turning.
import * as THREE from 'three';
import { positionsNm, CLASS_NAMES } from './data.js';

const CLASS_COLOURS = {
  optic: '#2B3446', central: '#3E5478', sensory: '#4E7C58', visual_projection: '#33507A',
  descending: '#B98C3E', ascending: '#6F5C8E', motor: '#C85A4C', endocrine: '#8C6C4C', other: '#2B3446',
};
const SEL_COLOUR = new THREE.Color('#8FB0E8');
const GLOW_TAU = 150;   // ms

export function createBrainView(canvas, data, groups) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);

  // nm → scene units (1 unit = 10 µm), FlyWire y points ventral and z posterior
  const nm = positionsNm(data);
  const n = data.n;
  const pos = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { pos[3 * i] = nm[3 * i] / 1e4; pos[3 * i + 1] = -nm[3 * i + 1] / 1e4; pos[3 * i + 2] = -nm[3 * i + 2] / 1e4; }
  const col = new Float32Array(3 * n);
  const palette = CLASS_NAMES.map(c => new THREE.Color(CLASS_COLOURS[c] || CLASS_COLOURS.other));
  for (let i = 0; i < n; i++) { const c = palette[data.cls[i]]; col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b; }
  const glow = new Float32Array(n);
  const sel = new Float32Array(n);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const glowAttr = new THREE.BufferAttribute(glow, 1); glowAttr.setUsage(THREE.DynamicDrawUsage);
  const selAttr = new THREE.BufferAttribute(sel, 1);
  geo.setAttribute('glow', glowAttr);
  geo.setAttribute('sel', selAttr);
  geo.computeBoundingSphere();
  const radius = geo.boundingSphere.radius;

  const mat = new THREE.ShaderMaterial({
    uniforms: { uPr: { value: renderer.getPixelRatio() }, uSel: { value: SEL_COLOUR } },
    vertexShader: `
      attribute float glow; attribute float sel; attribute vec3 color;
      uniform float uPr; uniform vec3 uSel;
      varying vec3 vC; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.25 + glow * 3.5 + sel * 2.2) * uPr;
        vC = mix(color, vec3(1.0), glow * 0.9);
        vC = mix(vC, uSel, sel * (1.0 - glow) * 0.85);
        vA = 0.28 + glow * 0.72 + sel * 0.5;
      }`,
    fragmentShader: `
      varying vec3 vC; varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        if (dot(c, c) > 0.25) discard;
        gl_FragColor = vec4(vC * vA, vA);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  let spin = 0, dragging = false, lastX = 0, lastY = 0, tilt = 0.15, userSpin = 0, idle = 0;
  const onDown = e => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); };
  const onMove = e => {
    if (!dragging) return;
    userSpin += (e.clientX - lastX) * 0.008; tilt = Math.max(-1.2, Math.min(1.2, tilt + (e.clientY - lastY) * 0.006));
    lastX = e.clientX; lastY = e.clientY; idle = 0;
  };
  const onUp = () => { dragging = false; };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  let pending = null;   // spikes not yet lit
  function onSpikes(spikes) {
    if (!spikes.length) return;
    for (let k = 0; k < spikes.length; k++) glow[spikes[k]] = 1;
    pending = true;
  }
  function highlight(name) {
    sel.fill(0);
    if (name && groups[name]) for (const i of groups[name]) sel[i] = 1;
    selAttr.needsUpdate = true;
  }
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    mat.uniforms.uPr.value = renderer.getPixelRatio();
    fit();
  }
  function fit() {
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05 / Math.min(1, camera.aspect);
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
  }
  let last = performance.now();
  function render(now = performance.now()) {
    const dt = Math.min(100, now - last); last = now;
    const k = Math.exp(-dt / GLOW_TAU);
    let any = false;
    for (let i = 0; i < n; i++) { const g = glow[i]; if (g > 0.003) { glow[i] = g * k; any = true; } else if (g) glow[i] = 0; }
    if (any || pending) { glowAttr.needsUpdate = true; pending = false; }
    if (!dragging) idle += dt;
    spin += dt * 0.00012;
    points.rotation.set(tilt, spin + userSpin, 0);
    renderer.render(scene, camera);
  }
  resize();
  return { onSpikes, highlight, resize, render, points };
}
