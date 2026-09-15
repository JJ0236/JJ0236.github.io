#!/usr/bin/env node
// scripts/verify-aerial-lidar.mjs — checks for the Aerial LiDAR swipe map.
//
//   node scripts/verify-aerial-lidar.mjs          offline, deterministic
//   node scripts/verify-aerial-lidar.mjs --live   also probe the real services

import * as S from '../aerial-lidar/sources.js';

let failures = 0, checks = 0;
const ok = (name, cond, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ': ' + detail : ''}`); }
};
const section = t => console.log(`\n${t}`);

section('URL building');
{
  const u = new URL(S.demImageUrl([-10492052.251, 4270689.644, -10490829.258, 4271912.637], 256, 'Hillshade Gray'));
  const q = u.searchParams;
  ok('points at the 3DEP image service', u.origin + u.pathname === `${S.DEM}/exportImage`);
  ok('bbox is xmin,ymin,xmax,ymax', q.get('bbox') === '-10492052.251,4270689.644,-10490829.258,4271912.637');
  ok('declares web mercator both ways', q.get('bboxSR') === '3857' && q.get('imageSR') === '3857');
  ok('asks for a square image', q.get('size') === '256,256');
  ok('render rule is JSON, not a bare name',
     JSON.parse(q.get('renderingRule')).rasterFunction === 'Hillshade Gray');
  ok('requests an image, not a description', q.get('f') === 'image');

  const e = new URL(S.elevationUrl(-94.2447, 35.7842));
  ok('elevation query is a WGS84 point',
     JSON.parse(e.searchParams.get('geometry')).spatialReference.wkid === 4326);
  ok('elevation query skips geometry in the reply', e.searchParams.get('returnGeometry') === 'false');

  const g = new URL(S.geocodeUrl('devils den', 35.78, -94.24));
  ok('geocoder is Photon, which tolerates a missing apostrophe', g.host === 'photon.komoot.io');
  ok('geocoder is biased to the current view', g.searchParams.get('lat') === '35.7800');
  ok('geocoder omits bias when there is none',
     !new URL(S.geocodeUrl('x')).searchParams.has('lat'));
}

section('Render and contour tables');
{
  ok('four LiDAR renders', S.RENDERS.length === 4);
  ok('every render has a rule and a note', S.RENDERS.every(r => r.rule && r.note));
  ok('multidirectional is the default', S.RENDERS[0].id === 'multi');
  ok('unknown render id falls back rather than throwing', S.renderById('nonsense').id === 'multi');
  ok('contours include an off state', S.contourById('off').rule === null);
  ok('unknown contour id falls back to off', S.contourById('nonsense').rule === null);
  ok('contour rules are the preset intervals',
     S.CONTOURS.filter(c => c.rule).every(c => /Contour Interval$/.test(c.rule)));
}

section('Elevation parsing');
{
  ok('reads a number', S.parseElevation({ value: 314.023 }) === 314.023);
  ok('reads a numeric string', S.parseElevation({ value: '314.023' }) === 314.023);
  ok('no-data string becomes null', S.parseElevation({ value: 'NoData' }) === null);
  ok('missing value becomes null', S.parseElevation({}) === null);
  ok('null response becomes null', S.parseElevation(null) === null);
  // 3DEP returns a large negative sentinel outside coverage; that is not a depth.
  ok('sentinel below sea level is rejected', S.parseElevation({ value: -3.4e38 }) === null);
  ok('absurdly high value is rejected', S.parseElevation({ value: 99999 }) === null);
  ok('Dead Sea depth is still accepted', S.parseElevation({ value: -430 }) === -430);

  ok('feet conversion', S.formatElevation(314.023, 'ft') === '1,030 ft');
  ok('metre conversion', S.formatElevation(314.023, 'm') === '314 m');
  ok('null renders as a dash', S.formatElevation(null, 'ft') === '—');
}

section('Geocode parsing');
{
  const sample = { features: [
    { geometry: { coordinates: [-94.2447, 35.7842] },
      properties: { name: "Devil's Den State Park", county: 'Washington', state: 'Arkansas', country: 'United States' } },
    { geometry: { coordinates: [-94.16, 36.06] },
      properties: { housenumber: '1', street: 'Dickson Street', city: 'Fayetteville', state: 'Arkansas', country: 'United States' } },
    { geometry: { coordinates: [null, null], }, properties: { name: 'Broken' } },
    { properties: { name: 'No geometry' } },
    { geometry: { coordinates: [-94.2447, 35.7842] },
      properties: { name: "Devil's Den State Park", county: 'Washington', state: 'Arkansas', country: 'United States' } },
  ]};
  const hits = S.parseGeocode(sample);
  ok('drops features with no usable coordinates', hits.length === 2, `${hits.length}`);
  ok('names a place by its name', hits[0].label === "Devil's Den State Park, Washington, Arkansas");
  ok('names an address by number and street', hits[1].label === '1 Dickson Street, Fayetteville, Arkansas');
  ok('leaves the country off for the US', !hits[0].label.includes('United States'));
  ok('coordinates come back lat, lon the right way round',
     Math.abs(hits[0].lat - 35.7842) < 1e-9 && Math.abs(hits[0].lon + 94.2447) < 1e-9);
  ok('duplicate labels collapse', new Set(hits.map(h => h.label)).size === hits.length);
  ok('empty response is an empty list', S.parseGeocode({}).length === 0 && S.parseGeocode(null).length === 0);
}

section('URL state');
{
  const v = { lat: 35.7842, lon: -94.2447, zoom: 15, render: 'slope', contour: 'c5', split: 52 };
  const round = S.parseHash(S.buildHash(v));
  ok('a view survives a round trip',
     round.lat === v.lat && round.lon === v.lon && round.zoom === v.zoom &&
     round.render === v.render && round.contour === v.contour && round.split === v.split,
     JSON.stringify(round));
  ok('an empty hash gives the default view',
     S.parseHash('').lat === S.DEFAULT_VIEW.lat && S.parseHash('#').render === 'multi');
  ok('junk in the hash does not throw', (() => {
    for (const junk of ['#a,b,c', '#', '#1', '#999,999,99,x,y,z', '#,,,,,', 'nonsense'])
      if (!Number.isFinite(S.parseHash(junk).lat)) return false;
    return true;
  })());
  ok('latitude is clamped to the mercator limit', S.parseHash('#99,0,10').lat === 85);
  ok('zoom is clamped to the service range',
     S.parseHash('#35,-94,40').zoom === 19 && S.parseHash('#35,-94,-5').zoom === 3);
  ok('split is clamped to 0-100',
     S.parseHash('#35,-94,10,multi,off,500').split === 100 &&
     S.parseHash('#35,-94,10,multi,off,-20').split === 0);
  ok('an unknown render in a shared link falls back', S.parseHash('#35,-94,10,bogus,off,50').render === 'multi');
}

if (process.argv.includes('--live')) {
  section('Live services');
  const get = async (url, kind) => {
    try {
      const r = await fetch(url);
      return { status: r.status, type: r.headers.get('content-type') || '', body: kind === 'json' ? await r.json() : null };
    } catch (e) { return { status: 0, type: String(e.message), body: null }; }
  };
  const img = await get(S.demImageUrl([-10492052, 4270689, -10490829, 4271912], 256, 'Hillshade Multidirectional'));
  ok('3DEP returns an image', img.status === 200 && img.type.includes('image'), `${img.status} ${img.type}`);
  const el = await get(S.elevationUrl(-94.2447, 35.7842), 'json');
  ok('3DEP returns an elevation near Devil\'s Den',
     Math.abs((S.parseElevation(el.body) ?? 0) - 314) < 60, JSON.stringify(el.body?.value));
  const geo = await get(S.geocodeUrl('devils den state', 35.78, -94.24), 'json');
  ok('Photon finds Devil\'s Den without its apostrophe',
     S.parseGeocode(geo.body).some(h => /Devil/i.test(h.label)),
     S.parseGeocode(geo.body).slice(0, 2).map(h => h.label).join(' | '));
  const tile = await get(S.IMAGERY.url.replace('{z}', '9').replace('{y}', '198').replace('{x}', '119'));
  ok('Esri imagery serves a tile', tile.status === 200 && tile.type.includes('image'), `${tile.status}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`${failures} failing`); process.exit(1); }
console.log('aerial lidar verified.');
