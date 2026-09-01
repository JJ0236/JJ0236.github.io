// imprint/export.js — writes slicer-ready files, adapted from relief/export.js.
//
// One solid, so both formats are the simple case: binary STL, and a 3MF at
// the bare core spec (unit="millimeter", one object, one build item) so every
// slicer loads the exact dimensions.

import { zipSync, strToU8 } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm';

const ATTRIBUTION = 'Generated with Imprint - joshhicks.info/imprint';
const round = v => Math.round(v * 10000) / 10000;

/* ── Binary STL ────────────────────────────────────────────────────────── */

export function exportStl(positions, { name = 'imprint' } = {}) {
  const triangles = positions.length / 9;
  const buf = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buf);
  const header = `Imprint ${name} - joshhicks.info`;
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
    for (const c of [ax, ay, az, bx, by, bz, cx, cy, cz]) {
      view.setFloat32(off, c, true); off += 4;
    }
    view.setUint16(off, 0, true); off += 2;
  }
  return new Blob([buf], { type: 'model/stl' });
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

function meshXml(positions) {
  const index = new Map();
  const verts = [];
  const tris = [];

  for (let i = 0; i < positions.length; i += 3) {
    const x = round(positions[i]);
    const y = round(positions[i + 1]);
    const z = round(positions[i + 2]);
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

export function export3mf(positions, { name = 'imprint', color = '#8FB0E8', stats } = {}) {
  const notes = stats
    ? `${stats.widthMm} x ${stats.heightMm} x ${stats.totalMm} mm`
    : '';

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Imprint - joshhicks.info/imprint</metadata>
<metadata name="Title">${esc(name)}</metadata>
<metadata name="Description">${esc(notes)}</metadata>
<metadata name="Copyright">${esc(ATTRIBUTION)}</metadata>
<resources>
<basematerials id="1"><base name="Panel" displaycolor="${esc(color.toUpperCase())}FF"/></basematerials>
<object id="2" type="model" pid="1" pindex="0" name="${esc(name)}">${meshXml(positions)}</object>
</resources>
<build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build>
</model>`;

  const files = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(model)
  };
  return new Blob([zipSync(files, { level: 6 })], { type: 'model/3mf' });
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
