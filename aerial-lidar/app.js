// aerial-lidar/app.js — swipe between bare-earth LiDAR and aerial imagery.

import {
  RENDERS, CONTOURS, renderById, contourById, demImageUrl, elevationUrl,
  parseElevation, IMAGERY, DEM_ATTRIBUTION, geocodeUrl, parseGeocode,
  buildHash, parseHash, formatElevation,
} from './sources.js';

const $ = id => document.getElementById(id);
const state = parseHash(location.hash);
let unit = 'ft';

// ── A Leaflet layer over an ArcGIS ImageServer ──────────────────────
//
// 3DEP renders on demand rather than serving pre-cut tiles, so each tile is a
// separate exportImage call for that tile's own bounding box.
const Dynamic = L.TileLayer.extend({
  getTileUrl(coords) {
    const s = this.getTileSize();
    const map = this._map;
    const nw = map.unproject(L.point(coords.x, coords.y).scaleBy(s), coords.z);
    const se = map.unproject(L.point(coords.x + 1, coords.y + 1).scaleBy(s), coords.z);
    const a = L.CRS.EPSG3857.project(nw);
    const b = L.CRS.EPSG3857.project(se);
    // Ask for a denser image than the tile's CSS size on high-DPI screens.
    const px = Math.min(512, s.x * Math.min(2, Math.round(window.devicePixelRatio || 1)));
    return demImageUrl([a.x, b.y, b.x, a.y], px, this.options.rule);
  },
});
const dynamic = (rule, opts = {}) => new Dynamic('', { rule, ...opts });

// ── Maps ────────────────────────────────────────────────────────────
//
// The aerial map underneath takes every gesture; the LiDAR map on top is
// pointer-transparent and simply follows it. That way a drag or a scroll over
// the LiDAR side still reaches a map, and the two can never disagree.
const common = { zoomControl: false, attributionControl: false, maxZoom: 19, minZoom: 3 };
const base = L.map('map-base', { ...common }).setView([state.lat, state.lon], state.zoom);
const over = L.map('map-over', { ...common, dragging: false, scrollWheelZoom: false,
                                 doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false })
              .setView([state.lat, state.lon], state.zoom);

L.tileLayer(IMAGERY.url, { maxZoom: IMAGERY.maxZoom, maxNativeZoom: IMAGERY.maxZoom }).addTo(base);
L.control.attribution({ prefix: false })
  .addAttribution(`${IMAGERY.attribution} &middot; ${DEM_ATTRIBUTION}`)
  .addTo(base);

let demLayer = dynamic(renderById(state.render).rule, { maxZoom: 19 }).addTo(over);
let contourBase = null, contourOver = null;

const syncFrom = (a, b) => {
  let busy = false;
  a.on('move zoom', () => {
    if (busy) return;
    busy = true;
    b.setView(a.getCenter(), a.getZoom(), { animate: false });
    busy = false;
  });
};
syncFrom(base, over);
base.on('moveend zoomend', pushHash);

// ── Swipe ───────────────────────────────────────────────────────────

const stage = $('stage');
function setSplit(pct) {
  state.split = Math.min(100, Math.max(0, pct));
  stage.style.setProperty('--split', `${state.split}%`);
  $('handle').style.left = `${state.split}%`;
  $('label-lidar').style.opacity = state.split < 12 ? 0 : 1;
  $('label-aerial').style.opacity = state.split > 88 ? 0 : 1;
}
setSplit(state.split);

let dragging = false;
const fromEvent = e => {
  const r = stage.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
  return (x / r.width) * 100;
};
const startDrag = e => { dragging = true; e.preventDefault(); };
const moveDrag = e => { if (dragging) { setSplit(fromEvent(e)); } };
const endDrag = () => { if (dragging) { dragging = false; pushHash(); } };

$('handle').addEventListener('pointerdown', startDrag);
addEventListener('pointermove', moveDrag);
addEventListener('pointerup', endDrag);
$('handle').addEventListener('touchstart', startDrag, { passive: false });
addEventListener('touchmove', moveDrag, { passive: true });
addEventListener('touchend', endDrag);

// Keyboard: the handle is focusable, so arrows nudge it.
$('handle').addEventListener('keydown', e => {
  const step = e.shiftKey ? 10 : 2;
  if (e.key === 'ArrowLeft')  { setSplit(state.split - step); pushHash(); e.preventDefault(); }
  if (e.key === 'ArrowRight') { setSplit(state.split + step); pushHash(); e.preventDefault(); }
});

// ── Controls ────────────────────────────────────────────────────────

