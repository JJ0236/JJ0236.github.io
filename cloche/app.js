// cloche/app.js — loads the brain, runs it in a worker, and wires the dome,
// the fly, the brain window, the smells, the memory panel and local saving.
import { decodeBrain } from './data.js';
import { RATE_ORDER, RATE_INDEX, BACKGROUND_HZ, SAVE_VERSION } from './groups-order.js';
import { createBrainView } from './brainview.js';
import { createScene } from './scene.js';
import { createFly } from './fly.js';

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('en-US');
const SAVE_KEY = 'cloche.fly';
const ODOUR_HZ = 100, TEACH_HZ = 20;

const PATHWAYS = {
  sugar: 'sugar GRNs → SEZ interneurons → MN9 (rostrum) and MN6 (labella)',
  bitter: 'bitter GRNs inhibit the sugar pathway; MN9 goes quiet',
  loom: 'LC4 + LPLC2 looming detectors → giant fibre → jump',
  poke: 'Johnston\'s organ → antennal interneurons → descending neurons → grooming',
  fruit: 'fruit receptors → antennal lobe → projection neurons → Kenyon cells',
  vinegar: 'vinegar receptors → antennal lobe → projection neurons → Kenyon cells',
  reward: 'smell + sugar: PAM dopamine weakens this smell\'s Kenyon-cell synapses onto avoidance neurons',
  punish: 'smell + bitter: PPL1 dopamine weakens this smell\'s Kenyon-cell synapses onto approach neurons',
};

