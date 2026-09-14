// cloche/app.js — the windowsill: loads the brains, runs the population,
// wires the world, the brain window, the panels, saving and the chips.
import { decodeBrain } from './data.js';
import { RATE_ORDER, RATE_INDEX, SAVE_VERSION } from './groups-order.js';
import { createBrainView } from './brainview.js';
import { createWorld, loadGltf } from './world.js';
import { createLifecycle } from './lifecycle.js';
import { createPopulation, budget } from './flies.js';

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('en-US');
const SAVE_KEY = 'cloche.windowsill';

const PATHWAYS = {
  sugar: 'sugar GRNs → SEZ interneurons → MN9 (rostrum) and MN6 (labella)',
  bitter: 'bitter GRNs inhibit the sugar pathway; MN9 goes quiet',
  loom: 'LC4 + LPLC2 looming detectors → giant fibre → jump',
  poke: 'Johnston\'s organ → antennal interneurons → descending neurons → grooming',
  fruit: 'fruit receptors → antennal lobe → projection neurons → Kenyon cells',
  vinegar: 'vinegar receptors → antennal lobe → projection neurons → Kenyon cells',
  reward: 'smell + sugar: PAM dopamine weakens this smell\'s Kenyon-cell synapses onto avoidance neurons',
  punish: 'smell + bitter: PPL1 dopamine weakens this smell\'s Kenyon-cell synapses onto approach neurons',
  court: 'LC10a sees her → P1 courtship cluster → pIP10 song command → wing extension',
  hear: 'song → Johnston\'s organ (JO-A) → auditory pathway → vpoDN acceptance',
  egg: 'oviDN egg-laying command → abdomen bends → an egg on the fruit',
};

function loadSave() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return s && s.v === SAVE_VERSION ? s : null; } catch { return null; } }
function writeSave(obj) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); } catch {} }

async function fetchBuffer(url, onProgress) {
  const res = await fetch(url); if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = +res.headers.get('Content-Length') || 0; const reader = res.body.getReader();
  const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress?.(got, total); }
  const buffer = new ArrayBuffer(got); const u8 = new Uint8Array(buffer); let o = 0; for (const c of chunks) { u8.set(c, o); o += c.length; }
  return buffer;
}

