# crease — origami crease-pattern generator for the laser

**Date:** 2026-09-11
**Path:** `/crease/`

## Purpose

Pick a parametric origami tessellation, set its cell size and count, and
export a laser-ready SVG: the sheet outline as a cut layer, mountain folds on
one score layer, valley folds on another. Scoring the creases is what makes
tessellations with hundreds of folds practical to collapse by hand.

Scope is deliberately single-sheet, no-cut origami defined by math. Unfolding
an STL into a papercraft net is a different tool and a planned follow-up that
can reuse the export layer.

## Patterns

Every pattern is a pure function `(params) -> { cuts, mountains, valleys, w, h }`
in millimetres, with `cuts` as closed polylines and the fold sets as line
segments. No DOM. The parameter panel is generated from each pattern's
declared param list.

| Pattern | Params | Assignment |
|---|---|---|
| **Miura-ori** | columns, rows, cell width, cell height, zigzag angle | Each horizontal zigzag is uniformly M or V, alternating by row. Vertical segments are a checkerboard: a vertical crease flips type each time it crosses a zigzag pleat. Every interior vertex is 3:1 (Maekawa) and its opposite sector angles sum to 180° (Kawasaki), so the pattern flat-folds. |
| **Yoshimura** | columns, rows, cell width, row height | Straight horizontal row lines are M; the diamond zigzag diagonals are V. Rows alternate stagger by half a cell. Not flat-foldable by design (it is a cylinder buckling pattern). |
| **Waterbomb** | columns, rows, unit width, unit height | Each unit's X diagonals are M, the horizontal midline through unit centres is V, the horizontal unit boundaries are M. Alternate rows are staggered by half a unit, which is what lets the sheet curl into the magic ball. |
| **Concentric circles** | rings, inner radius, ring spacing | Curved creases alternating M/V from the inside out. The centre disc is cut out (the classic Bauhaus model needs it) and the outline is the outer circle. A laser is the only practical way to score curved creases, so this is the showcase. |

The outline follows the pattern's real edge (Miura and Yoshimura have zigzag
top and bottom edges; Waterbomb is rectangular; circles are an annulus). A
**Swap M/V** toggle flips every assignment for people scoring the back face.

## Sheet fitting

The panel reports the pattern's overall width × height live. A sheet preset
(A4, US Letter, 12×12 in, 12×24 in, custom) plus a **Fit to sheet** button
rescales the cell dimensions uniformly so the pattern fills the sheet with a
margin. Overflow is shown as a warning, never silently clipped.

## Laser handling of valleys

A laser scores one face. The **Valley strategy** selector decides what the
valley layer means:

1. **Same side** (default): both layers scored from the front. Paper folds
   either way across a score line; valleys are slightly less crisp. Layers are
   still separate so power can differ.
2. **Perforate valleys**: valley segments are emitted as real short dashes
   (dash and gap lengths are parameters) so the fold is symmetric. Dashes are
   geometry, not `stroke-dasharray`, because laser software ignores dash
   arrays.
3. **Two-sided**: two SVGs. Front carries cuts plus mountains; back carries
   valleys mirrored about the vertical axis, plus the same cut outline and two
   registration crosses so the sheet can be flipped and re-aligned. Cutting
   happens on whichever pass the user chooses last.

## SVG export

- `width`/`height` in mm, `viewBox` in the same units, 1 unit = 1 mm.
- Three groups with `id` and `inkscape:label`: `cut` (black `#000000`),
  `mountain` (red `#ff0000`), `valley` (blue `#0000ff`), stroke width 0.1.
  Same convention as s1c3r so the user's laser layer mapping carries over.
- Collinear consecutive segments are merged into polylines per layer so the
  laser does not lift between every cell.
- Optional legend text group, off by default.

## Preview

An inline SVG of the pattern in the viewport, pan and zoom by wheel and drag.
Mountains draw dash-dot red and valleys dashed blue, the standard diagram
convention, with the cut outline solid. Fold count and total score length are
in the stats corner, since score length is what determines laser time.

## Files

```
crease/index.html    layout and styles, following imprint conventions
crease/patterns.js   pure pattern generators + shared helpers (no DOM)
crease/export.js     SVG string builder, dash conversion, mirroring, merging
crease/app.js        panel generation, preview, download wiring
scripts/verify-crease.mjs   node checks, no browser
```

## Verification

`node scripts/verify-crease.mjs`:

- every fold segment of every pattern lies inside the outline's bounds
- Miura: every interior vertex is degree 4, 3:1, and Kawasaki holds
- Waterbomb: unit centres are degree 6 with 4:2
- circles: ring radii strictly increase and alternate assignment
- dash conversion preserves total covered length within dash+gap tolerance
- two-sided back file mirrors valley x-coordinates exactly
- export output parses as XML and contains the three layer groups
- **Swap M/V** exchanges the two sets exactly

## Revision, 2026-09-12

Laser colours changed sitewide in `crease/export.js`: red cut, blue creases
(one colour for mountain and valley), green labels, 0.1 pt strokes. Because the
two crease types share a colour, each crease gets a small green m or v beside
its midpoint on the label layer (toggle in the Laser panel).
