// umbra/export.js — slicer-ready and cutter-ready files.

import { makeSurface, ringToSurface, rayAngleAtAnchor, sheetErosion } from './project.js';
import { boundsOf } from './svg.js';

const round = v => Math.round(v * 1000) / 1000;

/* ── Binary STL ──────────────────────────────────────────────────────────── */

export function exportStl(positions, { name = 'umbra', setup = '' } = {}) {
  const triangles = positions.length / 9;
  const buf = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buf);
  const header = `Umbra ${name} - joshhicks.info${setup ? ' - ' + setup : ''}`;
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < header.length ? header.charCodeAt(i) & 0x7f : 0);
  }
  view.setUint32(80, triangles, true);

  let off = 84;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i],     ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    view.setFloat32(off, nx / nl, true); off += 4;
    view.setFloat32(off, ny / nl, true); off += 4;
    view.setFloat32(off, nz / nl, true); off += 4;
    for (const c of [ax, ay, az, bx, by, bz, cx, cy, cz]) { view.setFloat32(off, c, true); off += 4; }
    view.setUint16(off, 0, true); off += 2;
  }
  return new Blob([buf], { type: 'model/stl' });
}

/* ── Laser SVG ───────────────────────────────────────────────────────────── */

/**
 * Flat plate only. A laser kerf runs perpendicular to the sheet, so a cut plate
 * has vertical walls rather than ray-aligned ones and the shadow shifts by about
 * thickness*tan(angle to the rays). Taking the outline at the sheet's MID-plane
 * splits that error either side of the target instead of stacking it on one
 * face, which halves it.
 */
export function exportLaserSvg(material, { L, objectDist, yaw, pitch, sheetMm, name = 'umbra', setup = '' } = {}) {
  const S = makeSurface({ L, objectDist, yaw, pitch, delta: -sheetMm / 2 });
  const rings = [];
  for (const poly of material) {
    for (const ring of poly) {
      const open = ring.length > 1 &&
        ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
        ? ring.slice(0, -1) : ring;
      const sr = ringToSurface(open, S);
      if (sr) rings.push(sr);
    }
  }
  if (!rings.length) throw new Error('Nothing to cut — the plate falls outside the light cone.');

  const b = boundsOf(rings);
  const pad = 5;
  const w = b.w + pad * 2, h = b.h + pad * 2;
  // SVG y runs down; the surface runs up, so flip on the way out.
  const toPath = r => 'M' + r.map(p =>
    `${round(p[0] - b.x0 + pad)},${round(b.y1 - p[1] + pad)}`).join('L') + 'Z';

  const erosion = sheetErosion(sheetMm, rayAngleAtAnchor(S));
  return new Blob([
    `<?xml version="1.0" encoding="UTF-8"?>\n`,
    `<!-- Umbra cut file - joshhicks.info/umbra\n`,
    `     ${setup.replace(/\n/g, '\n     ')}\n`,
    `     Sheet ${round(sheetMm)} mm. Outline taken at the sheet mid-plane;\n`,
    `     expect about ${round(erosion)} mm of edge error either side because a\n`,
    `     kerf is perpendicular to the sheet, not aligned to the light rays. -->\n`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(w)}mm" height="${round(h)}mm" `,
    `viewBox="0 0 ${round(w)} ${round(h)}">\n`,
    `<g fill="none" stroke="#000" stroke-width="0.1">\n`,
    rings.map(r => `<path d="${toPath(r)}"/>`).join('\n'),
    `\n</g>\n</svg>\n`
  ], { type: 'image/svg+xml' });
}

/* ── Setup card ──────────────────────────────────────────────────────────── */

// The object is useless without the geometry it was solved for, so every export
// carries the numbers needed to reproduce it.
export function setupText(s) {
  return [
    `Lamp ${round(s.lampDist)} mm from wall, offset ${round(s.lampX)} / ${round(s.lampY)} mm`,
    `Object ${round(s.objectDist)} mm from wall, tilt ${round(s.yawDeg)} deg yaw / ${round(s.pitchDeg)} deg pitch`,
    `Emitter ${round(s.emitter)} mm, magnification ${round(s.M)}x, shadow ${round(s.wallArtWidth)} mm wide`
  ].join('\n');
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
