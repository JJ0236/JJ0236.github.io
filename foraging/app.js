// ============================================================
// Fayetteville Food Foraging Map - App Logic
// ============================================================

// --- Plant Database with Seasonal Info (NW Arkansas) ---
// Months are 1-indexed (1=Jan, 12=Dec)
const PLANT_DB = {
  'Serviceberry': {
    color: '#7b1fa2',
    harvestMonths: [5, 6, 7],
    harvestLabel: 'May – Jul',
    description: 'Sweet berry similar to blueberry. Great fresh or in pies.',
    edibleParts: 'Berries',
    category: 'Berry'
  },
  'Red Mulberry': {
    color: '#c62828',
    harvestMonths: [5, 6],
    harvestLabel: 'May – Jun',
    description: 'Dark red-purple berries, sweet when ripe. Prolific producer.',
    edibleParts: 'Berries',
    category: 'Berry'
  },
  'Black Cherry': {
    color: '#880e4f',
    harvestMonths: [6, 7, 8],
    harvestLabel: 'Jun – Aug',
    description: 'Small dark cherries. Best for jams, jellies, and syrups.',
    edibleParts: 'Cherries (cooked/processed)',
    category: 'Fruit'
  },
  'Pawpaw': {
    color: '#e65100',
    harvestMonths: [8, 9, 10],
    harvestLabel: 'Aug – Oct',
    description: 'Tropical-tasting native fruit. Custard-like flesh, amazing flavor.',
    edibleParts: 'Fruit pulp',
    category: 'Fruit'
  },
  'Common Persimmon': {
    color: '#ff6f00',
    harvestMonths: [9, 10, 11],
    harvestLabel: 'Sep – Nov',
    description: 'Sweet when fully ripe (soft). Astringent if unripe! Wait for frost.',
    edibleParts: 'Ripe fruit',
    category: 'Fruit'
  },
  'Pecan': {
    color: '#5d4037',
    harvestMonths: [10, 11],
    harvestLabel: 'Oct – Nov',
    description: 'Classic nut tree. Collect fallen nuts in autumn.',
    edibleParts: 'Nuts',
    category: 'Nut'
  },
  'Black Walnut': {
    color: '#33691e',
    harvestMonths: [9, 10],
    harvestLabel: 'Sep – Oct',
    description: 'Rich, bold flavor. Green husks stain everything! Worth the work.',
    edibleParts: 'Nuts',
    category: 'Nut'
  },
  'Shagbark Hickory': {
    color: '#827717',
    harvestMonths: [9, 10],
    harvestLabel: 'Sep – Oct',
    description: 'Sweet, rich hickory nuts. Distinctive shaggy bark makes ID easy.',
    edibleParts: 'Nuts',
    category: 'Nut'
  },
  'Mockernut Hickory': {
    color: '#9e9d24',
    harvestMonths: [9, 10],
    harvestLabel: 'Sep – Oct',
    description: 'Small but flavorful nuts. Hard to crack but tasty.',
    edibleParts: 'Nuts',
    category: 'Nut'
  },
  'Black Hickory': {
    color: '#6d4c41',
    harvestMonths: [9, 10],
    harvestLabel: 'Sep – Oct',
    description: 'Small hickory nuts, similar to other hickories.',
    edibleParts: 'Nuts',
    category: 'Nut'
  }
};

// Fallback for unknown plant types
const DEFAULT_PLANT = {
  color: '#607d8b',
  harvestMonths: [],
  harvestLabel: 'Unknown',
  description: 'Foraging tree or shrub.',
  edibleParts: 'Varies',
  category: 'Other'
};

// --- State ---
let allFeatures = [];
let markers = [];
let markerLayer;
let map;
let selectedPlants = new Set();
let showProducingOnly = false;

// --- Helpers ---
function getPlantInfo(commonName) {
  return PLANT_DB[commonName] || { ...DEFAULT_PLANT };
}

function getCurrentMonth() {
  return new Date().getMonth() + 1; // 1-indexed
}

function isProducingNow(plantName) {
  const info = getPlantInfo(plantName);
  return info.harvestMonths.includes(getCurrentMonth());
}

function getMonthName(monthNum) {
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return names[monthNum - 1];
}

