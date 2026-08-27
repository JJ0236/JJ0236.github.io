// terra/sources.js — data acquisition.
//
// Two independent sources, both key-free and CORS-enabled:
//   • Elevation  — AWS Terrain Tiles (terrarium encoding), SRTM 30m + GMTED fill
//   • Features   — OpenStreetMap via Overpass API
//
// Tile math and the DEM sampler are pure and safe to import inside a worker.
// Only fetchDem() touches the DOM (canvas decode), and it runs on the main thread.

export const ATTRIBUTION =
  'Map data © OpenStreetMap contributors (ODbL). ' +
  'Elevation: SRTM/GMTED via AWS Terrain Tiles.';

const DEM_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

// Global-coverage instances only. Regional extracts (overpass.osm.ch, for one)
// answer HTTP 200 with zero elements outside their region, which would quietly
// produce an empty model instead of an error.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

/* ── Web Mercator tile math ────────────────────────────────────────────── */

export function lon2px(lon, z) {
  return (lon + 180) / 360 * Math.pow(2, z) * 256;
}

export function lat2px(lat, z) {
  const r = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  return y * Math.pow(2, z) * 256;
}

// Pick the coarsest zoom that still resolves the requested sample spacing.
// Capped at 14 — the underlying SRTM data runs out of real detail around z13,
// and asking for more just multiplies tile count for interpolated mush.
export function pickDemZoom(lat, sampleMetres) {
  const z = Math.ceil(Math.log2(156543.03392 * Math.cos(lat * Math.PI / 180) / sampleMetres));
  return Math.max(6, Math.min(14, z));
}

/* ── Elevation ─────────────────────────────────────────────────────────── */

async function fetchTile(z, x, y, signal) {
  const n = Math.pow(2, z);
  // Wrap x around the antimeridian; clamp y (no tiles beyond the poles).
  const wx = ((x % n) + n) % n;
  if (y < 0 || y >= n) return null;

  const url = `${DEM_BASE}/${z}/${wx}/${y}.png`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal, mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await createImageBitmap(await res.blob());
    } catch (err) {
      if (signal && signal.aborted) throw err;
      lastErr = err;
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  console.warn(`terra: DEM tile ${z}/${x}/${y} failed`, lastErr);
  return null; // treated as sea level rather than failing the whole build
}

async function pooled(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Fetch and stitch elevation covering a bbox.
 *
 * @param {{west:number,south:number,east:number,north:number}} bbox
 * @param {number} sampleMetres  desired ground resolution
 * @returns {Promise<object>} a plain, structured-cloneable DEM descriptor
 */
export async function fetchDem(bbox, sampleMetres, { onProgress, signal } = {}) {
  const midLat = (bbox.north + bbox.south) / 2;
  const z = pickDemZoom(midLat, sampleMetres);

  // Pad by one pixel so bilinear sampling at the very edge stays in range.
  const pxW = lon2px(bbox.west, z) - 1;
  const pxE = lon2px(bbox.east, z) + 1;
  const pxN = lat2px(bbox.north, z) - 1;
  const pxS = lat2px(bbox.south, z) + 1;

  const tx0 = Math.floor(pxW / 256), tx1 = Math.floor(pxE / 256);
  const ty0 = Math.floor(pxN / 256), ty1 = Math.floor(pxS / 256);
  const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;

  const coords = [];
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) coords.push({ tx, ty });

  let done = 0;
  const bitmaps = await pooled(coords, 8, async c => {
    const bm = await fetchTile(z, c.tx, c.ty, signal);
    done++;
    if (onProgress) onProgress(done / coords.length);
    return bm;
  });

  const width = cols * 256, height = rows * 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  bitmaps.forEach((bm, i) => {
    if (!bm) return;
    const cx = (i % cols) * 256, cy = Math.floor(i / cols) * 256;
    ctx.drawImage(bm, cx, cy);
    bm.close();
  });

  const rgba = ctx.getImageData(0, 0, width, height).data;
  const elev = new Float32Array(width * height);
  for (let i = 0, p = 0; i < elev.length; i++, p += 4) {
    // Terrarium: elevation = (R * 256 + G + B / 256) - 32768
    elev[i] = (rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256) - 32768;
  }

  return { z, width, height, originX: tx0 * 256, originY: ty0 * 256, elev };
}

/**
 * Bilinear elevation lookup, in metres. Pure — usable inside a worker.
 * Returns a closure over the DEM descriptor from fetchDem().
 */
