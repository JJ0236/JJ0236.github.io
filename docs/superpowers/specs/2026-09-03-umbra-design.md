# umbra — anamorphic shadow-casting tool

**Date:** 2026-09-03
**Path:** `/umbra/`
**Status:** design approved, ready for implementation planning

## Purpose

Load an SVG (or type a word). Place a lamp in a 3D room. The tool solves for a
physical object — printable or laser-cuttable — that casts that SVG as its
shadow, and only from the lamp position you chose. Viewed from anywhere else the
object reads as a stretched, skewed, or scattered abstraction.

This is the anamorphic case specifically: one image, one viewpoint, a distorted
object. It is not multi-view shadow sculpture (several images from several
directions) and not a self-shadowing relief.

## The central invariant

Material is extruded **along the light rays**, not along the object's surface
normal.

For a surface point `v`, the back face vertex is `v + normalize(v - L) * thickness`,
where `L` is the lamp. Because the back vertex lies on the same ray as the front
vertex, both project to the identical point on the wall. The cast shadow is
therefore exact regardless of how thick the piece is.

A perpendicular extrusion — the obvious implementation — smears and erodes every
edge in proportion to thickness. That is why hand-built attempts at this look
mushy. This invariant is the tool's core correctness property and is asserted
numerically in the verify script.

## Geometry

### Coordinate system

Millimeters throughout, matching the other tools. Wall plane at `z = 0` with
normal `+Z`. Art is laid out in wall coordinates `(x, y)` at the user's chosen
physical size. Lamp at `L = (Lx, Ly, Lz)` with `Lz > 0`. The object sits between
lamp and wall.

For an art point `P = (px, py, 0)`, the ray is `R(t) = L + t*(P - L)` with `t = 0`
at the lamp and `t = 1` at the wall. Each surface mode solves for the smallest
positive `t` where the ray meets the surface — the lamp-facing side.

### Surface modes

The object frame is a plane through anchor `C` with normal `n` derived from user
tilt (yaw, pitch), positioned at `objDist` from the wall.

| Mode | Solve | Notes |
|---|---|---|
| **Plane** | `t = dot(C - L, n) / dot(P - L, n)` | Closed form. The whole art-to-surface map is a single homography. |
| **Cylinder** | quadratic in `t` | Axis through `C`, vertical by default, radius `r`. |
| **Dome** | quadratic in `t` | Sphere centered `C'`, radius `r`. |
| **Wave** | bracketed bisection, 24 iterations | Height field `A*sin(2*pi*u/lambda + phi)` displaced along `n`. |
| **Scattered** | per-island plane offset | Each connected island gets its own depth `d_i`. Positive polarity only. |

Scattering a solid plate is meaningless, so scattered mode forces positive
polarity and disables the polarity toggle.

### Derived numbers, shown live

These decide whether the object works in a real room, so they are surfaced in the
UI rather than buried:

- **Magnification** `wallDist / objDist`, measured at the anchor point `C` since a tilted
  plane's distance varies across its face — e.g. a 40 mm object throwing a 600 mm word
- **Penumbra blur** on the wall: `lampDiameter * b / a`, where `a` is lamp-to-object
  and `b` is object-to-wall distance
- **Thinnest stroke vs. blur** — warn when the narrowest feature is thinner than the
  blur, because that stroke will wash out
- **Object footprint** against print bed / sheet size

## Polarity and bridges

**Negative** (default): art is cut out of a plate. Glowing art in a dark field.
The plate holds the letters, but counters — the island inside `O`, `a`, `e` — float
free and need tabs. Few and short.

**Positive**: art is the material. Dark art on a lit wall. Every island is loose.

Bridges cannot be hidden. Anything in the beam casts a shadow, and general art
provides nothing to hide a strut behind. So the tool minimizes and discloses them
rather than pretending otherwise:

1. Compute connected components of the material polygon set in surface 2D space.
2. Build a minimum spanning tree over components using nearest point pairs
   (brute force over decimated contour vertices).
3. Emit each MST edge as a rectangle of user-set width, unioned into the material.
4. Assert the result is a single connected component.

In scattered mode islands sit at different depths, so the MST is solved in 3D over
island centroids and each bridge is a ray-aligned strut between two depths rather
than a flat rectangle in surface space.

Wall view renders bridges in a distinct color so their added shadow is visible
before committing to a print.

## SVG input

`svg.js` splits into a **pure geometry half** (no DOM) and a thin DOM traversal
half. The pure half parses path `d` strings and flattens curves with adaptive
tolerance; the DOM half walks the document. This split exists so the node verify
script can test path parsing directly without needing `DOMParser`.

- **Elements:** `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`,
  nested `g`, `transform` attributes (matrix / translate / scale / rotate / skewX /
  skewY), `viewBox` for scale. `preserveAspectRatio` ignored — fit by viewBox.
- **Fill rules:** `evenodd` resolves as XOR of all subpath rings; `nonzero` as
  union of positively-wound rings minus union of negatively-wound rings. The
  latter is exact for font outlines and simple shapes, and can differ from a true
  nonzero scan for pathological self-overlapping paths. The wall-view overlay
  makes any such difference visible.
