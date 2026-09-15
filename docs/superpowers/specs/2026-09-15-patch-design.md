# Patch — quilt block generator

**Date:** 2026-09-15
**Path:** `/patch/`

## Purpose

Pick a quilt block, assign fabrics, set the finished size, and get a laser-ready
SVG of every piece with the seam allowance already in it.

## The one rule that matters

A quilt piece is cut larger than it finishes, by the seam allowance, on every
edge. Patterns state that per unit type — "half-square triangle = finished +
⅞″", "quarter-square = finished + 1¼″", "flying geese = finished width + 1¼″" —
but those are all the same operation underneath: **offset the finished polygon
outward by the seam allowance.**

Working it from first principles for a half-square triangle: two triangles sewn
along the hypotenuse with seam `s` give a unit `U = C − s√2`, and the finished
size is `F = U − 2s`, so `C = F + s(2+√2)`. At `s = ¼″` that is 0.8536″ — ⅞″
rounded to the nearest eighth, because quilters cut against a ruler. The
quarter-square works out to `s(2+2√2)` = 1.207″ ≈ 1¼″, and the flying goose base
to `2s/tan(22.5°)` = 1.207″ ≈ 1¼″.

So the general operation *reproduces* the rule book rather than contradicting
it, and it extends to geometry the rule book never covered. Quilt pieces are
essentially always convex — squares, rectangles, right triangles, diamonds,
trapezoids — so the offset is exact and cheap.

**Dog ears.** An offset 45° corner runs out to `s/sin(22.5°)` ≈ 2.6× the seam
allowance: a long fragile spike. Clamping the mitre cuts it off. **Off by
default** — with the points on, a piece is exactly what a pattern hands you, and
the point is the corner you line neighbouring pieces up by when piecing.
Trimming saves fabric and is one checkbox away.

Squares are unaffected either way: a 90° mitre reaches 1.41× the allowance,
inside the 1.6 limit, so nothing is ever cut off a right angle.

**Grain.** A piece cut off-grain stretches on the bias and pulls the block out
of square, so the cutting layout is grain-locked to 0/180° rotation.

## Model

A block is an N×N grid of *finished* units. Each unit expands to regions, and
each region takes a fabric. Unit types: plain, half-square, quarter-square,
flying geese (2×1), rails, square-in-square, four patch.

Unit types: plain, half-square, quarter-square, flying geese (2×1), two rails,
three rails, square-in-square, split quarter-square, folded corner, snowball,
nine patch, stem, four patch. A unit may be sized non-uniformly (`w`/`h` rather
than a single scale), which is what log cabin logs and bear paw sashing need —
they are long thin rectangles, not scaled squares. `rotateUnits` turns a group a
quarter at a time about the block centre, so a symmetric block reads as "one
motif, placed four ways" instead of a hand-written list of every unit.

Library (23): Four Patch, Nine Patch, Half-Square Triangle, Pinwheel, Sawtooth
Star, Ohio Star, Churn Dash, Friendship Star, Card Trick, Jacob's Ladder, Maple
Leaf, Double Nine Patch, Hourglass, Square in a Square, Snowball, Broken Dishes,
Bow Tie, Dutchman's Puzzle, Rail Fence, Flying Geese, Log Cabin, Bear's Paw,
Shoofly. Plus a grid editor — click a cell to cycle its type, shift-click to
rotate — because most traditional blocks *are* a grid.

Log Cabin is not a grid of units: a centre square with logs added round it in
turn, each as long as the side it lands on, light on two sides and dark on the
other two. Bear's Paw is one paw motif placed four ways on a 7×7 grid.

Card Trick's side units are flying geese in a *square* cell — background against
the outer edge with its point inward, the two neighbouring cards filling the
corners beside it. Cutting a half off a diagonal instead gives the wrong shape,
and the block stops reading as four interlocking cards.

A star's centre square and its points are collinear, so sharing a fabric between
them reads as one plain diamond rather than a star. The default roles put a
focus fabric in the centre, which is how the block is actually pieced.

## Cutting

Pieces of different fabrics can never share a sheet, so each fabric is laid out
separately. The layout reuses the nester from `/arrange/` with grain lock rather
than growing a second one.

Output is the site laser convention: red `#ff0000` at 0.1 pt, millimetre units,
one SVG per fabric per sheet. Grain arrows are available on the engrave layer
and off by default — marking fabric with a laser is usually not wanted.

## Files

```
patch/blocks.js   unit types and the block library; no units, no millimetres
patch/pieces.js   convex offset, piece grouping, fabric totals
patch/export.js   layout via ../arrange/nest.js, laser SVG out
patch/app.js      UI, preview, cutting layout
scripts/verify-patch.mjs
```

## Verification

`node scripts/verify-patch.mjs`, no browser:

- every library block's regions cover its grid exactly and never overlap
- half-square, quarter-square and flying geese cut sizes match both the exact
  formula and, to within a sixteenth, the traditional rule
- a 12″ nine patch gives exactly 4.5″ squares
- every finished edge sits exactly one seam allowance inside the cut outline
- the cut polygon contains the finished polygon, at any winding
- trimming stays inside the mitre limit, still covers the finished shape, and
  only ever removes material
- every laid-out piece lands inside its sheet, with nothing unplaced
