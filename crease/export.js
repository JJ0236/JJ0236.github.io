// crease/export.js — turns pattern geometry into laser-ready SVG.
//
// Pure string building, no DOM. Layers keep the s1c3r colour convention so an
// existing laser layer mapping carries over: cut black, mountain red, valley
// blue, stroke 0.1 mm, 1 SVG unit = 1 mm.

import { segLength } from './patterns.js';

// Laser convention: red cuts, blue scores (mountain and valley share a colour
// and are told apart by small m/v marks on the label layer), green engraving.
// Strokes are 0.1 pt, which is 0.0353 mm at 1 unit = 1 mm.
export const COLORS = { cut: '#ff0000', mountain: '#0000ff', valley: '#0000ff', label: '#008800' };
export const STROKE = 0.0353;

/* ── Item transforms ─────────────────────────────────────────────────────── */

export function translate(items, dx, dy) {
  return items.map(s => {
    switch (s.k) {
      case 'L': return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
      case 'C': case 'A': return { ...s, cx: s.cx + dx, cy: s.cy + dy };
      case 'P': return { ...s, pts: s.pts.map(([x, y]) => [x + dx, y + dy]) };
      case 'T': return { ...s, x: s.x + dx, y: s.y + dy };
    }
    return s;
  });
}

// Mirror about the vertical axis of a page of width W (x -> W - x). Arcs keep
// their sweep consistent by mirroring their angles as well.
export function mirrorX(items, W) {
  return items.map(s => {
    switch (s.k) {
      case 'L': return { ...s, x1: W - s.x1, x2: W - s.x2 };
      case 'C': return { ...s, cx: W - s.cx };
      case 'A': return { ...s, cx: W - s.cx, a0: Math.PI - s.a1, a1: Math.PI - s.a0 };
      case 'P': return { ...s, pts: s.pts.map(([x, y]) => [W - x, y]) };
      case 'T': return { ...s, x: W - s.x, angle: -(s.angle || 0) };
    }
    return s;
  });
}

/* ── Chaining: join touching same-layer segments into polylines ───────────── */

// Fewer separate paths means fewer head lifts on the laser. Greedy: from each
// unused segment, extend both ends through shared endpoints, always taking the
// straightest available continuation. Circles and polylines pass through.
export function chain(items, tol = 1e-4) {
  const segs = items.filter(s => s.k === 'L');
  const rest = items.filter(s => s.k !== 'L');
  const key = (x, y) => `${Math.round(x / tol)},${Math.round(y / tol)}`;
  const at = new Map();
  segs.forEach((s, i) => {
    for (const k of [key(s.x1, s.y1), key(s.x2, s.y2)]) {
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(i);
    }
  });
  const used = new Array(segs.length).fill(false);
  const other = (s, x, y) => (Math.hypot(s.x1 - x, s.y1 - y) < tol ? [s.x2, s.y2] : [s.x1, s.y1]);

  const extend = (pts, dirIn) => {
    for (;;) {
      const [x, y] = pts.at(-1);
      let best = -1, bestTurn = Infinity;
      for (const i of at.get(key(x, y)) || []) {
        if (used[i]) continue;
        const [ox, oy] = other(segs[i], x, y);
        const dx = ox - x, dy = oy - y;
        const turn = Math.abs(Math.atan2(dirIn[0] * dy - dirIn[1] * dx, dirIn[0] * dx + dirIn[1] * dy));
        if (turn < bestTurn) { bestTurn = turn; best = i; }
      }
      if (best < 0) return;
      used[best] = true;
      const [nx, ny] = other(segs[best], x, y);
      dirIn = [nx - x, ny - y];
      pts.push([nx, ny]);
    }
  };

  const out = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const s = segs[i];
    const fwd = [[s.x1, s.y1], [s.x2, s.y2]];
    extend(fwd, [s.x2 - s.x1, s.y2 - s.y1]);
    const back = [[s.x2, s.y2], [s.x1, s.y1]];
    extend(back, [s.x1 - s.x2, s.y1 - s.y2]);
    const pts = back.slice(2).reverse().concat(fwd);
    out.push({ k: 'P', pts, closed: false });
  }
  return rest.concat(out);
}

