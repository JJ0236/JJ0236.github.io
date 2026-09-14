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

export function createFly({ sex = 'female', teneral = false, template = null } = {}) {
  const group = new THREE.Group();
  group.userData.fly = null;
  group.scale.setScalar(FLY_SCALE * (sex === 'male' ? 0.86 : 1));
  const body = new THREE.Group();          // pitches on a jump
  group.add(body);
  let mat, dark, legMat, eyeMat, abdoMat, wingMat, thorax, abdomen, abdoPiv, head, rostrum, labella, labL, labR;
  const legs = [], wings = [];
  let paleness = teneral ? 1 : 0;
  let baseCols = [];
  const PALE = new THREE.Color('#D9CDB2');
  function applyPale() { for (const [m, c] of baseCols) m.color.copy(c).lerp(PALE, paleness * 0.8); }
  if (template) {
    // ---- the Blender model: clone it, give it its own materials, find the rig ----
    const model = template.clone(true);
    const seen = new Map();
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = false;
      if (!seen.has(o.material)) seen.set(o.material, o.material.clone());
      o.material = seen.get(o.material);
    });
    for (const m of seen.values()) baseCols.push([m, m.color.clone()]);
    body.add(model);
    const find = n => { const o = model.getObjectByName(n); if (!o) console.warn('fly model: missing', n); return o || new THREE.Group(); };
    head = find('head'); rostrum = find('rostrum'); labella = find('labella'); labL = find('labL'); labR = find('labR'); abdoPiv = find('abdomen');
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
      const nm = (s < 0 ? 'L' : 'R') + (i + 1);
      const hip = find('hip_' + nm), fPiv = find('femur_' + nm), knee = find('knee_' + nm);
      legs.push({ hip, fPiv, knee, side: s, index: i, baseSwing: (i - 1) * 0.35, restZ: knee.rotation.z, restHipY: hip.rotation.y, restFz: fPiv.rotation.z });
    }
    for (const s of [-1, 1]) { const piv = find(s < 0 ? 'wingL' : 'wingR'); wings.push({ piv, side: s, restY: piv.rotation.y }); }
  } else {
    mat = new THREE.MeshStandardMaterial({ color: SLATE, roughness: 0.55, flatShading: true });
    dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.6, flatShading: true });
    legMat = new THREE.MeshStandardMaterial({ color: LEG, roughness: 0.6 });
    eyeMat = new THREE.MeshStandardMaterial({ color: EYE, roughness: 0.35, flatShading: true });
    abdoMat = new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.55, flatShading: true });
    // opaque: transparent objects do not show through the glass dome
    wingMat = new THREE.MeshStandardMaterial({ map: wingTexture(), side: THREE.DoubleSide, roughness: 0.25, metalness: 0.05 });
    const mesh = (geo, m) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; o.receiveShadow = false; return o; };
    baseCols = [[mat, new THREE.Color(SLATE)], [dark, new THREE.Color(DARK)], [legMat, new THREE.Color(LEG)], [eyeMat, new THREE.Color(EYE)]];

    thorax = mesh(new THREE.IcosahedronGeometry(0.78, 1), mat);
    thorax.scale.set(1.0, 0.85, 1.15); thorax.position.set(0, 0.95, 0.25); body.add(thorax);
    const abdoGeo = new THREE.SphereGeometry(0.7, 12, 8); abdoGeo.rotateX(Math.PI / 2);
    abdomen = mesh(abdoGeo, abdoMat);
    abdoPiv = new THREE.Group(); abdoPiv.position.set(0, 0.85, -0.55); body.add(abdoPiv);
    abdomen.position.set(0, 0, -0.8); abdoPiv.add(abdomen);
    if (sex === 'male') {
      abdomen.scale.set(0.9, 0.72, 1.35);
      const tip = mesh(new THREE.SphereGeometry(0.42, 10, 8), dark); tip.scale.set(1.2, 0.85, 1); tip.position.set(0, 0, -1.7); abdoPiv.add(tip);
    } else {
      abdomen.scale.set(0.98, 0.78, 1.85);
      const tip = mesh(new THREE.ConeGeometry(0.3, 0.7, 8), mat); tip.rotation.x = Math.PI / 2; tip.position.set(0, -0.05, -2.45); abdoPiv.add(tip);
    }
    head = new THREE.Group(); head.position.set(0, 1.0, 1.25); body.add(head);
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
    rostrum = new THREE.Group(); rostrum.position.set(0, -0.3, 0.3); head.add(rostrum);
    const rSeg = mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.62, 8), dark); rSeg.position.y = -0.31; rostrum.add(rSeg);
    labella = new THREE.Group(); labella.position.y = -0.62; rostrum.add(labella);
    labL = mesh(new THREE.SphereGeometry(0.15, 8, 6), mat); labL.scale.set(1, 0.6, 1.3); labL.position.x = -0.1; labella.add(labL);
    labR = labL.clone(); labR.position.x = 0.1; labella.add(labR);
    rostrum.rotation.x = 1.25;   // tucked

    // legs: hip on thorax, femur out and down, knee, tibia + tarsus down to the ground
    const legZ = [0.85, 0.25, -0.35];
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(s * 0.55, 0.6, legZ[i]); body.add(hip);
      const femurLen = 0.95, tibLen = 1.25;
      const femur = mesh(new THREE.CylinderGeometry(0.06, 0.08, femurLen, 6), legMat); femur.position.y = -femurLen / 2; femur.castShadow = true;
      const fPiv = new THREE.Group(); fPiv.rotation.z = s * 1.15; hip.add(fPiv); fPiv.add(femur);
      const knee = new THREE.Group(); knee.position.y = -femurLen; fPiv.add(knee);
      const tib = mesh(new THREE.CylinderGeometry(0.045, 0.03, tibLen, 6), legMat); tib.position.y = -tibLen / 2; knee.add(tib);
      if (sex === 'male' && i === 0) { const comb = mesh(new THREE.BoxGeometry(0.1, 0.16, 0.06), dark); comb.position.set(0, -tibLen * 0.55, 0.05); knee.add(comb); }
      knee.rotation.z = -s * 1.55;
      const baseSwing = (i - 1) * 0.35;   // splay front legs forward, hind legs back
      hip.rotation.y = -s * baseSwing;
      legs.push({ hip, fPiv, knee, side: s, index: i, baseSwing, restZ: -s * 1.55, restHipY: hip.rotation.y, restFz: s * 1.15 });
    }

    // wings
    for (const s of [-1, 1]) {
      const piv = new THREE.Group(); piv.position.set(s * 0.28, 1.5, 0.05); body.add(piv);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 2.5), wingMat);
      w.position.set(s * 0.15, 0, -1.2); w.rotation.x = -Math.PI / 2; w.castShadow = true;
      piv.add(w); piv.rotation.y = s * 0.28; piv.rotation.z = s * 0.06;
      wings.push({ piv, side: s, restY: s * 0.28 });
    }

  }
  if (teneral) applyPale();
  const restRostrumX = rostrum.rotation.x, restHeadX = head.rotation.x, restAbdoX = abdoPiv.rotation.x;
  // leg lengths in model units, and where each foot wants to stand relative to the root
  const LF = template ? 1.0 : 0.95, LT = template ? 1.42 : 1.25;
  const NOMINAL = [[1.2, 0, 1.0], [1.3, 0, 0.15], [1.15, 0, -0.8]];   // lateral, up, forward
  for (const L of legs) {
    L.foot = new THREE.Vector3(); L.planted = false; L.swing = null;
    L.group = (L.index + (L.side > 0 ? 1 : 0)) % 2;
    L.nom = new THREE.Vector3(L.side * NOMINAL[L.index][0], 0, NOMINAL[L.index][2]);
  }
  const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _n = new THREE.Vector3(0, 1, 0), _f = new THREE.Vector3();
  const smoothN = new THREE.Vector3(0, 1, 0);
  let surf = { y: 0, nx: 0, ny: 1, nz: 0 };
  let lastX = 0, lastZ = 0, velX = 0, velZ = 0;

  /** Two-bone IK: put this leg's foot on `target` (world). */
  function solveLeg(L, target) {
    const hipP = L.hip.parent;
    _t.copy(target); hipP.worldToLocal(_t); _t.sub(L.hip.position);
    const s = L.side;
    const psi = Math.atan2(-s * _t.z, s * _t.x);
    const u = Math.max(0.3, Math.hypot(_t.x, _t.z)), v = Math.min(-0.08, _t.y);   // feet stay outboard and below the hip
    let D = Math.hypot(u, v);
    const dmax = (LF + LT) * 0.995, dmin = Math.abs(LF - LT) + 0.02;
    if (D > dmax) D = dmax; if (D < dmin) D = dmin;
    const alpha = Math.acos(Math.max(-1, Math.min(1, (LF * LF + D * D - LT * LT) / (2 * LF * D))));
    const beta = Math.acos(Math.max(-1, Math.min(1, (LF * LF + LT * LT - D * D) / (2 * LF * LT))));
    const phi = Math.atan2(v, u);
    const thetaF = phi + alpha;
    L.hip.rotation.y = psi;
    L.fPiv.rotation.z = s * (thetaF + Math.PI / 2);
    L.knee.rotation.z = -s * (Math.PI - beta);
  }
  function nominalFoot(L, out) { out.copy(L.nom); group.localToWorld(out); if (world?.surfaceAt) { const sf = world.surfaceAt(out.x, out.z, out.y + 30); out.y = sf.y; } return out; }

  // ---- state ----
  const rates = { MN9: 0, MN6: 0, GF: 0, groom: 0, DNa01: 0, DNa02: 0, DN_L: 0, DN_R: 0, DNa02_L: 0, DNa02_R: 0 };
  const sm = { MN9: 0, MN6: 0, groom: 0, DN: 0, DN_L: 0, DN_R: 0, turn: 0 };
  let wanderNoise = 0, noiseT = 0, curiosityT = 12 + Math.random() * 20;
  let mode = 'idle', hunger = 0.6;
  let heading = Math.random() * Math.PI * 2, x = 6, z = -4;
  let phase = 0, walking = 0;
  let idleTimer = 1.2, idleWalking = false;
  let jump = null, jumpCooldown = 0;
  let feedingOn = null, leaveTimer = 0, rejectTimer = 0;
  let groomT = 0;
  let flight = null;   // { t, dur, path }
  let song = 0, songT = 0;            // 0..1 wing-extension song intensity (males)
  let mount = null;                   // { target, t, dur }
  let ovi = 0;                        // abdomen bend, 0..1
  let surfaceY = 0, pitch = 0;
  let hold = false;                   // frozen by the page (being mounted)
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
    const list = world.foods || world.droplets;
    for (const d of list) { if (d.rejected || d.gone) continue; const dd = Math.hypot(d.x - x, d.z - z); if (dd < bd) { bd = dd; best = d; } }
    return best;
  }
  let pursuit = null;   // { x, z, stopAt } or { fly, stopAt }
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
    if (mount) {
      mount.t += dtMs;
      const tp = mount.target.position, th = mount.target.heading;
      x = tp.x - Math.sin(th) * 0.9 * FLY_SCALE; z = tp.z - Math.cos(th) * 0.9 * FLY_SCALE; heading = th;
      group.position.y = surfaceY + 1.1 * FLY_SCALE * (sex === 'male' ? 0.86 : 1);
      body.rotation.x = -0.35;
      for (const wg of wings) wg.piv.rotation.y += (wg.restY + wg.side * 0.25 - wg.piv.rotation.y) * 0.2;
      mode = 'mating';
      if (mount.t >= mount.dur) { mount = null; body.rotation.x = 0; mode = 'idle'; idleTimer = 1; }
    } else if (hold) {
      mode = 'mating';
    } else if (flight) {
      flight.t += dtMs;
      const u = Math.min(1, flight.t / flight.dur);
      const p = catmull(flight.pts, u), q = catmull(flight.pts, Math.min(1, u + 0.01));
      const dx = q.x - p.x, dz = q.z - p.z;
      if (Math.hypot(dx, dz) > 1e-4) heading = Math.atan2(dx, dz);
      x = p.x; z = p.z; group.position.y = Math.max(0, p.y);
      body.rotation.x = -0.25 * Math.sin(u * Math.PI);
      const beat = Math.sin(flight.t * 1.1);
 for (const wg of wings) wg.piv.rotation.y = wg.restY + wg.side * (0.1 + 0.75 * beat);
      for (const L of legs) { L.knee.rotation.z += (L.restZ - L.side * 0.9 - L.knee.rotation.z) * 0.2; }
      if (u >= 1) { flight = null; group.position.y = 0; body.rotation.x = 0; mode = 'idle'; idleTimer = 1.2; idleWalking = false; for (const L of legs) { L.planted = false; L.swing = null; } }
    } else if (jump) {
      jump.t += dtMs;
      const u = Math.min(1, jump.t / jump.dur);
      x = jump.x0 + (jump.x1 - jump.x0) * u; z = jump.z0 + (jump.z1 - jump.z0) * u;
      heading = Math.atan2(jump.x1 - jump.x0, jump.z1 - jump.z0);
      group.position.y = jump.h * 4 * u * (1 - u) * FLY_SCALE / 2.8;
      body.rotation.x = -0.5 * Math.sin(u * Math.PI);
      for (const wg of wings) wg.piv.rotation.y = wg.restY + wg.side * (0.9 * Math.sin(u * Math.PI) + 0.35 * Math.sin(jump.t * 0.9));
      if (u >= 1) { jump = null; group.position.y = 0; body.rotation.x = 0; mode = 'idle'; idleTimer = 0.8; idleWalking = false; for (const L of legs) { L.planted = false; L.swing = null; } }
    } else if (sm.groom > 25 && !feedingOn) {
      mode = 'grooming'; groomT += dt;
    } else if (pursuit && !feedingOn) {
      const tx = pursuit.fly ? pursuit.fly.position.x : pursuit.x, tz = pursuit.fly ? pursuit.fly.position.z : pursuit.z;
      const dx = tx - x, dz = tz - z, dist = Math.hypot(dx, dz);
      mode = pursuit.mode || 'pursuing';
      turnToward(Math.atan2(dx, dz), dt, 3.5);
      if (dist > (pursuit.stopAt || 4)) speed = pursuit.speed || 8; else if (pursuit.arrive) { const p = pursuit; pursuit = null; p.arrive(); }
    } else if (feedingOn && !feedingOn.gone && hunger <= 0.03) {
      leaveDroplet(); mode = 'idle'; idleTimer = 1.5; idleWalking = true; heading += Math.PI * 0.7;
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
        // a learned smell pulls the heading up or down its gradient; now and
        // then curiosity picks a prop on the counter and the fly goes to see it
        mode = 'idle';
        curiosityT -= dt;
        if (curiosityT <= 0 && w.objects && w.objects.length) {
          curiosityT = 25 + Math.random() * 40;
          const cands = w.objects.filter(o => o.food.length || o.eggSite || o.scents.length);
          const o = cands[(Math.random() * cands.length) | 0];
          const spot = o.food[0] || o.eggSite || o.scents[0];
          if (spot && Math.hypot(spot.x - x, spot.z - z) > 15) {
            const a = Math.random() * 6.28, r = (spot.r || 12) + 4 + Math.random() * 6;
            pursuit = { x: spot.x + Math.cos(a) * r, z: spot.z + Math.sin(a) * r, stopAt: 3, speed: 6.5, mode: 'going to look at the ' + o.name, arrive() { idleTimer = 2 + Math.random() * 3; idleWalking = false; } };
          }
        }
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

    // ---- move: the real surface decides what is a wall ----
    if (speed > 0) {
      const nx = x + Math.sin(heading) * speed * dt, nz = z + Math.cos(heading) * speed * dt;
      const wk = w.walkable ? w.walkable(x, z, nx, nz, group.position.y + 30) : { ok: true };
      if (wk.ok) { x = nx; z = nz; if (wk.s) surf = wk.s; }
      else { heading += (Math.random() < 0.5 ? 1 : -1) * (0.9 + Math.random() * 0.8) * Math.min(1, dt * 12); speed = 0; if (pursuit && !pursuit.fly) { const p = pursuit; pursuit = null; p.arrive?.(); } }
      phase += dt * GAIT_HZ * (speed / 9);
      walking = Math.min(1, walking + dt * 8);
    } else walking = Math.max(0, walking - dt * 8);
    velX = (x - lastX) / Math.max(dt, 1e-3); velZ = (z - lastZ) / Math.max(dt, 1e-3); lastX = x; lastZ = z;
    if (w.pushOut) { const p = w.pushOut({ x, z }); x = p.x; z = p.z; }
    if (!flight && !mount) {
      if (w.surfaceAt) surf = w.surfaceAt(x, z, group.position.y + 30);
      surfaceY += (surf.y - surfaceY) * Math.min(1, dtMs / 90);
      const kN = Math.min(1, dtMs / 140);
      smoothN.x += (surf.nx - smoothN.x) * kN; smoothN.y += (surf.ny - smoothN.y) * kN; smoothN.z += (surf.nz - smoothN.z) * kN; smoothN.normalize();
      group.position.set(x, surfaceY + (jump ? group.position.y - surfaceY : 0), z);
      // forward = heading projected onto the surface plane; up = the surface normal
      _f.set(Math.sin(heading), 0, Math.cos(heading)); _f.addScaledVector(smoothN, -_f.dot(smoothN)).normalize();
      group.up.copy(jump ? _n : smoothN);
      group.lookAt(group.position.x + _f.x, group.position.y + _f.y, group.position.z + _f.z);
      body.rotation.x = feedingOn ? -0.12 : 0;
      body.position.y = feedingOn ? -0.08 : 0;
    } else {
      group.position.x = x; group.position.z = z;
      group.up.copy(_n); group.rotation.set(0, heading, 0);
    }
    if (flight || mount) return;

    // ---- pose ----
    const ext = Math.min(1, sm.MN9 / 40);
    rostrum.rotation.x += ((restRostrumX - 1.35 * ext) - rostrum.rotation.x) * k;
    const spread = 0.45 * Math.min(1, sm.MN6 / 40);
    labL.rotation.z += (spread - labL.rotation.z) * k; labR.rotation.z += (-spread - labR.rotation.z) * k;
    if (!jump && !flight) {
      const tw = Math.sin(phase * Math.PI * 2);
      songT += dtMs;
      for (const wg of wings) {
        // song: the left wing swings out ~80° and vibrates
        const out = wg.side < 0 ? wg.restY - 1.3 * song - 0.12 * song * Math.sin(songT * 0.09) : wg.restY;
        wg.piv.rotation.y += (out - wg.piv.rotation.y) * (song > 0 ? 0.35 : k);
      }
      abdoPiv.rotation.x += ((restAbdoX + (ovi > 0 ? 0.55 : 0)) - abdoPiv.rotation.x) * 0.08;
      if (ovi > 0) { ovi -= dtMs / 2200; if (ovi <= 0) ovi = 0; }
      // ---- feet: each foot stays where it was planted until it has to step ----
      group.updateMatrixWorld(true);
      const scale = group.scale.x;
      const spd = Math.hypot(velX, velZ);
      const stepLen = (0.45 + 0.1 * Math.min(1, spd / 6)) * scale, lead = Math.min(0.45 * scale, spd * 0.1);
      const swinging = [0, 0]; for (const L of legs) if (L.swing) swinging[L.group]++;
      for (const L of legs) {
        if (!L.planted) { nominalFoot(L, L.foot); L.planted = true; }
        if (L.swing) {
          L.swing.t += dtMs; const u = Math.min(1, L.swing.t / L.swing.dur);
          L.foot.lerpVectors(L.swing.from, L.swing.to, u); L.foot.addScaledVector(smoothN, Math.sin(u * Math.PI) * 0.3 * scale);
          if (u >= 1) { L.foot.copy(L.swing.to); L.swing = null; }
        } else {
          nominalFoot(L, _v);
          const err = Math.hypot(_v.x - L.foot.x, _v.z - L.foot.z) + Math.abs(_v.y - L.foot.y) * 0.5;
          const otherFree = swinging[1 - L.group] === 0;
          if ((err > stepLen && otherFree) || err > 1.4 * stepLen) {
            const to = _v.clone(); to.x += (velX / Math.max(1e-6, Math.hypot(velX, velZ) || 1)) * lead; to.z += (velZ / Math.max(1e-6, Math.hypot(velX, velZ) || 1)) * lead;
            if (world?.surfaceAt) { const sf = world.surfaceAt(to.x, to.z, to.y + 30); to.y = sf.y; }
            L.swing = { from: L.foot.clone(), to, t: 0, dur: 55 + 35 * (1 - Math.min(1, spd / 8)) }; swinging[L.group]++;
          }
        }
        if (mode === 'grooming' && L.index === 0) {
          const g = Math.sin(groomT * 2 * Math.PI * 3);
          L.hip.rotation.y += ((L.restHipY - L.side * (0.55 + 0.35 * g)) - L.hip.rotation.y) * 0.4;
          L.fPiv.rotation.z += ((L.restFz - L.side * 0.6) - L.fPiv.rotation.z) * 0.4;
          L.knee.rotation.z += ((L.restZ - L.side * (0.65 + 0.4 * g)) - L.knee.rotation.z) * 0.4;
          L.planted = false;
        } else solveLeg(L, L.foot);
      }
      const bob = mode === 'grooming' ? Math.sin(groomT * 2 * Math.PI * 3) * 0.12 : 0;
      head.rotation.x += (restHeadX + (mode === 'grooming' ? 0.35 : 0) + bob - head.rotation.x) * 0.3;
      body.position.y += walking * Math.abs(tw) * 0.04;
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
    get sex() { return sex; },
    setSong(v) { song = Math.max(0, Math.min(1, v)); },
    mountOn(target, dur = 20000) { mount = { target, t: 0, dur }; if (feedingOn) leaveDroplet(); },
    get mounting() { return !!mount; },
    set hold(v) { hold = !!v; }, get hold() { return hold; },
    oviposit() { ovi = 1; },
    set paleness(v) { paleness = v; applyPale(); }, get paleness() { return paleness; },
    setPosition(nx, nz, h) { x = nx; z = nz; lastX = nx; lastZ = nz; if (h !== undefined) heading = h; for (const L of legs) { L.planted = false; L.swing = null; } },
    get surface() { return surf; },
    nudge(dx, dz) { x += dx; z += dz; lastX += dx; lastZ += dz; },
    setPursuit(p) { pursuit = p; }, get pursuit() { return pursuit; },
    stopFeeding() { if (feedingOn) { leaveDroplet(); mode = 'idle'; idleTimer = 0.5; } },
    get mode() { return mode; }, get hunger() { return hunger; }, set hunger(v) { hunger = v; },
    get position() { return { x, z }; }, get heading() { return heading; }, get feeding() { return feedingOn; },
    eat(amount) { hunger = Math.max(0, hunger - amount); },
  };
}
