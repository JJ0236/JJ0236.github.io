// cloche/app.js — loads the brain, runs it in a worker, and wires the dome,
// the fly and the brain window together.
import { decodeBrain } from './data.js';
import { RATE_ORDER, RATE_INDEX } from './groups-order.js';
import { createBrainView } from './brainview.js';
import { createScene } from './scene.js';
import { createFly } from './fly.js';

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('en-US');

const PATHWAYS = {
  sugar: 'sugar GRNs → SEZ interneurons → MN9 (rostrum) and MN6 (labella)',
  bitter: 'bitter GRNs inhibit the sugar pathway; MN9 goes quiet',
  loom: 'LC4 + LPLC2 looming detectors → giant fibre → jump',
  poke: 'Johnston\'s organ → antennal interneurons → descending neurons → grooming',
};

async function main() {
  if (!window.WebGLRenderingContext) { $('noWebgl').classList.add('show'); return; }

  // ---- load ----
  const bar = $('loadBar'), stage = $('loadStage');
  let buffer;
  try {
    const res = await fetch('./data/brain.bin');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = +res.headers.get('Content-Length') || 0;
    const reader = res.body.getReader();
    const chunks = []; let got = 0;
    if (!total) bar.classList.add('pulse');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (total) bar.firstElementChild.style.width = `${Math.min(100, got / total * 100).toFixed(0)}%`;
    }
    buffer = new ArrayBuffer(got);
    const u8 = new Uint8Array(buffer); let o = 0;
    for (const c of chunks) { u8.set(c, o); o += c.length; }
    bar.classList.remove('pulse'); bar.firstElementChild.style.width = '100%';
  } catch (err) {
    stage.textContent = 'Could not load the connectome.'; $('loadSub').textContent = String(err.message || err); return;
  }
  stage.textContent = 'Waking the neurons…';
  const groups = await (await fetch('./data/groups.json')).json();
  const data = decodeBrain(buffer);

  // ---- brain runner: worker, or inline fallback ----
  let post;
  const onTick = [];
  try {
    const worker = new Worker('./worker.js', { type: 'module' });
    const wbuf = buffer.slice(0);
    const ready = new Promise((resolve, reject) => {
      worker.onmessage = e => { if (e.data.type === 'ready') resolve(); else if (e.data.type === 'tick') onTick.forEach(f => f(e.data)); };
      worker.onerror = e => reject(new Error(e.message || 'worker failed'));
      setTimeout(() => reject(new Error('worker timeout')), 20000);
    });
    worker.postMessage({ type: 'init', buffer: wbuf, groups }, [wbuf]);
    await ready;
    post = m => worker.postMessage(m);
  } catch (err) {
    console.warn('cloche: worker unavailable, running inline', err);
    const { createBrain } = await import('./brain.js');
    const brain = createBrain(data, { seed: Date.now() & 0xffff });
    let bio = 0, origin = performance.now();
    post = m => {
      if (m.type === 'stim') brain.stimulate(groups[m.group], m.hz);
      else if (m.type === 'stimIdx') brain.stimulate(m.indices, m.hz);
      else if (m.type === 'reset') { brain.reset(); bio = 0; origin = performance.now(); }
    };
    const gfSet = new Set(groups.GF);
    onTick.push; // no-op for symmetry
    const inlineStep = () => {
      const start = performance.now();
      let wall = start - origin; if (wall - bio > 200) { origin = start - bio - 200; wall = bio + 200; }
      const acc = []; let gf = false;
      while (bio < wall && performance.now() - start < 8) { const sp = brain.step(50); if (sp.length) { acc.push(sp.slice()); for (const i of sp) if (gfSet.has(i)) gf = true; } bio += 5; }
      const spikes = new Uint32Array(acc.reduce((a, s) => a + s.length, 0)); let o = 0; for (const s of acc) { spikes.set(s, o); o += s.length; }
      const rates = new Float32Array(RATE_ORDER.length);
      for (let i = 0; i < RATE_ORDER.length; i++) rates[i] = brain.rate(groups[RATE_ORDER[i]], 100);
      onTick.forEach(f => f({ type: 'tick', time: bio, spikes, rates, active: brain.activeCount, speed: 1, gf }));
      requestAnimationFrame(inlineStep);
    };
    requestAnimationFrame(inlineStep);
  }

  // ---- views ----
  const scene = createScene($('three-canvas'));
  const fly = createFly();
  scene.setFly(fly.group);
  const brainView = createBrainView($('brain-canvas'), data, groups);
  $('brainMeta').textContent = `${fmt(data.n)} neurons · ${fmt(data.e)} connections`;

  // ---- stimuli ----
  const active = {};   // group → hz
  const pathway = $('pathway');
  function stim(group, hz) {
    if ((active[group] || 0) === hz) return;
    if (hz > 0) active[group] = hz; else delete active[group];
    post({ type: 'stim', group, hz });
    updatePathway();
  }
  let pathwayHold = 0;
  function say(key, holdMs = 0) { pathway.textContent = PATHWAYS[key] || key; pathway.classList.add('live'); pathwayHold = performance.now() + holdMs; }
  function updatePathway() {
    if (active.sugar && active.bitter) say('bitter');
    else if (active.sugar) say('sugar');
    else if (active.LC4) say('loom', 1500);
    else if (active.JO) say('poke', 1200);
    else if (performance.now() > pathwayHold) { pathway.textContent = 'Resting. Every neuron is silent until you do something.'; pathway.classList.remove('live'); }
  }
  const timers = {};
  function pulse(groupsToDrive, hz, ms, key) {
    for (const g of groupsToDrive) { stim(g, hz); clearTimeout(timers[g]); timers[g] = setTimeout(() => stim(g, 0), ms); }
    say(key, ms + 1200);
  }
  function shadow(dx = 1, dz = 0.2) { scene.sweepShadow(dx, dz); pulse(['LC4', 'LPLC2'], 150, 70, 'loom'); }
  function poke() { const p = fly.position; scene.ripple(p.x, p.z); pulse(['JO'], 140, 300, 'poke'); }

  // ---- fly ↔ droplets ----
  const world = {
    droplets: scene.droplets,
    onReachDroplet(d) { stim('sugar', 200); if (d.bitter) stim('bitter', 200); },
    onLeaveDroplet() { stim('sugar', 0); stim('bitter', 0); },
  };

  // ---- ticks ----
  let lastRates = new Float32Array(RATE_ORDER.length);
  let spikeWindow = [], spikeSum = 0, lastActive = 0, lastSpeed = 1, gfAt = -Infinity;
  onTick.push(t => {
    brainView.onSpikes(t.spikes);
    lastRates = t.rates; lastActive = t.active; lastSpeed = t.speed;
    const now = performance.now();
    spikeWindow.push([now, t.spikes.length]); spikeSum += t.spikes.length;
    while (spikeWindow.length && now - spikeWindow[0][0] > 1000) spikeSum -= spikeWindow.shift()[1];
    if (t.gf) { gfAt = now; fly.gfSpike(); }
    fly.setRates({ MN9: t.rates[RATE_INDEX.MN9], MN6: t.rates[RATE_INDEX.MN6], GF: t.rates[RATE_INDEX.GF], groom: t.rates[RATE_INDEX.groom], DNa01: t.rates[RATE_INDEX.DNa01], DNa02: t.rates[RATE_INDEX.DNa02] });
  });

  // ---- pointer ----
  const canvas = $('three-canvas');
  let mode = 'sugar';
  const chips = $('chips');
  chips.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mode) { mode = b.dataset.mode; chips.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === b)); $('hint').textContent = mode === 'sugar' ? 'Click the base to drop sugar' : 'Click the base, or a sugar drop, to add bitter'; }
    else if (b.dataset.act === 'shadow') shadow(1, 0.3);
    else if (b.dataset.act === 'poke') poke();
  });
  let down = null;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now(), shift: e.shiftKey }; });
  canvas.addEventListener('pointerup', e => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y, moved = Math.hypot(dx, dy);
    const d = down; down = null;
    if (d.shift && moved > 30) { shadow(dx, dy); return; }
    if (moved > 6 || performance.now() - d.t > 600) return;
    const hit = scene.pick(e.clientX, e.clientY);
    if (hit.hitFly) poke();
    else if (hit.hitBase) {
      const drop = scene.addDroplet(mode, hit.point.x, hit.point.z);
      if (drop === fly.feeding && drop.bitter) stim('bitter', 200);
      $('hint').classList.add('fade');
    }
  });
  canvas.addEventListener('pointercancel', () => { down = null; });
  document.querySelectorAll('.readout .k[data-group]').forEach(k => k.addEventListener('click', () => {
    const on = k.classList.contains('on');
    document.querySelectorAll('.readout .k.on').forEach(x => x.classList.remove('on'));
    if (!on) k.classList.add('on');
    brainView.highlight(on ? null : k.dataset.group);
  }));

  // ---- loop ----
  let last = performance.now(), hudAt = 0;
  function frame(now) {
    const dt = Math.min(100, now - last); last = now;
    fly.update(dt, world);
    const f = fly.feeding;
    if (f && !f.gone && lastRates[RATE_INDEX.MN9] > 5) { f.shrink(0.5 * dt / 1000); fly.eat(0.35 * (0.5 * dt / 1000) / 3.4); if (f.gone) fly.eat(0.1); }
    if (f && f.changed) { f.changed = false; if (f.bitter) stim('bitter', 200); }
    scene.render(dt);
    brainView.render(now);
    if (now - hudAt > 120) { hudAt = now; hud(); }
    requestAnimationFrame(frame);
  }
  function hud() {
    const r = k => lastRates[RATE_INDEX[k]];
    const hz = (k, el, hot = 10) => { const v = r(k); el.textContent = v < 0.5 ? '–' : `${v.toFixed(0)} Hz`; el.classList.toggle('hot', v >= hot); };
    $('rActive').textContent = fmt(lastActive);
    $('rSpikes').textContent = fmt(spikeSum);
    hz('MN9', $('rMN9')); hz('groom', $('rGroom'), 25);
    const ago = (performance.now() - gfAt) / 1000;
    $('rGF').textContent = ago > 3600 ? 'never' : ago < 1 ? 'FIRED' : `${ago.toFixed(0)} s ago`;
    $('rGF').classList.toggle('fire', ago < 1);
    $('rSpeed').textContent = `${lastSpeed.toFixed(2)}× real time`;
    $('rSpeed').classList.toggle('slow', lastSpeed < 0.8);
    hz('sugar', $('rSugar')); hz('bitter', $('rBitter')); hz('JO', $('rJO')); hz('LPLC2', $('rLoom'));
    const modes = { idle: 'wandering', seeking: 'walking to a drop', feeding: 'tasting', grooming: 'grooming', jumping: 'jumping' };
    $('rMode').textContent = modes[fly.mode] || fly.mode;
    $('rHunger').textContent = `${(fly.hunger * 100).toFixed(0)} %`;
    $('flyStats').textContent = `${fmt(data.n)} neurons\n${lastActive ? fmt(lastActive) + ' active' : 'silent'}`;
    updatePathway();
  }
  const ro = new ResizeObserver(() => { scene.resize(); brainView.resize(); });
  ro.observe(canvas.parentElement); ro.observe($('brain-canvas'));
  $('loading').classList.add('hide');
  requestAnimationFrame(frame);

  window.cloche = { stim, shadow, poke, fly, scene, brainView, groups, data, post };
}

main().catch(err => { console.error(err); const s = $('loadStage'); if (s) { s.textContent = 'Something broke.'; $('loadSub').textContent = String(err.message || err); } });
