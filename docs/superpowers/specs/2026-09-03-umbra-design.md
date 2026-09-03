# umbra — anamorphic shadow-casting tool

**Date:** 2026-09-03 (revised)
**Path:** `/umbra/`

## Purpose

Load an SVG or type a word. Place a lamp in a 3D room. The tool solves for a
physical object — printable or laser-cuttable — that casts that art as its
shadow from that one lamp position.

## What the light does, and why it drives the design

The first version of this spec treated lamp placement as a parameter and the
optics as a warning badge. That was backwards: the lamp decides whether the
object is possible at all.

**Blur.** A source of diameter `s` at distance `a` from the object, with the wall
`b` beyond it, casts a penumbra of width `s·b/a` on the wall.

**Magnification.** `M = (a+b)/a`.

Let `k = objectDistance / lampDistance` (both measured from the wall). Then:

```
M                      = 1 / (1 - k)
min feature on object  ~ 3·s·k          (3:1 legibility against the blur)
object art width       = wallArtWidth · (1 - k)
resolvable features    ~ wallArtWidth · (1-k) / (3·s·k)
```

Three consequences the tool is built around:

1. **Sharpness depends on the ratio of object detail to emitter diameter, not on
   magnification.** A bigger throw does not buy a crisper shadow.
2. **Detail scales as `(1-k)/k`.** Pushing the object toward the wall strictly
   buys resolution, at the cost of a bigger object. That is the real trade, and
   it gets a slider with a live readout instead of being buried.
3. **The emitter must be small.** A phone flashlight (~2 mm) or a bare LED works.
   A frosted household bulb (~40 mm) cannot produce a readable shadow at any
   settings.

| Source | Emitter | Min feature on object at k=0.5 |
|---|---|---|
| Phone flashlight | ~2 mm | ~3 mm |
| Bare 5 mm LED | 5 mm | ~7.5 mm |
| Halogen capsule | ~4 mm | ~6 mm |
| Frosted A19 bulb | ~40 mm | ~60 mm — unusable |

The art's own mean stroke width is estimated as `2·area/perimeter`, compared
against the minimum feature, and reported as a sharpness ratio with a plain
verdict: sharp, soft, or washed out.

**Fine line art is physically out of reach.** A 1 mm line needs a sub-millimetre
emitter. The tool says so rather than producing an object that cannot work.

## The central invariant

Material extrudes **along the light rays**, not along the surface normal. The back
vertex of every point is `v + normalize(v - L)·thickness`, so it lies on the same
ray as the front vertex and lands on the identical spot on the wall. The shadow is
exact at any thickness. A perpendicular extrusion smears every edge in proportion
to thickness.

## Where the distortion comes from

A plate **parallel to the wall** produces a pure scaled copy no matter where the
lamp is — the ray bundle through it is a uniform scaling. Distortion requires
tilt, which makes the art-to-surface map a homography.

But a homography of a word is still a readable word — it is the same relationship
as a projector on a tilted screen. The "abstract until the light hits it" effect
comes from **depth variation**, not tilt: pieces at different depths shear apart
as the viewpoint moves.

So depth is a first-class slider, not a late-phase mode:

- **spread** — how far pieces separate along the rays
- **granularity** — whole plate, horizontal bands, or per-island
- **seed** — reroll the arrangement

Each group is re-projected through the rays onto its own offset plane, so the
shadow stays exact while the physical pieces sit at different depths and different
scales.

## Polarity

**Negative** (default): art cut out of a plate. Always flat — a single plate is one
rigid piece, and scattering the holes of a plate is meaningless. Robust, and the
mode that always works.

**Positive**: art is the material. Depth spread available here. Every island is
loose and needs a strut.

## Bridges

Bridges cannot be hidden — anything in the beam casts a shadow. The tool minimizes
and discloses them.

Connected components come free from the clipping result: `polygon-clipping` returns
a MultiPolygon whose every polygon is one connected component. Each non-primary
component is joined to the largest by a rectangle of user-set width at the nearest
point pair, then unioned back in. Depth-varied islands get 3D struts as separate
closed box solids instead.

Wall view renders bridges in a distinct color so their added shadow is visible
before printing.

## SVG input

`svg.js` splits into a pure geometry half (path `d` parsing, curve flattening, no
DOM) and a thin DOM traversal half, so the node verify script can test parsing
without `DOMParser`.

- `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, nested `g`,
  `transform` (matrix/translate/scale/rotate/skew), `viewBox`
- Fill rules: `evenodd` as XOR of rings; `nonzero` as union of positive rings minus
  union of negative rings — exact for font outlines and simple shapes
- **Stroked line art** is outlined into fillable polygons (a quad per segment plus
  round joins, unioned). Without this, stroke-only SVGs produce an empty object.

Text input uses `opentype.js` with a vendored OFL font, so typing a word works with
no external file.

## Preview

three.js via importmap, matching `imprint` and `relief`.

- **Room view** — orbit the setup, live shadow-mapped cast, draggable lamp
- **Wall view** — camera square to the wall, target art overlaid on the achieved
  shadow

A real shadow render rather than an analytic re-projection: re-projecting through
the same math would be tautological. The cast is what reveals bridge intrusion and
penumbra washout.

## Exports

- **Binary STL**
- **Laser SVG**, flat plate only. A laser kerf is perpendicular to the sheet, so a
  cut plate has vertical walls, not ray-aligned ones — the shadow is eroded
  (negative) or dilated (positive) by about `thickness·tan θ`. The outline is
  therefore taken at the sheet's **mid-plane** to halve the error, and tilt is
  capped from sheet thickness and minimum feature. Extreme tilts are print-only.

## Files

```
umbra/index.html                  UI + three.js scene
umbra/svg.js                      SVG -> contours (pure half + DOM half)
umbra/project.js                  lamp math, ray-surface intersection, feasibility solver
umbra/mesh.js                     clipping, bridges, earcut, ray extrusion -> positions
umbra/worker.js                   off-main-thread build
umbra/export.js                   binary STL, laser SVG
umbra/vendor/earcut.js            ~7 KB
umbra/vendor/polygon-clipping.js  UMD + ESM wrapper, ~90 KB
```

Vendored, not CDN-loaded: node cannot import `https:` URLs, so a verify script that
loads `mesh.js` would break. Every published ESM build of `polygon-clipping` has
external imports; the UMD build is self-contained and works as ESM with one
appended `export default`. `three` stays on the importmap — browser-only, never
imported by the verify script.

## Verification

`scripts/verify-umbra.mjs`, reusing `checkManifold`, `signedVolume`, `boundingBox`
from `relief/mesh.js`.

The load-bearing test: project the generated mesh's front faces back through the
lamp onto the wall and assert they land on the target within tolerance. Run at
several thicknesses to prove the ray-extrusion invariant — the projection must not
move as thickness varies.

Also: watertight and outward-wound; single connected component after bridging;
path parsing against hand-written `d` strings; stroke outlining yields non-empty
area; even-odd counters produce holes; the feasibility formulas match closed form.

## Cut from the first version

The jig, 3MF, curved shell modes as separate surfaces, and automatic lamp solving.
The user places the lamp; the tool reports what that placement can and cannot do.
