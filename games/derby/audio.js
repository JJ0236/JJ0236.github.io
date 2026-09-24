// Sound, made in the browser: there is nothing to download. Engines are a
// pair of detuned saws through a filter, crashes are noise bursts with a
// thump under them, and metal is a couple of ringing partials.
//
// Browsers refuse to make a sound until the page has been clicked or typed
// in, so everything waits for the first key or click.

const MAX_ENGINES = 4;          // the nearest cars you can hear
const HEAR = 70;                // metres

export function createAudio(store) {
  let ctx = null, master = null, noise = null;
  let muted = store.get('derby-mute', '0') === '1';
  let volume = Math.max(0, Math.min(1, +store.get('derby-volume', '0.7') || 0.7));
  const engines = new Map();    // car idx -> nodes
  let fire = null, wind = null;
  const listeners = new Set();

  function start() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    // One second of noise, reused by every crash, scrape and flame.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;         // a little brown noise in the mix
      d[i] = w * 0.7 + last * 3;
    }
  }
  /** The browser only allows sound after the person has done something. */
  const wake = () => {
    start();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  };

  const now = () => ctx.currentTime;
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  function burst({ v = 0.5, dur = 0.3, type = 'bandpass', freq = 900, q = 1, sweep = 0, dest }) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), now() + dur);
    const g = gain(0);
    g.gain.setValueAtTime(0, now());
    g.gain.linearRampToValueAtTime(v, now() + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0008, now() + dur);
    s.connect(f); f.connect(g); g.connect(dest || master);
    s.start();
    s.stop(now() + dur + 0.05);
    return g;
  }
  function tone({ f = 440, to = 0, v = 0.3, dur = 0.3, type = 'sine', dest }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, now());
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), now() + dur);
    const g = gain(0);
    g.gain.setValueAtTime(0, now());
    g.gain.linearRampToValueAtTime(v, now() + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, now() + dur);
    o.connect(g); g.connect(dest || master);
    o.start();
    o.stop(now() + dur + 0.05);
  }

  /** Where a sound sits: quieter far away, and to the side it came from. */
  function place(at, cam) {
    const g = gain(1);
    const p = ctx.createStereoPanner();
    g.connect(p); p.connect(master);
    const set = (pos) => {
      if (!pos || !cam) return 1;
      const dx = pos[0] - cam.pos[0], dy = pos[1] - cam.pos[1], dz = pos[2] - cam.pos[2];
      const d = Math.hypot(dx, dy, dz);
      const vol = Math.max(0, 1 - d / HEAR) ** 2;
      const right = [-Math.sin(cam.yaw), 0, Math.cos(cam.yaw)];
      p.pan.value = Math.max(-0.9, Math.min(0.9, (dx * right[0] + dz * right[2]) / Math.max(4, d)));
      g.gain.value = vol;
      return vol;
    };
    return { node: g, set };
  }

  /** One car's engine: two saws and a rumble, filtered by how hurt it is. */
  function engineFor(idx) {
    let e = engines.get(idx);
    if (e) return e;
    const out = gain(0);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    const pan = ctx.createStereoPanner();
    const saw1 = ctx.createOscillator(), saw2 = ctx.createOscillator(), sub = ctx.createOscillator();
    saw1.type = saw2.type = 'sawtooth';
    sub.type = 'square';
    const mix = gain(0.5), subGain = gain(0.35);
    saw1.connect(mix); saw2.connect(mix); sub.connect(subGain);
    mix.connect(filter); subGain.connect(filter);
    filter.connect(out); out.connect(pan); pan.connect(master);
    saw1.start(); saw2.start(); sub.start();
    e = { out, filter, pan, saw1, saw2, sub, idx };
    engines.set(idx, e);
    return e;
  }

  function stopEngine(idx) {
    const e = engines.get(idx);
    if (!e) return;
    e.out.gain.setTargetAtTime(0, now(), 0.05);
    for (const o of [e.saw1, e.saw2, e.sub]) o.stop(now() + 0.3);
    engines.delete(idx);
  }

  /** A loop that is turned up and down: fire, and the wind over the quarry. */
  function loop(freq, q, type = 'lowpass') {
    const s = ctx.createBufferSource();
    s.buffer = noise; s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = gain(0);
    s.connect(f); f.connect(g); g.connect(master);
    s.start();
    return { gain: g, filter: f };
  }

  const api = {
    /** Call from the first click or key: browsers need that before any sound. */
    wake,
    get muted() { return muted; },
    get volume() { return volume; },
    set(v, isMuted) {
      volume = Math.max(0, Math.min(1, v));
      muted = !!isMuted;
      store.set('derby-volume', String(volume));
      store.set('derby-mute', muted ? '1' : '0');
      if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
      for (const fn of listeners) fn();
    },
    onChange(fn) { listeners.add(fn); },

    /** Engines, fire and wind, once a frame. */
    update(view, cam, me) {
      if (!ctx || !view) return;
      if (ctx.state === 'suspended') return;
      const heard = [];
      for (const c of view.cars) {
        if (c.out) continue;
        const d = cam ? Math.hypot(c.pos[0] - cam.pos[0], c.pos[1] - cam.pos[1], c.pos[2] - cam.pos[2]) : 0;
        if (d < HEAR) heard.push({ c, d });
      }
      heard.sort((a, b) => (a.c.idx === me ? -1 : b.c.idx === me ? 1 : a.d - b.d));
      const keep = new Set();
      for (const { c, d } of heard.slice(0, MAX_ENGINES)) {
        keep.add(c.idx);
        const e = engineFor(c.idx);
        const speed = Math.hypot(c.vel[0], c.vel[2]);
        const mine = c.idx === me;
        // Revs rise with speed and fall back to an idle burble.
        const rev = 42 + speed * 7.5 + (c.boosting ? 40 : 0);
        const t = now();
        e.saw1.frequency.setTargetAtTime(rev, t, 0.08);
        e.saw2.frequency.setTargetAtTime(rev * 1.01, t, 0.08);
        e.sub.frequency.setTargetAtTime(rev / 2, t, 0.08);
        // A hurt engine sounds rough and muffled.
        const health = Math.max(0, Math.min(1, c.engine / 100));
        e.filter.frequency.setTargetAtTime(500 + health * 1600 + speed * 40, t, 0.1);
        const near = mine ? 1 : Math.max(0, 1 - d / HEAR) ** 2;
        e.out.gain.setTargetAtTime(near * (mine ? 0.16 : 0.1) * (0.5 + health * 0.5), t, 0.08);
        if (cam) {
          const dx = c.pos[0] - cam.pos[0], dz = c.pos[2] - cam.pos[2];
          const dist = Math.max(4, Math.hypot(dx, dz));
          const right = [-Math.sin(cam.yaw), 0, Math.cos(cam.yaw)];
          e.pan.pan.setTargetAtTime(mine ? 0 : Math.max(-0.9, Math.min(0.9, (dx * right[0] + dz * right[2]) / dist)), now(), 0.08);
        }
      }
      for (const idx of [...engines.keys()]) if (!keep.has(idx)) stopEngine(idx);

      // Your own car on fire, and the wind over the quarry.
      const mineCar = view.cars.find(c => c.idx === me);
      if (!fire) fire = loop(600, 0.7);
      const burning = mineCar && !mineCar.out && mineCar.engine < 15 ? 0.1 : mineCar && mineCar.out === 'wreck' ? 0.07 : 0;
      fire.gain.gain.setTargetAtTime(burning, now(), 0.3);
      if (!wind) wind = loop(320, 0.4);
      wind.gain.gain.setTargetAtTime(0.012, now(), 1);
    },

    /** What just happened. */
    events(events, view, cam, me) {
      if (!ctx || ctx.state === 'suspended' || !view) return;
      for (const e of events) {
        const car = e.c !== undefined ? view.cars[e.c] : null;
        const at = car ? car.pos : null;
        const spot = at ? place(at, cam) : null;
        const vol = spot ? spot.set(at) : 1;
        const dest = spot ? spot.node : master;
        if (vol <= 0.02 && e.type !== 'go' && e.type !== 'roundEnd') continue;
        switch (e.type) {
          case 'hit': {
            const hard = e.s > 0.25, mid = e.s > 0.12;
            burst({ v: hard ? 0.9 : mid ? 0.5 : 0.22, dur: hard ? 0.5 : 0.25, freq: hard ? 700 : 1500, q: 0.8, sweep: 0.3, dest });
            tone({ f: hard ? 90 : 150, to: hard ? 45 : 80, v: hard ? 0.8 : 0.3, dur: hard ? 0.45 : 0.2, dest });
            if (hard) { tone({ f: 1400, to: 1200, v: 0.12, dur: 0.6, type: 'triangle', dest }); }
            break;
          }
          case 'detach':
            burst({ v: 0.4, dur: 0.5, freq: 2200, q: 2, sweep: 0.4, dest });
            tone({ f: 820, to: 700, v: 0.18, dur: 0.7, type: 'triangle', dest });
            tone({ f: 1230, to: 1100, v: 0.1, dur: 0.5, type: 'triangle', dest });
            break;
          case 'crush':
            tone({ f: 70, to: 35, v: 0.9, dur: 0.8, dest });
            burst({ v: 0.7, dur: 0.7, freq: 500, q: 0.7, sweep: 0.2, dest });
            break;
          case 'wreck':
            tone({ f: 120, to: 40, v: 0.6, dur: 0.9, dest });
            burst({ v: 0.5, dur: 1.2, freq: 400, q: 0.5, sweep: 0.3, dest });
            break;
          case 'fell':
            tone({ f: 300, to: 60, v: 0.35, dur: 1.4, type: 'triangle', dest });
            break;
          case 'pickup':
            if (e.c === me) { tone({ f: 660, v: 0.25, dur: 0.16 }); setTimeout(() => ctx && tone({ f: 990, v: 0.22, dur: 0.22 }), 110); }
            break;
          case 'land':
            tone({ f: 60, to: 30, v: 0.8, dur: 0.7 });
            burst({ v: 0.5, dur: 0.6, freq: 420, q: 0.6, sweep: 0.25 });
            break;
          case 'crumble':
            tone({ f: 80, to: 32, v: 0.5, dur: 1.6 });
            burst({ v: 0.35, dur: 1.8, freq: 300, q: 0.4, sweep: 0.3 });
            break;
          case 'go':
            tone({ f: 880, v: 0.3, dur: 0.5, type: 'square' });
            break;
          case 'roundEnd':
            for (const [i, f] of [523, 659, 784].entries()) setTimeout(() => ctx && tone({ f, v: 0.22, dur: 0.5, type: 'triangle' }), i * 130);
            break;
          default: break;
        }
      }
    },

    /** The countdown: a beep a second, from the clock rather than an event. */
    beep(n) {
      if (!ctx || ctx.state === 'suspended') return;
      tone({ f: n > 0 ? 440 : 880, v: 0.22, dur: n > 0 ? 0.14 : 0.4, type: 'square' });
    },

    /** For tests: is there a sound graph, and how much of it is running. */
    debug: () => ({ ctx: ctx ? ctx.state : 'none', engines: engines.size, muted, volume }),

    /** Between matches: no engines left running. */
    silence() {
      for (const idx of [...engines.keys()]) stopEngine(idx);
      if (fire) fire.gain.gain.setTargetAtTime(0, now(), 0.1);
    },
  };
  return api;
}
