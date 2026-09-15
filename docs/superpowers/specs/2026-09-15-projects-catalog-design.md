# Projects page — catalog redesign

**Date:** 2026-09-15
**Page:** `/projects/`

## Problem

Fifteen projects sat in one flat `auto-fill` card grid with no grouping. Card
descriptions ranged from eight words (Foraging Map) to a five-sentence paragraph
(Cloche), so rows never aligned and the grid had no rhythm. The only visual
differentiator was a 4px colour stripe. Two "showcase" cards that link nowhere
were mixed in with real tools. `/lazar/` and `/umbra/` were built but listed
nowhere.

## Grouping — by machine

A visitor's real question is "I have a laser cutter, what can I use?" Sections
are named for the machine, plainly, with a subtitle that explains the payoff.

| # | Section | Tools |
|---|---------|-------|
| 01 | Laser cutter | Crease, Unfold, Scissor, s1c3r, Umbra, LAZAR, STL→Depth |
| 02 | 3D printer | Terra, Relief, Imprint |
| 03 | Simulation | Cloche, WebGL Wave Tank |
| 04 | Data & media | Foraging Map, Transcript Tool, Instagram Analytics |

Dual-output tools live in one section only, but carry both tags so the filter
still finds them: **Umbra** (laser SVG + STL) sits under Laser cutter with a
`print` tag; **Imprint** (STL/3MF + laser slats) sits under 3D printer with a
`laser` tag.

**STL→Depth** is placed under Laser cutter, paired with LAZAR: LAZAR preps
photos for engraving, STL→Depth preps 3D models for engraving.

## Display — catalog rows

Replaces cards. Each row is a single `<a>`:

- stable two-digit part number
- name, with format chips (`SVG`, `STL`, `3MF`, `PNG`, `Laser`) right-aligned
- a one-line summary, always visible
- the long description, revealed on `:hover`/`:focus-visible`

Part numbers are **stable** — filtering leaves gaps (01, 04, 07) the way a real
parts catalog does. No renumbering.

On `(hover: none)` devices the long description is shown by default, since
hover never fires there.

## Filter bar

Sticky chip row: `all · laser · 3d print · three.js · maps · data · simulation`.
Reads `data-tags` off each row. Sections with no matching rows hide themselves;
section counts update live. Rows are static HTML, so the page is fully readable
and crawlable with JS disabled.

## Inventory changes

- **Added:** LAZAR, Umbra (requires committing the untracked `umbra/` dir)
- **Renamed:** "Interactive WebGL Demo" → "WebGL Wave Tank" (the old name said
  nothing about what it is)
- **Moved off Projects:** "3D Printing & Fabrication" and "Scouting / STEM" —
  the two non-linking showcase cards — become an **Other things I do** section
  at the bottom of `/experience/`, alongside TunesInYourCity
- **Kept:** TunesInYourCity featured banner at the top of Projects
- **Unchanged:** the hidden SHA-256 gate on the "o" in "Projects"
