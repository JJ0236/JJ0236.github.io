// Drawing. Everything reads from a "view": the live game on the host, or an
// interpolated snapshot on a client. Colours come from the page's tokens so
// the field follows the site theme.

import { COLS, ROWS, WALL, CRATE } from './maps.js';
import { TILE, W, H, TANK_R, POWERUPS } from './sim.js';

const GROUP_RING = { weapon: '--pu-weapon', defense: '--pu-defense', chaos: '--pu-chaos' };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let scale = 1, ox = 0, oy = 0, dpr = 1;
  let C = {};
  const fx = [];      // short-lived effects
  let decals = [];    // scorch marks, cleared each round

  function readTheme() {
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    C = {
      bg: css('--canvas-bg'), grid: css('--canvas-grid'), ink: css('--canvas-ink'),
      wall: css('--wall'), wallTop: css('--wall-top'), crate: css('--crate'), crateEdge: css('--crate-edge'),
      shell: css('--shell'), scorch: css('--scorch'), freeze: '#8FC4E8',
      '--pu-weapon': css('--pu-weapon'), '--pu-defense': css('--pu-defense'), '--pu-chaos': css('--pu-chaos'),
      token: css('--surface'), font: css('--font-ui') || 'sans-serif',
    };
  }
  readTheme();

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    scale = Math.min(canvas.width / W, canvas.height / H);
    ox = (canvas.width - W * scale) / 2;
    oy = (canvas.height - H * scale) / 2;
  }

  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) * dpr - ox) / scale,
      y: ((clientY - r.top) * dpr - oy) / scale,
    };
  }

  // ── Effects ──

  function addEvents(events, view) {
    for (const e of events) {
      switch (e.type) {
        case 'round': decals = []; fx.length = 0; break;
        case 'die': {
          const col = colorOf(view, e.id);
          fx.push({ k: 'ring', x: e.x, y: e.y, t: 0, life: 0.5, r0: 8, r1: 46, col: C.ink });
          for (let i = 0; i < 14; i++) {
            const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 120;
            fx.push({ k: 'bit', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.6 + Math.random() * 0.5, col: i % 3 ? col : C.ink, sz: 2 + Math.random() * 3 });
          }
          decals.push({ x: e.x, y: e.y, r: 20 + Math.random() * 6, col });
          break;
        }
        case 'boom':
          fx.push({ k: 'ring', x: e.x, y: e.y, t: 0, life: 0.45, r0: 6, r1: 62, col: C.ink });
          fx.push({ k: 'flash', x: e.x, y: e.y, t: 0, life: 0.25, r: 52 });
          decals.push({ x: e.x, y: e.y, r: 26, col: null });
          break;
        case 'crate':
          for (let i = 0; i < 9; i++) {
            const a = Math.random() * Math.PI * 2, s = 30 + Math.random() * 90;
            fx.push({ k: 'bit', x: e.x + (Math.random() - 0.5) * 20, y: e.y + (Math.random() - 0.5) * 20, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.5 + Math.random() * 0.3, col: C.crateEdge, sz: 3 + Math.random() * 3 });
          }
          break;
        case 'spark': case 'hit': case 'bounce':
          fx.push({ k: 'ring', x: e.x, y: e.y, t: 0, life: 0.18, r0: 2, r1: e.type === 'bounce' ? 7 : 10, col: C.ink });
          break;
        case 'shield':
          fx.push({ k: 'ring', x: e.x, y: e.y, t: 0, life: 0.4, r0: 20, r1: 34, col: C['--pu-defense'] });
          break;
        case 'freeze':
          fx.push({ k: 'ring', x: e.x, y: e.y, t: 0, life: 0.4, r0: 10, r1: 30, col: C.freeze });
          break;
        case 'pick': case 'spawn':
          fx.push({ k: 'ring', x: e.x, y: e.y, t: 0, life: 0.35, r0: 10, r1: 24, col: C.ink });
          break;
        case 'tp':
          fx.push({ k: 'ring', x: e.x0, y: e.y0, t: 0, life: 0.4, r0: 22, r1: 4, col: C['--pu-chaos'] });
          fx.push({ k: 'ring', x: e.x1, y: e.y1, t: 0, life: 0.4, r0: 4, r1: 24, col: C['--pu-chaos'] });
          break;
      }
    }
    if (fx.length > 400) fx.splice(0, fx.length - 400);
  }

  function colorOf(view, id) {
    const p = view.players && view.players[id];
    return p ? p.color : C.ink;
  }

  // ── Frame ──

  function draw(view, opts = {}) {
    const dt = opts.dt || 1 / 60;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!view || !view.grid) return;
    ctx.setTransform(scale, 0, 0, scale, ox, oy);

    // Ground grid: a surveyor's sheet.
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < COLS; c++) { ctx.moveTo(c * TILE, 0); ctx.lineTo(c * TILE, H); }
    for (let r = 1; r < ROWS; r++) { ctx.moveTo(0, r * TILE); ctx.lineTo(W, r * TILE); }
    ctx.stroke();

    for (const d of decals) {
      ctx.fillStyle = C.scorch;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
    }

    drawTiles(view.grid);
    for (const m of view.mines) drawMine(m, view, opts.me);
    for (const p of view.pickups) drawPickup(p, opts.time || 0);
    for (const t of view.tanks) if (!t.alive) drawWreck(t, view);
    for (const t of view.tanks) if (t.alive) drawTank(t, view, opts.me, opts.time || 0);
    for (const s of view.shells) drawShell(s, view);
    for (const b of view.beams) drawBeam(b);

    // Effects
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.t += dt;
      if (f.t >= f.life) { fx.splice(i, 1); continue; }
      const k = f.t / f.life;
      if (f.k === 'ring') {
        ctx.strokeStyle = f.col; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r0 + (f.r1 - f.r0) * k, 0, Math.PI * 2); ctx.stroke();
      } else if (f.k === 'flash') {
        ctx.fillStyle = C.ink; ctx.globalAlpha = 0.18 * (1 - k);
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      } else if (f.k === 'bit') {
        f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.93; f.vy *= 0.93;
        ctx.fillStyle = f.col; ctx.globalAlpha = 1 - k;
        ctx.fillRect(f.x - f.sz / 2, f.y - f.sz / 2, f.sz, f.sz);
      }
      ctx.globalAlpha = 1;
    }

    // Names last, over everything.
    ctx.font = `600 11px ${C.font}`;
    ctx.textAlign = 'center';
    for (const t of view.tanks) {
      if (!t.alive) continue;
      if (t.buffs.invis > 0 && t.id !== opts.me) continue;
      const p = view.players[t.id];
      if (!p) continue;
      const label = t.id === opts.me ? 'you' : p.name;
      const ly = Math.max(12, t.y - TANK_R - 9);
      // A halo in the ground colour keeps the label legible over walls.
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = C.bg;
      ctx.lineJoin = 'round';
      ctx.strokeText(label, t.x, ly);
      ctx.fillStyle = C.ink;
      ctx.fillText(label, t.x, ly);
    }
  }

  function drawTiles(grid) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = grid[r * COLS + c];
        const x = c * TILE, y = r * TILE;
        if (t === WALL) {
          ctx.fillStyle = C.wall;
          // Overlap by a hair so no seam shows between blocks at odd scales.
          ctx.fillRect(x - 0.5, y - 0.5, TILE + 1, TILE + 1);
          // Joins between wall blocks disappear; free edges get a lighter lip.
          ctx.fillStyle = C.wallTop;
          const open = (dc, dr) => {
            const nc = c + dc, nr = r + dr;
            return nc >= 0 && nr >= 0 && nc < COLS && nr < ROWS && grid[nr * COLS + nc] !== WALL;
          };
          if (open(0, 1)) ctx.fillRect(x, y + TILE - 5, TILE, 5);
          if (open(0, -1)) ctx.fillRect(x, y, TILE, 2);
        } else if (t === CRATE) {
          const p = 3;
          ctx.fillStyle = C.crate;
          ctx.fillRect(x + p, y + p, TILE - 2 * p, TILE - 2 * p);
          ctx.strokeStyle = C.crateEdge;
          ctx.lineWidth = 2;
          ctx.strokeRect(x + p + 1, y + p + 1, TILE - 2 * p - 2, TILE - 2 * p - 2);
          ctx.beginPath();
          ctx.moveTo(x + p + 2, y + p + 2); ctx.lineTo(x + TILE - p - 2, y + TILE - p - 2);
          ctx.moveTo(x + TILE - p - 2, y + p + 2); ctx.lineTo(x + p + 2, y + TILE - p - 2);
          ctx.stroke();
        }
      }
    }
  }

  function drawTank(t, view, me, time) {
    const col = colorOf(view, t.id);
    const mine = t.id === me;
    let alpha = 1;
    if (t.buffs.invis > 0) alpha = mine ? 0.35 : 0.04 + 0.04 * Math.sin(time * 9);
    if (t.grace > 0 && Math.floor(time * 20) % 2) alpha *= 0.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(t.x, t.y);

    if (t.buffs.shield > 0) {
      ctx.strokeStyle = C['--pu-defense'];
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -time * 20;
      ctx.beginPath(); ctx.arc(0, 0, TANK_R + 7, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.save();
    ctx.rotate(t.a);
    // Tracks
    ctx.fillStyle = C.ink;
    ctx.fillRect(-15, -13, 30, 7);
    ctx.fillRect(-15, 6, 30, 7);
    // Hull
    ctx.fillStyle = col;
    ctx.fillRect(-12, -9, 24, 18);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-12, -9, 24, 18);
    if (t.buffs.speed > 0) {
      ctx.strokeStyle = C['--pu-defense'];
      ctx.beginPath();
      ctx.moveTo(-20, -6); ctx.lineTo(-28, -6);
      ctx.moveTo(-20, 6); ctx.lineTo(-28, 6);
      ctx.stroke();
    }
    ctx.restore();

    // Turret and barrel
    ctx.rotate(t.ta);
    ctx.fillStyle = col;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.5;
    const len = t.weapon === 'giant' ? 20 : 19, wid = t.weapon === 'giant' ? 8 : 5;
    ctx.fillRect(0, -wid / 2, len, wid);
    ctx.strokeRect(0, -wid / 2, len, wid);
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();

    if (t.frozen > 0) {
      ctx.fillStyle = C.freeze;
      ctx.globalAlpha = 0.45;
      ctx.beginPath(); ctx.arc(t.x, t.y, TANK_R + 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (t.charging > 0) {
      // The laser telegraphs where it will fire.
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x + Math.cos(t.ta) * 900, t.y + Math.sin(t.ta) * 900);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  function drawWreck(t, view) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.a);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = C.ink;
    ctx.fillRect(-12, -9, 24, 18);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawShell(s, view) {
    const col = s.kind === 'freeze' ? C.freeze : s.kind === 'homing' ? colorOf(view, s.owner) : C.shell;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    if (s.kind === 'homing' || s.kind === 'giant') {
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  function drawMine(m, view, me) {
    const own = m.owner === me;
    ctx.globalAlpha = m.arm > 0 || own ? 0.9 : 0.22;
    ctx.fillStyle = colorOf(view, m.owner);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      ctx.moveTo(m.x + Math.cos(a) * 6, m.y + Math.sin(a) * 6);
      ctx.lineTo(m.x + Math.cos(a) * 10, m.y + Math.sin(a) * 10);
    }
    ctx.stroke();
    if (m.arm <= 0) {
      ctx.fillStyle = C.ink;
      ctx.beginPath(); ctx.arc(m.x, m.y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBeam(b) {
    ctx.strokeStyle = C['--pu-weapon'];
    ctx.globalAlpha = Math.min(1, b.life / 0.2);
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    b.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawPickup(p, time) {
    const def = POWERUPS[p.type];
    const ring = C[GROUP_RING[def.group]];
    const bob = Math.sin(time * 3 + p.id) * 1.5;
    const x = p.x, y = p.y + bob;
    ctx.globalAlpha = p.life < 3 ? 0.4 + 0.6 * (Math.floor(time * 6) % 2) : 1;
    ctx.fillStyle = C.token;
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = C.ink;
    ctx.fillStyle = C.ink;
    ctx.lineWidth = 1.6;
    drawIcon(ctx, p.type, x, y, 1);
    ctx.globalAlpha = 1;
  }

  return { resize, draw, toWorld, addEvents, readTheme };
}

/** Small glyphs for each power-up, drawn in ink around (x, y). Shared with the HUD. */
export function drawIcon(ctx, type, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (type) {
    case 'ricochet':
      ctx.moveTo(-7, 5); ctx.lineTo(-2, -5); ctx.lineTo(3, 5); ctx.lineTo(7, -3);
      break;
    case 'laser':
      ctx.moveTo(-7, 0); ctx.lineTo(7, 0);
      ctx.moveTo(-7, -4); ctx.lineTo(-7, 4);
      break;
    case 'shotgun':
      for (const [dx, dy] of [[-5, 0], [3, -5], [5, 0], [3, 5]]) { ctx.moveTo(dx + 1.6, dy); ctx.arc(dx, dy, 1.6, 0, Math.PI * 2); }
      ctx.fill();
      ctx.beginPath();
      break;
    case 'homing':
      ctx.moveTo(-7, 5); ctx.quadraticCurveTo(-4, -6, 6, -4);
      ctx.moveTo(2, -7); ctx.lineTo(6, -4); ctx.lineTo(3, 0);
      break;
    case 'mines':
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        ctx.moveTo(Math.cos(a) * 3.5, Math.sin(a) * 3.5); ctx.lineTo(Math.cos(a) * 7, Math.sin(a) * 7);
      }
      break;
    case 'triple':
      ctx.moveTo(-6, 0); ctx.lineTo(7, 0);
      ctx.moveTo(-6, 0); ctx.lineTo(6, -5);
      ctx.moveTo(-6, 0); ctx.lineTo(6, 5);
      break;
    case 'shield':
      ctx.moveTo(0, -7); ctx.lineTo(6, -4); ctx.quadraticCurveTo(6, 4, 0, 7); ctx.quadraticCurveTo(-6, 4, -6, -4); ctx.closePath();
      break;
    case 'speed':
      ctx.moveTo(-6, -5); ctx.lineTo(-1, 0); ctx.lineTo(-6, 5);
      ctx.moveTo(1, -5); ctx.lineTo(6, 0); ctx.lineTo(1, 5);
      break;
    case 'invis':
      ctx.setLineDash([2.5, 2.5]);
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      break;
    case 'giant':
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      break;
    case 'freeze':
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI / 3;
        ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7); ctx.lineTo(-Math.cos(a) * 7, -Math.sin(a) * 7);
      }
      break;
    case 'teleport':
      ctx.arc(-4, 3, 2.5, 0, Math.PI * 2);
      ctx.moveTo(6.5, -3); ctx.arc(4, -3, 2.5, 0, Math.PI * 2);
      ctx.moveTo(-2, 1); ctx.lineTo(2, -1);
      break;
  }
  ctx.stroke();
  ctx.restore();
}
