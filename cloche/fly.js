// cloche/fly.js — a procedural low-poly fruit fly with named pivots, a pose
// driven by firing rates, and a small staged locomotion controller.
// Forward is +z in the fly's local frame. Units are millimetres.
import * as THREE from 'three';
import { WALK_R } from './scene.js';

export const FLY_SCALE = 2.8;   // a real fly is 3 mm; the specimen is shown larger

const SLATE = '#3E4A5A', DARK = '#2B333F', EYE = '#A43A2E', LEG = '#4B5566';
const GAIT_HZ = 8;

function stripeTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = SLATE; g.fillRect(0, 0, 16, 128);
  g.fillStyle = DARK;
  for (let y = 30; y < 118; y += 18) g.fillRect(0, y, 16, 7);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function wingTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 160;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 160);
  g.fillStyle = '#B9C6D8'; g.fillRect(0, 0, 64, 160);
  g.strokeStyle = 'rgba(40,50,64,0.7)'; g.lineWidth = 2;
  for (const x of [12, 24, 38, 52]) { g.beginPath(); g.moveTo(32, 0); g.lineTo(x, 158); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createFly() {
  const group = new THREE.Group();
  group.scale.setScalar(FLY_SCALE);
  const body = new THREE.Group();          // pitches on a jump
  group.add(body);
  const mat = new THREE.MeshStandardMaterial({ color: SLATE, roughness: 0.55, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.6, flatShading: true });
  const legMat = new THREE.MeshStandardMaterial({ color: LEG, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: EYE, roughness: 0.35, flatShading: true });
  const abdoMat = new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.55, flatShading: true });
  // opaque: transparent objects do not show through the glass dome
  const wingMat = new THREE.MeshStandardMaterial({ map: wingTexture(), side: THREE.DoubleSide, roughness: 0.25, metalness: 0.05 });
  const mesh = (geo, m) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; o.receiveShadow = false; return o; };

  const thorax = mesh(new THREE.IcosahedronGeometry(0.78, 1), mat);
  thorax.scale.set(1.0, 0.85, 1.15); thorax.position.set(0, 0.95, 0.25); body.add(thorax);
  const abdoGeo = new THREE.SphereGeometry(0.7, 12, 8); abdoGeo.rotateX(Math.PI / 2);
  const abdomen = mesh(abdoGeo, abdoMat);
  abdomen.scale.set(0.95, 0.75, 1.7); abdomen.position.set(0, 0.85, -1.35); body.add(abdomen);
  const head = new THREE.Group(); head.position.set(0, 1.0, 1.25); body.add(head);
  head.add(mesh(new THREE.IcosahedronGeometry(0.52, 1), mat));
  for (const s of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.32, 10, 8), eyeMat);
    eye.position.set(s * 0.36, 0.05, 0.22); head.add(eye);
    const ant = new THREE.Group(); ant.position.set(s * 0.16, 0.22, 0.42); ant.rotation.x = -0.6; head.add(ant);
    const seg = mesh(new THREE.ConeGeometry(0.06, 0.55, 6), dark); seg.position.y = 0.27; ant.add(seg);
    const arista = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4), dark); arista.position.set(s * 0.15, 0.5, 0); arista.rotation.z = s * 0.7; ant.add(arista);
    ant.name = s < 0 ? 'antL' : 'antR';
  }
  // proboscis: rostrum pivot under the head, labella at its tip
  const rostrum = new THREE.Group(); rostrum.position.set(0, -0.3, 0.3); head.add(rostrum);
  const rSeg = mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.62, 8), dark); rSeg.position.y = -0.31; rostrum.add(rSeg);
  const labella = new THREE.Group(); labella.position.y = -0.62; rostrum.add(labella);
  const labL = mesh(new THREE.SphereGeometry(0.15, 8, 6), mat); labL.scale.set(1, 0.6, 1.3); labL.position.x = -0.1; labella.add(labL);
  const labR = labL.clone(); labR.position.x = 0.1; labella.add(labR);
  rostrum.rotation.x = 1.25;   // tucked

  // legs: hip on thorax, femur out and down, knee, tibia + tarsus down to the ground
  const legs = [];
  const legZ = [0.85, 0.25, -0.35];
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.55, 0.6, legZ[i]); body.add(hip);
    const femurLen = 0.95, tibLen = 1.25;
    const femur = mesh(new THREE.CylinderGeometry(0.06, 0.08, femurLen, 6), legMat); femur.position.y = -femurLen / 2; femur.castShadow = true;
    const fPiv = new THREE.Group(); fPiv.rotation.z = s * 1.15; hip.add(fPiv); fPiv.add(femur);
    const knee = new THREE.Group(); knee.position.y = -femurLen; fPiv.add(knee);
    const tib = mesh(new THREE.CylinderGeometry(0.045, 0.03, tibLen, 6), legMat); tib.position.y = -tibLen / 2; knee.add(tib);
    knee.rotation.z = -s * 1.55;
    const baseSwing = (i - 1) * 0.35;   // splay front legs forward, hind legs back
    hip.rotation.y = -s * baseSwing;
    legs.push({ hip, fPiv, knee, side: s, index: i, baseSwing, restZ: -s * 1.55 });
  }

  // wings
  const wings = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(s * 0.28, 1.5, 0.05); body.add(piv);
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 2.5), wingMat);
    w.position.set(s * 0.15, 0, -1.2); w.rotation.x = -Math.PI / 2; w.castShadow = true;
    piv.add(w); piv.rotation.y = s * 0.28; piv.rotation.z = s * 0.06;
    wings.push({ piv, side: s });
  }

  // ---- state ----
  const rates = { MN9: 0, MN6: 0, GF: 0, groom: 0, DNa01: 0, DNa02: 0, DN_L: 0, DN_R: 0, DNa02_L: 0, DNa02_R: 0 };
  const sm = { MN9: 0, MN6: 0, groom: 0, DN: 0, DN_L: 0, DN_R: 0, turn: 0 };
  let wanderNoise = 0, noiseT = 0;
  let mode = 'idle', hunger = 0.6;
  let heading = Math.random() * Math.PI * 2, x = 6, z = -4;
  let phase = 0, walking = 0;
  let idleTimer = 1.2, idleWalking = false;
  let jump = null, jumpCooldown = 0;
  let feedingOn = null, leaveTimer = 0, rejectTimer = 0;
  let groomT = 0;
  let flight = null;   // { t, dur, path }
  function takeOff() {
    if (flight || jump) return;
    const pts = [{ x, z, y: 0 }];
    let hx = x, hz = z;
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * (WALK_R - 6);
      hx = Math.cos(a) * r; hz = Math.sin(a) * r;
      pts.push({ x: hx, z: hz, y: 14 + Math.random() * 22 });
    }
    let lx = hx, lz = hz; const rr = Math.hypot(lx, lz); if (rr > WALK_R - 3) { lx *= (WALK_R - 3) / rr; lz *= (WALK_R - 3) / rr; }
    pts.push({ x: lx, z: lz, y: 0 });
    flight = { t: 0, dur: 2600 + Math.random() * 1800, pts };
    if (feedingOn) leaveDroplet();
    mode = 'flying';
  }
  function catmull(pts, u) {
    const n = pts.length - 1; const s = u * n; const i = Math.min(n - 1, Math.floor(s)); const f = s - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
    const c = k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f * f * f);
    return { x: c('x'), y: c('y'), z: c('z') };
  }
  const parts = { rostrum, labella, labL, labR, legs, wings, head, body };

  function setRates(r) { Object.assign(rates, r); }
  function gfSpike() {
    if (jump || jumpCooldown > 0) return;
    const a = heading + (Math.random() - 0.5) * 2.2;
    const dist = 10 + Math.random() * 9;
    let tx = x + Math.sin(a) * dist, tz = z + Math.cos(a) * dist;
    const rr = Math.hypot(tx, tz); if (rr > WALK_R - 2) { tx *= (WALK_R - 2) / rr; tz *= (WALK_R - 2) / rr; }
    jump = { t: 0, dur: 160, x0: x, z0: z, x1: tx, z1: tz, h: 12 };
    jumpCooldown = 700;
    if (feedingOn) leaveDroplet();
    mode = 'jumping';
  }
  let world = null;
  function leaveDroplet() { const d = feedingOn; feedingOn = null; world?.onLeaveDroplet?.(d); }

  function nearestDroplet() {
    let best = null, bd = Infinity;
    for (const d of world.droplets) { if (d.rejected || d.gone) continue; const dd = Math.hypot(d.x - x, d.z - z); if (dd < bd) { bd = dd; best = d; } }
    return best;
  }
  function labellumPoint() {
    const p = new THREE.Vector3(); labella.getWorldPosition(p); return p;
  }

  function update(dtMs, w) {
    world = w;
    const dt = Math.min(0.1, dtMs / 1000);
    const k = 1 - Math.exp(-dtMs / 50);
    sm.MN9 += (rates.MN9 - sm.MN9) * k; sm.MN6 += (rates.MN6 - sm.MN6) * k;
    sm.groom += (rates.groom - sm.groom) * k; sm.DN += ((rates.DNa01 + rates.DNa02) / 2 - sm.DN) * k;
    const kS = 1 - Math.exp(-dtMs / 250);
    sm.DN_L += (rates.DN_L - sm.DN_L) * kS; sm.DN_R += (rates.DN_R - sm.DN_R) * kS;
    // steering asymmetry: DNa02 is the best-known steering pair; the whole descending population backs it up
    const asym = (rates.DNa02_R - rates.DNa02_L) * 0.05 + (rates.DN_R - rates.DN_L) / (rates.DN_R + rates.DN_L + 1.5);
    sm.turn += (Math.max(-1, Math.min(1, asym)) - sm.turn) * kS;
    hunger = Math.min(1, hunger + dt / 240);
    if (jumpCooldown > 0) jumpCooldown -= dtMs;

    // ---- decide ----
    let speed = 0;
    if (flight) {
      flight.t += dtMs;
      const u = Math.min(1, flight.t / flight.dur);
      const p = catmull(flight.pts, u), q = catmull(flight.pts, Math.min(1, u + 0.01));
      const dx = q.x - p.x, dz = q.z - p.z;
      if (Math.hypot(dx, dz) > 1e-4) heading = Math.atan2(dx, dz);
      x = p.x; z = p.z; group.position.y = Math.max(0, p.y);
      body.rotation.x = -0.25 * Math.sin(u * Math.PI);
      const beat = Math.sin(flight.t * 1.1);
      for (const wg of wings) wg.piv.rotation.y = wg.side * (0.35 + 0.75 * beat) ; 
      for (const L of legs) { L.knee.rotation.z += (-L.side * 2.4 - L.knee.rotation.z) * 0.2; }
      if (u >= 1) { flight = null; group.position.y = 0; body.rotation.x = 0; mode = 'idle'; idleTimer = 1.2; idleWalking = false; }
    } else if (jump) {
      jump.t += dtMs;
      const u = Math.min(1, jump.t / jump.dur);
      x = jump.x0 + (jump.x1 - jump.x0) * u; z = jump.z0 + (jump.z1 - jump.z0) * u;
      heading = Math.atan2(jump.x1 - jump.x0, jump.z1 - jump.z0);
      group.position.y = jump.h * 4 * u * (1 - u) * FLY_SCALE / 2.8;
      body.rotation.x = -0.5 * Math.sin(u * Math.PI);
      for (const wg of wings) wg.piv.rotation.y = wg.side * (0.28 + 0.9 * Math.sin(u * Math.PI) + 0.35 * Math.sin(jump.t * 0.9));
      if (u >= 1) { jump = null; group.position.y = 0; body.rotation.x = 0; mode = 'idle'; idleTimer = 0.8; idleWalking = false; }
    } else if (sm.groom > 25 && !feedingOn) {
      mode = 'grooming'; groomT += dt;
    } else if (feedingOn) {
      mode = 'feeding';
      if (!feedingOn.gone) turnToward(Math.atan2(feedingOn.x - x, feedingOn.z - z), dt, 2.0);
      if (feedingOn.gone) { leaveTimer += dtMs; if (leaveTimer > 400) { leaveDroplet(); mode = 'idle'; idleTimer = 1; } }
      else if (feedingOn.bitter && sm.MN9 < 5) { rejectTimer += dtMs; if (rejectTimer > 900) { feedingOn.rejected = true; leaveDroplet(); mode = 'idle'; idleTimer = 0; idleWalking = true; heading += Math.PI * 0.8; } }
      else rejectTimer = 0;
    } else {
      const target = hunger > 0.25 ? nearestDroplet() : null;
      if (target) {
        mode = 'seeking';
        const dx = target.x - x, dz = target.z - z, dist = Math.hypot(dx, dz);
        if (dist < target.radius + 1.5 * FLY_SCALE) {
          feedingOn = target; leaveTimer = 0; rejectTimer = 0; mode = 'feeding';
          w.onReachDroplet?.(target);
        } else {
          turnToward(Math.atan2(dx, dz), dt, 3.2);
          speed = 9 * (0.5 + 0.5 * Math.min(1, sm.DN / 20));
        }
      } else {
        // exploring: the descending population sets the pace and the turn;
        // a learned smell pulls the heading up or down its gradient
        mode = 'idle';
        const drive = (sm.DN_L + sm.DN_R) / 2;                // Hz, mean over the descending neurons
        const brainPace = Math.min(1, drive / 4);
        noiseT -= dt; if (noiseT <= 0) { noiseT = 0.6 + Math.random() * 1.4; wanderNoise = (Math.random() - 0.5) * 1.6; }
        idleTimer -= dt;
        if (idleTimer <= 0) { idleWalking = !idleWalking; idleTimer = idleWalking ? 0.8 + Math.random() * 2.2 + 3 * brainPace : 0.6 + Math.random() * 2.2 * (1 - brainPace); }
        if (idleWalking || brainPace > 0.5) {
          speed = 2.5 + 6 * brainPace;
          heading += (sm.turn * 2.2 + wanderNoise) * dt;
          const r = Math.hypot(x, z);
          if (r > WALK_R - 6) turnToward(Math.atan2(-x, -z), dt, 2.5);
        }
        if (w.smellAt && w.memory) {
          const here = w.smellAt(x, z);
          for (const kind of ['fruit', 'vinegar']) {
            const bias = w.memory[kind] || 0;
            if (Math.abs(bias) < 0.05 || here[kind] < 0.02) continue;
            const gr = w.smellGradient(kind, x, z);
            const gl = Math.hypot(gr.x, gr.z); if (gl < 1e-6) continue;
            const toward = Math.atan2(gr.x, gr.z);
            const want = bias > 0 ? toward : toward + Math.PI;
            turnToward(want, dt, 2.5 * Math.min(1, Math.abs(bias) * 3));
            if (!idleWalking) speed = Math.max(speed, 3);
            mode = bias > 0 ? 'approaching smell' : 'avoiding smell';
          }
        }
      }
    }
    if (mode !== 'grooming') groomT = 0;

    // ---- move ----
    if (speed > 0) {
      x += Math.sin(heading) * speed * dt; z += Math.cos(heading) * speed * dt;
      const r = Math.hypot(x, z); if (r > WALK_R) { x *= WALK_R / r; z *= WALK_R / r; }
      phase += dt * GAIT_HZ * (speed / 9);
      walking = Math.min(1, walking + dt * 8);
    } else walking = Math.max(0, walking - dt * 8);
    group.position.x = x; group.position.z = z;
    group.rotation.y = heading;
    if (flight) return;

    // ---- pose ----
    const ext = Math.min(1, sm.MN9 / 40);
    rostrum.rotation.x += ((1.25 - 1.35 * ext) - rostrum.rotation.x) * k;
    const spread = 0.45 * Math.min(1, sm.MN6 / 40);
    labL.rotation.z += (spread - labL.rotation.z) * k; labR.rotation.z += (-spread - labR.rotation.z) * k;
    if (!jump && !flight) {
      const tw = Math.sin(phase * Math.PI * 2);
      for (const wg of wings) wg.piv.rotation.y += (wg.side * 0.28 - wg.piv.rotation.y) * k;
      for (const L of legs) {
        const tripod = (L.index + (L.side > 0 ? 1 : 0)) % 2 === 0 ? 1 : -1;
        const sw = Math.sin(phase * Math.PI * 2) * tripod;
        const lift = Math.max(0, Math.cos(phase * Math.PI * 2) * tripod);
        let hipY = -L.side * L.baseSwing + L.side * 0 + sw * 0.32 * walking;
        let kneeZ = L.restZ - L.side * lift * 0.45 * walking;
        let fz = L.side * 1.15;
        if (mode === 'grooming' && L.index === 0) {
          const g = Math.sin(groomT * 2 * Math.PI * 3);
          hipY = -L.side * (0.9 + 0.35 * g); fz = L.side * 0.55; kneeZ = -L.side * (2.2 + 0.4 * g);
        }
        L.hip.rotation.y += (hipY - L.hip.rotation.y) * 0.5;
        L.knee.rotation.z += (kneeZ - L.knee.rotation.z) * 0.5;
        L.fPiv.rotation.z += (fz - L.fPiv.rotation.z) * 0.3;
      }
      const bob = mode === 'grooming' ? Math.sin(groomT * 2 * Math.PI * 3) * 0.12 : 0;
      head.rotation.x += ((mode === 'grooming' ? 0.35 : 0) + bob - head.rotation.x) * 0.3;
      body.position.y = walking * Math.abs(tw) * 0.05;
    }
  }
  function turnToward(target, dt, rate) {
    let d = target - heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    const step = Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    heading += step;
  }

  return {
    group, parts, setRates, gfSpike, takeOff, update, labellumPoint,
    get flying() { return !!flight; },
    get mode() { return mode; }, get hunger() { return hunger; }, set hunger(v) { hunger = v; },
    get position() { return { x, z }; }, get heading() { return heading; }, get feeding() { return feedingOn; },
    eat(amount) { hunger = Math.max(0, hunger - amount); },
  };
}