async function main() {
  if (!window.WebGLRenderingContext) { $('noWebgl').classList.add('show'); return; }
  const bar = $('loadBar'), stage = $('loadStage');
  const saved = loadSave();
  const maxFlies = budget();
  const datasets = {};
  try {
    stage.textContent = 'Loading the female connectome…';
    const fb = await fetchBuffer('./data/brain.bin', (g, t) => { if (t) bar.firstElementChild.style.width = `${Math.min(100, g / t * 50).toFixed(0)}%`; });
    datasets.female = { buffer: fb, groups: await (await fetch('./data/groups.json')).json(), data: decodeBrain(fb) };
    if (maxFlies >= 2) {
      stage.textContent = 'Loading the male connectome…';
      const mb = await fetchBuffer('./data/male.bin', (g, t) => { if (t) bar.firstElementChild.style.width = `${Math.min(100, 50 + g / t * 50).toFixed(0)}%`; });
      datasets.male = { buffer: mb, groups: await (await fetch('./data/male-groups.json')).json(), data: decodeBrain(mb) };
    }
    bar.firstElementChild.style.width = '100%';
  } catch (err) { stage.textContent = 'Could not load the connectomes.'; $('loadSub').textContent = String(err.message || err); return; }
  stage.textContent = 'Waking the neurons…';

  // Blender models: the set, the two fly bodies, the brood. The page works without them.
  stage.textContent = 'Setting the table…';
  const assets = {};
  await Promise.all(Object.entries({ set: 'set.glb', flyF: 'fly_female.glb', flyM: 'fly_male.glb', egg: 'egg.glb', larva: 'larva.glb', pupa: 'pupa.glb' }).map(async ([k, f]) => { try { assets[k] = await loadGltf('./assets/' + f); } catch (e) { console.warn('cloche: model failed', f, e); } }));
  const world = createWorld($('three-canvas'));
  if (assets.set) world.applySet(assets.set);
  const lifecycle = createLifecycle(world, { egg: assets.egg, larva: assets.larva, pupa: assets.pupa });
  const views = {};
  function viewFor(sex) { if (!views[sex]) views[sex] = createBrainView($('brain-canvas'), datasets[sex].data, datasets[sex].groups); return views[sex]; }
  let view = null;

  const pathway = $('pathway'); let pathwayHold = 0;
  function say(key, holdMs = 0) { pathway.textContent = PATHWAYS[key] || key; pathway.classList.add('live'); pathwayHold = performance.now() + holdMs; }
  const log = $('eventLog');
  function note(text) { const d = document.createElement('div'); d.textContent = text; log.prepend(d); while (log.children.length > 8) log.lastChild.remove(); }

  const pop = createPopulation({
    world, lifecycle, datasets, templates: { female: assets.flyF, male: assets.flyM },
    onSelect(fly) {
      if (!fly) return;
      view = viewFor(fly.sex); view.resize();
      $('brainMeta').textContent = `${fly.name} · ${fly.sex === 'male' ? 'male CNS v1.0' : 'FlyWire v783'} · ${fmt(datasets[fly.sex].data.n)} neurons`;
      $('brainNote').textContent = fly.sex === 'male' ? 'Male neurons are drawn at the position of their cell type in the female map; the nerve cord is laid out below.' : '';
      document.querySelectorAll('.court-row').forEach(r => r.hidden = false);
      refreshMemory();
    },
    onEvent(e) {
      if (e.type === 'tick') { e.fly.spikeWin = e.fly.spikeWin || []; const now = performance.now(); e.fly.spikeWin.push([now, e.t.spikes.length]); while (e.fly.spikeWin.length && now - e.fly.spikeWin[0][0] > 1000) e.fly.spikeWin.shift(); if (e.fly === pop.selected && view) view.onSpikes(e.t.spikes); }
      else if (e.type === 'spawn') note(`${e.fly.name} ${e.fly.teneral ? 'climbed out of its pupa' : 'arrived'}`);
      else if (e.type === 'remove') note(`${e.fly.name} flew out of the window`);
      else if (e.type === 'mating') { note(`${e.male.name} is mating with ${e.female.name}`); say('hear', 4000); }
      else if (e.type === 'mated') note(`${e.fly.name} is now mated`);
      else if (e.type === 'egg') { note(`${e.fly.name} laid an egg`); say('egg', 3000); }
      else if (e.type === 'error') note(`${e.fly.name}: brain error`);
    },
  });

  // ---- population from save or fresh
  const roster = saved?.flies || [];
  if (roster.length) { for (const r of roster.slice(0, maxFlies)) if (datasets[r.sex]) pop.spawn(r.sex, r.x, r.z, { state: r, silent: true }); }
  if (!pop.flies.length) {
    pop.spawn('female', -20, 20);
    if (maxFlies >= 2 && datasets.male) pop.spawn('male', 30, -10);
  }
  lifecycle.restore(saved?.lifecycle);

  // ---- stimuli helpers on the selected fly
  function shadow(dx = 1, dz = 0.3) { const s = pop.selected; world.sweepShadow(dx, dz, s ? s.body.position.x : 0, s ? s.body.position.z : 0); pop.shadowAll(dx, dz); say('loom', 1500); }
  function poke(fly = pop.selected) { if (!fly) return; const p = fly.body.position; world.ripple(p.x, p.z); pop.poke(fly); say('poke', 1200); }

  // ---- memory panel (selected fly)
  async function refreshMemory() {
    const f = pop.selected; if (!f) return;
    const m = await pop.memoryFor(f); if (!m || f !== pop.selected) return;
    for (const k of ['fruit', 'vinegar']) {
      const mm = m[k]; if (!mm) continue;
      const bar = $(k === 'fruit' ? 'memFruitBar' : 'memVinegarBar'), val = $(k === 'fruit' ? 'memFruitVal' : 'memVinegarVal');
      const b = Math.max(-1, Math.min(1, mm.bias * 1.6));
      bar.classList.toggle('neg', b < 0);
      if (b >= 0) { bar.style.left = '50%'; bar.style.width = `${b * 50}%`; } else { bar.style.left = `${50 + b * 50}%`; bar.style.width = `${-b * 50}%`; }
      val.textContent = !mm.kcs ? 'unknown' : mm.bias > 0.06 ? 'likes' : mm.bias < -0.06 ? 'avoids' : 'neutral';
      val.className = 'val' + (mm.bias > 0.06 ? ' like' : mm.bias < -0.06 ? ' dislike' : '');
    }
    $('memMeta').textContent = f.changed ? `${f.name} · ${fmt(f.changed)} synapses changed` : `${f.name} · no synapses changed`;
  }
  $('forget').addEventListener('click', () => { const f = pop.selected; if (f) { pop.forget(f); refreshMemory(); } });

  // ---- save
  async function save() {
    const flies = [];
    for (const f of pop.flies) { const st = await pop.stateFor(f); if (st) flies.push(st); }
    writeSave({ v: SAVE_VERSION, flies, lifecycle: lifecycle.state(), savedAt: Date.now() });
  }

  // ---- chips and pointer
  const canvas = $('three-canvas'); let mode = 'sugar';
  const HINTS = { sugar: 'Click the counter to drop sugar', bitter: 'Click the counter, food or a drop to add bitter', fruit: 'Click the counter to puff a fruit smell', vinegar: 'Click the counter to puff a vinegar smell' };
  const chips = $('chips');
  function updateAddButtons() { const full = pop.flies.length >= maxFlies; $('addF').disabled = full; $('addM').disabled = full || !datasets.male; $('popBudget').textContent = `${pop.flies.length} of ${maxFlies} brains running${maxFlies === 1 ? ' (one per spare core; this device has one)' : ''}`; }
  chips.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mode) { mode = b.dataset.mode; chips.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === b)); $('hint').textContent = HINTS[mode]; $('hint').classList.remove('fade'); }
    else if (b.dataset.act === 'shadow') shadow(1, 0.3);
    else if (b.dataset.act === 'poke') poke();
  });
  $('addF').addEventListener('click', () => { if (pop.flies.length < maxFlies) { const p = freeSpot(); pop.spawn('female', p.x, p.z); updateAddButtons(); } });
  $('addM').addEventListener('click', () => { if (pop.flies.length < maxFlies && datasets.male) { const p = freeSpot(); pop.spawn('male', p.x, p.z); updateAddButtons(); } });
  function freeSpot() { for (let i = 0; i < 20; i++) { const p = world.pushOut({ x: (Math.random() - 0.5) * 180, z: (Math.random() - 0.5) * 100 }); if (!pop.flies.some(f => Math.hypot(f.body.position.x - p.x, f.body.position.z - p.z) < 12)) return p; } return { x: 0, z: 0 }; }
  let down = null;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now(), shift: e.shiftKey }; });
  canvas.addEventListener('pointerup', e => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y, moved = Math.hypot(dx, dy); const d = down; down = null;
    if (d.shift && moved > 30) { shadow(dx, dy); return; }
    if (moved > 6 || performance.now() - d.t > 600) return;
    const hit = world.pick(e.clientX, e.clientY);
    if (hit.hitFly) { if (hit.hitFly === pop.selected) poke(hit.hitFly); else pop.select(hit.hitFly); }
    else if (hit.hitBase) {
      if (mode === 'fruit' || mode === 'vinegar') world.addScent(mode, hit.point.x, hit.point.z);
      else { const drop = world.addDroplet(mode, hit.point.x, hit.point.z); if (drop) for (const f of pop.flies) if (drop === f.body.feeding && drop.bitter) { pop.stim(f, 'bitter', 200); } }
      $('hint').classList.add('fade');
    }
  });
  canvas.addEventListener('pointercancel', () => { down = null; });
  document.querySelectorAll('.readout .k[data-group]').forEach(k => k.addEventListener('click', () => {
    const on = k.classList.contains('on');
    document.querySelectorAll('.readout .k.on').forEach(x => x.classList.remove('on'));
    if (!on) k.classList.add('on');
    view?.highlight(on ? null : k.dataset.group);
  }));

  // ---- loop
  let last = performance.now(), hudAt = 0, memAt = 0, saveAt = performance.now();
  function frame(now) {
    const dt = Math.min(100, now - last); last = now;
    pop.update(dt);
    for (const ev of lifecycle.update(dt)) if (ev.type === 'eclose') {
      const sex = Math.random() < 0.5 ? 'male' : 'female';
      const useSex = datasets[sex] ? sex : 'female';
      if (pop.flies.length >= maxFlies) { const oldest = pop.flies.reduce((a, b) => (a.age > b.age ? a : b)); pop.remove(oldest, 'left'); }
      pop.spawn(useSex, ev.x, ev.z, { teneral: true }); updateAddButtons();
    }
    world.render(dt);
    if (view) view.render(now);
    if (now - hudAt > 120) { hudAt = now; hud(); }
    if (now - memAt > 2000) { memAt = now; refreshMemory(); }
    if (now - saveAt > 20000) { saveAt = now; save(); }
    requestAnimationFrame(frame);
  }
  function hud() {
    const f = pop.selected; if (!f) return;
    const r = k => f.rates[RATE_INDEX[k]] || 0;
    const hz = (k, el, hot = 10) => { const v = r(k); el.textContent = v < 0.5 ? '–' : `${v.toFixed(0)} Hz`; el.classList.toggle('hot', v >= hot); };
    $('rActive').textContent = fmt(f.active);
    $('rSpikes').textContent = fmt((f.spikeWin || []).reduce((a, x) => a + x[1], 0));
    hz('MN9', $('rMN9')); hz('groom', $('rGroom'), 25);
    const ago = (performance.now() - f.lastGF) / 1000;
    $('rGF').textContent = ago > 3600 ? 'never' : ago < 1 ? 'FIRED' : `${ago.toFixed(0)} s ago`; $('rGF').classList.toggle('fire', ago < 1);
    $('rSpeed').textContent = `${f.speed.toFixed(2)}× real time`; $('rSpeed').classList.toggle('slow', f.speed < 0.8);
    hz('sugar', $('rSugar')); hz('bitter', $('rBitter')); hz('JO', $('rJO')); hz('LPLC2', $('rLoom'));
    hz('fruit', $('rFruit')); hz('vinegar', $('rVinegar'));
    $('rKC').textContent = f.kcOn ? `${fmt(f.kcOn)} / tick` : '–';
    $('rDN').textContent = `${r('DN_L').toFixed(1)} / ${r('DN_R').toFixed(1)} Hz`;
    if (f.sex === 'male') { hz('P1', $('rP1'), 1); hz('pIP10', $('rSong'), 3); hz('LC10a', $('rLC10'), 5); $('rHear').textContent = '–'; $('rAccept').textContent = '–'; $('rOvi').textContent = '–'; }
    else { $('rP1').textContent = '–'; $('rSong').textContent = '–'; $('rLC10').textContent = '–'; hz('JO_A', $('rHear')); hz('vpoDN', $('rAccept'), 4); hz('oviDN', $('rOvi'), 5); }
    const modes = { idle: 'exploring', seeking: 'walking to food', feeding: 'tasting', grooming: 'grooming', jumping: 'jumping', flying: 'flying', mating: 'mating', pursuing: 'walking', courting: 'courting' };
    $('rMode').textContent = modes[f.body.mode] || f.body.mode;
    $('rHunger').textContent = `${(f.body.hunger * 100).toFixed(0)} %`;
    $('rStatus').textContent = f.sex === 'male' ? (f.courting ? `courting ${f.courting.name}` : 'male') : (f.mated ? 'mated female' : 'virgin female');
    const c = lifecycle.counts();
    $('popAdults').textContent = `${pop.flies.filter(x => x.sex === 'female').length} ♀ · ${pop.flies.filter(x => x.sex === 'male').length} ♂`;
    $('popEggs').textContent = `${c.eggs} eggs · ${c.larvae} larvae · ${c.pupae} pupae`;
    updateAddButtons();
    // pathway
    const s = f.stim;
    const smell = s.fruit ? 'fruit' : s.vinegar ? 'vinegar' : null;
    if (s.reward_DAN && smell) say('reward'); else if (s.punish_DAN && smell) say('punish');
    else if (s.sugar && s.bitter) say('bitter'); else if (s.sugar) say('sugar');
    else if (f.courting) say('court'); else if (s.JO_A) say('hear'); else if (s.oviDN) say('egg');
    else if (smell) say(smell);
    else if (performance.now() > pathwayHold) { pathway.textContent = 'A quiet hum in the sensory neurons. Nothing else until something happens.'; pathway.classList.remove('live'); }
    $('flyStats').textContent = `${pop.flies.length} brain${pop.flies.length === 1 ? '' : 's'} · ${fmt(pop.flies.reduce((a, x) => a + x.active, 0))} neurons active`;
  }
  const ro = new ResizeObserver(() => { world.resize(); view?.resize(); });
  ro.observe(canvas.parentElement); ro.observe($('brain-canvas'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', () => save());
  $('loading').classList.add('hide');
  updateAddButtons();
  requestAnimationFrame(frame);
  window.cloche = { pop, world, lifecycle, datasets, shadow, poke, save, get selected() { return pop.selected; }, get view() { return view; } };
}

main().catch(err => { console.error(err); const s = $('loadStage'); if (s) { s.textContent = 'Something broke.'; $('loadSub').textContent = String(err.message || err); } });
