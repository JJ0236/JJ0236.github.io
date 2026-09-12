# unfold — STL to papercraft net

**Date:** 2026-09-12
**Path:** `/unfold/`

## Purpose

Load a low-poly STL, get a laser-ready net: cut outline with glue tabs,
scored fold lines split into mountain and valley layers, matching edge
numbers engraved so the pieces go back together. A fold slider animates the
flat net closing into the model.

This is papercraft, not origami. It reuses `crease/export.js` for layers,
chaining, perforation and two-sided output.

## Pipeline (all pure, no DOM, testable under node)

`unfold/stl.js` — binary and ASCII STL → flat triangle array.

`unfold/mesh.js` — weld vertices on a 1e-4 grid relative to the bounding
box; build edge map; **merge coplanar adjacent triangles** (normals within
1°) into polygon faces, since a cube must unfold as six squares, not twelve
triangles. Groups whose boundary is not a single loop fall back to their
triangles. Faces store their outward normal and vertex loop, counter-clockwise
seen from outside. Edges shared by exactly two faces are foldable; any other
edge is a boundary. Refuse models above 3000 faces with a plain message and
warn above 600 that the net will be fiddly.

`unfold/unfold.js` —

1. **Spanning tree** over the face-adjacency graph by maximum edge length
   (fold along long edges, cut short ones). Root is the largest face.
2. **Layout.** Each face gets a right-handed in-plane basis, so its 2D
   coordinates are its 3D vertices projected. Children are placed by the 2D
   rigid transform that maps their shared edge onto the parent's copy of it;
   with consistent orientation the child lands on the far side automatically.
3. **Islands.** Before placing a child, test it against every polygon already
   in the island (segment intersection plus point-in-polygon on slightly
   shrunk polygons). If it overlaps, or would push the island's bounding box
   past the sheet's usable area, the tree edge becomes a cut and the child
   starts a new island. BFS continues inside the child's subtree.
4. **Tabs.** Every cut edge between two faces gets one trapezoid tab on one
   side only: height `tabH`, ends angled `tabAngle`, top shortened accordingly
   and never inverted. Try the first side; if the tab overlaps anything in
   that island, try the other; then halve the height twice; then give up and
   mark the edge *no tab*. A tab's hinge is the same type as the mesh edge.
5. **Assignment.** Dihedral sign gives the type: convex edge is mountain when
   the outside face is scored. **Score face: outside / inside** mirrors the
   whole layout and swaps the layers.
6. **Labels.** Cut edges are numbered; the number sits just inside each face
   near the edge midpoint and on the tab. Text is a fourth layer, `label`,
   green `#008800`, intended for engraving. Font size is clamped between 2
   and 6 mm.
7. **Packing.** Each island is rotated to its minimum-area bounding box
   (36 trial angles), then shelf-packed onto sheets of the chosen preset
   minus margin. One SVG per sheet.

`crease/export.js` gains a `T` item `{ x, y, text, size, angle }` and emits a
`label` group only when a file has labels. Nothing else changes.

## Page

Same layout and styles as `/crease/`. Sidebar: Model (drop STL, four sample
solids generated in code: cube, octahedron, icosahedron, a low-poly gem),
Size (longest dimension in mm, default from the file), Sheet (same presets),
Tabs (on/off, height, angle), Labels toggle, Score face, Valley strategy,
Export (one button per sheet), stats (faces, islands, sheets, edges without
tabs, cut and score length).

Viewport toggle **3D | Net**. 3D is Three.js with orbit controls and a
**Fold** slider: every face's transform is its parent's transform times a
rotation about the shared edge by `t · dihedral`; each island's root
interpolates from its flat position on the net to its place in the assembled
model, so at 100 % the model is whole. Net view is the sheets side by side
with pan and zoom, tabs shaded, labels visible.

## Verification (`scripts/verify-unfold.mjs`)

- ASCII and binary STL parse to the same triangles.
- Cube: 12 triangles merge to 6 faces; 5 fold edges, 7 cut edges; a single
  island; every 2D edge length equals its 3D length.
- No two faces in an island overlap, for cube, octahedron, icosahedron and gem.
- Tabs overlap nothing; every cut edge with a tab has its number exactly
  twice plus once on the tab.
- Packed islands lie inside the sheet minus margin.
- Fold at t = 1 reproduces every original 3D vertex within 1e-6 after the
  island root pose is applied.
- Export parses as XML with `cut`, `mountain`, `valley` and `label` groups.

## Revision, 2026-09-12 (afternoon)

Tested on a 221-face model the fixed spanning tree produced 26 pieces. Replaced
with:

- **Forest search.** Islands grow face by face; an attachment that would
  overlap is skipped and the face waits for another neighbour. Randomised edge
  priorities and roots, up to ~48 tries, fewest pieces wins, ties to the most
  compact net.
- **One piece by default.** When no overlap-free net exists at the current
  detail, quadric edge-collapse decimation (`unfold/decimate.js`) removes
  ~18 % of triangles per round and the search repeats, down to a user-set
  minimum face count (default 20). The sheet never splits a net; the page is
  sized to the net and the sheet is drawn only as a reference.
- **Colours.** Red cut, blue folds (mountain and valley share the colour),
  green labels, 0.1 pt strokes. Small green m/v marks sit beside every fold on
  the scored face, which now defaults to inside.
- **Samples.** Dodecahedron, sphere, star, house and torus added; icons are
  drawn from the solids.

## Revision, 2026-09-12 (evening): tabu search

Random-restart growth still needed seven rounds of blind simplification on a
221-face model. Replaced the search with `unfold/solver.js`:

- **Tabu search over the unfold tree** (Zawallich, *Unfolding Polyhedra via
  Tabu Search*, 2023). One spanning tree, objective = overlapping face pairs
  counted on a uniform grid. Each iteration re-roots so the chosen overlapping
  face drags the smallest subtree, then moves it to the neighbour that lowers
  the count most; a tabu list (3·log₃F) blocks undoing moves; stalls trigger a
  regrown start with the global best kept.
- **Fallback simplification** (after Bhargava et al., *Mesh Simplification for
  Unfolding*, 2024): when the time budget (default 15 s) runs out with
  overlaps, quadric collapse removes 12 % of triangles per round with the
  edges of the overlapping faces collapsing first, and a short search runs
  again, down to the minimum face count. Saddle-vertex nudging was tried and
  dropped: it did not converge in practice.
- Runs in a Web Worker (`unfold/worker.js`) with live progress and a **Keep
  searching** button; inline fallback when workers are unavailable.
- Results: 288-face torus 0.2 s, 310-face bumpy sphere 5 s, both unsimplified;
  the 217-face test model reaches one piece at 100–135 faces in about 25 s.
- Labels: 2 mm, one number per edge on the tab and its mate; m/v marks 1.4 mm.
  On-screen previews use the laser colours (red cut, one blue for creases).
- 3D view shows built W × D × H in inches with mm; editing any one scales the
  model uniformly and flows straight into the export.
