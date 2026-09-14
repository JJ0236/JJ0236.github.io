// cloche/flies.js — the population: one full brain per fly in its own
// worker, bodies in the world, stimuli from where each fly stands, the
// courtship coupling between brains, egg laying, selection.
import { createFly, FLY_SCALE } from './fly.js';
import { RATE_ORDER, RATE_INDEX, BACKGROUND_HZ } from './groups-order.js';

export const ODOUR_HZ = 100, TEACH_HZ = 20;
const COURT_RANGE = 22, TOUCH_RANGE = 4.5, SONG_RANGE = 26;

export function budget() {
  const cores = navigator.hardwareConcurrency || 2;
  const phone = /Mobi|Android/i.test(navigator.userAgent) || Math.min(window.innerWidth, window.innerHeight) < 600;
  return phone ? 1 : Math.max(1, Math.min(4, cores - 1));
}

export function createPopulation({ world, lifecycle, datasets, templates = {}, onSelect, onEvent }) {
  const flies = [];
  let nextId = 1, selected = null;
  const foods = [];   // droplets + food sites, as the body's controller sees them
  for (const o of world.objects) for (const f of o.food) foods.push({ x: f.x, z: f.z, radius: f.r, site: f, bitter: !!f.bitter, gone: false, rejected: false, rejectedUntil: 0, shrink() {} });
  function refreshFoods() {
    const now = performance.now();
    for (const f of foods) { if (f.site) { const info = world.foodAt(f.x, f.z); f.bitter = !!(info && info.bitter); if (f.rejected && now > f.rejectedUntil) f.rejected = false; } }
    const list = [...world.droplets, ...foods];
    return list;
  }

  function spawn(sex, x, z, { teneral = false, state = null, silent = false } = {}) {
    const ds = datasets[sex];
    if (!ds) return null;
    const id = nextId++;
    const body = createFly({ sex, teneral, template: templates[sex] || null });
    body.setPosition(x, z, Math.random() * 6.28);
    if (state?.hunger !== undefined) body.hunger = state.hunger; else body.hunger = teneral ? 0.7 : 0.4 + Math.random() * 0.3;
    const fly = {
      id, sex, name: `${sex === 'male' ? '♂' : '♀'} ${id}`, body, dataset: sex,
      rates: new Float32Array(RATE_ORDER.length), active: 0, speed: 1, changed: state?.changed || 0, kcOn: 0,
      memory: { fruit: 0, vinegar: 0 }, memoryInfo: null, stim: {}, timers: {},
      mated: !!state?.mated, virgin: state ? !state.mated : true, age: state?.age || 0, teneral,
      lastGF: -Infinity, courting: null, acceptT: 0, matingUntil: 0, courtCooldown: 0, eggTimer: 30000 + Math.random() * 30000, flightAt: performance.now() + 30000 + Math.random() * 60000,
      worker: null, post: null, ready: false, pending: new Map(), reqId: 0, spikesForView: null,
    };
    body.group.userData.fly = fly;
    world.addFlyObject(body.group);
    // brain
    const worker = new Worker('./worker.js', { type: 'module' });
    const wbuf = ds.buffer.slice(0);
    worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'ready') { fly.ready = true; return; }
      if (m.type === 'tick') { onTick(fly, m); return; }
      const r = fly.pending.get(m.id); if (r) { r(m); fly.pending.delete(m.id); }
    };
    worker.onerror = e => { console.error('cloche worker', fly.name, e.message); onEvent?.({ type: 'error', fly, message: e.message }); };
    worker.postMessage({ type: 'init', buffer: wbuf, groups: ds.groups, state: state?.brain || null, backgroundHz: sex === 'male' ? BACKGROUND_HZ / 2 : BACKGROUND_HZ }, [wbuf]);
    fly.worker = worker;
    fly.post = m => worker.postMessage(m);
    fly.request = (type, extra = {}) => new Promise(res => { const id = ++fly.reqId; fly.pending.set(id, res); fly.post({ type, id, ...extra }); });
    flies.push(fly);
    if (!selected) select(fly);
    if (!silent) onEvent?.({ type: 'spawn', fly });
    return fly;
  }
  function remove(fly, reason = 'left') {
    const k = flies.indexOf(fly); if (k < 0) return;
    flies.splice(k, 1);
    try { fly.worker.terminate(); } catch {}
    world.removeFlyObject(fly.body.group);
    for (const f of flies) if (f.courting === fly) f.courting = null;
    if (selected === fly) select(flies[0] || null);
    onEvent?.({ type: 'remove', fly, reason });
  }
  function select(fly) { selected = fly; onSelect?.(fly); }
  function stim(fly, group, hz) {
    hz = Math.round(hz);
    if ((fly.stim[group] || 0) === hz) return;
    if (hz > 0) fly.stim[group] = hz; else delete fly.stim[group];
    fly.post({ type: 'stim', group, hz });
  }
  function pulse(fly, groups, hz, ms) { for (const g of groups) { stim(fly, g, hz); clearTimeout(fly.timers[g]); fly.timers[g] = setTimeout(() => stim(fly, g, 0), ms); } }

  function onTick(fly, t) {
    fly.rates = t.rates; fly.active = t.active; fly.speed = t.speed; fly.kcOn = t.kcOn || 0;
    if (t.changed !== undefined) fly.changed = t.changed;
    if (t.gf) { fly.lastGF = performance.now(); fly.body.gfSpike(); }
    const r = k => t.rates[RATE_INDEX[k]] || 0;
    fly.body.setRates({ MN9: r('MN9'), MN6: r('MN6'), GF: r('GF'), groom: r('groom'), DNa01: r('DNa01'), DNa02: r('DNa02'), DN_L: r('DN_L'), DN_R: r('DN_R'), DNa02_L: r('DNa02_L'), DNa02_R: r('DNa02_R') });
    if (fly === selected) fly.spikesForView = t.spikes;
    onEvent?.({ type: 'tick', fly, t });
  }

  function teach(fly, food) {
    const smelling = fly.stim.fruit || fly.stim.vinegar;
    if (food.bitter) { stim(fly, 'reward_DAN', 0); stim(fly, 'punish_DAN', smelling ? TEACH_HZ : 0); }
    else { stim(fly, 'punish_DAN', 0); stim(fly, 'reward_DAN', smelling ? TEACH_HZ : 0); }
  }
  function worldFor(fly) {
    return {
      droplets: world.droplets, foods: refreshFoods(),
      smellAt: world.smellAt, smellGradient: world.smellGradient, memory: fly.memory,
      heightAt: world.heightAt, surfaceAt: world.surfaceAt, walkable: world.walkable, pushOut: world.pushOut, objects: world.objects, planFlight: world.planFlight, planHop: world.planHop,
      onReachDroplet(d) { stim(fly, 'sugar', 200); if (d.bitter) stim(fly, 'bitter', 200); teach(fly, d); fly.feedingOn = d; },
      onLeaveDroplet() { stim(fly, 'sugar', 0); stim(fly, 'bitter', 0); stim(fly, 'reward_DAN', 0); stim(fly, 'punish_DAN', 0); fly.feedingOn = null; },
    };
  }

  let smellAt = 0;
  function update(dtMs) {
    const now = performance.now();
    const doSmell = now - smellAt > 100; if (doSmell) smellAt = now;
    for (const fly of flies) {
      const b = fly.body;
      fly.age += dtMs;
      if (fly.teneral) { const pale = Math.max(0, 1 - fly.age / 60000); b.paleness = pale; if (pale <= 0) fly.teneral = false; }
      b.update(dtMs, worldFor(fly));
      const f = b.feeding;
      if (f) {
        const r = fly.rates[RATE_INDEX.MN9] || 0;
        if (r > 5) { f.shrink(0.5 * dtMs / 1000); b.eat((f.site ? 0.25 : 0.35) * (0.5 * dtMs / 1000) / 3.4); if (f.gone) b.eat(0.1); }
        if (f.changed) { f.changed = false; if (f.bitter) { stim(fly, 'bitter', 200); teach(fly, f); } }
        if (f.bitter && !fly.stim.bitter) { stim(fly, 'bitter', 200); teach(fly, f); }
        if (f.rejected) f.rejectedUntil = now + 30000;
      }
      if (doSmell) {
        const here = b.flying ? { fruit: 0, vinegar: 0 } : world.smellAt(b.position.x, b.position.z);
        stim(fly, 'fruit', here.fruit * ODOUR_HZ); stim(fly, 'vinegar', here.vinegar * ODOUR_HZ);
        if (f && !f.gone) teach(fly, f);
      }
      // flights
      if (now > fly.flightAt && !f && !b.flying && !b.mounting && !b.hold && b.mode !== 'grooming' && !fly.courting) { fly.flightAt = b.takeOff() ? now + 45000 + Math.random() * 70000 : now + 6000; }
    }
    separate();
    courtship(dtMs, now);
    eggs(dtMs, now);
  }
  // flies do not walk through each other
  function separate() {
    const minD = 2.4 * FLY_SCALE;
    for (let i = 0; i < flies.length; i++) for (let j = i + 1; j < flies.length; j++) {
      const a = flies[i].body, b = flies[j].body;
      if (a.flying || b.flying || a.mounting || b.mounting || a.hold || b.hold) continue;
      const pa = a.position, pb = b.position; const dx = pb.x - pa.x, dz = pb.z - pa.z; const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < minD) { const push = (minD - d) / 2, ux = dx / d, uz = dz / d; a.nudge(-ux * push, -uz * push); b.nudge(ux * push, uz * push); }
    }
  }

  function courtship(dtMs, now) {
    for (const m of flies) {
      if (m.sex !== 'male') continue;
      const mb = m.body;
      if (mb.mounting || mb.flying || now < m.courtCooldown) { if (!mb.mounting) { stim(m, 'LC10a', 0); stim(m, 'tpGRN', 0); mb.setSong(0); } continue; }
      // nearest female in range, and how well he faces her
      let best = null, bd = COURT_RANGE, facing = 0;
      for (const f of flies) {
        if (f.sex !== 'female' || f.body.flying) continue;
        const dx = f.body.position.x - mb.position.x, dz = f.body.position.z - mb.position.z, d = Math.hypot(dx, dz);
        if (d < bd) { bd = d; best = f; const a = Math.atan2(dx, dz) - mb.heading; facing = Math.max(0, Math.cos(a)); }
      }
      if (!best) { m.courting = null; stim(m, 'LC10a', 0); stim(m, 'tpGRN', 0); mb.setSong(0); if (mb.pursuit?.mode === 'courting') mb.setPursuit(null); continue; }
      // his visual tracking neurons: strongest when she is centred and close
      stim(m, 'LC10a', 120 * Math.sqrt(facing) * (1 - 0.5 * bd / COURT_RANGE));
      stim(m, 'tpGRN', bd < TOUCH_RANGE ? 60 : 0);
      // a courting male is not hungry enough to leave her unless he is starving
      if (mb.feeding && mb.hunger < 0.85 && (m.rates[RATE_INDEX.pIP10] || 0) > 1) mb.stopFeeding();
      const pip = m.rates[RATE_INDEX.pIP10] || 0;   // the song command is the courtship readout
      const song = Math.min(1, pip / 15);
      if (pip > 1.5) {
        m.courting = best;
        if (mb.feeding) mb.stopFeeding();
        if (!mb.pursuit || mb.pursuit.mode !== 'courting') mb.setPursuit({ fly: best.body, stopAt: 3.2, speed: 9, mode: 'courting' });
        mb.setSong(song);
        // she hears him
        if (song > 0.05 && bd < SONG_RANGE) { stim(best, 'JO_A', 100 * song * (1 - bd / SONG_RANGE)); best.heardT = (best.heardT || 0) + dtMs; }
        else { stim(best, 'JO_A', 0); best.heardT = Math.max(0, (best.heardT || 0) - dtMs * 0.3); }
        // The model does not carry hearing through to vpoDN on its own (JO-A drive leaves it
        // silent), so once she has heard three seconds of song the page drives vpoDN itself
        // and reads its firing as acceptance. Disclosed on the page.
        if (best.virgin && best.heardT > 3000 && !best.stim.vpoDN && now - (best.vpoAt || 0) > 6000) { pulse(best, ['vpoDN'], 40, 2500); best.vpoAt = now; }
        const vpo = best.rates[RATE_INDEX.vpoDN] || 0;
        if (best.virgin && !best.body.mounting && !best.body.hold && vpo > 4) best.acceptT += dtMs; else best.acceptT = Math.max(0, best.acceptT - dtMs * 0.5);
        if (best.acceptT > 1500 && bd < 7) {
          // mating
          best.acceptT = 0; best.heardT = 0; m.courting = null; mb.setPursuit(null); mb.setSong(0);
          stim(m, 'LC10a', 0); stim(m, 'tpGRN', 0); stim(best, 'JO_A', 0);
          best.body.hold = true; best.body.setPursuit(null);
          mb.mountOn(best.body, 20000);
          best.matingUntil = now + 20000; m.courtCooldown = now + 90000;
          onEvent?.({ type: 'mating', male: m, female: best });
        }
      } else { if (m.courting) { m.courting = null; if (mb.pursuit?.mode === 'courting') mb.setPursuit(null); } mb.setSong(0); stim(best, 'JO_A', 0); }
    }
    for (const f of flies) if (f.sex === 'female' && f.matingUntil && now > f.matingUntil) { f.matingUntil = 0; f.body.hold = false; f.mated = true; f.virgin = false; onEvent?.({ type: 'mated', fly: f }); }
  }

  function eggs(dtMs, now) {
    for (const f of flies) {
      if (f.sex !== 'female' || !f.mated || f.body.feeding || f.body.flying || f.body.hold) continue;
      f.eggTimer -= dtMs;
      const site = world.eggSiteAt(f.body.position.x, f.body.position.z);
      if (f.eggTimer > 0) continue;
      if (!site) {
        // go find fruit to lay on
        if (!f.body.pursuit && f.body.hunger < 0.5) { let best = null, bd = Infinity; for (const o of world.objects) if (o.eggSite) { const d = Math.hypot(o.eggSite.x - f.body.position.x, o.eggSite.z - f.body.position.z); if (d < bd) { bd = d; best = o.eggSite; } } if (best) f.body.setPursuit({ x: best.x + (Math.random() - 0.5) * best.r, z: best.z + (Math.random() - 0.5) * best.r, stopAt: 3, speed: 7, mode: 'looking for a place to lay', arrive() {} }); }
        continue;
      }
      if (!f.stim.oviDN) { pulse(f, ['oviDN'], 50, 2500); f.oviAt = now; }
      if ((f.rates[RATE_INDEX.oviDN] || 0) > 5 && now - (f.laidAt || 0) > 4000) {
        f.body.oviposit();
        const p = f.body.position, h = f.body.heading;
        const egg = lifecycle.layEgg(p.x - Math.sin(h) * 2.4 * FLY_SCALE * 0.8, p.z - Math.cos(h) * 2.4 * FLY_SCALE * 0.8);
        f.laidAt = now; f.eggTimer = 45000 + Math.random() * 40000;
        onEvent?.({ type: 'egg', fly: f, egg });
      }
    }
  }

  async function memoryFor(fly) {
    if (!fly?.ready) return null;
    const r = await fly.request('memory'); fly.memoryInfo = r.memory;
    for (const k of ['fruit', 'vinegar']) if (r.memory?.[k]) fly.memory[k] = r.memory[k].bias;
    return r.memory;
  }
  async function stateFor(fly) {
    if (!fly?.ready) return null;
    const r = await fly.request('getState');
    return { brain: { plastic: r.plastic, odourKCs: r.odourKCs }, changed: r.changed, hunger: fly.body.hunger, mated: fly.mated, age: fly.age, sex: fly.sex, x: fly.body.position.x, z: fly.body.position.z };
  }
  function forget(fly) { fly.post({ type: 'forget' }); fly.changed = 0; }
  function shadowAll(dx, dz) { for (const f of flies) pulse(f, ['LC4', 'LPLC2'], 150, 70); }
  function gust(strength = 1) {
    for (const f of flies) {
      pulse(f, ['JO'], 90 * strength, 600);
      if (!f.body.flying && !f.body.mounting && !f.body.hold) { const k = 3 * strength; f.body.nudge((Math.random() - 0.5) * k, k * 1.6); }
      f.gustAt = performance.now();
    }
  }
  function poke(fly) { pulse(fly, ['JO'], 140, 300); }

  return { flies, spawn, remove, select, get selected() { return selected; }, update, stim, pulse, memoryFor, stateFor, forget, shadowAll, gust, poke, budget };
}