/* ── Perforation: real dash geometry, since lasers ignore dasharray ───────── */

// Dashes are spread so the first and last touch the crease endpoints, which
// is where a fold most needs guidance. The dash length flexes a little to make
// the count come out whole; the gap is honoured exactly.
export function dashItems(items, dash, gap) {
  const out = [];
  for (const s of items) {
    if (s.k === 'L') {
      const len = segLength(s);
      if (len <= dash) { out.push(s); continue; }
      const n = Math.max(2, Math.round((len + gap) / (dash + gap)));
      const d = (len - (n - 1) * gap) / n;
      const ux = (s.x2 - s.x1) / len, uy = (s.y2 - s.y1) / len;
      for (let i = 0; i < n; i++) {
        const t0 = i * (d + gap);
        out.push({ k: 'L', x1: s.x1 + ux * t0, y1: s.y1 + uy * t0, x2: s.x1 + ux * (t0 + d), y2: s.y1 + uy * (t0 + d) });
      }
    } else if (s.k === 'C') {
      const circ = 2 * Math.PI * s.r;
      const n = Math.max(3, Math.round(circ / (dash + gap)));
      const step = 2 * Math.PI / n, dAng = step * (dash / (dash + gap));
      for (let i = 0; i < n; i++) out.push({ k: 'A', cx: s.cx, cy: s.cy, r: s.r, a0: i * step, a1: i * step + dAng });
    } else out.push(s);
  }
  return out;
}

/* ── Layer assembly ──────────────────────────────────────────────────────── */

// opts: { swap, strategy: 'same' | 'perf' | 'two', dash, gap, margin, legend }
// Returns { page: {w,h}, files: [{ name, layers: {cut, mountain, valley}, note }] }
export function assemble(pattern, opts) {
  const m = opts.margin ?? 5;
  const page = { w: pattern.w + 2 * m, h: pattern.h + 2 * m };
  let mountain = translate(opts.swap ? pattern.valleys : pattern.mountains, m, m);
  let valley   = translate(opts.swap ? pattern.mountains : pattern.valleys, m, m);
  const cut    = translate(pattern.cuts, m, m);
  const label  = translate(pattern.labels || [], m, m);

  if (opts.strategy === 'perf') valley = dashItems(valley, opts.dash ?? 3, opts.gap ?? 1.5);

  if (opts.strategy === 'two') {
    const reg = registrationMarks(page, m);
    return {
      page,
      files: [
        { name: 'front', layers: { cut: cut.concat(reg), mountain: chain(mountain), valley: [], label },
          note: 'Front face: cut outline and mountain scores.' },
        { name: 'back', layers: { cut: mirrorX(cut.concat(reg), page.w), mountain: [], valley: chain(mirrorX(valley, page.w)) },
          note: 'Back face, mirrored left-right. Flip the sheet about its vertical axis and line up the crosses.' },
      ],
    };
  }

  return {
    page,
    files: [{ name: 'front', layers: { cut, mountain: chain(mountain), valley: opts.strategy === 'perf' ? valley : chain(valley), label } }],
  };
}

// Small crosses in the page margin, one per corner, so a flipped sheet can be
// re-registered. They sit outside the cut outline so they stay on the waste.
export function registrationMarks(page, m) {
  const r = Math.min(m * 0.4, 3);
  const pts = [[m / 2, m / 2], [page.w - m / 2, m / 2], [m / 2, page.h - m / 2], [page.w - m / 2, page.h - m / 2]];
  const out = [];
  for (const [x, y] of pts) {
    out.push({ k: 'L', x1: x - r, y1: y, x2: x + r, y2: y });
    out.push({ k: 'L', x1: x, y1: y - r, x2: x, y2: y + r });
  }
  return out;
}

