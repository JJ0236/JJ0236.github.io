# Arrange — SVG nesting for sheet stock

**Date:** 2026-09-15
**Path:** `/arrange/`

## Purpose

Pack many SVG parts onto sheet stock with as little waste as the geometry
allows, then export a laser-ready SVG. Runs entirely in the browser.

## Why not copy SVGnest / Deepnest

Both use *no-fit polygon + genetic algorithm*. An NFP approach must compute
O(n²) pairwise no-fit polygons **before it can place anything**, so there is no
result at all until the precompute finishes, and it degrades badly as part
count rises.

The current state of the art is `sparrow` (Gardeyn & Wauters, 2025, on top of
`jagua-rs`), which beats the prior best (ROMA) on all 13 standard benchmarks —
SWIM 78.26% vs 74.29%. Its shape suits a browser far better:

- start from a trivial bottom-left fill, so there is a usable layout immediately
- **allow overlap**, measure it, and run guided local search to separate
- shrink the container, let that force overlap, repair, repeat
- improves monotonically, so the user can stop at any time

Sparrow reaches its published numbers in Rust on 3 threads over 20 minutes. This
is JS in one worker over ~30 seconds, so the target is "clearly better than
Deepnest within the patience of someone at a laser", not benchmark parity.

## Geometry pipeline

Each part is prepared once, at import:

1. Parse SVG (`path`, `rect`, `circle`, `ellipse`, `polygon`, `polyline`,
   `line`, nested `g` with transforms). Bézier curves flatten **adaptively** to
   a chord tolerance, so straight runs stay cheap and tight curves stay round.
2. Resolve units. `width`/`height` + `viewBox` give a user-unit → mm scale;
   unitless input is treated as 96 dpi px. The user can override scale.
3. Classify contours into one outer boundary plus holes by winding and
   containment.
4. **Convex-decompose the outer contour** — earcut triangulation, then
   Hertel–Mehlhorn merging of triangles across non-essential diagonals.
5. Precompute the bounding circle and the **inscribed circle** (pole of
   inaccessibility, by grid subdivision).

Convex decomposition is the load-bearing decision. It makes collision exact and
fast (SAT between convex pieces), and it yields a signed **penetration depth**
for free — which is precisely the continuous overlap measure the local search
needs. Holes are carried for rendering and export only; part-in-part nesting is
deliberately out of scope for v1.

## Collision

Three tiers, cheapest first (the jagua-rs pattern):

1. uniform **grid broadphase** over placed parts
2. **bounding-circle** test — rejects most pairs in one distance compare
3. exact **convex SAT** per piece pair, returning penetration depth

The inscribed circle is computed but deliberately *not* used as a definite-hit
early accept: the local search needs the exact overlap magnitude as its
gradient, not a yes/no, so a shortcut there would not skip the piece loop.

Part spacing (kerf clearance) is enforced as a *minimum separation distance*
rather than by offsetting polygons. Polygon offsetting is fragile on concave
notches; a distance threshold is exact and cannot produce a too-small hull.

## Engine

Container is one real sheet (w×h), not an open strip.

```
for each sheet:
    bottom-left fill the remaining parts, then gravity-settle
    repeat until the sheet's time budget runs out:
        tear out 10-40% of the placements at random
        rebuild them with the bottom-left sweep (randomised, GRASP-style)
        settle, and keep the result if it is no worse
    parts that never fit roll to the next sheet
```

**Placement** is a lexicographic bottom-left sweep: scan y upward and, within a
row, x rightward, taking the first legal spot, then slide it down-and-left by
greedy descent. Unlike a corner-point BLF this tests real geometry on a lattice,
so a part can drop into another part's notch. Blocked positions **skip past the
blocker's right edge** rather than crawling the lattice, which is what makes a
fine lattice affordable; the slide afterwards recovers anything that skip
overshot.

**Improvement is ruin & recreate, not sparrow's overlap repair.** This is the
one place the design departs from the research, and it was measured, not
assumed: an overlap-tolerant guided local search was built first and never
converged. Sparrow reaches its published densities by evaluating millions of
samples a second in Rust over twenty minutes; in JS over a few seconds, random
jitter cannot repair a globally squeezed layout, and every shrink attempt
failed. Ruin & recreate reuses the placement sweep, and has the property that
every candidate it produces is already feasible — an invalid nest cannot be
returned, only a worse one.

Two details matter for it to work at all:

