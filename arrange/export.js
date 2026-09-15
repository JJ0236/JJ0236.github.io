// arrange/export.js — laser-ready SVG out.
//
// Site convention (matches crease/unfold/s1c3r): red #ff0000 cut, 0.1 pt
// strokes, no fill, one group per sheet, millimetre user units.

import { rotate, translate } from './geom.js';
import { mergeCommonLines } from './merge.js';

const CUT = '#ff0000';
const STROKE = 0.1 * (25.4 / 72);          // 0.1 pt in mm

const f = n => (Math.abs(n) < 1e-9 ? '0' : n.toFixed(4).replace(/\.?0+$/, ''));
const ring = pts => {
  let d = `M${f(pts[0])} ${f(pts[1])}`;
  for (let i = 2; i < pts.length; i += 2) d += `L${f(pts[i])} ${f(pts[i + 1])}`;
  return d + 'Z';
};
const open = pts => {
  let d = `M${f(pts[0])} ${f(pts[1])}`;
  for (let i = 2; i < pts.length; i += 2) d += `L${f(pts[i])} ${f(pts[i + 1])}`;
  return d;
};

// Placement -> rings in sheet coordinates.
export function ringsFor(parts, placement) {
  const pose = parts[placement.part].poses[placement.pose];
  return [pose.outer, ...pose.holes].map(r => translate(r, placement.x, placement.y));
}

// Placements -> rings, per sheet. The worker sends these straight to the UI so
// the main thread never has to prepare parts a second time.
export function ringsForSheets(parts, sheets) {
  return sheets.map(placements => placements.map(p => ringsFor(parts, p)));
}

/**
 * Build one SVG per sheet (or a single combined one).
 * `sheetsRings` is [ sheet ][ part ][ ring ].
 * Returns [{ name, svg }]
 */
export function toSVG(sheetsRings, sheet, { merge = false, combined = false } = {}) {
  const bodies = sheetsRings.map((partRings, i) => {
    const rings = partRings.flat();
    let paths;
    let note = '';

    if (merge) {
      const m = mergeCommonLines(rings);
      paths = m.polylines.map(open);
      note = m.sharedLength > 0.5
        ? `<!-- merged common lines: ${m.sharedLength.toFixed(1)}mm of duplicate cut removed -->\n  `
        : '<!-- merged common lines: nothing coincident found (parts need ~0 spacing to touch) -->\n  ';
    } else {
      paths = rings.map(ring);
    }

    return {
      index: i,
      note,
      body: paths.map(d => `<path d="${d}"/>`).join('\n    '),
      count: partRings.length,
    };
  });

  const head = (w, h) =>
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
    `width="${f(w)}mm" height="${f(h)}mm" viewBox="0 0 ${f(w)} ${f(h)}">`;
  const style = `<g fill="none" stroke="${CUT}" stroke-width="${f(STROKE)}">`;

  if (combined) {
    const gap = 10;
    const w = sheet.w * bodies.length + gap * (bodies.length - 1);
    const svg =
      `${head(w, sheet.h)}\n  <!-- Arrange — ${bodies.length} sheet(s), ${sheet.w}x${sheet.h}mm -->\n  ` +
      bodies.map(b =>
        `${b.note}<g id="sheet-${b.index + 1}" transform="translate(${f(b.index * (sheet.w + gap))} 0)">\n    ` +
        `${style}\n    ${b.body}\n    </g>\n  </g>`).join('\n  ') +
      `\n</svg>\n`;
    return [{ name: 'arrange-all-sheets.svg', svg }];
  }

  return bodies.map(b => ({
    name: `arrange-sheet-${b.index + 1}.svg`,
    svg: `${head(sheet.w, sheet.h)}\n  ${b.note}<!-- Arrange — sheet ${b.index + 1}, ${b.count} parts -->\n  ` +
         `${style}\n    ${b.body}\n  </g>\n</svg>\n`,
  }));
}