/* ── SVG string ──────────────────────────────────────────────────────────── */

const f = n => (Math.abs(n) < 1e-9 ? 0 : n).toFixed(4).replace(/\.?0+$/, '');

export function itemToSvg(s) {
  switch (s.k) {
    case 'L': return `<line x1="${f(s.x1)}" y1="${f(s.y1)}" x2="${f(s.x2)}" y2="${f(s.y2)}"/>`;
    case 'C': return `<circle cx="${f(s.cx)}" cy="${f(s.cy)}" r="${f(s.r)}"/>`;
    case 'A': {
      const x0 = s.cx + s.r * Math.cos(s.a0), y0 = s.cy + s.r * Math.sin(s.a0);
      const x1 = s.cx + s.r * Math.cos(s.a1), y1 = s.cy + s.r * Math.sin(s.a1);
      const large = Math.abs(s.a1 - s.a0) > Math.PI ? 1 : 0;
      const sweep = s.a1 > s.a0 ? 1 : 0;
      return `<path d="M${f(x0)},${f(y0)} A${f(s.r)},${f(s.r)} 0 ${large} ${sweep} ${f(x1)},${f(y1)}"/>`;
    }
    case 'P': {
      const d = s.pts.map((p, i) => (i ? 'L' : 'M') + f(p[0]) + ',' + f(p[1])).join(' ') + (s.closed ? ' Z' : '');
      return `<path d="${d}"/>`;
    }
    case 'T': {
      const rot = s.angle ? ` transform="rotate(${f(s.angle)} ${f(s.x)} ${f(s.y)})"` : '';
      return `<text x="${f(s.x)}" y="${f(s.y)}" font-size="${f(s.size)}"${rot}>${String(s.text).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</text>`;
    }
  }
  return '';
}

export function toSvg(file, page, meta = {}) {
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"`,
    `     width="${f(page.w)}mm" height="${f(page.h)}mm" viewBox="0 0 ${f(page.w)} ${f(page.h)}">`,
    `  <!-- crease | ${meta.title || 'origami crease pattern'} | ${file.name} | ${f(page.w)}x${f(page.h)} mm | joshhicks.info/crease -->`,
    `  <style>`,
    `    /* stroke-width ${STROKE} mm = 0.1 pt */`,
    `    .cut      { fill: none; stroke: ${COLORS.cut}; stroke-width: ${STROKE}; }`,
    `    .mountain { fill: none; stroke: ${COLORS.mountain}; stroke-width: ${STROKE}; }`,
    `    .valley   { fill: none; stroke: ${COLORS.valley}; stroke-width: ${STROKE}; }`,
    `    .legend   { font-family: sans-serif; font-size: 3px; fill: #333333; }`,
    `    .label    { font-family: sans-serif; fill: ${COLORS.label}; stroke: none; text-anchor: middle; dominant-baseline: middle; }`,
    `  </style>`,
  ];
  const layers = ['mountain', 'valley', 'cut'];
  if (file.layers.label && file.layers.label.length) layers.push('label');
  for (const layer of layers) {
    const items = file.layers[layer] || [];
    lines.push(`  <g id="${layer}" inkscape:groupmode="layer" inkscape:label="${layer}" class="${layer}">`);
    for (const s of items) lines.push('    ' + itemToSvg(s));
    lines.push(`  </g>`);
  }
  if (meta.legend) {
    lines.push(`  <g id="legend" class="legend">`);
    lines.push(`    <text x="${f(page.w - 2)}" y="${f(page.h - 1.5)}" text-anchor="end">${meta.title || ''} · red cut · blue crease · m/v marks green${file.note ? ' · ' + file.note : ''}</text>`);
    lines.push(`  </g>`);
  }
  lines.push(`</svg>`);
  return lines.join('\n');
}
