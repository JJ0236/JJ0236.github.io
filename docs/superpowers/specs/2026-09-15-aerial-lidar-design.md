# Aerial LiDAR — swipe between bare earth and imagery

**Date:** 2026-09-15
**Path:** `/aerial-lidar/`

## Purpose

Drag a handle across the map and the aerial photo gives way to the ground
underneath it. **Bare earth** is a LiDAR survey with the vegetation returns
removed, so old roadbeds, homesteads, quarries, railroad grades and sinkholes
are plainly visible where the aerial shows nothing but canopy. In the Ozarks
that is most of it.

## Sources, and why these ones

| | Service | Why |
|---|---|---|
| Elevation | [USGS 3DEP](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) bare-earth DEM, 1 m | CORS enabled, no key, renders on demand |
| Imagery | Esri World Imagery | free, no key, sub-metre; attribution required |
| Geocoding | Photon | fuzzy, built for typeahead |

Three sources were ruled out by testing rather than by assumption:

- **The Arkansas GIS Office's own services send no CORS header**, so a browser
  cannot read them at all. Everything comes from 3DEP instead — the same LiDAR,
  nationally hosted.
- **Google Maps** cannot legally be used as raw tiles; it needs the Maps JS API,
  a key and a billing account, which would make this the only tool on the site
  that cannot just be opened.
- **Nominatim** matches literally: "devils den" returns nothing and only
  "Devil's Den" works. Photon forgives the apostrophe and a misspelling, and
  takes a location bias so the nearby Devil's Den outranks the others.

3DEP renders on demand rather than serving pre-cut tiles, so each map tile is
its own `exportImage` call for that tile's bounding box.

## Renders

`Hillshade Multidirectional` (default — lit from several angles so nothing hides
in shadow), `Hillshade Gray`, `Slope Map`, `Hillshade Elevation Tinted`, plus
2/5/10 ft contours as an overlay. Contours are drawn on **both** halves so a line
can be followed straight across the swipe instead of stopping at it.

## The swipe

Two Leaflet maps stacked. The aerial map underneath takes every gesture; the
LiDAR map on top is `pointer-events: none` and follows it. A drag or scroll over
the LiDAR side therefore still reaches a map, and the two can never disagree
about where they are.

**Both panes need an explicit `z-index`.** `clip-path` makes the top pane a
stacking context, but the bottom pane is not one, so Leaflet's internal pane
z-indexes (200–800) escape into the root stacking context and paint the aerial
tiles straight over the LiDAR map. The symptom is subtle: tiles load, the DOM
looks perfect, and both halves show imagery.

## Verification

`node scripts/verify-aerial-lidar.mjs` — offline and deterministic: URL
construction, render/contour table integrity, elevation parsing (including
3DEP's large negative no-data sentinel), geocode normalisation, and URL-state
round-tripping with clamping and junk input.

`--live` additionally probes all four services, asserting 3DEP returns an image,
reports ~314 m at Devil's Den, that Photon finds it without its apostrophe, and
that Esri serves a tile.
