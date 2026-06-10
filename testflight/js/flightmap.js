/* ============================================================
   OZARK TOURS — Aerial map background for the JOURNEY scroll
   --------------------------------------------------------------
   A MapLibre globe lives behind the journey trail line. It is
   SCROLL-LINKED: main.js feeds OzarkMap.setProgress(t) a continuous
   value (0 = Thaden Field, 1 = stop 0, … 8 = stop 7) derived from
   scroll position, and the camera is interpolated to match — so the
   Google-Earth transition scrubs as you scroll, forward or back.
   Each leg dips its zoom out then back in (the swoop), and a gold
   pin rises at each place. Nothing auto-plays.

   Free stack (no token/account/card): MapLibre GL JS v5 (globe),
   Esri World Imagery satellite (swap → EOX s2cloudless-2016 CC-BY
   for launch), AWS Terrarium DEM terrain.
   ============================================================ */

(function () {
  'use strict';

  if (typeof maplibregl === 'undefined') return;
  const mapEl = document.getElementById('journeyMap');
  if (!mapEl) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ESRI =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const TERRARIUM =
    'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

  const THADEN = { lng: -94.2189, lat: 36.3457 };

  // Journey stops, same order as the 8 journey cards (proximity order).
  // PLACEHOLDER photos (Pexels, category-matched) — swap for the real
  // licensed location photos when we have them.
  // Real location photos. Business photos (used with the client's permission)
  // are hosted locally in /images; natural landmarks use free Wikimedia images
  // (verify attribution before launch).
  const WK = 'https://upload.wikimedia.org/wikipedia/commons/thumb';
  const STOPS = [
    { name: 'Restaurant Ryn',             lng: -94.16927, lat: 36.40020, zoom: 15.8, pitch: 62, photo: 'images/ryn-2.jpg',        page: 'experiences/restaurant-ryn.html' },
    { name: 'Sassafras Springs Vineyard', lng: -94.06632, lat: 36.12743, zoom: 15.4, pitch: 63, photo: 'images/sassafras.png',    page: 'experiences/sassafras-vineyard.html' },
    { name: 'Sailing · Beaver Lake',      lng: -93.90903, lat: 36.38923, zoom: 15.1, pitch: 62, photo: WK + '/5/58/Beaver_Lake_with_changing_leaves.jpg/1280px-Beaver_Lake_with_changing_leaves.jpg', page: 'experiences/sailing-chef.html' },
    { name: 'Equestrian & Ride Therapy',  lng: -94.10039, lat: 36.10706, zoom: 15.4, pitch: 61, photo: 'images/equestrian.jpg',   page: 'experiences/equestrian.html' },
    { name: 'White Rock Mountain',        lng: -93.95714, lat: 35.69314, zoom: 15.1, pitch: 66, photo: 'images/whiterock-1.jpg',  page: 'experiences/white-rock-mountain.html' },
    { name: 'Cave Meditation · Lost Bridge', lng: -93.92770, lat: 36.41970, zoom: 15.2, pitch: 63, photo: 'https://picsum.photos/seed/lostbridge-cave-hero/1280/853', page: 'experiences/lost-bridge-cave.html' },
    { name: 'Cotter Elite Anglers',       lng: -92.53544, lat: 36.27118, zoom: 15.1, pitch: 62, photo: WK + '/1/14/White_River%2C_Arkansas.jpg/1280px-White_River%2C_Arkansas.jpg', page: 'experiences/cotter-anglers.html' },
    { name: 'Crystal Mining',             lng: -93.09953, lat: 34.66161, zoom: 15.4, pitch: 62, photo: WK + '/2/27/Digging_For_Diamonds_%282245556315%29.jpg/1280px-Digging_For_Diamonds_%282245556315%29.jpg', page: 'experiences/crystal-mining.html' },
  ];

  function bearing(a, b) {
    const toR = (d) => (d * Math.PI) / 180;
    const y = Math.sin(toR(b.lng - a.lng)) * Math.cos(toR(b.lat));
    const x =
      Math.cos(toR(a.lat)) * Math.sin(toR(b.lat)) -
      Math.sin(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.cos(toR(b.lng - a.lng));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }
  function geoDist(a, b) {                    // miles
    const R = 3958.8, toR = (d) => (d * Math.PI) / 180;
    const dlat = toR(b.lat - a.lat), dlng = toR(b.lng - a.lng);
    const s = Math.sin(dlat / 2) ** 2 +
      Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dlng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // Route frames: F[0] = Thaden Field, F[1..8] = the stops, F[9] = whole state.
  const AR_OVERVIEW = { name: 'Arkansas', lng: -92.44, lat: 34.72, zoom: 5.85, pitch: 0, bearing: 0 };
  const F = [{ lng: THADEN.lng, lat: THADEN.lat, zoom: 13.0, pitch: 52, bearing: 0 }].concat(STOPS, [AR_OVERVIEW]);
  F.forEach((s, i) => { if (i > 0) s.bearing = bearing(F[i - 1], s); });
  AR_OVERVIEW.bearing = 0;   // keep the final state view north-up

  let map = null, ready = false, pending = 0;
  let marker = null, pinInner = null, pinTimer = null, lastPinStop = -99;

  const departEl = document.getElementById('journeyDepart');
  function setDepart(on) { if (departEl) departEl.classList.toggle('is-on', on); }

  const journeyEl  = document.getElementById('journey') || mapEl;
  const photoFrame = document.getElementById('journeyPhoto');
  const photoImg   = document.getElementById('journeyPhotoImg');
  const photoName  = document.getElementById('journeyPhotoName');
  const photoMore  = document.getElementById('journeyPhotoMore');
  let lastPhotoStop = -99;

  function buildPin() {
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    inner.className = 'map-pin';
    inner.innerHTML =
      '<svg class="map-pin__svg" viewBox="0 0 24 32" width="27" height="36" aria-hidden="true">' +
      '<path d="M12 0C5.37 0 0 5.37 0 12c0 8.4 12 20 12 20s12-11.6 12-20C24 5.37 18.63 0 12 0z" fill="#e8a84e"/>' +
      '<circle cx="12" cy="12" r="4.6" fill="#0d1a0d"/></svg>';
    outer.appendChild(inner);
    pinInner = inner;
    marker = new maplibregl.Marker({ element: outer, anchor: 'bottom' });
  }

  function showPin(stop) {
    if (!marker) return;
    marker.setLngLat([stop.lng, stop.lat]).addTo(map);
    if (!pinInner) return;
    pinInner.classList.remove('is-in');
    void pinInner.offsetWidth;
    window.clearTimeout(pinTimer);
    pinTimer = window.setTimeout(() => pinInner.classList.add('is-in'), reduceMotion ? 0 : 220);
  }

  // Off-center the place so the rising pin clears the journey trail line.
  function legOffset() {
    return [0, 0];   // dead-centered on the place/pin (no vertical nudge)
  }

  // Narrow screens see a tight, claustrophobic satellite frame — pull the zoom
  // out so more of the landscape is in view. Zoom is log2, so −1 ≈ 2× the area.
  function zoomAdjust() {
    const w = window.innerWidth;
    if (w <= 480) return 1.5;   // phones
    if (w <= 767) return 1.0;   // large phones / small tablets
    return 0;                   // desktop unchanged
  }

  const lerp = (a, b, f) => a + (b - a) * f;
  const smooth = (f) => f * f * (3 - 2 * f);
  const HOLD = 0.18;          // half-width of the "clean stop" hold zone (frame units)
  const PHOTO = HOLD * 0.78;  // photo only inside this → clean map bands at the edges

  // Apply a (smoothed) progress value to the camera + photo. Driven by the
  // animation loop below, not directly by scroll.
  function applyProgress(rawT) {
    const maxK = F.length - 1;
    const t = Math.max(0, Math.min(maxK, rawT));      // clamped for the camera
    const k = Math.min(Math.floor(t), maxK - 1);
    const f = t - k;                                  // 0..1 within segment

    // Park at A for [0,HOLD] and at B for [1-HOLD,1] (clean stops); travel in
    // between. So the camera is fully settled while the photo is up.
    let tp;
    if (f <= HOLD) tp = 0;
    else if (f >= 1 - HOLD) tp = 1;
    else tp = (f - HOLD) / (1 - 2 * HOLD);
    const A = F[k], B = F[k + 1];
    // ZOOM-OUT → reposition → ZOOM-IN (not a low fly-across): hold the center
    // over A while pulling the zoom way out, slide to B only while high up,
    // then hold over B while zooming back in. Pitch flattens overhead at apex.
    const arc = Math.sin(Math.PI * tp);                              // 0 at stops, 1 mid-leg
    const e = smooth(Math.max(0, Math.min(1, (tp - 0.22) / 0.56)));  // center: hold → move → hold
    const lng = lerp(A.lng, B.lng, e);
    const lat = lerp(A.lat, B.lat, e);
    let db = ((B.bearing - A.bearing + 540) % 360) - 180;           // shortest turn
    const bearing = A.bearing + db * e;
    // Apex = a regional pull-back that fits the leg (further out on long legs).
    let apex = 14.0 - Math.log2(Math.max(geoDist(A, B), 6)) * 1.3;
    apex = Math.max(6.5, Math.min(10.5, apex));
    const baseZoom = lerp(A.zoom, B.zoom, e) - zoomAdjust();
    const zoom = baseZoom - (baseZoom - apex) * arc;
    // Near top-down AT the stops (so the venue sits dead-center under the pin —
    // a steep pitch shoves the target up-screen), a gentle tilt only mid-leg.
    const pitch = 10 + 26 * arc;

    const st = Math.round(t);
    const off = st >= 1 ? legOffset(st - 1) : [0, 0];
    map.easeTo({ center: [lng, lat], zoom, pitch, bearing, offset: off, duration: 0 });

    setDepart(t < 0.5);
    if (st !== lastPinStop) {
      lastPinStop = st;
      if (st >= 1 && st <= STOPS.length) showPin(STOPS[st - 1]);
      else if (marker) marker.remove();
    }

    // Full-screen photo: fade in → brief hold → fade out, ONLY inside the
    // clean-stop hold zone (camera parked), with clean map bands at the edges.
    // Uses RAW t so the LAST photo fades out as you scroll past (no lingering).
    if (photoFrame && photoImg) {
      const r = journeyEl.getBoundingClientRect();
      const inStage = r.top <= 2 && r.bottom >= window.innerHeight * 0.6;
      const pst = Math.round(rawT);
      const d = Math.abs(rawT - pst);
      if (inStage && pst >= 1 && pst <= STOPS.length && d <= PHOTO) {
        if (pst !== lastPhotoStop) {
          lastPhotoStop = pst;
          const stop = STOPS[pst - 1];
          photoImg.src = stop.photo;
          if (photoName) photoName.textContent = stop.name;
          if (photoMore && stop.page) photoMore.setAttribute('href', stop.page);
        }
        // plateau in the inner half, fade across the outer half of the window
        photoFrame.style.opacity = Math.max(0, Math.min(1, (PHOTO - d) / (PHOTO * 0.5))).toFixed(3);
        // Tag the visible photo so it morphs into the page hero on navigation.
        // (Only the .journey__photo-more link itself is clickable — see CSS.)
        photoImg.style.viewTransitionName = 'exp-hero';
      } else {
        photoFrame.style.opacity = '0';
        photoImg.style.viewTransitionName = 'none';
      }
    }
  }

  // Scroll feeds a TARGET; this loop eases the camera toward it so the motion
  // is smooth/natural instead of snapping 1:1 with how fast you scroll.
  let targetT = 0, currentT = 0, lastApplied = -999, loopRunning = false;
  function setProgress(t) {
    if (!ready) { pending = t; return; }
    targetT = t;
    if (!loopRunning) { loopRunning = true; window.requestAnimationFrame(loop); }
  }
  function loop() {
    if (reduceMotion) { currentT = targetT; applyProgress(currentT); loopRunning = false; return; }
    // Ease toward the scroll target with heavy inertia so the camera has
    // "traction" — it glides and settles instead of snapping 1:1 with fast or
    // jerky scrolling (which made the zoom arc wig out). Lower = more damped.
    currentT += (targetT - currentT) * 0.08;
    if (Math.abs(targetT - currentT) < 0.0005) {
      currentT = targetT; lastApplied = currentT;
      applyProgress(currentT); loopRunning = false; return;
    }
    if (Math.abs(currentT - lastApplied) > 0.0005) {
      lastApplied = currentT; applyProgress(currentT);
    }
    window.requestAnimationFrame(loop);
  }
  window.OzarkMap = { setProgress };

  function initMap() {
    map = new maplibregl.Map({
      container: mapEl, zoom: 3.6, center: [THADEN.lng, THADEN.lat],
      pitch: 0, bearing: 0, interactive: false, attributionControl: { compact: true },
      style: {
        version: 8,
        projection: { type: 'globe' },
        sources: {
          satellite: {
            type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19,
            attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
          },
          terrainDEM: {
            type: 'raster-dem', tiles: [TERRARIUM], encoding: 'terrarium',
            tileSize: 256, maxzoom: 15, attribution: 'Terrain: AWS Open Data / Mapzen',
          },
        },
        layers: [{ id: 'sat', type: 'raster', source: 'satellite' }],
      },
    });

    buildPin();

    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
      try {
        map.setSky({
          'sky-color': '#0a0f2c', 'horizon-color': '#3a6ea5',
          'fog-color': '#cfe3ff', 'sky-horizon-blend': 0.5,
        });
      } catch (e) { /* ok */ }
      map.setTerrain({ source: 'terrainDEM', exaggeration: 1.0 });

      // Arkansas state outline — visible when the route zooms out to the state.
      fetch('data/arkansas.geojson')
        .then((r) => r.json())
        .then((geo) => {
          if (map.getSource('ar')) return;
          map.addSource('ar', { type: 'geojson', data: geo });
          map.addLayer({ id: 'ar-fill', type: 'fill', source: 'ar',
            paint: { 'fill-color': '#e8a84e', 'fill-opacity': 0.10 } });
          map.addLayer({ id: 'ar-glow', type: 'line', source: 'ar',
            layout: { 'line-join': 'round' },
            paint: { 'line-color': '#e8a84e', 'line-width': 10, 'line-opacity': 0.35, 'line-blur': 6 } });
          map.addLayer({ id: 'ar-outline', type: 'line', source: 'ar',
            layout: { 'line-join': 'round' },
            paint: { 'line-color': '#ffe6b0', 'line-width': 3, 'line-opacity': 0.95 } });
          console.log('[map] AR outline added');
        })
        .catch((e) => console.warn('[map] AR outline failed', e && e.message));

      // Location dots at every experience + Thaden origin, so you can see them
      // on the map and confirm each sits on the actual venue.
      map.addSource('stops', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: STOPS.map((s, i) => ({
          type: 'Feature', properties: { i },
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        })) },
      });
      map.addLayer({
        id: 'stops-dots', type: 'circle', source: 'stops',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.2, 11, 5, 16, 8],
          'circle-color': '#e8a84e',
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
          'circle-opacity': 0.95,
        },
      });
      map.addSource('origin', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Point', coordinates: [THADEN.lng, THADEN.lat] } },
      });
      map.addLayer({
        id: 'origin-dot', type: 'circle', source: 'origin',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 6],
          'circle-color': '#ffffff', 'circle-stroke-color': '#e8a84e', 'circle-stroke-width': 2.5,
        },
      });

      ready = true;
      targetT = currentT = lastApplied = (pending == null ? 0 : pending);
      applyProgress(currentT);
    });
  }

  // Boot the map OFF the hero's critical path. Instead of initializing at page
  // load (which fired the ~800 KB library + satellite/terrain tile fetches in
  // parallel with the hero video), we start init as the journey section nears
  // the viewport — with a big rootMargin (~1.5 viewports of lead time) so tiles
  // are loaded by the time it scrolls into view. The ready/pending guard in
  // setProgress means even a fast scroll just snaps to the correct frame; the
  // section opens parked on the "Now departing — Thaden Field" caption anyway.
  let booted = false;
  function bootMap() { if (booted) return; booted = true; initMap(); }

  if ('IntersectionObserver' in window) {
    const bootObs = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        bootObs.disconnect();
        bootMap();
      }
    }, { rootMargin: '1500px 0px' });
    bootObs.observe(journeyEl);
  } else {
    bootMap();   // no IO support → fall back to immediate init
  }

  window.addEventListener('resize', () => { if (map) map.resize(); }, { passive: true });
})();
