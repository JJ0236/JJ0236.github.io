# crease — fold guide

**Date:** 2026-09-12
**Path:** `/crease/` (adds a Fold view to the existing tool)

## Purpose

After the laser has scored a sheet, show how to fold it. Two parts: a
step-by-step checklist per pattern, and a 3D simulation with a fold slider
that runs from the flat scored sheet to the collapsed form.

## Simulation

`crease/fold.js` is pure (no DOM), so `scripts/verify-crease.mjs` can drive it.

1. **Planar graph from the crease pattern.** Split every straight crease and
   outline segment at every point that lies on it (T-junctions: Yoshimura
   diagonals ending on row lines, waterbomb corners on boundary lines), weld
   vertices, then trace faces by walking half-edges sorted by angle around
   each vertex. The outer face is dropped.
2. **Triangulation.** Faces are convex for all three straight-line patterns,
   so a fan from the first vertex is exact. Fan diagonals become *facet* edges
   with a target angle of 0.
3. **Spring-mass model** (after Ghassaei, Origami Simulator): every edge is an
   axial spring; every interior edge is a hinge with a target dihedral angle.
   Crease hinges target `fold · θmax` with sign from the assignment; facet
   hinges target 0 with lower stiffness. Hinge forces use the Bridson 2003
   bending element with `sin(θ/2) − sin(θ0/2)` so a non-zero rest angle is
   supported. Semi-implicit Euler, global velocity damping, positions
   re-centred each step. Vertices start on the plane with a deterministic
   sub-millimetre z-jitter keyed by the crease assignment so the first step
   breaks symmetry in the right direction.
4. **Concentric circles are not simulated.** Curved creases need facet
   bending the model does not have. The Fold view shows the steps only.

## View

A `Pattern | Fold` toggle in the viewport. Fold view is a Three.js canvas
with orbit controls, the sheet drawn as a two-sided paper material with
crease lines coloured on top, a **Fold** slider (0–100 %), and a **Play**
button that sweeps the slider. Switching pattern or parameters rebuilds the
model.

A steps panel sits over the viewport in Fold view. Steps are per pattern and
each one, when clicked, sets the slider and the highlighted layer:

- Miura: score → pre-fold every mountain toward you → flip, pre-fold every
  valley → collapse from one corner; it closes in a single motion.
- Yoshimura: score → pre-fold rows as mountains → pre-fold diagonals as
  valleys → pinch each row of diamonds so the sheet curls; roll and join the
  side edges for a cylinder.
- Waterbomb: score → accordion-fold every horizontal line (rows alternate)
  → with the accordion closed, pinch each X so its centre pops toward you →
  work row by row; edges wrap to form the ball.
- Circles: score → gently fold each ring, alternating, a little at a time →
  the annulus twists into a saddle; do not force any single ring flat.

## Verification

- Face extraction: Miura yields `cols·rows` faces, all parallelograms;
  Yoshimura `2·cols·rows` triangles; waterbomb face count matches units.
- Every 2D face has positive area and the faces tile the outline (area sum
  equals outline area).
- Hinge force sanity: two triangles hinged with target −90° move toward −90°
  and away from +90°.
- Miura at 60 % fold: after settling, every crease dihedral is within a few
  degrees of its target and no edge length has changed by more than 1 %.
