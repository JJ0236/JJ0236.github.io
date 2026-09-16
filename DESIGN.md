# Design direction — joshhicks.info

Authored by Josh, 2026-09-16, choosing from rendered options. This file is the
direction. `antislop.md` is the filter applied on top of it.

## Reading

Tool pages for makers who already know what they are doing, in a **field guide**
visual language.

**Dials: ENERGY 1 / RHYTHM 2 / MOTION 1.**

Calm, because these are working tools used beside a machine, not a landing page
that has to sell anything. Some rhythm, because a tool page has genuinely
different kinds of block (a specimen list, a settings panel, a preview) and they
should not all look the same. Almost no motion, because something moving while
you are setting a kerf value is noise.

## The language

Old naturalist handbooks and USDA field bulletins: a reading serif, specimen
entries with an italic note underneath, engraved rules, room in the margins,
figures set as measurements rather than as interface chrome.

It fits because half these tools are about physical material (fabric, plywood,
acrylic, terrain) and half are about the Ozarks directly (foraging, LiDAR,
Cloche). A field guide is what you carry to look closely at something real.

## Palette

Unchanged. Moss, soil, slate, parchment, as before. Dark is **the same earth
after sundown**: parchment becomes the ink instead of the paper, moss and soil
hold their roles. It is not a generic dark theme with a green accent.

Two colours changed for contrast, not taste: the small uppercase section label
was 4.46:1 in light and 3.31:1 in dark, both under WCAG AA. Now `--label` is a
darker soil in light (6.4:1) and `--soil-light` in dark (6.3:1).

## Typography

- **Literata** for reading and headings. A text serif drawn for long reading on
  screen, with real italics for the specimen notes and oldstyle figures so
  `120 × 46 mm` reads as a measurement. Chosen against Space Grotesk, which is
  on every AI-default roster and gave the site no voice of its own.
- **Public Sans** for labels, controls and anything small and uppercase. A civic
  typeface, plain on purpose, so it never competes with the serif.

## Identity motif

The **specimen entry**: a name, its measurement set flush right, and an italic
note beneath. Parts, blocks, fabrics, tools and map layers are all specimens.
It repeats across every tool and is the thing that makes the site one site.

## Accent

Moss green, at the action. One primary button per screen. Soil is structural
(rules, labels, headings), not decorative.

## Rules that follow from this

- No card grid where a list will do. Specimens are a list.
- Rules are hairlines that separate; they never carry colour for decoration.
- Numbers use oldstyle figures in the serif, tabular in the sans.
- Motion is limited to state changes the user caused. Nothing loops.
- Dark mode follows the system, with an explicit override remembered per browser.
