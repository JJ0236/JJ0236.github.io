// patch/export.js — lay the cut pieces out on fabric and write the laser SVG.
//
// Pieces of different fabrics can never share a sheet, so each fabric gets its
// own layout. Rotation is grain-locked to 0/180 by default: a quilt piece cut
// off-grain stretches on the bias and pulls the finished block out of square.

import { nest, prepare, ROTATION_SETS } from '../arrange/nest.js';
import { bounds } from './pieces.js';

const CUT = '#ff0000';
const MARK = '#008800';
const STROKE = 0.1 * (25.4 / 72);          // 0.1 pt in mm

const f = n => (Math.abs(n) < 1e-9 ? '0' : n.toFixed(4).replace(/\.?0+$/, ''));
const path = pts => 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L') + 'Z';

/**
 * Nest every fabric's pieces onto sheets.
 * pieces: from blockPieces(), each with { fabric, cut, count }
 * Returns [{ fabric, sheets: [[ {poly, label} ]], unplaced }]
 */
export function layoutForCutting(pieces, sheet, {
  spacing = 2, grainLock = true, timeMs = 1500, seed = 1, blocks = 1,
} = {}) {
  const byFabric = new Map();
  for (const p of pieces) {
    if (!byFabric.has(p.fabric)) byFabric.set(p.fabric, []);
    byFabric.get(p.fabric).push(p);
  }

  const rotations = grainLock ? ROTATION_SETS.grain : ROTATION_SETS.quarter;
  const out = [];

  for (const [fabric, group] of byFabric) {
    const parts = group.map((p, i) => prepare({
      id: `${fabric}-${i}`,
      name: p.unitType,
      outer: Float64Array.from(p.cut.flat()),
      holes: [],
    }, rotations));

    const items = [];
    group.forEach((p, i) => {
      for (let k = 0; k < p.count * blocks; k++) items.push({ part: i, inst: `${i}-${k}` });
    });

    const res = nest({ parts, items, sheet, spacing, timeMs, seed });

    out.push({
      fabric,
      unplaced: res.unplaced,
      count: items.length,
      sheets: res.sheets.map(placements => placements.map(pl => {
        const pose = parts[pl.part].poses[pl.pose];
        const poly = [];
        for (let i = 0; i < pose.outer.length; i += 2)
          poly.push([pose.outer[i] + pl.x, pose.outer[i + 1] + pl.y]);
        return { poly, label: parts[pl.part].name, deg: pose.deg };
      })),
    });
  }
  return out;
}

/**
 * SVG per fabric sheet, in the site's laser convention.
 * Grain arrows go on the engrave layer and are off by default — marking
 * fabric with a laser is usually not what you want.
 */
export function toSVG(layout, sheet, { grainMarks = false } = {}) {
  const files = [];

  for (const fab of layout) {
    fab.sheets.forEach((placements, i) => {
      const cuts = placements.map(p => `<path d="${path(p.poly)}"/>`).join('\n      ');

      let marks = '';
      if (grainMarks) {
        marks = '\n    <g fill="none" stroke="' + MARK + `" stroke-width="${f(STROKE)}">\n      ` +
          placements.map(p => {
            const b = bounds(p.poly);
            const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
            const r = Math.min(b.w, b.h) * 0.25;
            // straight grain runs along the block's x axis; grain lock keeps
            // that true through nesting
            return `<path d="M${f(cx - r)} ${f(cy)} L${f(cx + r)} ${f(cy)} ` +
                   `M${f(cx + r - r * 0.35)} ${f(cy - r * 0.2)} L${f(cx + r)} ${f(cy)} ` +
                   `L${f(cx + r - r * 0.35)} ${f(cy + r * 0.2)}"/>`;
          }).join('\n      ') + '\n    </g>';
      }

      files.push({
        name: `patch-${slug(fab.fabric)}-sheet-${i + 1}.svg`,
        fabric: fab.fabric,
        svg:
`<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${f(sheet.w)}mm" height="${f(sheet.h)}mm" viewBox="0 0 ${f(sheet.w)} ${f(sheet.h)}">
  <!-- Patch - fabric "${fab.fabric}", sheet ${i + 1} of ${fab.sheets.length}, ${placements.length} pieces.
       Cut lines include the seam allowance. -->
  <g fill="none" stroke="${CUT}" stroke-width="${f(STROKE)}">
      ${cuts}
  </g>${marks}
</svg>
`,
      });
    });
  }
  return files;
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fabric';