export function demSampler(dem) {
  const { z, width, height, originX, originY, elev } = dem;
  return function sample(lon, lat) {
    const fx = Math.max(0, Math.min(width - 1.001, lon2px(lon, z) - originX));
    const fy = Math.max(0, Math.min(height - 1.001, lat2px(lat, z) - originY));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const i00 = y0 * width + x0;
    const a = elev[i00], b = elev[i00 + 1];
    const c = elev[i00 + width], d = elev[i00 + width + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

/* ── OpenStreetMap features ────────────────────────────────────────────── */

const OVERPASS_QUERY = bbox => {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `[out:json][timeout:90];
(
  way["building"](${b});
  relation["building"](${b});
  way["highway"](${b});
  way["railway"~"^(rail|light_rail|subway|tram)$"](${b});
  way["waterway"~"^(river|stream|canal|riverbank)$"](${b});
  way["natural"="water"](${b});
  relation["natural"="water"](${b});
  way["landuse"~"^(reservoir|basin)$"](${b});
  way["landuse"~"^(forest|grass|meadow|village_green|orchard|vineyard|recreation_ground|cemetery|allotments)$"](${b});
  way["natural"~"^(wood|scrub|heath|grassland)$"](${b});
  way["leisure"~"^(park|garden|pitch|golf_course|playground)$"](${b});
  relation["leisure"~"^(park|golf_course)$"](${b});
);
out geom;`;
};

// Only a malformed query (400) or a wrong path (404) is worth giving up on.
// Everything else Overpass returns under load — 406, 429, 502, 504 — is
// congestion, and the same query usually succeeds moments later.
const PERMANENT = new Set([400, 404]);

/**
 * Query Overpass, retrying each mirror before falling through to the next.
 * The public endpoint is busy often enough that this is load-bearing rather
 * than defensive fluff — it failed repeatedly while this tool was being built.
 */
export async function fetchOsm(bbox, { onProgress, signal, attempts = 2 } = {}) {
  const body = 'data=' + encodeURIComponent(OVERPASS_QUERY(bbox));
  const errors = [];
  const steps = OVERPASS_MIRRORS.length * attempts;
  let step = 0;

  for (const url of OVERPASS_MIRRORS) {
    const host = new URL(url).host;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (onProgress) {
        onProgress(step++ / steps, attempt ? `${host} (retry ${attempt})` : host);
      }
      try {
        const res = await fetch(url, {
          method: 'POST',
          body,
          signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          err.transient = !PERMANENT.has(res.status);
          throw err;
        }
        const json = await res.json();
        if (!json.elements) throw new Error('malformed response');
        return classify(json.elements);
      } catch (err) {
        if (signal && signal.aborted) throw err;
        errors.push(`${host}: ${err.message}`);
        // A hard rejection won't change on retry; move to the next mirror.
        if (err.transient === false) break;
        if (attempt < attempts - 1) {
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    }
  }

  const busy = errors.some(e => /50\d|429/.test(e));
  throw new Error(
    (busy
      ? 'Overpass is busy right now and every mirror timed out. Wait a minute and try again, or select a smaller area. '
      : 'Could not load map features. ') +
    '(' + errors.join('; ') + ')'
  );
}

/* ── Feature classification ────────────────────────────────────────────── */

// Approximate carriageway widths in metres, keyed by highway class.
const ROAD_WIDTH = {
  motorway: 14, motorway_link: 8, trunk: 12, trunk_link: 7,
  primary: 11, primary_link: 7, secondary: 9, secondary_link: 6,
  tertiary: 7.5, tertiary_link: 5, unclassified: 5.5, residential: 5.5,
  living_street: 5, service: 4, pedestrian: 5, track: 3.5,
  footway: 2, path: 1.8, cycleway: 2.2, steps: 1.8
};
const MINOR_ROADS = new Set(['footway', 'path', 'cycleway', 'steps', 'track', 'service']);
const RAIL_WIDTH = 3.2;

const GREEN_LANDUSE = new Set([
  'forest', 'grass', 'meadow', 'village_green', 'orchard',
  'vineyard', 'recreation_ground', 'cemetery', 'allotments'
]);
const GREEN_NATURAL = new Set(['wood', 'scrub', 'heath', 'grassland']);
const GREEN_LEISURE = new Set(['park', 'garden', 'pitch', 'golf_course', 'playground']);
const WATER_LANDUSE = new Set(['reservoir', 'basin']);

function ringFromGeometry(geom) {
  if (!geom || geom.length < 3) return null;
  const ring = geom.map(p => [p.lon, p.lat]);
  // Drop the duplicated closing vertex; every consumer treats rings as implicit.
  const a = ring[0], b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) ring.pop();
  return ring.length >= 3 ? ring : null;
}

function isClosed(geom) {
  if (!geom || geom.length < 4) return false;
  const a = geom[0], b = geom[geom.length - 1];
  return a.lon === b.lon && a.lat === b.lat;
}

// Assemble relation members into polygons. Overpass `out geom;` gives each
// member its own coordinate list; closed members become rings directly and
// open ones are stitched end-to-end until they close.
function polygonsFromRelation(el) {
  const outers = [], inners = [];
  const openOuter = [], openInner = [];

  for (const m of el.members || []) {
    if (m.type !== 'way' || !m.geometry) continue;
    const target = m.role === 'inner' ? inners : outers;
    const open = m.role === 'inner' ? openInner : openOuter;
    if (isClosed(m.geometry)) {
      const r = ringFromGeometry(m.geometry);
      if (r) target.push(r);
    } else {
      open.push(m.geometry.map(p => [p.lon, p.lat]));
    }
  }

  stitch(openOuter, outers);
  stitch(openInner, inners);

  if (!outers.length) return [];
  // Attach every inner ring to the first outer. Correct containment testing
  // would need point-in-polygon per inner; for building courtyards and lake
  // islands the single-outer case dominates and this stays cheap.
  return outers.map((o, i) => (i === 0 ? [o, ...inners] : [o]));
}

function stitch(open, out) {
  const eq = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  while (open.length) {
    let chain = open.shift();
    let joined = true;
    while (joined && !eq(chain[0], chain[chain.length - 1])) {
      joined = false;
      for (let i = 0; i < open.length; i++) {
        const seg = open[i];
        if (eq(chain[chain.length - 1], seg[0])) { chain = chain.concat(seg.slice(1)); }
        else if (eq(chain[chain.length - 1], seg[seg.length - 1])) { chain = chain.concat(seg.slice(0, -1).reverse()); }
        else continue;
        open.splice(i, 1);
        joined = true;
        break;
      }
    }
    if (eq(chain[0], chain[chain.length - 1])) chain.pop();
    if (chain.length >= 3) out.push(chain);
  }
}

// Parse OSM height-ish values: "12", "12 m", "39'" (feet).
function parseHeight(v) {
  if (!v) return null;
  const s = String(v).trim();
  const feet = s.match(/^([\d.]+)\s*'/);
  if (feet) return parseFloat(feet[1]) * 0.3048;
  const m = s.match(/^([\d.]+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function classify(elements) {
  const buildings = [], roads = [], water = [], greenery = [];

  for (const el of elements) {
    const tags = el.tags || {};

    if (tags.building || tags['building:part']) {
      const polys = el.type === 'relation'
        ? polygonsFromRelation(el)
        : (isClosed(el.geometry) ? [[ringFromGeometry(el.geometry)]] : []);
      for (const rings of polys) {
        if (!rings || !rings[0]) continue;
        const h = parseHeight(tags.height)
          ?? (parseFloat(tags['building:levels']) > 0
                ? parseFloat(tags['building:levels']) * 3.0
                : null);
        const min = parseHeight(tags.min_height)
          ?? (parseFloat(tags['building:min_level']) > 0
                ? parseFloat(tags['building:min_level']) * 3.0
                : 0);
        buildings.push({ rings, height: h, minHeight: min, name: tags.name });
      }
      continue;
    }

    if (tags.highway || tags.railway) {
      if (!el.geometry || el.geometry.length < 2) continue;
      const kind = tags.highway || 'rail';
      const width = tags.highway
        ? (ROAD_WIDTH[tags.highway] ?? 5)
        : RAIL_WIDTH;
      const explicit = parseHeight(tags.width);
      roads.push({
        line: el.geometry.map(p => [p.lon, p.lat]),
        width: explicit ?? width,
        minor: !tags.highway || MINOR_ROADS.has(kind),
        kind
      });
      continue;
    }

    const isWaterArea =
      tags.natural === 'water' ||
      tags.waterway === 'riverbank' ||
      WATER_LANDUSE.has(tags.landuse);

    if (isWaterArea) {
      const polys = el.type === 'relation'
        ? polygonsFromRelation(el)
        : (isClosed(el.geometry) ? [[ringFromGeometry(el.geometry)]] : []);
      for (const rings of polys) if (rings && rings[0]) water.push({ rings });
      continue;
    }

    if (tags.waterway && el.geometry && el.geometry.length >= 2) {
      const w = parseHeight(tags.width)
        ?? (tags.waterway === 'river' ? 12 : tags.waterway === 'canal' ? 8 : 3);
      water.push({ line: el.geometry.map(p => [p.lon, p.lat]), width: w });
      continue;
    }

    const isGreen =
      GREEN_LANDUSE.has(tags.landuse) ||
      GREEN_NATURAL.has(tags.natural) ||
      GREEN_LEISURE.has(tags.leisure);

    if (isGreen) {
      const polys = el.type === 'relation'
        ? polygonsFromRelation(el)
        : (isClosed(el.geometry) ? [[ringFromGeometry(el.geometry)]] : []);
      for (const rings of polys) if (rings && rings[0]) greenery.push({ rings });
    }
  }

  return { buildings, roads, water, greenery };
}

/* ── Geocoding ─────────────────────────────────────────────────────────── */

// Nominatim's usage policy forbids autocomplete-style querying, so this is
// wired to explicit submits only — never keystrokes.
export async function geocode(query, { signal } = {}) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&q=' +
    encodeURIComponent(query);
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
  const json = await res.json();
  return json.map(r => ({
    name: r.display_name,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    bbox: r.boundingbox && {
      south: parseFloat(r.boundingbox[0]), north: parseFloat(r.boundingbox[1]),
      west: parseFloat(r.boundingbox[2]), east: parseFloat(r.boundingbox[3])
    }
  }));
}