- **The objective blends height with the mean part top edge.** Used height alone
  is a max over parts, so nearly every rebuild ties and the search has no
  gradient; it accepted 106 of 106 candidates and never improved.
- **The rebuild is randomised.** A deterministic greedy recreate regenerates the
  same layout forever, which makes the whole loop pointless.

**The time budget caps optimisation, never placement.** Past the deadline the
sweep degrades to a fast path — first pose that fits, no slide — because
refusing to place would strand every later sheet. Overshoot is bounded but real:
a single initial fill cannot be interrupted mid-part, so a 6 s budget on a
hundred curved parts finishes nearer 8 s.

## Rotation

`free` (continuous), `90°` steps, `180°`, `none`, and **grain lock** — 0° and
180° only, for plywood and anything with a direction. Per-part override.

## Merged common lines

After nesting, edges from different parts that are collinear and overlapping
within tolerance are emitted once instead of twice. Saves cut time and avoids
the heat warping you get from burning the same line twice.

This only fires when parts actually touch, so it requires spacing ≈ 0. The
objective therefore carries a small **contact reward** so the optimizer actively
seeks flush straight edges rather than merely tolerating them. If that term
destabilises the search it ships as detection-only, and the UI says so.

## Files

```
arrange/index.html   layout and styles, following crease/imprint conventions
arrange/geom.js      vectors, polygons, flattening, hull, decomposition, SAT
arrange/svgin.js     SVG -> parts, unit resolution
arrange/nest.js      engine: grid, collision, separation search, sheets (no DOM)
arrange/merge.js     common-line detection and merging
arrange/export.js    laser SVG output
arrange/worker.js    runs nest.js off the main thread, streams best-so-far
arrange/app.js       UI, canvas preview, wiring
arrange/vendor/earcut.js   earcut 3.0.1 (ISC)
scripts/verify-arrange.mjs node checks, no browser
```

## Export

Laser SVG in the site convention: red `#ff0000` cut, 0.1 pt strokes, one group
per sheet, holes preserved. Optionally one file per sheet.

## Verification

`node scripts/verify-arrange.mjs`, no browser:

- flattening keeps a circle within chord tolerance of true radius
- convex decomposition: every piece is convex, wound consistently, and the
  pieces' areas sum to the original polygon's area
- inscribed circle lies inside the polygon; bounding circle contains it
- SAT agrees with a brute-force point/edge test on random polygon pairs, and
  reports zero penetration exactly when they are disjoint
- **no two placed parts overlap, and all respect the spacing** — the property
  that actually matters, asserted over randomised nests
- every part lands inside its sheet
- common-line merging preserves total cut geometry minus the shared overlap
- a known-easy instance (a grid of identical rectangles) reaches near-100%
  density, which catches a silently broken search
- right triangles, which tile into rectangles, exceed 75% — bounding-box-only
  packing scores about 50% there, so this is the test that proves the nester
  actually interlocks
- a concave outline decomposes into several pieces, none repeating a vertex and
  none straying outside the outline
- the clearance short-circuit never disagrees with an exact measurement about
  whether spacing is met

## Measured results

| Instance | Efficiency | Note |
|---|---|---|
| 40 identical rectangles | 94.7% | essentially optimal |
| 24 right triangles | 85.7% | bbox-only packing would be ~50% |
| mixed 6-type laser job, 60 parts, 2 mm kerf | 75.5% | the realistic case |
| crosses + L-shapes | 64.6% | crosses are the worst-packing shape there is |

## Bugs worth remembering

- **The convex decomposition silently collapsed concave parts.** The
  Hertel–Mehlhorn merge re-added the shared vertex, producing a ring with a
  zero-width slit. That ring passed a per-triple convexity test, so a concave
  bracket came back as *one* "convex" piece and collided as a solid blob —
  interlocking was impossible and the concave benchmark sat at 43%. Fixing the
  loop bound took it to 64.6%. The merge is now judged on real geometry.
- **Neighbour queries must be padded by the clearance.** Two parts can violate
  `spacing` while their bounding boxes are still apart, so an unpadded grid
  query made the clearance silently unenforceable.
- **SAT's edge-normal gap is only a lower bound on distance** for disjoint
  convex polygons — the closest approach can be vertex-to-vertex along no edge
  normal. Using it as the gap made the nester over-separate parts. It is exact
  for penetration, so it still settles the sign.
- **Computing that exact distance everywhere cost 78% of runtime.** The collision
  test only needs to know whether the gap clears `spacing`, and the SAT bound
  already answers that above the threshold.