function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return s && s.v === SAVE_VERSION ? s : null; } catch { return null; }
}
function writeSave(obj) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); } catch {} }

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
  const saved = loadSave();

  // ---- brain runner: worker, or inline fallback ----
  let post;
  const onTick = [];
  const replies = new Map(); let reqId = 0;
  const request = (type, extra = {}) => new Promise(resolve => { const id = ++reqId; replies.set(id, resolve); post({ type, id, ...extra }); });
  let inline = false;
  try {
    const worker = new Worker('./worker.js', { type: 'module' });
    const wbuf = buffer.slice(0);
    const ready = new Promise((resolve, reject) => {
      worker.onmessage = e => {
        const m = e.data;
        if (m.type === 'ready') resolve(m);
        else if (m.type === 'tick') onTick.forEach(f => f(m));
        else if (replies.has(m.id)) { replies.get(m.id)(m); replies.delete(m.id); }
      };
      worker.onerror = e => reject(new Error(e.message || 'worker failed'));
      setTimeout(() => reject(new Error('worker timeout')), 30000);
    });
    worker.postMessage({ type: 'init', buffer: wbuf, groups, state: saved, backgroundHz: BACKGROUND_HZ }, [wbuf]);
    await ready;
    post = m => worker.postMessage(m);
  } catch (err) {
    console.warn('cloche: worker unavailable, running inline', err);
    inline = true;
    const { createBrain } = await import('./brain.js');
    const brain = createBrain(data, { seed: Date.now() & 0xffff, modulatory: groups.modulatory });
    brain.enablePlasticity(groups.KC, [...groups.MBON_approach, ...groups.MBON_avoid], groups.teach);
    if (saved?.plastic) brain.setPlasticState(saved.plastic);
    const sens = []; for (let i = 0; i < data.n; i++) if (data.cls[i] === 2) sens.push(i);
    brain.background(sens, BACKGROUND_HZ);
    let bio = 0, origin = performance.now();
    post = m => {
      if (m.type === 'stim') brain.stimulate(groups[m.group], m.hz);
      else if (m.type === 'reset') { brain.reset(); bio = 0; origin = performance.now(); }
      else if (m.type === 'forget') brain.setPlasticState([]);
      else if (m.type === 'getState') replies.get(m.id)?.({ plastic: brain.getPlasticState(), changed: brain.changedEdges, odourKCs: {} });
      else if (m.type === 'memory') replies.get(m.id)?.({ memory: {} });
    };
    const gfSet = new Set(groups.GF);
    const inlineStep = () => {
      const start = performance.now();
      let wall = start - origin; if (wall - bio > 200) { origin = start - bio - 200; wall = bio + 200; }
      const acc = []; let gf = false;
      while (bio < wall && performance.now() - start < 8) { const sp = brain.step(50); if (sp.length) { acc.push(sp.slice()); for (const i of sp) if (gfSet.has(i)) gf = true; } bio += 5; }
      const spikes = new Uint32Array(acc.reduce((a, s) => a + s.length, 0)); let o = 0; for (const s of acc) { spikes.set(s, o); o += s.length; }
      const rates = new Float32Array(RATE_ORDER.length);
      for (let i = 0; i < RATE_ORDER.length; i++) { const g = groups[RATE_ORDER[i]]; rates[i] = g && g.length ? brain.rate(g, 100) : 0; }
      onTick.forEach(f => f({ type: 'tick', time: bio, spikes, rates, active: brain.activeCount, speed: 1, gf, changed: brain.changedEdges, kcOn: 0 }));
      requestAnimationFrame(inlineStep);
    };
    requestAnimationFrame(inlineStep);
  }

  // ---- views ----
  const scene = createScene($('three-canvas'));
  const fly = createFly();
  if (saved && typeof saved.hunger === 'number') fly.hunger = saved.hunger;
  scene.setFly(fly.group);
  const brainView = createBrainView($('brain-canvas'), data, groups);
  $('brainMeta').textContent = `${fmt(data.n)} neurons · ${fmt(data.e)} connections`;

  // ---- stimuli ----
  const active = {};   // group → hz
  const pathway = $('pathway');
  function stim(group, hz) {
    hz = Math.round(hz);
    if ((active[group] || 0) === hz) return;
    if (hz > 0) active[group] = hz; else delete active[group];
    post({ type: 'stim', group, hz });
    updatePathway();
  }
  let pathwayHold = 0;
  function say(key, holdMs = 0) { pathway.textContent = PATHWAYS[key] || key; pathway.classList.add('live'); pathwayHold = performance.now() + holdMs; }
  function updatePathway() {
    const smell = active.fruit ? 'fruit' : active.vinegar ? 'vinegar' : null;
    if (active.reward_DAN && smell) say('reward');
    else if (active.punish_DAN && smell) say('punish');
    else if (active.sugar && active.bitter) say('bitter');
    else if (active.sugar) say('sugar');
    else if (active.LC4) say('loom', 1500);
    else if (active.JO) say('poke', 1200);
    else if (smell) say(smell);
    else if (performance.now() > pathwayHold) { pathway.textContent = 'Resting. A quiet hum in the sensory neurons; nothing else until you do something.'; pathway.classList.remove('live'); }
  }
  const timers = {};
  function pulse(groupsToDrive, hz, ms, key) {
    for (const g of groupsToDrive) { stim(g, hz); clearTimeout(timers[g]); timers[g] = setTimeout(() => stim(g, 0), ms); }
    say(key, ms + 1200);
  }
  function shadow(dx = 1, dz = 0.2) { scene.sweepShadow(dx, dz); pulse(['LC4', 'LPLC2'], 150, 70, 'loom'); }
  function poke() { const p = fly.position; scene.ripple(p.x, p.z); pulse(['JO'], 140, 300, 'poke'); }

  // ---- memory (read from the mushroom body) ----
  const memory = { fruit: 0, vinegar: 0 };
  let memoryInfo = null, changedEdges = saved?.changed || 0;
  async function refreshMemory() {
    if (inline) return;
    const r = await request('memory');
    memoryInfo = r.memory;
    for (const k of ['fruit', 'vinegar']) {
      const m = memoryInfo[k]; if (!m) continue;
      memory[k] = m.bias;
      const bar = $(k === 'fruit' ? 'memFruitBar' : 'memVinegarBar'), val = $(k === 'fruit' ? 'memFruitVal' : 'memVinegarVal');
      const b = Math.max(-1, Math.min(1, m.bias * 1.6));
      bar.classList.toggle('neg', b < 0);
      if (b >= 0) { bar.style.left = '50%'; bar.style.width = `${b * 50}%`; } else { bar.style.left = `${50 + b * 50}%`; bar.style.width = `${-b * 50}%`; }
      val.textContent = !m.kcs ? 'unknown' : m.bias > 0.06 ? 'likes' : m.bias < -0.06 ? 'avoids' : 'neutral';
      val.className = 'val' + (m.bias > 0.06 ? ' like' : m.bias < -0.06 ? ' dislike' : '');
    }
    $('memMeta').textContent = changedEdges ? `${fmt(changedEdges)} synapses changed` : 'no synapses changed';
  }
  async function save() {
    if (inline) return;
    const r = await request('getState');
    writeSave({ v: SAVE_VERSION, plastic: r.plastic, odourKCs: r.odourKCs, changed: r.changed, hunger: fly.hunger, savedAt: Date.now() });
  }
  $('forget').addEventListener('click', () => { post({ type: 'forget' }); changedEdges = 0; try { localStorage.removeItem(SAVE_KEY); } catch {} refreshMemory(); });

  // ---- fly ↔ world ----
  const world = {
    droplets: scene.droplets,
    smellAt: scene.smellAt, smellGradient: scene.smellGradient, memory,
    onReachDroplet(d) { stim('sugar', 200); if (d.bitter) stim('bitter', 200); teach(d); },
    onLeaveDroplet() { stim('sugar', 0); stim('bitter', 0); stim('reward_DAN', 0); stim('punish_DAN', 0); },
  };
  function teach(d) {
    // sugar while a smell is present rewards it; bitter punishes it
    const smelling = active.fruit || active.vinegar;
    if (d.bitter) { stim('reward_DAN', 0); stim('punish_DAN', smelling ? TEACH_HZ : 0); }
    else { stim('punish_DAN', 0); stim('reward_DAN', smelling ? TEACH_HZ : 0); }
  }

  // ---- ticks ----
  let lastRates = new Float32Array(RATE_ORDER.length);
  let spikeWindow = [], spikeSum = 0, lastActive = 0, lastSpeed = 1, gfAt = -Infinity, kcOnWindow = [], kcOnSum = 0;
  onTick.push(t => {
    brainView.onSpikes(t.spikes);
    lastRates = t.rates; lastActive = t.active; lastSpeed = t.speed;
    if (t.changed !== undefined) changedEdges = t.changed;
    const now = performance.now();
    spikeWindow.push([now, t.spikes.length]); spikeSum += t.spikes.length;
    while (spikeWindow.length && now - spikeWindow[0][0] > 1000) spikeSum -= spikeWindow.shift()[1];
    kcOnWindow.push([now, t.kcOn || 0]); kcOnSum += t.kcOn || 0;
    while (kcOnWindow.length && now - kcOnWindow[0][0] > 1000) kcOnSum -= kcOnWindow.shift()[1];
    if (t.gf) { gfAt = now; fly.gfSpike(); }
    const r = k => t.rates[RATE_INDEX[k]];
    fly.setRates({ MN9: r('MN9'), MN6: r('MN6'), GF: r('GF'), groom: r('groom'), DNa01: r('DNa01'), DNa02: r('DNa02'), DN_L: r('DN_L'), DN_R: r('DN_R'), DNa02_L: r('DNa02_L'), DNa02_R: r('DNa02_R') });
  });

  // ---- pointer ----
  const canvas = $('three-canvas');
  let mode = 'sugar';
  const HINTS = { sugar: 'Click the base to drop sugar', bitter: 'Click the base, or a sugar drop, to add bitter', fruit: 'Click the base to puff a fruit smell', vinegar: 'Click the base to puff a vinegar smell' };
  const chips = $('chips');
  chips.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mode) { mode = b.dataset.mode; chips.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === b)); $('hint').textContent = HINTS[mode]; $('hint').classList.remove('fade'); }
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
      if (mode === 'fruit' || mode === 'vinegar') scene.addScent(mode, hit.point.x, hit.point.z);
      else {
        const drop = scene.addDroplet(mode, hit.point.x, hit.point.z);
        if (drop === fly.feeding && drop.bitter) { stim('bitter', 200); teach(drop); }
      }
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
  let last = performance.now(), hudAt = 0, smellAt = 0, memAt = 0, saveAt = performance.now(), flightAt = performance.now() + 20000 + Math.random() * 30000;
  function frame(now) {
    const dt = Math.min(100, now - last); last = now;
    fly.update(dt, world);
    const f = fly.feeding;
    if (f && !f.gone && lastRates[RATE_INDEX.MN9] > 5) { f.shrink(0.5 * dt / 1000); fly.eat(0.35 * (0.5 * dt / 1000) / 3.4); if (f.gone) fly.eat(0.1); }
    if (f && f.changed) { f.changed = false; if (f.bitter) { stim('bitter', 200); teach(f); } }
    if (now - smellAt > 100) {
      smellAt = now;
      const here = fly.flying ? { fruit: 0, vinegar: 0 } : scene.smellAt(fly.position.x, fly.position.z);
      stim('fruit', here.fruit * ODOUR_HZ); stim('vinegar', here.vinegar * ODOUR_HZ);
      if (f && !f.gone) teach(f);
    }
    if (now > flightAt && !f && fly.mode !== 'grooming' && !fly.flying) { fly.takeOff(); flightAt = now + 35000 + Math.random() * 50000; }
    scene.render(dt);
    brainView.render(now);
    if (now - hudAt > 120) { hudAt = now; hud(); }
    if (now - memAt > 2000) { memAt = now; refreshMemory(); }
    if (now - saveAt > 15000) { saveAt = now; save(); }
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
    hz('fruit', $('rFruit')); hz('vinegar', $('rVinegar'));
    $('rKC').textContent = kcOnSum ? `${fmt(kcOnSum)} / s` : '–';
    $('rDN').textContent = `${r('DN_L').toFixed(1)} / ${r('DN_R').toFixed(1)} Hz`;
    const modes = { idle: 'exploring', seeking: 'walking to a drop', feeding: 'tasting', grooming: 'grooming', jumping: 'jumping', flying: 'flying' };
    $('rMode').textContent = modes[fly.mode] || fly.mode;
    $('rHunger').textContent = `${(fly.hunger * 100).toFixed(0)} %`;
    $('flyStats').textContent = `${fmt(data.n)} neurons\n${lastActive ? fmt(lastActive) + ' active' : 'silent'}`;
    updatePathway();
  }
  const ro = new ResizeObserver(() => { scene.resize(); brainView.resize(); });
  ro.observe(canvas.parentElement); ro.observe($('brain-canvas'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', () => save());
  $('loading').classList.add('hide');
  refreshMemory();
  requestAnimationFrame(frame);

  window.cloche = { stim, shadow, poke, fly, scene, brainView, groups, data, post, request, save, memory, get memoryInfo() { return memoryInfo; } };
}

main().catch(err => { console.error(err); const s = $('loadStage'); if (s) { s.textContent = 'Something broke.'; $('loadSub').textContent = String(err.message || err); } });