function getCurrentSeasonText() {
  const month = getCurrentMonth();
  const producing = Object.entries(PLANT_DB)
    .filter(([_, info]) => info.harvestMonths.includes(month))
    .map(([name, _]) => name);

  if (producing.length === 0) {
    return `<span class="season-badge">${getMonthName(month)}</span> No plants are currently in season.`;
  }
  return `<span class="season-badge">${getMonthName(month)}</span> In season now: <strong>${producing.join(', ')}</strong>`;
}

// --- API ---
const API_URL = 'https://maps.fayetteville-ar.gov/server/rest/services/Parks/Food_Foraging/MapServer/0/query';

async function fetchForagingData() {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'OBJECTID,TR_COMMON,NOTES,OWNER,TZ_CODE',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
    resultRecordCount: '2000'
  });

  const response = await fetch(`${API_URL}?${params}`);
  const data = await response.json();
  return data.features || [];
}

// --- Map Setup ---
function initMap() {
  map = L.map('map', {
    center: [36.0822, -94.1719],
    zoom: 13,
    zoomControl: true
  });

  // Clean tile layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> | Data: City of Fayetteville, AR',
    maxZoom: 19
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
}

// --- Marker Creation ---
function createMarker(feature) {
  const { TR_COMMON, NOTES, OWNER } = feature.attributes;
  const { x: lng, y: lat } = feature.geometry;
  const info = getPlantInfo(TR_COMMON);
  const producing = isProducingNow(TR_COMMON);

  const icon = L.divIcon({
    className: '',
    html: `<div class="custom-marker" style="background:${info.color}"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -16]
  });

  const marker = L.marker([lat, lng], { icon });

  // Popup content
  const seasonClass = producing ? 'in-season' : 'off-season';
  const seasonText = producing
    ? `In season now (${info.harvestLabel})`
    : `Harvest season: ${info.harvestLabel}`;

  let notesHtml = '';
  if (NOTES && NOTES.trim()) {
    notesHtml = `<div class="popup-detail">Notes: ${NOTES}</div>`;
  }

  marker.bindPopup(`
    <div class="popup-content">
      <h3>${TR_COMMON}</h3>
      <div class="popup-detail">Type: ${info.category} · Edible parts: ${info.edibleParts}</div>
      <div class="popup-detail">Owner: ${OWNER || 'Unknown'}</div>
      ${notesHtml}
      <div class="popup-detail" style="color:#9eb0bf;font-style:italic">${info.description}</div>
      <div class="popup-season ${seasonClass}">${seasonText}</div>
    </div>
  `, { maxWidth: 280 });

  marker._plantName = TR_COMMON;
  return marker;
}

// --- Rendering ---
function updateMarkers() {
  markerLayer.clearLayers();
  markers = [];

  allFeatures.forEach(feature => {
    const name = feature.attributes.TR_COMMON;
    if (!selectedPlants.has(name)) return;
    if (showProducingOnly && !isProducingNow(name)) return;

    const marker = createMarker(feature);
    markerLayer.addLayer(marker);
    markers.push(marker);
  });

  // Update stats
  document.getElementById('totalTrees').textContent = `${markers.length} trees shown`;

  const producingCount = markers.filter(m => isProducingNow(m._plantName)).length;
  const producingEl = document.getElementById('producingNow');
  if (producingCount > 0) {
    producingEl.textContent = `${producingCount} in season`;
    producingEl.style.background = 'rgba(255,152,0,0.3)';
  } else {
    producingEl.textContent = 'None in season';
    producingEl.style.background = 'rgba(255,255,255,0.15)';
  }
}

function buildPlantList() {
  // Count occurrences
  const counts = {};
  allFeatures.forEach(f => {
    const name = f.attributes.TR_COMMON;
    counts[name] = (counts[name] || 0) + 1;
  });

  // Sort: producing first, then by count
  const plantNames = Object.keys(counts).sort((a, b) => {
    const aProd = isProducingNow(a) ? 0 : 1;
    const bProd = isProducingNow(b) ? 0 : 1;
    if (aProd !== bProd) return aProd - bProd;
    return counts[b] - counts[a];
  });

  // Select all by default
  plantNames.forEach(name => selectedPlants.add(name));

  renderPlantList(plantNames, counts);
  buildLegend(plantNames, counts);
}

function renderPlantList(plantNames, counts) {
  const container = document.getElementById('plantList');
  const searchTerm = document.getElementById('plantSearch').value.toLowerCase();

  const filtered = plantNames.filter(name => name.toLowerCase().includes(searchTerm));

  if (filtered.length === 0) {
    container.innerHTML = '<div class="no-results">No plants match your search.</div>';
    return;
  }

  container.innerHTML = filtered.map(name => {
    const selected = selectedPlants.has(name);
    const producing = isProducingNow(name);
    const info = getPlantInfo(name);

    return `
      <div class="plant-item ${selected ? 'selected' : ''}" onclick="togglePlant('${name.replace(/'/g, "\\'")}')">
        <div class="checkbox">${selected ? '✓' : ''}</div>
        <div class="plant-info">
          <div class="plant-name">${name}</div>
          <div class="plant-meta">
            <span>${info.harvestLabel}</span>
            <span>${info.category}</span>
          </div>
        </div>
        ${producing ? '<div class="producing-dot" title="In season"></div>' : ''}
        <span class="plant-count">${counts[name]}</span>
      </div>
    `;
  }).join('');
}

function buildLegend(plantNames, counts) {
  const legend = document.getElementById('legend');
  const items = plantNames.map(name => {
    const info = getPlantInfo(name);
    const producing = isProducingNow(name);
    return `
      <div class="legend-item">
        <div class="legend-dot" style="background:${info.color}"></div>
        <span>${name}${producing ? ' (in season)' : ''}</span>
      </div>
    `;
  }).join('');

  legend.innerHTML = `<h4>Legend</h4>${items}`;
}

function updateFilterSummary(totalPlantTypes) {
  const summary = document.getElementById('filterSummary');
  if (!summary) return;

  const selectedCount = selectedPlants.size;
  const modeText = showProducingOnly ? 'Showing only in-season plants' : 'Showing all selected plants';
  summary.textContent = `${selectedCount} of ${totalPlantTypes} plant types selected. ${markers.length} trees visible. ${modeText}.`;
}

// --- Interactions ---
function togglePlant(name) {
  if (selectedPlants.has(name)) {
    selectedPlants.delete(name);
  } else {
    selectedPlants.add(name);
  }
  refreshUI();
}

function selectAll() {
  const counts = {};
  allFeatures.forEach(f => {
    counts[f.attributes.TR_COMMON] = true;
  });
  Object.keys(counts).forEach(name => selectedPlants.add(name));
  refreshUI();
}

function selectNone() {
  selectedPlants.clear();
  refreshUI();
}

function selectProducing() {
  selectedPlants.clear();
  const counts = {};
  allFeatures.forEach(f => {
    counts[f.attributes.TR_COMMON] = true;
  });
  Object.keys(counts).forEach(name => {
    if (isProducingNow(name)) selectedPlants.add(name);
  });
  refreshUI();
}

function refreshUI() {
  const counts = {};
  allFeatures.forEach(f => {
    const name = f.attributes.TR_COMMON;
    counts[name] = (counts[name] || 0) + 1;
  });

  const plantNames = Object.keys(counts).sort((a, b) => {
    const aProd = isProducingNow(a) ? 0 : 1;
    const bProd = isProducingNow(b) ? 0 : 1;
    if (aProd !== bProd) return aProd - bProd;
    return counts[b] - counts[a];
  });

  renderPlantList(plantNames, counts);
  updateMarkers();
  updateFilterSummary(plantNames.length);
}

// Sidebar toggle (mobile)
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('active');
}

// --- Init ---
async function init() {
  initMap();

  try {
    allFeatures = await fetchForagingData();

    // Show season info
    const seasonInfo = document.getElementById('seasonInfo');
    seasonInfo.innerHTML = getCurrentSeasonText();
    seasonInfo.classList.add('active');

    buildPlantList();
    updateMarkers();

    // Fit map to markers
    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }
  } catch (err) {
    console.error('Failed to load foraging data:', err);
    document.getElementById('totalTrees').textContent = 'Failed to load data';
  }

  // Hide loading
  document.getElementById('loadingOverlay').classList.add('hidden');

  // Event listeners
  document.getElementById('producingToggle').addEventListener('change', (e) => {
    showProducingOnly = e.target.checked;
    refreshUI();
  });

  document.getElementById('plantSearch').addEventListener('input', () => {
    refreshUI();
  });

  document.getElementById('sidebarOverlay').addEventListener('click', toggleSidebar);
}

// Go!
init();
