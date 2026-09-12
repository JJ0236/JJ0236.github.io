// crease/foldview.js — Three.js view of the folding simulation.
//
// Loaded on demand the first time the Fold view opens, so the pattern view
// never pays for three.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildFoldModel, FoldSim, miuraKinematics, FOLD_LIMITS } from './fold.js';

const COLORS = { mountain: 0x4a86e8, valley: 0x4a86e8, boundary: 0xd23b3b };

export class FoldView {
  constructor(container, onStatus) {
    this.container = container;
    this.onStatus = onStatus || (() => {});
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x171b22);
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50);
    this.camera.position.set(0.9, -1.5, 1.4);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    this.scene.add(new THREE.HemisphereLight(0xdfe6f2, 0x1a1e26, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(1.2, -1.6, 2.4); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xb9c8e8, 0.5); fill.position.set(-1.5, 1.2, -1.0); this.scene.add(fill);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.sim = null;
    this.playing = false;
    this.playDir = 1;
    this.highlight = null;
    this.visible = false;
    this.fold = 0;
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    new ResizeObserver(this.resize).observe(container);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Build the sim for a pattern. id picks kinematics and the fold ceiling.
  setModel(id, pattern, params) {
    this.clear();
    const model = buildFoldModel(pattern);
    if (!model.ok) { this.sim = null; this.onStatus({ ok: false, reason: model.reason }); return false; }
    const opts = { maxAngle: FOLD_LIMITS[id] ?? 120 };
    if (id === 'miura') opts.goal = miuraKinematics(params.angle);
    this.sim = new FoldSim(model, opts);
    this.buildMeshes(model);
    this.setFold(this.fold);
    this.onStatus({ ok: true, faces: model.faces.length, creases: model.hinges.filter(h => h.type !== 'F').length, maxAngle: opts.maxAngle });
    return true;
  }

  clear() {
    for (const obj of this.group.children.slice()) {
      this.group.remove(obj);
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose()); else obj.material?.dispose();
    }
  }

  buildMeshes(model) {
    const n = model.verts.length;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    geo.setAttribute('position', this.posAttr);
    geo.setIndex(model.tris.flat());
    const front = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.92, metalness: 0, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const back = new THREE.MeshStandardMaterial({ color: 0xcfc8ba, roughness: 0.95, metalness: 0, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.mesh = new THREE.Mesh(geo, front);
    this.meshBack = new THREE.Mesh(geo, back);
    this.group.add(this.mesh, this.meshBack);

    // One line segment per graph edge, coloured by type; positions follow the sim.
    this.lineEdges = model.edges;
    const lgeo = new THREE.BufferGeometry();
    this.linePos = new THREE.BufferAttribute(new Float32Array(model.edges.length * 6), 3);
    this.lineCol = new THREE.BufferAttribute(new Float32Array(model.edges.length * 6), 3);
    lgeo.setAttribute('position', this.linePos);
    lgeo.setAttribute('color', this.lineCol);
    this.lines = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
    this.group.add(this.lines);
    this.paintLines();
  }

  paintLines() {
    const c = new THREE.Color();
    this.lineEdges.forEach((e, i) => {
      const type = e.type === 'M' ? 'mountain' : e.type === 'V' ? 'valley' : 'boundary';
      c.setHex(COLORS[type]);
      const dim = this.highlight && type !== 'boundary' && type !== this.highlight;
      if (dim) c.multiplyScalar(0.25);
      for (let k = 0; k < 2; k++) this.lineCol.setXYZ(2 * i + k, c.r, c.g, c.b);
    });
    this.lineCol.needsUpdate = true;
  }

  setHighlight(layer) { this.highlight = layer; if (this.lineEdges) this.paintLines(); }

  setFold(pct) {
    this.fold = Math.max(0, Math.min(100, pct));
    if (this.sim) this.sim.setFold(this.fold);
  }

  play() { this.playing = true; this.playDir = this.fold >= 99.5 ? -1 : 1; }
  pause() { this.playing = false; }

  show() { this.visible = true; this.resize(); requestAnimationFrame(this.frame); }
  hide() { this.visible = false; this.playing = false; }

  frame() {
    if (!this.visible) return;
    if (this.playing) {
      this.fold += this.playDir * 0.45;
      if (this.fold >= 100 || this.fold <= 0) { this.fold = Math.max(0, Math.min(100, this.fold)); this.playing = false; }
      this.sim?.setFold(this.fold);
      this.onFold?.(this.fold);
    }
    if (this.sim) {
      // Spend up to ~7 ms of the frame on physics.
      const t0 = performance.now();
      let steps = 0;
      while (performance.now() - t0 < 7 && steps < 600) { this.sim.step(10); steps += 10; }
      this.syncGeometry();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  }

  syncGeometry() {
    const P = this.sim.P;
    this.posAttr.array.set(P);
    this.posAttr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
    const L = this.linePos.array;
    this.lineEdges.forEach((e, i) => {
      L[6 * i] = P[3 * e.a]; L[6 * i + 1] = P[3 * e.a + 1]; L[6 * i + 2] = P[3 * e.a + 2];
      L[6 * i + 3] = P[3 * e.b]; L[6 * i + 4] = P[3 * e.b + 1]; L[6 * i + 5] = P[3 * e.b + 2];
    });
    this.linePos.needsUpdate = true;
  }

  resetCamera() {
    this.camera.position.set(0.9, -1.5, 1.4);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
}