- **Stroked line art:** many line-art SVGs have strokes and no fill. Strokes are
  outlined into fillable polygons — a quad per segment plus a join polygon,
  unioned — using the element's stroke width, or a user override. Without this,
  line art produces an empty object.

## Text input

Typing a word requires glyph outlines. `opentype.js` provides them from a
`.ttf`/`.otf` the user drops in, and one OFL-licensed TTF is vendored into the
repo so typing a word works with zero friction out of the box.

## Preview

three.js scene via importmap, matching `imprint` and `relief`.

- **Room view** — orbit the whole setup, live shadow-mapped cast onto the wall,
  draggable lamp gizmo
- **Wall view** — camera snapped to face the wall head-on, target art overlaid
  against the achieved shadow

The shadow map is deliberately a real render rather than an analytic re-projection.
Re-projecting through the same math would be tautological; a real cast is what
catches self-occlusion in scattered mode, bridge intrusion, and penumbra washout.

Units switch app-wide between mm and inches, matching `s1c3r`.

## Exports

- **Binary STL** and **3MF**, reusing the shape of `relief/export.js`
- **Laser SVG** — flat-plate mode only, cut-ready. A tilted flat plate is genuinely a
  2D part. Contours must be unioned first: overlapping paths would otherwise be cut
  twice.
- **Jig STL** — angled stand with a slot at the solved tilt, footprint sized to the
  plate, notched to point at the lamp
- Lamp coordinates and setup numbers embedded as comments in exported files and
  shown in the export panel

## Files

```
umbra/index.html               UI + three.js scene
umbra/svg.js                   SVG -> contours (pure parse half + DOM half)
umbra/project.js               surfaces, ray intersection, homography, penumbra math
umbra/mesh.js                  clipping, bridges, earcut, ray extrusion -> positions
umbra/worker.js                off-main-thread build
umbra/export.js                STL, 3MF, laser SVG
umbra/jig.js                   stand geometry
umbra/vendor/earcut.js         vendored, ~7 KB
umbra/vendor/polygon-clipping.js  vendored UMD + ESM wrapper, ~90 KB
umbra/vendor/space-grotesk.ttf   one OFL font for text input (already the site face)
```

Plus a card in `/projects/index.html` and a link in `scripts/nav.js`.

### Why vendored, not CDN

Node cannot import `https:` URLs, so a verify script that loads `mesh.js` breaks
if `mesh.js` pulls dependencies from a CDN. Verified during design:

- `earcut@3.0.1/+esm` — self-contained, works in node as a local file
- `polygon-clipping@0.15.7` — every published ESM build has external imports
  (`splaytree`, `robust-predicates`); the **UMD build is self-contained** and works
  as ESM with a one-line `export default globalThis.polygonClipping;` appended

Both were smoke-tested in node during design: earcut triangulates a square with a
square hole into 8 triangles; polygon-clipping unions two overlapping squares into
1 polygon and differences a hole into a 2-ring result.

`three` stays on the CDN importmap, as in the other tools — it is browser-only and
never imported by the verify script.

## Verification

`scripts/verify-umbra.mjs`, matching the existing verify scripts and reusing
`checkManifold`, `signedVolume`, and `boundingBox` from `relief/mesh.js`.

The load-bearing test: take the generated mesh's front faces, project them back
through the lamp onto the wall, and assert they land on the target within
tolerance. This is a real numerical check that the shadow is what was asked for.
Run it at several thicknesses to prove the ray-extrusion invariant — the projected
result must not change as thickness varies.

Also asserted:

- Mesh is watertight and outward-wound
- Material is a single connected component after bridging
- Path parsing fidelity against hand-written `d` strings, including arcs and
  relative commands
- Stroke outlining produces non-empty area for a stroke-only input
- Fill-rule handling: even-odd input with a counter produces a hole
- Scattered mode: no island fully occludes another along the lamp rays

## Build order

Each phase leaves a working tool.

1. **Foundation** — page shell in house chrome, SVG parse and flatten, contour
   normalization, plane projection, ray extrusion, mesh build, STL/3MF export,
   3D preview with cast shadow. Negative polarity only.
2. **Bridges and disclosure** — MST bridge solver, polarity toggle, wall-view
   overlay, penumbra and magnification warnings.
3. **Line art and text** — stroke outlining, `opentype.js` text input with the
   vendored font.
4. **Fabrication extras** — laser SVG export, jig STL.
5. **Curved surfaces** — cylinder, dome, wave.
6. **Scattered mode** — per-island depths, occlusion checking.

Scattered is last deliberately: it is the largest chunk and the least certain to
look good, so it stays additive rather than load-bearing.

## Explicitly out of scope

- Multi-view shadow sculpture (different images from different light directions)
- Self-shadowing relief panels
- Colored or filtered light
- Solving for lamp position automatically — the user places the lamp; the tool
  solves the object for wherever it is
