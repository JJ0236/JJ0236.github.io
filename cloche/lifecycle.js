// cloche/lifecycle.js — eggs, larvae, pupae and eclosion. Timed stages in
// minutes, meshes procedural, no brains: the larva has a different
// connectome that is not simulated here (disclosed on the page).
import * as THREE from 'three';

export const STAGE_MS = { egg: 120000, larva: 360000, pupa: 240000 };
export const MAX_EGGS = 12, MAX_LARVAE = 8, MAX_PUPAE = 6;
const S = 2.8;   // drawn at the same scale as the flies

export function createLifecycle(world, templates = {}) {
  const eggs = [], larvae = [], pupae = [];
  const eggGeo = new THREE.SphereGeometry(0.28, 10, 8);
  const eggMat = new THREE.MeshStandardMaterial({ color: '#F4F1E6', roughness: 0.55 });
  const filMat = new THREE.MeshStandardMaterial({ color: '#E8E2D0', roughness: 0.7 });
  const larvaMat = new THREE.MeshStandardMaterial({ color: '#EFE9D6', roughness: 0.45 });
  const headMat = new THREE.MeshStandardMaterial({ color: '#3A2E22', roughness: 0.5 });
  const pupaMat = new THREE.MeshStandardMaterial({ color: '#8C5A2B', roughness: 0.6 });

  function layEgg(x, z) {
    if (eggs.length >= MAX_EGGS) return null;
    const g = new THREE.Group();
    if (templates.egg) { const m = templates.egg.clone(true); m.traverse(o => { if (o.isMesh) o.castShadow = true; }); g.add(m); }
    else {
      const e = new THREE.Mesh(eggGeo, eggMat); e.scale.set(1, 0.9, 1.9); e.castShadow = true; g.add(e);
      for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4), filMat); f.position.set(s * 0.12, 0.25, 0.55); f.rotation.x = -0.8; f.rotation.z = s * 0.4; g.add(f); }
    }
    g.scale.setScalar(S);
    const sf = world.surfaceAt(x, z);
    g.position.set(x + sf.nx * 0.2 * S, sf.y + sf.ny * 0.2 * S, z + sf.nz * 0.2 * S);
    g.up.set(sf.nx, sf.ny, sf.nz); const a = Math.random() * 6.28; g.lookAt(g.position.x + Math.sin(a), g.position.y, g.position.z + Math.cos(a));
    world.scene.add(g);
    const egg = { x, z, t: 0, mesh: g };
    eggs.push(egg); return egg;
  }
  function hatch(egg) {
    world.scene.remove(egg.mesh);
    if (larvae.length >= MAX_LARVAE) return;
    const g = new THREE.Group(); const segs = [];
    if (templates.larva) {
      const m = templates.larva.clone(true); m.traverse(o => { if (o.isMesh) o.castShadow = true; }); g.add(m);
      for (let i = 0; i < 9; i++) { const sg = m.getObjectByName('seg' + i); if (sg) segs.push(sg); }
    }
    if (!segs.length) {
      for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), larvaMat); m.position.z = -i * 0.3; m.castShadow = true; g.add(m); segs.push(m); }
      const hooks = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 5), headMat); hooks.position.set(0, -0.06, 0.2); hooks.rotation.x = 1.2; g.add(hooks);
    }
    g.scale.setScalar(S * 0.5);
    world.scene.add(g);
    larvae.push({ x: egg.x, z: egg.z, heading: Math.random() * 6.28, t: 0, mesh: g, segs, phase: Math.random() * 6.28, home: { x: egg.x, z: egg.z }, turnT: 0 });
  }
  function pupate(l) {
    world.scene.remove(l.mesh);
    if (pupae.length >= MAX_PUPAE) return;
    let m, mat;
    if (templates.pupa) { m = templates.pupa.clone(true); m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); mat = o.material; } }); m.rotation.y = Math.random() * 6.28; }
    else { mat = pupaMat.clone(); m = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.6, 4, 10), mat); m.rotation.x = Math.PI / 2; m.rotation.y = Math.random() * 6.28; m.castShadow = true; }
    m.scale.setScalar(S);
    const sf = world.surfaceAt(l.x, l.z); m.position.set(l.x + sf.nx * 0.45 * S, sf.y + sf.ny * 0.45 * S, l.z + sf.nz * 0.45 * S);
    if (templates.pupa) { m.up.set(sf.nx, sf.ny, sf.nz); const a = Math.random() * 6.28; m.lookAt(m.position.x + Math.sin(a), m.position.y, m.position.z + Math.cos(a)); }
    world.scene.add(m);
    pupae.push({ x: l.x, z: l.z, t: 0, mesh: m, mat });
  }

  /** Advance everything; returns events: { type: 'eclose', x, z }. */
  function update(dtMs) {
    const out = [];
    for (let i = eggs.length - 1; i >= 0; i--) { const e = eggs[i]; e.t += dtMs; if (e.t >= STAGE_MS.egg) { eggs.splice(i, 1); hatch(e); } }
    for (let i = larvae.length - 1; i >= 0; i--) {
      const l = larvae[i]; l.t += dtMs;
      const u = l.t / STAGE_MS.larva;
      const instar = u < 0.33 ? 1 : u < 0.66 ? 2 : 3;
      const size = 0.5 + 0.9 * u;                    // grows ×3 over the stage
      l.mesh.scale.setScalar(S * size);
      // crawl: slow peristaltic wander that stays near the fruit; late third instar wanders off to pupate
      const speed = (u > 0.9 ? 1.6 : 0.6) * (0.6 + 0.4 * instar / 3);
      l.turnT -= dtMs; if (l.turnT <= 0) { l.turnT = 1500 + Math.random() * 3000; l.heading += (Math.random() - 0.5) * 2.2; }
      if (u <= 0.9) { const dx = l.home.x - l.x, dz = l.home.z - l.z; if (Math.hypot(dx, dz) > 14) l.heading = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.6; }
      l.phase += dtMs * 0.004;
      const crawl = 0.5 + 0.5 * Math.sin(l.phase);
      const nx = l.x + Math.sin(l.heading) * speed * crawl * dtMs / 1000, nz = l.z + Math.cos(l.heading) * speed * crawl * dtMs / 1000;
      const wk = world.walkable(l.x, l.z, nx, nz);
      if (wk.ok) { l.x = nx; l.z = nz; } else l.heading += 1.2;
      const sf = world.surfaceAt(l.x, l.z);
      l.mesh.position.set(l.x + sf.nx * 0.22 * S * size, sf.y + sf.ny * 0.22 * S * size, l.z + sf.nz * 0.22 * S * size);
      l.mesh.up.set(sf.nx, sf.ny, sf.nz); l.mesh.lookAt(l.mesh.position.x + Math.sin(l.heading), l.mesh.position.y, l.mesh.position.z + Math.cos(l.heading));
      for (let k = 0; k < l.segs.length; k++) { const w = 0.85 + 0.25 * Math.sin(l.phase - k * 0.7); l.segs[k].scale.set(w, w, 1); }
      if (l.t >= STAGE_MS.larva) { larvae.splice(i, 1); pupate(l); }
    }
    for (let i = pupae.length - 1; i >= 0; i--) { const p = pupae[i]; p.t += dtMs; const u = p.t / STAGE_MS.pupa; if (p.mat) p.mat.color.setStyle(u < 0.3 ? '#C9A46A' : u < 0.7 ? '#8C5A2B' : '#4E3418'); if (p.t >= STAGE_MS.pupa) { pupae.splice(i, 1); world.scene.remove(p.mesh); out.push({ type: 'eclose', x: p.x, z: p.z }); } }
    return out;
  }
  function counts() { return { eggs: eggs.length, larvae: larvae.length, pupae: pupae.length }; }
  function state() { return { eggs: eggs.map(e => [e.x, e.z, e.t]), larvae: larvae.map(l => [l.x, l.z, l.t]), pupae: pupae.map(p => [p.x, p.z, p.t]) }; }
  function restore(st) {
    if (!st) return;
    for (const [x, z, t] of st.eggs || []) { const e = layEgg(x, z); if (e) e.t = t; }
    for (const [x, z, t] of st.larvae || []) { hatch({ x, z, mesh: new THREE.Group() }); const l = larvae[larvae.length - 1]; if (l) l.t = t; }
    for (const [x, z, t] of st.pupae || []) { pupate({ x, z, mesh: new THREE.Group() }); const p = pupae[pupae.length - 1]; if (p) p.t = t; }
  }
  return { layEgg, update, counts, state, restore, eggs, larvae, pupae };
}
