// Drawing, on a plain 2D canvas. The ground lives on its own canvas the
// size of the map: the sim rubs holes in its mask, and the same holes are
// rubbed out of the picture here, so craters are just missing pixels.

import * as T from './terrain.js?v=1';
import { WEAPONS } from './weapons.js?v=1';

const SKY_TOP = '#8FB2CE';
const SKY_LOW = '#DCC9A8';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const ground = document.createElement('canvas');
  ground.width = T.W; ground.height = T.H;
  const gctx = ground.getContext('2d', { willReadFrequently: true });
  // What is behind the ground: the shape of the map as it started, in the
  // dark, so craters and caves read as dug out rather than as sky.
  const bedrock = document.createElement('canvas');
  bedrock.width = T.W; bedrock.height = T.H;
  const bctx = bedrock.getContext('2d');
  let shake = 0;
  const bits = [];          // sparks, smoke, dirt
  const marks = [];         // floating damage numbers
  const trails = new Map(); // shot trails, by index

  const hash2 = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };

  /**
   * Paint the whole map from its mask. Colour follows the distance to the
   * nearest air in any direction, not the depth straight down, or the grass
   * would smear down cliffs and grow on the ceilings of caves.
   */
  function paint(mask, top) {
    const n = T.W * T.H;
    const dist = new Uint16Array(n);
    const FAR = 9999;
    for (let i = 0; i < n; i++) dist[i] = mask[i] ? FAR : 0;
    // Two passes of a chamfer distance: down-right, then up-left.
    for (let y = 0; y < T.H; y++) {
      for (let x = 0; x < T.W; x++) {
        const i = y * T.W + x;
        if (!dist[i]) continue;
        let best = y === 0 ? 3 : dist[i - T.W] + 3;              // off the top counts as air
        if (x > 0) best = Math.min(best, dist[i - 1] + 3, y > 0 ? dist[i - T.W - 1] + 4 : 4);
        else best = Math.min(best, 3);
        if (x < T.W - 1 && y > 0) best = Math.min(best, dist[i - T.W + 1] + 4);
        if (best < dist[i]) dist[i] = best;
      }
    }
    for (let y = T.H - 1; y >= 0; y--) {
      for (let x = T.W - 1; x >= 0; x--) {
        const i = y * T.W + x;
        if (!dist[i]) continue;
        let best = dist[i];
        if (y < T.H - 1) best = Math.min(best, dist[i + T.W] + 3);
        if (x < T.W - 1) best = Math.min(best, dist[i + 1] + 3, y < T.H - 1 ? dist[i + T.W + 1] + 4 : best);
        else best = Math.min(best, 3);
        if (x > 0 && y < T.H - 1) best = Math.min(best, dist[i + T.W - 1] + 4);
        if (best < dist[i]) dist[i] = best;
      }
    }
    const img = gctx.createImageData(T.W, T.H);
    const d = img.data;
    const grass = [94, 124, 78], edge = [58, 78, 48], rim = [96, 68, 46], soil = [142, 101, 66], deep = [104, 84, 70], rock = [116, 108, 99];
    for (let y = 0; y < T.H; y++) {
      // Strata sag and rise across the map, so they never look like stripes.
      for (let x = 0; x < T.W; x++) {
        const i = y * T.W + x;
        if (!mask[i]) continue;
        const o = i * 4;
        const wob = Math.sin(x * 0.011) * 9 + Math.sin(x * 0.037 + 1.3) * 4;
        const near = dist[i] / 3;                                  // pixels to the nearest air
        const grain = hash2(x, y) * 16 - 8;
        const band = Math.sin((y + wob) * 0.055) * 0.5 + Math.sin((y + wob) * 0.017 + 2.1) * 0.5;
        // Grass grows where the ground faces up, not down a cliff: compare
        // how much earth is above this spot with how much is below.
        let up = false;
        if (near < 8) {
          let above = 0, below = 0;
          for (const dx of [-3, 0, 3]) {
            for (let dy = 1; dy <= 4; dy++) {
              if (y - dy >= 0 && mask[(y - dy) * T.W + x + dx]) above++;
              if (y + dy < T.H && mask[(y + dy) * T.W + x + dx]) below++;
            }
          }
          up = below - above > 4;
        }
        let c;
        if (near < 4 && up) c = grass;
        else if (near < 7 && up) c = edge;
        else if (near < 3) c = rim;
        else if (near < 26) c = soil;
        else c = band > 0.45 ? rock : deep;
        const shade = near < 7 ? 0 : band * 7 - Math.min(20, near * 0.12);
        d[o] = c[0] + grain + shade; d[o + 1] = c[1] + grain + shade; d[o + 2] = c[2] + grain + shade; d[o + 3] = 255;
      }
    }
    gctx.putImageData(img, 0, 0);
    // The backdrop: everything under the original hill line, in shadow, so
    // caves and craters read as dug out instead of showing the sky.
    const back = bctx.createImageData(T.W, T.H);
    const bd = back.data;
    for (let x = 0; x < T.W; x++) {
      const from = top ? Math.max(0, top[x] | 0) : 0;
      for (let y = from; y < T.H; y++) {
        const o = (y * T.W + x) * 4;
        const k = Math.min(1, (y - from) / 220);
        bd[o] = 54 - k * 16; bd[o + 1] = 42 - k * 13; bd[o + 2] = 35 - k * 11; bd[o + 3] = 255;
      }
    }
    bctx.putImageData(back, 0, 0);
  }

  /** Blow a hole in the picture, with a scorched rim. */
  function hole(x, y, r) {
    gctx.save();
    gctx.globalCompositeOperation = 'destination-out';
    gctx.beginPath();
    gctx.arc(x, y, r, 0, Math.PI * 2);
    gctx.fill();
    gctx.globalCompositeOperation = 'source-atop';
    gctx.strokeStyle = 'rgba(28, 22, 16, 0.55)';
    gctx.lineWidth = 7;
    gctx.beginPath();
    gctx.arc(x, y, r + 3, 0, Math.PI * 2);
    gctx.stroke();
    gctx.restore();
  }

  function spray(x, y, n, kind) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = kind === 'smoke' ? 30 + Math.random() * 40 : 60 + Math.random() * 260;
      bits.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'smoke' ? 60 : 40),
        life: 0, max: 0, kind, size: kind === 'smoke' ? 6 + Math.random() * 10 : 2 + Math.random() * 3,
      });
      const b = bits[bits.length - 1];
      b.max = b.life = kind === 'smoke' ? 1.4 + Math.random() : 0.5 + Math.random() * 0.8;
    }
  }

  function events(list, view) {
    for (const e of list) {
      if (e.type === 'boom') {
        hole(e.x, e.y, e.r);
        spray(e.x, e.y, Math.min(60, 14 + e.r), 'dirt');
        spray(e.x, e.y, 10, 'smoke');
        shake = Math.min(18, shake + e.r * 0.12);
      } else if (e.type === 'hurt') {
        const u = view && view.units[e.unit];
        if (u && e.amount > 0) marks.push({ x: u.x, y: u.y - 16, text: '-' + e.amount, life: 1.2 });
      } else if (e.type === 'fire' || e.type === 'split') {
        spray(e.x, e.y, 6, 'smoke');
      } else if (e.type === 'hop') {
        spray(e.x, e.y, 20, 'dirt');
      }
    }
  }

  function step(dt) {
    for (const b of bits) {
      b.life -= dt;
      b.vy += (b.kind === 'smoke' ? -20 : 520) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= 0.99;
    }
    for (let i = bits.length - 1; i >= 0; i--) if (bits[i].life <= 0) bits.splice(i, 1);
    for (const mk of marks) { mk.life -= dt; mk.y -= 26 * dt; }
    for (let i = marks.length - 1; i >= 0; i--) if (marks[i].life <= 0) marks.splice(i, 1);
    shake *= Math.exp(-dt * 5);
  }

  /** One unit: a little gun on tracks, with its barrel where it is aiming. */
  function unit(u, colour, active, labels) {
    const x = u.x, y = u.y;
    ctx.save();
    ctx.translate(x, y);
    if (!u.alive) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#4A443C';
      ctx.fillRect(-8, -2, 16, 5);
      ctx.restore();
      return;
    }
    // Barrel
    ctx.save();
    ctx.rotate(-u.angle * u.facing);
    ctx.fillStyle = '#3B3730';
    ctx.fillRect(0, -2, u.facing * 19, 4);
    ctx.restore();
    // Body and tracks
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(-10, 2); ctx.lineTo(-7, -6); ctx.lineTo(7, -6); ctx.lineTo(10, 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2A2721';
    ctx.fillRect(-11, 2, 22, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(-6, -5, 12, 2);
    // Health and name
    if (labels !== false) {
      const w = 26, hpw = Math.max(0, (u.hp / 85) * w);
      ctx.fillStyle = 'rgba(20,18,15,0.55)';
      ctx.fillRect(-w / 2 - 1, -19, w + 2, 5);
      ctx.fillStyle = u.hp > 45 ? '#6E9A58' : u.hp > 20 ? '#D9A21B' : '#C2452F';
      ctx.fillRect(-w / 2, -18, hpw, 3);
    }
    if (active) {
      ctx.fillStyle = '#F4EEE0';
      ctx.beginPath();
      ctx.moveTo(0, -30); ctx.lineTo(-5, -38); ctx.lineTo(5, -38);
      ctx.closePath();
      ctx.fill();
      if (u.charge > 0) {
        ctx.fillStyle = 'rgba(20,18,15,0.5)';
        ctx.fillRect(-16, -26, 32, 5);
        ctx.fillStyle = '#E8C33A';
        ctx.fillRect(-15, -25, 30 * u.charge, 3);
      }
    }
    ctx.restore();
  }

  function draw(view, opts = {}) {
    const dt = Math.max(0, Math.min(0.1, opts.dt || 0));
    step(dt);
    const cw = canvas.width, ch = canvas.height;
    const scale = Math.min(cw / T.W, ch / T.H);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, ch);
    sky.addColorStop(0, SKY_TOP);
    sky.addColorStop(1, SKY_LOW);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, cw, ch);
    ctx.translate((cw - T.W * scale) / 2, (ch - T.H * scale) / 2);
    ctx.scale(scale, scale);
    if (shake > 0.4) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    // Far hills, for a bit of depth
    ctx.fillStyle = 'rgba(120, 140, 150, 0.45)';
    ctx.beginPath();
    ctx.moveTo(0, T.H);
    for (let x = 0; x <= T.W; x += 40) ctx.lineTo(x, T.H * 0.58 + Math.sin(x / 260) * 46 + Math.sin(x / 90) * 14);
    ctx.lineTo(T.W, T.H);
    ctx.closePath();
    ctx.fill();

    ctx.drawImage(bedrock, 0, 0);
    ctx.drawImage(ground, 0, 0);
    if (!view) { ctx.restore(); return; }

    // Crates on their parachutes, and mines
    for (const c of view.crates) {
      if (c.air) {
        ctx.strokeStyle = 'rgba(244,238,224,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(c.x - 9, c.y - 9); ctx.lineTo(c.x - 12, c.y - 20);
        ctx.moveTo(c.x + 9, c.y - 9); ctx.lineTo(c.x + 12, c.y - 20);
        ctx.stroke();
        ctx.fillStyle = 'rgba(244,238,224,0.9)';
        ctx.beginPath();
        ctx.ellipse(c.x, c.y - 21, 13, 8, 0, Math.PI, 0);
        ctx.fill();
      }
      ctx.fillStyle = c.kind === 'health' ? '#46A35A' : c.kind === 'ammo' ? '#D9A21B' : '#8C4FA3';
      ctx.fillRect(c.x - 9, c.y - 9, 18, 18);
      ctx.strokeStyle = 'rgba(20,18,15,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x - 9, c.y - 9, 18, 18);
      ctx.fillStyle = '#F4EEE0';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(c.kind === 'health' ? '+' : c.kind === 'ammo' ? 'A' : 'W', c.x, c.y + 4);
    }
    for (const mine of view.mines) {
      ctx.fillStyle = mine.armed ? '#C2452F' : '#6B655C';
      ctx.beginPath();
      ctx.arc(mine.x, mine.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Shots, with a short trail
    for (const [i, s] of view.shots.entries()) {
      const key = i + ':' + s.w;
      const tr = trails.get(key) || [];
      tr.push([s.x, s.y]);
      if (tr.length > 14) tr.shift();
      trails.set(key, tr);
      ctx.strokeStyle = 'rgba(244, 238, 224, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      tr.forEach(([tx, ty], k) => (k ? ctx.lineTo(tx, ty) : ctx.moveTo(tx, ty)));
      ctx.stroke();
      const w = WEAPONS[s.w];
      ctx.fillStyle = w && w.kind === 'digger' ? '#D9A21B' : '#2A2721';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!view.shots.length && trails.size) trails.clear();

    for (const u of view.units) {
      const p = view.players.find(pp => pp.id === u.owner);
      unit(u, p ? p.colour : '#888', u.idx === view.active && view.phase === 'aim', opts.labels);
    }

    // Sparks, dirt and smoke
    for (const b of bits) {
      const left = Math.max(0, Math.min(1, b.life / (b.max || 1)));    // 1 when new, 0 when spent
      ctx.globalAlpha = b.kind === 'smoke' ? left * 0.45 : Math.min(1, left * 1.6);
      ctx.fillStyle = b.kind === 'smoke' ? '#6E6A63' : b.kind === 'dirt' ? '#7A5E43' : '#F0C070';
      const r = Math.max(0.5, b.size * (b.kind === 'smoke' ? 1 + (1 - left) * 1.4 : left));
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Damage numbers
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const mk of marks) {
      ctx.globalAlpha = Math.min(1, mk.life);
      ctx.fillStyle = '#F4EEE0';
      ctx.strokeStyle = 'rgba(20,18,15,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(mk.text, mk.x, mk.y);
      ctx.fillText(mk.text, mk.x, mk.y);
    }
    ctx.globalAlpha = 1;

    // The active unit's name, under it
    const act = view.units[view.active];
    if (act && act.alive && opts.labels !== false) {
      const p = view.players.find(pp => pp.id === act.owner);
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillStyle = p ? p.colour : '#fff';
      ctx.strokeStyle = 'rgba(20,18,15,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(act.name, act.x, act.y + 26);
      ctx.fillText(act.name, act.x, act.y + 26);
    }
    ctx.restore();
  }

  return {
    draw,
    events,
    setTerrain: paint,
    /** A guest rebuilds the same map from the seed, then the craters it is told about. */
    hole,
    resize() {
      const el = canvas.parentElement;
      const r = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(el.clientWidth * r);
      canvas.height = Math.floor(el.clientHeight * r);
    },
  };
}