const renderSel = $('render');
for (const r of RENDERS) {
  const o = document.createElement('option');
  o.value = r.id; o.textContent = r.name;
  renderSel.appendChild(o);
}
renderSel.value = state.render;
renderSel.onchange = () => {
  state.render = renderSel.value;
  over.removeLayer(demLayer);
  demLayer = dynamic(renderById(state.render).rule, { maxZoom: 19 }).addTo(over);
  if (contourOver) contourOver.bringToFront();
  $('render-note').textContent = renderById(state.render).note;
  pushHash();
};
$('render-note').textContent = renderById(state.render).note;

const contourSel = $('contour');
for (const c of CONTOURS) {
  const o = document.createElement('option');
  o.value = c.id; o.textContent = c.name;
  contourSel.appendChild(o);
}
contourSel.value = state.contour;
contourSel.onchange = () => {
  state.contour = contourSel.value;
  applyContours();
  pushHash();
};

function applyContours() {
  for (const [map, ref] of [[base, 'contourBase'], [over, 'contourOver']]) {
    const cur = ref === 'contourBase' ? contourBase : contourOver;
    if (cur) map.removeLayer(cur);
  }
  contourBase = contourOver = null;
  const rule = contourById(state.contour).rule;
  if (!rule) return;
  // Contours go on both halves, so a line can be followed straight across the
  // swipe instead of stopping at it.
  contourBase = dynamic(rule, { maxZoom: 19, opacity: 0.85 }).addTo(base);
  contourOver = dynamic(rule, { maxZoom: 19, opacity: 0.85 }).addTo(over);
}
applyContours();

for (const b of document.querySelectorAll('#unitSeg button')) {
  b.onclick = () => {
    unit = b.dataset.unit;
    for (const o of document.querySelectorAll('#unitSeg button'))
      o.setAttribute('aria-pressed', String(o === b));
    showReadout(lastElev, lastPoint);
  };
}

$('zoom-in').onclick = () => base.zoomIn();
$('zoom-out').onclick = () => base.zoomOut();

// ── Elevation readout ───────────────────────────────────────────────

let elevTimer = null, elevSeq = 0, lastElev = null, lastPoint = null;

function showReadout(m, pt) {
  lastElev = m; lastPoint = pt;
  $('elev').textContent = formatElevation(m, unit);
  $('coords').textContent = pt ? `${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}` : '—';
}

base.on('mousemove', e => {
  $('coords').textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
  clearTimeout(elevTimer);
  const seq = ++elevSeq;
  const at = e.latlng;
  // One request per pause, not per pixel: 3DEP is a shared public service.
  elevTimer = setTimeout(async () => {
    try {
      const r = await fetch(elevationUrl(at.lng, at.lat));
      const j = await r.json();
      if (seq === elevSeq) showReadout(parseElevation(j), at);
    } catch { if (seq === elevSeq) showReadout(null, at); }
  }, 280);
});
base.on('mouseout', () => { clearTimeout(elevTimer); });

// ── Search ──────────────────────────────────────────────────────────

const results = $('results');
let searchTimer = null;

$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('search').value.trim();
  if (q.length < 3) { results.hidden = true; return; }
  searchTimer = setTimeout(async () => {
    try {
      const c = base.getCenter();
      const r = await fetch(geocodeUrl(q, c.lat, c.lng));
      const hits = parseGeocode(await r.json());
      results.innerHTML = '';
      if (!hits.length) {
        results.innerHTML = '<button type="button" disabled>nothing found</button>';
        results.hidden = false;
        return;
      }
      for (const hit of hits) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = hit.label;
        b.onclick = () => {
          base.setView([hit.lat, hit.lon], Math.max(base.getZoom(), 15));
          results.hidden = true;
          $('search').value = hit.label.split(',')[0];
        };
        results.appendChild(b);
      }
      results.hidden = false;
    } catch { results.hidden = true; }
  }, 350);
});
$('search').addEventListener('keydown', e => {
  if (e.key === 'Escape') { results.hidden = true; $('search').blur(); }
  if (e.key === 'Enter') { results.querySelector('button')?.click(); }
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) results.hidden = true;
});

// ── URL ─────────────────────────────────────────────────────────────

let hashTimer = null;
function pushHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const c = base.getCenter();
    const h = buildHash({ lat: c.lat, lon: c.lng, zoom: base.getZoom(),
                          render: state.render, contour: state.contour, split: state.split });
    history.replaceState(null, '', h);
  }, 250);
}
pushHash();

$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $('copy').textContent = 'copied';
    setTimeout(() => { $('copy').textContent = 'copy link'; }, 1400);
  } catch {
    $('copy').textContent = 'select the address bar';
    setTimeout(() => { $('copy').textContent = 'copy link'; }, 1800);
  }
};

addEventListener('resize', () => { base.invalidateSize(); over.invalidateSize(); });
