// aerial-lidar/sources.js — where the pictures come from, and the URL state.
// Pure: no DOM, no Leaflet, so the URL building and hash round-trip can be
// checked without a browser.

// USGS 3DEP publishes a *bare earth* DEM — the LiDAR ground returns with
// vegetation stripped out. That is the whole point: it shows what is under the
// tree canopy, which in the Ozarks means old roadbeds, homesteads, quarries and
// sinkholes that are invisible from the air.
export const DEM = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';

export const RENDERS = [
  { id: 'multi',   rule: 'Hillshade Multidirectional',   name: 'Hillshade, multidirectional',
    note: 'Lit from several angles at once, so nothing hides in shadow. The one to spot features with.' },
  { id: 'gray',    rule: 'Hillshade Gray',               name: 'Hillshade, grey',
    note: 'A single low sun. Cleaner and more neutral; better for reading overall shape.' },
  { id: 'slope',   rule: 'Slope Map',                    name: 'Slope',
    note: 'Steepness as colour. Bluffs, scarps, cut banks and spoil heaps jump out.' },
  { id: 'tinted',  rule: 'Hillshade Elevation Tinted',   name: 'Elevation tinted',
    note: 'Hillshade with height as colour. Reads as terrain at a glance.' },
];

export const CONTOURS = [
  { id: 'off', rule: null,                          name: 'none' },
  { id: 'c2',  rule: 'Preset 2ft Contour Interval',  name: '2 ft' },
  { id: 'c5',  rule: 'Preset 5ft Contour Interval',  name: '5 ft' },
  { id: 'c10', rule: 'Preset 10ft Contour Interval', name: '10 ft' },
];

export const renderById = id => RENDERS.find(r => r.id === id) || RENDERS[0];
export const contourById = id => CONTOURS.find(c => c.id === id) || CONTOURS[0];

/** One 3DEP image for a web-mercator bbox [xmin, ymin, xmax, ymax]. */
export function demImageUrl(bbox, size, rule) {
  const q = new URLSearchParams({
    bbox: bbox.map(n => n.toFixed(3)).join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: `${size},${size}`,
    format: 'png',
    transparent: 'true',
    f: 'image',
    renderingRule: JSON.stringify({ rasterFunction: rule }),
  });
  return `${DEM}/exportImage?${q}`;
}

/** Ground elevation at a lon/lat, in metres, or null where there is no data. */
export function elevationUrl(lon, lat) {
  const q = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    returnGeometry: 'false',
    f: 'json',
  });
  return `${DEM}/identify?${q}`;
}

export function parseElevation(json) {
  const v = json && json.value;
  if (v === undefined || v === null) return null;
  // The service reports no-data as a string rather than a number.
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n) || n < -500 || n > 9000) return null;
  return n;
}

export const IMAGERY = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
  maxZoom: 19,
};

export const DEM_ATTRIBUTION = 'Elevation: USGS 3DEP bare-earth LiDAR';

// Photon rather than Nominatim proper: Nominatim's search is literal, so
// "devils den" finds nothing and only "Devil's Den" works. Photon is built for
// type-as-you-go and forgives both the apostrophe and a misspelling. Biasing by
// the current view puts the nearby Devil's Den above the ones in other states.
export const geocodeUrl = (q, lat, lon) =>
  'https://photon.komoot.io/api/?' + new URLSearchParams({
    q, limit: '6',
    ...(Number.isFinite(lat) && Number.isFinite(lon) ? { lat: lat.toFixed(4), lon: lon.toFixed(4) } : {}),
  });

/** Photon features -> { label, lat, lon }, dropping anything unplaceable. */
export function parseGeocode(json) {
  const feats = (json && json.features) || [];
  const seen = new Set();
  const out = [];
  for (const f of feats) {
    const c = f.geometry && f.geometry.coordinates;
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const p = f.properties || {};
    const head = [p.housenumber, p.street].filter(Boolean).join(' ') || p.name;
    if (!head) continue;
    const label = [head, p.city || p.county, p.state, p.country === 'United States' ? null : p.country]
      .filter(Boolean).join(', ');
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, lat: c[1], lon: c[0] });
  }
  return out;
}

// ── URL state ───────────────────────────────────────────────────────

export const DEFAULT_VIEW = { lat: 35.7842, lon: -94.2447, zoom: 15 };   // Devil's Den

/** "#35.7842,-94.2447,15,multi,c5,52" */
export function buildHash({ lat, lon, zoom, render, contour, split }) {
  return `#${lat.toFixed(5)},${lon.toFixed(5)},${Math.round(zoom * 10) / 10},` +
         `${render},${contour},${Math.round(split)}`;
}

export function parseHash(hash) {
  const p = String(hash || '').replace(/^#/, '').split(',');
  const num = (i, fallback) => {
    const n = parseFloat(p[i]);
    return Number.isFinite(n) ? n : fallback;
  };
  const lat = num(0, DEFAULT_VIEW.lat), lon = num(1, DEFAULT_VIEW.lon);
  return {
    lat: Math.min(85, Math.max(-85, lat)),
    lon: Math.min(180, Math.max(-180, lon)),
    zoom: Math.min(19, Math.max(3, num(2, DEFAULT_VIEW.zoom))),
    render: renderById(p[3]).id,
    contour: contourById(p[4]).id,
    split: Math.min(100, Math.max(0, num(5, 50))),
  };
}

export const formatElevation = (m, unit) =>
  m == null ? '—'
    : unit === 'ft' ? `${Math.round(m * 3.28084).toLocaleString()} ft`
    : `${Math.round(m).toLocaleString()} m`;
