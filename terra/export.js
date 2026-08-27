// terra/export.js — writes slicer-ready files.
//
// 3MF is written to the bare core specification. Vendor extensions are what
// break cross-slicer loading, so there are none here: a single basematerials
// group, one object per layer, one build item each.

import { zipSync, strToU8 } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm';
import { ATTRIBUTION } from './sources.js';

const round = v => Math.round(v * 10000) / 10000;

/** Shift a model so it sits in the positive octant, as 3MF requires. */
function originOffset(layers) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (const l of layers) {
    const p = l.positions;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < minX) minX = p[i];
      if (p[i + 1] < minY) minY = p[i + 1];
      if (p[i + 2] < minZ) minZ = p[i + 2];
    }
  }
  return Number.isFinite(minX) ? [-minX, -minY, -minZ] : [0, 0, 0];
}

/* ── Binary STL ────────────────────────────────────────────────────────── */

function writeBinaryStl(layers, offset, header) {
  let triangles = 0;
  for (const l of layers) triangles += l.positions.length / 9;

  const buf = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buf);
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < header.length ? header.charCodeAt(i) & 0x7f : 0);
  }
  view.setUint32(80, triangles, true);

  const [ox, oy, oz] = offset;
  let off = 84;
  for (const l of layers) {
    const p = l.positions;
    for (let i = 0; i < p.length; i += 9) {
      const ax = p[i] + ox,     ay = p[i + 1] + oy, az = p[i + 2] + oz;
      const bx = p[i + 3] + ox, by = p[i + 4] + oy, bz = p[i + 5] + oz;
      const cx = p[i + 6] + ox, cy = p[i + 7] + oy, cz = p[i + 8] + oz;

      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;

      view.setFloat32(off, nx / nl, true); off += 4;
      view.setFloat32(off, ny / nl, true); off += 4;
      view.setFloat32(off, nz / nl, true); off += 4;
      for (const c of [ax, ay, az, bx, by, bz, cx, cy, cz]) {
        view.setFloat32(off, c, true); off += 4;
      }
      view.setUint16(off, 0, true); off += 2;
    }
  }
  return buf;
}

export function exportStl(layers, { name = 'terra' } = {}) {
  const offset = originOffset(layers);
  const buf = writeBinaryStl(layers, offset, `Terra ${name} - joshhicks.info`);
  return new Blob([buf], { type: 'model/stl' });
}

/** One STL per layer in a zip — the fallback when a slicer mishandles 3MF. */
export function exportStlPerLayer(layers, { name = 'terra' } = {}) {
  const offset = originOffset(layers);
  const files = {};
  layers.forEach((l, i) => {
    const buf = writeBinaryStl([l], offset, `Terra ${l.name} ${l.color}`);
    files[`${String(i + 1).padStart(2, '0')}_${l.id}.stl`] = new Uint8Array(buf);
  });
  files['README.txt'] = strToU8(
    `Terra — ${name}\n${ATTRIBUTION}\n\n` +
    'All parts share one origin: load them together and they line up.\n\n' +
    'Suggested filament colours:\n' +
    layers.map(l => `  ${l.id.padEnd(10)} ${l.color}`).join('\n') + '\n'
  );
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}

/* ── 3MF ───────────────────────────────────────────────────────────────── */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

const esc = s => String(s).replace(/[<>&"]/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function meshXml(positions, offset) {
  const [ox, oy, oz] = offset;
  const index = new Map();
  const verts = [];
  const tris = [];

  for (let i = 0; i < positions.length; i += 3) {
    const x = round(positions[i] + ox);
    const y = round(positions[i + 1] + oy);
    const z = round(positions[i + 2] + oz);
    const key = `${x},${y},${z}`;
    let id = index.get(key);
    if (id === undefined) {
      id = verts.length;
      index.set(key, id);
      verts.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);
    }
    tris.push(id);
  }

  const triXml = [];
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    if (a === b || b === c || a === c) continue; // degenerate; 3MF rejects these
    triXml.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }

  return `<mesh><vertices>${verts.join('')}</vertices>` +
         `<triangles>${triXml.join('')}</triangles></mesh>`;
}

export function export3mf(layers, { name = 'terra', stats } = {}) {
  const offset = originOffset(layers);

  const bases = layers
    .map(l => `<base name="${esc(l.name)}" displaycolor="${l.color.toUpperCase()}FF"/>`)
    .join('');

  const objects = layers.map((l, i) =>
    `<object id="${i + 2}" type="model" pid="1" pindex="${i}" name="${esc(l.name)}">` +
    meshXml(l.positions, offset) +
    `</object>`
  ).join('');

  const items = layers
    .map((_, i) => `<item objectid="${i + 2}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`)
    .join('');

  const notes = stats
    ? `${stats.widthMm.toFixed(1)} x ${stats.depthMm.toFixed(1)} x ${stats.heightMm.toFixed(1)} mm, ` +
      `approx 1:${stats.scaleDenominator.toLocaleString()}`
    : '';

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Terra - joshhicks.info/terra</metadata>
<metadata name="Title">${esc(name)}</metadata>
<metadata name="Description">${esc(notes)}</metadata>
<metadata name="Copyright">${esc(ATTRIBUTION)}</metadata>
<resources>
<basematerials id="1">${bases}</basematerials>
${objects}
</resources>
<build>${items}</build>
</model>`;

  const files = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(model)
  };
  return new Blob([zipSync(files, { level: 6 })], {
    type: 'model/3mf'
  });
}

/* ── Download helper ───────────────────────────────────────────────────── */

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
