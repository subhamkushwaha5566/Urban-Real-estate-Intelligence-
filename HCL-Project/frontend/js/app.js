/**
 * Urban Real Estate Intelligence — Frontend Application
 * ========================================================
 * Fetches data from the Flask API and renders interactive
 * charts, maps, and the valuation predictor.
 */

import { API_BASE_URL, apiRequest } from './api.js';

// ── Globals ──
function clearAuth() {
  localStorage.removeItem('urei_token');
  localStorage.removeItem('urei_user');
}

let MARKET_COLORS = {};
let SECTOR_COLORS = {};
let MODEL_COLORS = [];

let chartInstances = {};
let mapInitialized = false;
let mapRedraw = null;
let searchIndex = [];
let activeSearchIdx = -1;

function withAlpha(hex, alpha) {
  if (!hex) return hex;
  hex = hex.trim();
  if (hex.startsWith('#') && (hex.length === 7)) return hex + alpha; // #rrggbb -> #rrggbbaa
  if (hex.startsWith('#') && (hex.length === 4)) {
    const r = hex[1], g = hex[2], b = hex[3];
    return `#${r}${r}${g}${g}${b}${b}${alpha}`;
  }
  return hex; // fallback (rgb() etc.)
}

// Initialize a small neutral palette used by JS (no CSS variables or theme switching)
function initColors() {
  const PRIMARY = '#0f172a';      // text / primary
  const SECONDARY = '#374151';    // muted text
  const ACCENT = '#2563eb';       // accent blue
  const BG_CARD = '#ffffff';
  const BORDER_DEFAULT = 'rgba(15,23,42,0.06)';
  const BORDER_MUTED = 'rgba(15,23,42,0.04)';

  MARKET_COLORS = {
    Center: '#3b82f6',
    South: '#60a5fa',
    East: '#38bdf8',
    West: '#94a3b8',
    North: '#2563eb',
  };
  SECTOR_COLORS = {
    'Social Rental': '#ef4444',
    'Private Rental': '#f59e0b',
    'Home Ownership': '#10b981',
  };
  MODEL_COLORS = ['#2563eb', '#60a5fa', '#1d4ed8', '#94a3b8'];

  // Chart.js defaults
  Chart.defaults.color = SECONDARY;
  Chart.defaults.borderColor = BORDER_DEFAULT;
  Chart.defaults.font.family = "'Inter', 'Poppins', sans-serif";

  // expose a minimal palette object for components that rely on it
  window.UREI_COLORS = { PRIMARY, SECONDARY, ACCENT, BG_CARD, BORDER_DEFAULT, BORDER_MUTED, withAlpha };
}

// ── Navigation ──
function navigateToSection(sectionId, options = {}) {
  const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.remove('active');
    n.removeAttribute('aria-current');
  });
  if (navItem) {
    navItem.classList.add('active');
    navItem.setAttribute('aria-current', 'true');
  }
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const sectionEl = document.getElementById(`section-${sectionId}`);
  if (sectionEl) sectionEl.classList.add('active');

  if (sectionId === 'map') {
    if (!mapInitialized) {
      mapInitialized = true;
      setTimeout(() => {
        initMap().then(() => {
          applyMapFilters(options);
        });
      }, 50);
    } else {
      applyMapFilters(options);
    }
  }

  if (sectionId === 'predictor') {
    if (options.mapMarket) {
      const marketEl = document.getElementById('input-market');
      if (marketEl) {
        marketEl.value = options.mapMarket;
        marketEl.dispatchEvent(new Event('change'));
      }
    }
    if (options.mapSector) {
      const sectorEl = document.getElementById('input-sector');
      if (sectorEl) sectorEl.value = options.mapSector;
    }
  }

  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  if (sidebar?.classList.contains('open')) {
    sidebar.classList.remove('open');
    document.body.classList.remove('sidebar-open');
    sidebarBackdrop?.classList.remove('visible');
  }
}

function applyMapFilters(options = {}) {
  if (options.mapMarket) {
    const el = document.getElementById('map-filter-market');
    if (el) el.value = options.mapMarket;
  }
  if (options.mapSector) {
    const el = document.getElementById('map-filter-sector');
    if (el) el.value = options.mapSector;
  }
  if (options.colorMode) {
    const el = document.getElementById('map-color-mode');
    if (el) el.value = options.colorMode;
  }
  if (mapRedraw) mapRedraw();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateToSection(item.dataset.section);
  });
});

// ── Fetch helper ──
async function fetchJSON(url, options = {}) {
  return apiRequest(url, options);
}

function setStatus(message, state = 'ready') {
  const badge = document.getElementById('status-badge');
  if (!badge) return;
  badge.innerHTML = `<span class="status-dot"></span> ${message}`;
  badge.dataset.state = state;
}

function showDashboardError(message) {
  document.querySelectorAll('.skeleton').forEach(s => { s.style.display = 'none'; });
  const section = document.getElementById('section-dashboard');
  if (!section) return;

  let errorEl = document.getElementById('dashboard-error');
  if (!errorEl) {
    errorEl = document.createElement('div');
    errorEl.id = 'dashboard-error';
    errorEl.className = 'error-state';
    errorEl.innerHTML = `
      <div class="error-state-title">Dashboard data is unavailable</div>
      <div class="error-state-text" id="dashboard-error-text"></div>
      <button type="button" class="btn-retry" id="dashboard-retry">Retry</button>
    `;
    section.prepend(errorEl);
    document.getElementById('dashboard-retry')?.addEventListener('click', () => {
      errorEl.classList.remove('visible');
      initDashboard();
    });
  }

  document.getElementById('dashboard-error-text').textContent =
    `${message} API: ${API_BASE_URL}`;
  errorEl.classList.add('visible');
}

// ── Format currency ──
function formatEUR(val) {
  return '₹' + Math.round(val).toLocaleString('en-US');
}

// ── Initialize Dashboard ──
async function initDashboard() {
  // show skeleton overlays while fetching data
  document.querySelectorAll('.skeleton').forEach(s => { if (s.dataset.skelFor !== 'result-card') s.style.display = 'block'; });
  setStatus('Loading Models', 'loading');

  try {
    const [summary, metrics, pcaData, predictions] = await Promise.all([
      fetchJSON('/api/summary'),
      fetchJSON('/api/metrics'),
      fetchJSON('/api/pca'),
      fetchJSON('/api/predictions'),
    ]);

    renderOverview(summary, metrics);
    renderPCA(pcaData);
    renderModels(metrics, predictions);
    initPredictor();
    await buildSearchIndex(summary, metrics);

    // hide any remaining skeletons (chart canvases are hidden inside createChart)
    document.querySelectorAll('.skeleton').forEach(s => { if (s.dataset.skelFor !== 'result-card') s.style.display = 'none'; });
    setStatus('Models Loaded', 'ready');
  } catch (err) {
    setStatus('API Unavailable', 'error');
    showDashboardError(err.message);
  }

  // Map is initialized lazily when its tab is first opened (canvas needs visible dimensions)
}

// ═══════════════════════════════════════════
// 1. OVERVIEW SECTION
// ═══════════════════════════════════════════
function renderOverview(summary, metrics) {
  document.getElementById('stat-total').textContent = summary.total_properties.toLocaleString();
  document.getElementById('stat-features').textContent = summary.features_count;
  document.getElementById('stat-mean-val').textContent = formatEUR(summary.valuation_stats.mean);

  const bestModel = metrics.best_model;
  const bestR2 = metrics.results[bestModel].r2;
  document.getElementById('stat-best-r2').textContent = bestR2.toFixed(4);
  document.getElementById('stat-best-name').textContent = bestModel;

  // Valuations by Market
  const marketNames = Object.keys(summary.avg_valuation_by_market);
  const marketVals = Object.values(summary.avg_valuation_by_market);
  createChart('chart-market-val', 'bar', {
    labels: marketNames,
    datasets: [{
      label: 'Avg Valuation (₹)',
      data: marketVals,
      backgroundColor: marketNames.map(m => withAlpha(MARKET_COLORS[m] || window.UREI_COLORS?.BG_CARD, '99')),
      borderColor: marketNames.map(m => MARKET_COLORS[m] || window.UREI_COLORS?.BG_CARD),
      borderWidth: 1.5,
      borderRadius: 6,
    }],
  }, { indexAxis: 'y' });

  // Valuations by Sector
  const sectorNames = Object.keys(summary.avg_valuation_by_sector);
  const sectorVals = Object.values(summary.avg_valuation_by_sector);
  createChart('chart-sector-val', 'bar', {
    labels: sectorNames,
    datasets: [{
      label: 'Avg Valuation (₹)',
      data: sectorVals,
      backgroundColor: sectorNames.map(s => withAlpha(SECTOR_COLORS[s] || window.UREI_COLORS?.BG_CARD, '99')),
      borderColor: sectorNames.map(s => SECTOR_COLORS[s] || window.UREI_COLORS?.BG_CARD),
      borderWidth: 1.5,
      borderRadius: 6,
    }],
  });

  // Market Distribution (doughnut)
  const marketCounts = Object.values(summary.micro_markets);
  createChart('chart-market-dist', 'doughnut', {
    labels: marketNames,
    datasets: [{
      data: marketCounts,
      backgroundColor: marketNames.map(m => withAlpha(MARKET_COLORS[m] || window.UREI_COLORS?.BG_CARD, 'cc')),
      borderColor: 'rgba(92,84,112,0.06)',
      borderWidth: 2,
    }],
  }, { cutout: '65%' });

  // Sector Distribution (doughnut)
  const sectorCounts = Object.values(summary.sectors);
  createChart('chart-sector-dist', 'doughnut', {
    labels: sectorNames,
    datasets: [{
      data: sectorCounts,
      backgroundColor: sectorNames.map(s => withAlpha(SECTOR_COLORS[s] || window.UREI_COLORS?.BG_CARD, 'cc')),
      borderColor: window.UREI_COLORS?.BORDER_MUTED || 'rgba(92,84,112,0.06)',
      borderWidth: 2,
    }],
  }, { cutout: '65%' });
}

// ═══════════════════════════════════════════
// 2. PCA SECTION
// ═══════════════════════════════════════════
function renderPCA(pca) {
  const nOrig = pca.n_features_original;
  const nComp = pca.n_components;
  const totalVar = pca.explained_variance_ratio.reduce((a, b) => a + b, 0);

  document.getElementById('pca-original').textContent = nOrig;
  document.getElementById('pca-components').textContent = nComp;
  document.getElementById('pca-variance').textContent = (totalVar * 100).toFixed(1) + '%';
  document.getElementById('pca-reduction').textContent = Math.round((1 - nComp / nOrig) * 100) + '%';

  // Explained Variance Chart
  const labels = pca.explained_variance_ratio.map((_, i) => `PC${i + 1}`);
  const cumLabels = pca.cumulative_variance.slice(0, nOrig);
  createChart('chart-pca-variance', 'bar', {
    labels: labels,
    datasets: [
      {
        label: 'Individual Variance',
        data: pca.explained_variance_ratio.map(v => (v * 100).toFixed(2)),
        backgroundColor: withAlpha(window.UREI_COLORS.SECONDARY, '17'),
        borderColor: window.UREI_COLORS.SECONDARY,
        borderWidth: 1.5,
        borderRadius: 4,
        order: 2,
      },
      {
        label: 'Cumulative Variance',
        data: cumLabels.slice(0, nComp).map(v => (v * 100).toFixed(2)),
        type: 'line',
        borderColor: window.UREI_COLORS.SECONDARY,
        backgroundColor: withAlpha(window.UREI_COLORS.ACCENT, '1f'),
        pointBackgroundColor: window.UREI_COLORS.ACCENT,
        pointRadius: 4,
        fill: true,
        tension: 0.3,
        order: 1,
      },
    ],
  }, {
    scales: {
      y: {
        title: { display: true, text: 'Variance (%)' },
      },
    },
  });

  // PCA Component Importances
  const importances = pca.pca_component_importances;
  const maxImp = Math.max(...importances);
  const barsContainer = document.getElementById('pca-importance-bars');
  barsContainer.innerHTML = '';

  importances.forEach((imp, i) => {
    const pct = (imp / maxImp * 100).toFixed(1);
    barsContainer.innerHTML += `
      <div class="feature-bar">
        <span class="feature-bar-name">PC${i + 1}</span>
        <div class="feature-bar-track">
          <div class="feature-bar-fill" style="width: ${pct}%"></div>
        </div>
        <span class="feature-bar-value">${(imp * 100).toFixed(1)}%</span>
      </div>
    `;
  });
}

// ═══════════════════════════════════════════
// 3. MODEL PERFORMANCE SECTION
// ═══════════════════════════════════════════
function renderModels(metrics, predictions) {
  const models = Object.keys(metrics.results);
  const r2s = models.map(m => metrics.results[m].r2);
  const rmses = models.map(m => metrics.results[m].rmse);

  // R² Chart
  createChart('chart-r2', 'bar', {
    labels: models,
    datasets: [{
      label: 'R² Score',
      data: r2s,
      backgroundColor: MODEL_COLORS.map(c => withAlpha(c, '99')),
      borderColor: MODEL_COLORS,
      borderWidth: 1.5,
      borderRadius: 6,
    }],
  }, {
    scales: {
      y: { min: Math.min(...r2s) - 0.02, max: 1.0 },
    },
  });

  // RMSE Chart
  createChart('chart-rmse', 'bar', {
    labels: models,
    datasets: [{
      label: 'RMSE (₹)',
      data: rmses,
      backgroundColor: MODEL_COLORS.map(c => withAlpha(c, '99')),
      borderColor: MODEL_COLORS,
      borderWidth: 1.5,
      borderRadius: 6,
    }],
  });

  // Actual vs Predicted scatter
  const scatterData = predictions.actual.map((a, i) => ({
    x: a,
    y: predictions.predicted[i],
  }));
  createChart('chart-actual-pred', 'scatter', {
    datasets: [
      {
        label: 'Predictions',
        data: scatterData,
        backgroundColor: withAlpha(window.UREI_COLORS.SECONDARY, '17'),
        borderColor: window.UREI_COLORS.SECONDARY,
        pointRadius: 3,
        pointHoverRadius: 6,
      },
      {
        label: 'Perfect Prediction',
        data: [
          { x: Math.min(...predictions.actual), y: Math.min(...predictions.actual) },
          { x: Math.max(...predictions.actual), y: Math.max(...predictions.actual) },
        ],
        type: 'line',
        borderColor: window.UREI_COLORS.SECONDARY,
        borderDash: [5, 5],
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  }, {
    scales: {
      x: { title: { display: true, text: 'Actual (₹)' } },
      y: { title: { display: true, text: 'Predicted (₹)' } },
    },
  });

  // Metrics Table
  const tbody = document.getElementById('metrics-tbody');
  tbody.innerHTML = '';
  models.forEach(m => {
    const r = metrics.results[m];
    const best = m === metrics.best_model ? ` style="color:${window.UREI_COLORS.SECONDARY};font-weight:700;"` : '';
    tbody.innerHTML += `
      <tr>
        <td${best}>${m}${m === metrics.best_model ? ' ⭐' : ''}</td>
        <td class="mono">${r.r2.toFixed(4)}</td>
        <td class="mono">${formatEUR(r.rmse)}</td>
        <td class="mono">${formatEUR(r.mae)}</td>
      </tr>
    `;
  });
}

// ═══════════════════════════════════════════
// 4. PREDICTOR
// ═══════════════════════════════════════════
function initPredictor() {
  // Sync range sliders with display values
  const sliders = [
    { id: 'input-rooms', valId: 'val-rooms', fmt: v => v },
    { id: 'input-area', valId: 'val-area', fmt: v => v },
    { id: 'input-quality', valId: 'val-quality', fmt: v => parseFloat(v).toFixed(2) },
    { id: 'input-age', valId: 'val-age', fmt: v => v },
    { id: 'input-energy', valId: 'val-energy', fmt: v => v },
    { id: 'input-transit', valId: 'val-transit', fmt: v => parseFloat(v).toFixed(2) },
  ];

  sliders.forEach(s => {
    const el = document.getElementById(s.id);
    const valEl = document.getElementById(s.valId);
    el.addEventListener('input', () => {
      valEl.textContent = s.fmt(el.value);
    });
  });

  // Sync manual micro-market dropdown select changes to set default coordinates
  document.getElementById('input-market').addEventListener('change', (e) => {
    const market = e.target.value;
    const coords = {
      Center: { lat: 52.3700, lon: 4.8950 },
      South:  { lat: 52.3400, lon: 4.8800 },
      East:   { lat: 52.3650, lon: 4.9400 },
      West:   { lat: 52.3750, lon: 4.8400 },
      North:  { lat: 52.4000, lon: 4.9100 },
    };
    if (coords[market]) {
      document.getElementById('input-lat').value = coords[market].lat.toFixed(4);
      document.getElementById('input-lon').value = coords[market].lon.toFixed(4);
    }
  });

  // Predict button
  document.getElementById('btn-predict').addEventListener('click', async () => {
    const market = document.getElementById('input-market').value;
    const sector = document.getElementById('input-sector').value;

    const lat = parseFloat(document.getElementById('input-lat').value) || 52.3700;
    const lon = parseFloat(document.getElementById('input-lon').value) || 4.8950;
    const dist = Math.sqrt((lat - 52.370)**2 + (lon - 4.895)**2) * 111;

    const payload = {
      micro_market: market,
      sector: sector,
      latitude: lat,
      longitude: lon,
      distance_to_center_km: dist,
      rooms: parseInt(document.getElementById('input-rooms').value),
      floor_area_m2: parseFloat(document.getElementById('input-area').value),
      quality_score: parseFloat(document.getElementById('input-quality').value),
      building_age_years: parseInt(document.getElementById('input-age').value),
      amenity_density: 0.6 + Math.random() * 0.2,
      local_tax_rate: 0.004,
      income_zone_rating: 3,
      transit_proximity_score: parseFloat(document.getElementById('input-transit').value),
      green_space_ratio: 0.3,
      crime_index: 0.2,
      school_rating: 7.0,
      noise_level_db: 50,
      energy_label: parseInt(document.getElementById('input-energy').value),
      parking_available: 1,
      has_balcony: 1,
      last_renovation_year: 2015,
    };

    const btn = document.getElementById('btn-predict');
    const resultSkel = document.querySelector('[data-skel-for="result-card"]');
    try {
      // show button loading + result skeleton
      if (btn) { btn.disabled = true; btn.classList.add('loading'); }
      if (resultSkel) { resultSkel.style.display = 'block'; }
      document.getElementById('result-empty').style.display = 'none';
      document.getElementById('result-content').style.display = 'none';

      const result = await fetchJSON('/api/predict', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // hide skeleton and reset button
      if (resultSkel) { resultSkel.style.display = 'none'; }
      if (btn) { btn.classList.remove('loading'); btn.disabled = false; }

      document.getElementById('result-empty').style.display = 'none';
      document.getElementById('result-content').style.display = 'block';
      document.getElementById('result-value').textContent = result.formatted;
      document.getElementById('result-confidence').textContent =
        result.confidence === 'high' ? '✓ High Confidence' : '⚠ Low Confidence';

      const details = document.getElementById('result-details');
      details.innerHTML = `
        <div class="result-detail-row">
          <span class="result-detail-label">Micro-Market</span>
          <span class="result-detail-value">${market}</span>
        </div>
        <div class="result-detail-row">
          <span class="result-detail-label">Sector</span>
          <span class="result-detail-value">${sector}</span>
        </div>
        <div class="result-detail-row">
          <span class="result-detail-label">Coordinates</span>
          <span class="result-detail-value">${lat.toFixed(4)}, ${lon.toFixed(4)}</span>
        </div>
        <div class="result-detail-row">
          <span class="result-detail-label">Rooms</span>
          <span class="result-detail-value">${payload.rooms}</span>
        </div>
        <div class="result-detail-row">
          <span class="result-detail-label">Floor Area</span>
          <span class="result-detail-value">${payload.floor_area_m2} m²</span>
        </div>
        <div class="result-detail-row">
          <span class="result-detail-label">Quality</span>
          <span class="result-detail-value">${payload.quality_score.toFixed(2)}</span>
        </div>
        <div class="result-detail-row">
          <span class="result-detail-label">Building Age</span>
          <span class="result-detail-value">${payload.building_age_years} years</span>
        </div>
        <div class="result-detail-row">
          <span class="result-detail-label">Model</span>
          <span class="result-detail-value">Stacking Ensemble (R² ≈ 0.95)</span>
        </div>
      `;
    } catch (e) {
      if (resultSkel) { resultSkel.style.display = 'none'; }
      if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
      
      document.getElementById('result-empty').style.display = 'none';
      document.getElementById('result-content').style.display = 'block';
      document.getElementById('result-value').textContent = 'Error';
      document.getElementById('result-confidence').textContent = '⚠ ' + e.message;
      document.getElementById('result-details').innerHTML = '<div style="color:var(--danger)">Failed to estimate valuation. Please try again later.</div>';
    }
  });
}

// ═══════════════════════════════════════════
// 5. MICRO-MARKET MAP
// ═══════════════════════════════════════════
let mapData = [];

async function initMap() {
  if (mapData.length === 0) {
    try {
      mapData = await fetchJSON('/api/data?n=2500');
    } catch (err) {
      mapData = [];
      document.getElementById('map-count').textContent = 'Map data unavailable';
      const mapSkel = document.querySelector('[data-skel-for="map-canvas"]');
      if (mapSkel) mapSkel.style.display = 'none';
      setStatus('API Unavailable', 'error');
    }
  }

  const canvas = document.getElementById('map-canvas');
  const ctx = canvas.getContext('2d');
  const tooltip = document.getElementById('map-tooltip');

  const latMin = 52.31, latMax = 52.43;
  const lonMin = 4.80, lonMax = 4.98;
  const padding = 40;

  let W, H;
  let activeProperty = null;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    W = rect.width;
    H = rect.height;
  }

  resizeCanvas();

  const toX = (lon) => padding + (lon - lonMin) / (lonMax - lonMin) * (W - 2 * padding);
  const toY = (lat) => H - padding - (lat - latMin) / (latMax - latMin) * (H - 2 * padding);
  const toLon = (x) => lonMin + (x - padding) / (W - 2 * padding) * (lonMax - lonMin);
  const toLat = (y) => latMin + (H - padding - y) / (H - 2 * padding) * (latMax - latMin);

  function getHeatmapColor(val, minVal = 150000, maxVal = 750000) {
    const pct = Math.min(Math.max((val - minVal) / (maxVal - minVal), 0), 1);
    let r, g, b;
    if (pct < 0.25) {
      const p = pct / 0.25;
      r = Math.round(99 + p * (34 - 99));
      g = Math.round(102 + p * (211 - 102));
      b = Math.round(241 + p * (238 - 241));
    } else if (pct < 0.50) {
      const p = (pct - 0.25) / 0.25;
      r = Math.round(34 + p * (16 - 34));
      g = Math.round(211 + p * (185 - 211));
      b = Math.round(238 + p * (129 - 238));
    } else if (pct < 0.75) {
      const p = (pct - 0.50) / 0.25;
      r = Math.round(16 + p * (251 - 16));
      g = Math.round(185 + p * (191 - 185));
      b = Math.round(129 + p * (36 - 129));
    } else {
      const p = (pct - 0.75) / 0.25;
      r = Math.round(251 + p * (244 - 251));
      g = Math.round(191 + p * (114 - 191));
      b = Math.round(36 + p * (182 - 36));
    }
    return `rgb(${r},${g},${b})`;
  }

  function renderLegend(colorMode) {
    const legendEl = document.getElementById('map-legend');
    legendEl.innerHTML = '';

    if (colorMode === 'market') {
      Object.entries(MARKET_COLORS).forEach(([name, color]) => {
        legendEl.innerHTML += `<div class="legend-item"><div class="legend-dot" style="background:${color}"></div> ${name}</div>`;
      });
    } else if (colorMode === 'sector') {
      Object.entries(SECTOR_COLORS).forEach(([name, color]) => {
        legendEl.innerHTML += `<div class="legend-item"><div class="legend-dot" style="background:${color}"></div> ${name}</div>`;
      });
    } else if (colorMode === 'valuation') {
      legendEl.innerHTML += `
        <div class="legend-item" style="display:flex; align-items:center; gap:12px; width: 100%;">
          <span>Low Val (₹150k)</span>
          <div style="height: 8px; flex: 1; background: linear-gradient(to right, rgb(99,102,241), rgb(34,211,238), rgb(16,185,129), rgb(251,191,36), rgb(244,114,182)); border-radius: 4px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.5);"></div>
          <span>High Val (₹750k+)</span>
        </div>
      `;
    }
  }

  function draw() {
    const filterMarket = document.getElementById('map-filter-market').value;
    const filterSector = document.getElementById('map-filter-sector').value;
    const colorMode = document.getElementById('map-color-mode').value;

    renderLegend(colorMode);

    const filteredData = mapData.filter(d => {
      const matchMarket = filterMarket === 'All' || d.micro_market === filterMarket;
      const matchSector = filterSector === 'All' || d.sector === filterSector;
      return matchMarket && matchSector;
    });

    document.getElementById('map-count').textContent = `${filteredData.length} properties`;

    // Background
    ctx.fillStyle = window.UREI_COLORS?.BG_CARD || '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = window.UREI_COLORS?.BORDER_MUTED || 'rgba(53,47,68,0.04)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const x = padding + (W - 2 * padding) * i / 10;
      const y = padding + (H - 2 * padding) * i / 10;
      ctx.beginPath(); ctx.moveTo(x, padding); ctx.lineTo(x, H - padding); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(W - padding, y); ctx.stroke();
    }

    // Plot properties
    filteredData.forEach(d => {
      const x = toX(d.longitude);
      const y = toY(d.latitude);

      let color;
      if (colorMode === 'market') {
        color = MARKET_COLORS[d.micro_market] || window.UREI_COLORS?.BG_CARD;
      } else if (colorMode === 'sector') {
        color = SECTOR_COLORS[d.sector] || window.UREI_COLORS?.BG_CARD;
      } else {
        color = getHeatmapColor(d.valuation_eur);
      }

      const isHovered = activeProperty && activeProperty.property_id === d.property_id;

      // Glow ring
      ctx.beginPath();
      ctx.arc(x, y, isHovered ? 8 : 4, 0, Math.PI * 2);
      ctx.fillStyle = color + (isHovered ? '44' : '15');
      ctx.fill();

      // Center dot
      ctx.beginPath();
      ctx.arc(x, y, isHovered ? 3.5 : 2.0, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });

    // Market centers labels
    const centers = {
      Center: { lat: 52.370, lon: 4.895 },
      South:  { lat: 52.340, lon: 4.880 },
      East:   { lat: 52.365, lon: 4.940 },
      West:   { lat: 52.375, lon: 4.840 },
      North:  { lat: 52.400, lon: 4.910 },
    };

    ctx.font = '600 11px Inter';
    Object.entries(centers).forEach(([name, c]) => {
      const x = toX(c.lon);
      const y = toY(c.lat);

      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(MARKET_COLORS[name] || window.UREI_COLORS?.BG_CARD, '15');
      ctx.strokeStyle = withAlpha(MARKET_COLORS[name] || window.UREI_COLORS?.BG_CARD, '66');
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = window.UREI_COLORS?.SECONDARY || '#374151';
      ctx.textAlign = 'center';
      ctx.fillText(name, x, y - 20);
    });
  }

  draw();

  // Resize handler
  window.addEventListener('resize', () => {
    if (document.getElementById('section-map').classList.contains('active')) {
      resizeCanvas();
      draw();
    }
  });

  // Attach filter events
  const filters = ['map-filter-market', 'map-filter-sector', 'map-color-mode'];
  filters.forEach(id => {
    document.getElementById(id).onchange = () => {
      draw();
      tooltip.style.display = 'none';
      activeProperty = null;
    };
  });

  // Hover detection
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const filterMarket = document.getElementById('map-filter-market').value;
    const filterSector = document.getElementById('map-filter-sector').value;
    const visibleData = mapData.filter(d => {
      const matchMarket = filterMarket === 'All' || d.micro_market === filterMarket;
      const matchSector = filterSector === 'All' || d.sector === filterSector;
      return matchMarket && matchSector;
    });

    let nearest = null;
    let minD = 8; // detection threshold in pixels

    visibleData.forEach(d => {
      const px = toX(d.longitude);
      const py = toY(d.latitude);
      const dist = Math.sqrt((px - mouseX)**2 + (py - mouseY)**2);
      if (dist < minD) {
        minD = dist;
        nearest = d;
      }
    });

    if (nearest) {
      if (!activeProperty || activeProperty.property_id !== nearest.property_id) {
        activeProperty = nearest;
        draw();
      }

      tooltip.style.display = 'block';
      tooltip.style.left = `${mouseX + 15}px`;
      tooltip.style.top = `${mouseY + 15}px`;

      const energyLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
      const energyText = energyLabels[nearest.energy_label - 1] || nearest.energy_label;

      tooltip.innerHTML = `
        <div class="tooltip-title">
          <span>${nearest.property_id}</span>
          <span style="color:${MARKET_COLORS[nearest.micro_market]}">${nearest.micro_market}</span>
        </div>
        <div class="tooltip-row">
          <span>Valuation:</span>
          <span style="color:${window.UREI_COLORS.SECONDARY}; font-weight:700;">${formatEUR(nearest.valuation_eur)}</span>
        </div>
        <div class="tooltip-row">
          <span>Sector:</span>
          <span>${nearest.sector}</span>
        </div>
        <div class="tooltip-row">
          <span>Rooms/Area:</span>
          <span>${nearest.rooms} R / ${nearest.floor_area_m2} m²</span>
        </div>
        <div class="tooltip-row">
          <span>Quality:</span>
          <span>${nearest.quality_score.toFixed(2)}</span>
        </div>
        <div class="tooltip-row">
          <span>Energy Label:</span>
          <span>${energyText}</span>
        </div>
        <div style="font-size: 10px; color: ${window.UREI_COLORS.SECONDARY}; margin-top: 8px; border-top: 1px solid rgba(0,0,0,0.06); padding-top: 6px; text-align: center;">
          Click dot to use in Predictor
        </div>
      `;
    } else {
      if (activeProperty) {
        activeProperty = null;
        draw();
      }
      tooltip.style.display = 'none';
    }
  };

  canvas.onmouseleave = () => {
    activeProperty = null;
    draw();
    tooltip.style.display = 'none';
  };

  // Click handler to coordinates sync and navigation
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    let targetLat, targetLon, targetMarket, targetSector;

    if (activeProperty) {
      targetLat = activeProperty.latitude;
      targetLon = activeProperty.longitude;
      targetMarket = activeProperty.micro_market;
      targetSector = activeProperty.sector;
    } else {
      targetLon = toLon(clickX);
      targetLat = toLat(clickY);

      // Find closest market center coordinates
      const centers = {
        Center: { lat: 52.370, lon: 4.895 },
        South:  { lat: 52.340, lon: 4.880 },
        East:   { lat: 52.365, lon: 4.940 },
        West:   { lat: 52.375, lon: 4.840 },
        North:  { lat: 52.400, lon: 4.910 },
      };

      let minC = Infinity;
      let closestMarket = 'Center';
      Object.entries(centers).forEach(([mName, c]) => {
        const d = Math.sqrt((c.lat - targetLat)**2 + (c.lon - targetLon)**2);
        if (d < minC) {
          minC = d;
          closestMarket = mName;
        }
      });
      targetMarket = closestMarket;
    }

    // Set form coordinates and market selector
    document.getElementById('input-lat').value = targetLat.toFixed(4);
    document.getElementById('input-lon').value = targetLon.toFixed(4);
    document.getElementById('input-market').value = targetMarket;
    if (targetSector) {
      document.getElementById('input-sector').value = targetSector;
    }

    // Visual feedback in top bar
    const originalText = document.querySelector('.status-badge').innerHTML;
    document.querySelector('.status-badge').innerHTML = `<span class="status-dot" style="background:${window.UREI_COLORS.SECONDARY};"></span> Location Synced!`;
    document.querySelector('.status-badge').style.borderColor = withAlpha(window.UREI_COLORS.SECONDARY, '1f');
    document.querySelector('.status-badge').style.background = withAlpha(window.UREI_COLORS.SECONDARY, '0f');
    document.querySelector('.status-badge').style.color = window.UREI_COLORS.PRIMARY;

    setTimeout(() => {
      document.querySelector('.status-badge').innerHTML = originalText;
      document.querySelector('.status-badge').removeAttribute('style');
    }, 2000);

    // Navigate to predictor tab
    const navPredictor = document.getElementById('nav-predictor');
    if (navPredictor) {
      navPredictor.click();
    }
  };

  // hide the map skeleton once initial draw completes
  const mapSkel = document.querySelector('[data-skel-for="map-canvas"]');
  if (mapSkel) mapSkel.style.display = 'none';

  mapRedraw = draw;
}

// ═══════════════════════════════════════════
// UTILITY: Create Chart
// ═══════════════════════════════════════════
function createChart(canvasId, type, data, extraOptions = {}) {
  const ctx = document.getElementById(canvasId).getContext('2d');

  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          padding: 16,
          usePointStyle: true,
          pointStyleWidth: 10,
          font: { size: 11 },
        },
      },
      tooltip: {
        backgroundColor: window.UREI_COLORS?.BG_CARD || '#ffffff',
        titleColor: window.UREI_COLORS?.PRIMARY || '#0f172a',
        bodyColor: window.UREI_COLORS?.SECONDARY || '#374151',
        borderColor: window.UREI_COLORS?.BORDER_DEFAULT || 'rgba(15,23,42,0.06)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12,
      },
    },
    scales: type === 'doughnut' || type === 'pie' ? {} : {
      x: {
        grid: { color: window.UREI_COLORS?.BORDER_MUTED || 'rgba(15,23,42,0.04)' },
        ticks: { font: { size: 11 } },
        ...(extraOptions.scales?.x || {}),
      },
      y: {
        grid: { color: window.UREI_COLORS?.BORDER_MUTED || 'rgba(15,23,42,0.04)' },
        ticks: { font: { size: 11 } },
        ...(extraOptions.scales?.y || {}),
      },
    },
    ...extraOptions,
  };

  // Merge scales properly
  if (extraOptions.scales && (type !== 'doughnut' && type !== 'pie')) {
    if (extraOptions.scales.x) {
      options.scales.x = { ...options.scales.x, ...extraOptions.scales.x };
    }
    if (extraOptions.scales.y) {
      options.scales.y = { ...options.scales.y, ...extraOptions.scales.y };
    }
  }

  if (extraOptions.cutout) {
    options.cutout = extraOptions.cutout;
  }

  if (extraOptions.indexAxis) {
    options.indexAxis = extraOptions.indexAxis;
  }

  chartInstances[canvasId] = new Chart(ctx, { type, data, options });
  // hide any skeleton overlay for this canvas once chart has been created
  try {
    const sk = document.querySelector(`[data-skel-for="${canvasId}"]`);
    if (sk) sk.style.display = 'none';
  } catch (err) { /* ignore in older browsers */ }
}

// ═══════════════════════════════════════════
// TOP BAR: SEARCH & USER MENU
// ═══════════════════════════════════════════
async function buildSearchIndex(summary, metrics) {
  const items = [
    { label: 'Dashboard', sublabel: 'Overview & key metrics', section: 'dashboard', terms: ['dashboard', 'overview', 'stats', 'properties', 'valuation'] },
    { label: 'PCA Analysis', sublabel: 'Dimensionality reduction', section: 'pca', terms: ['pca', 'principal', 'component', 'variance', 'features', 'analysis'] },
    { label: 'Model Performance', sublabel: 'Ensemble regression metrics', section: 'models', terms: ['model', 'models', 'performance', 'r2', 'rmse', 'ensemble', 'random forest', 'gradient', 'adaboost', 'stacking'] },
    { label: 'Valuation Predictor', sublabel: 'Estimate property value', section: 'predictor', terms: ['predict', 'predictor', 'valuation', 'estimate', 'price', 'property'] },
    { label: 'Micro-Market Map', sublabel: 'Spatial property map', section: 'map', terms: ['map', 'spatial', 'location', 'micro-market', 'market'] },
  ];

  Object.entries(summary.micro_markets || {}).forEach(([market, count]) => {
    items.push({
      label: market,
      sublabel: `Micro-market · ${Number(count).toLocaleString()} properties`,
      section: 'map',
      mapMarket: market,
      terms: [market.toLowerCase(), 'market', 'micro-market'],
    });
  });

  Object.entries(summary.sectors || {}).forEach(([sector, count]) => {
    items.push({
      label: sector,
      sublabel: `Sector · ${Number(count).toLocaleString()} properties`,
      section: 'map',
      mapSector: sector,
      terms: [sector.toLowerCase(), 'sector', 'rental', 'ownership'],
    });
  });

  Object.keys(metrics.results || {}).forEach(model => {
    const r2 = metrics.results[model].r2;
    items.push({
      label: model,
      sublabel: `Model · R² ${r2.toFixed(4)}`,
      section: 'models',
      terms: [model.toLowerCase(), 'model'],
    });
  });

  if (mapData.length === 0) {
    try {
      mapData = await fetchJSON('/api/data?n=500');
    } catch (err) {
      mapData = [];
    }
  }

  mapData.forEach(p => {
    items.push({
      label: `Property #${p.property_id}`,
      sublabel: `${p.micro_market} · ${p.sector}`,
      section: 'map',
      mapMarket: p.micro_market,
      mapSector: p.sector,
      terms: [`${p.property_id}`, 'property', p.micro_market.toLowerCase(), p.sector.toLowerCase()],
    });
  });

  searchIndex = items;
}

function filterSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return searchIndex.filter(item => {
    if (item.label.toLowerCase().includes(q)) return true;
    if (item.sublabel.toLowerCase().includes(q)) return true;
    return item.terms.some(term => term.includes(q) || q.includes(term));
  }).slice(0, 8);
}

function closeSearchResults() {
  const searchResults = document.getElementById('search-results');
  const searchInput = document.getElementById('top-search');
  if (searchResults) {
    searchResults.hidden = true;
    searchResults.innerHTML = '';
  }
  if (searchInput) searchInput.setAttribute('aria-expanded', 'false');
  activeSearchIdx = -1;
}

function selectSearchResult(item) {
  const searchInput = document.getElementById('top-search');
  navigateToSection(item.section, {
    mapMarket: item.mapMarket,
    mapSector: item.mapSector,
  });
  if (searchInput) searchInput.value = '';
  closeSearchResults();
}

function renderSearchResults(results) {
  const searchResults = document.getElementById('search-results');
  const searchInput = document.getElementById('top-search');
  if (!searchResults || !searchInput) return;

  activeSearchIdx = -1;

  if (!results.length) {
    searchResults.innerHTML = '<div class="search-empty">No results found</div>';
    searchResults.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
    return;
  }

  searchResults.innerHTML = results.map((item, i) => `
    <button type="button" class="search-result-item" role="option" data-index="${i}">
      <span class="search-result-label">${item.label}</span>
      <span class="search-result-sublabel">${item.sublabel}</span>
    </button>
  `).join('');

  searchResults.querySelectorAll('.search-result-item').forEach(btn => {
    btn.addEventListener('click', () => {
      selectSearchResult(results[Number(btn.dataset.index)]);
    });
  });

  searchResults.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
}

function openUserMenu() {
  const userMenu = document.getElementById('user-menu');
  const avatarBtn = document.getElementById('avatar-btn');
  if (userMenu) userMenu.hidden = false;
  if (avatarBtn) avatarBtn.setAttribute('aria-expanded', 'true');
}

function closeUserMenu() {
  const userMenu = document.getElementById('user-menu');
  const avatarBtn = document.getElementById('avatar-btn');
  if (userMenu) userMenu.hidden = true;
  if (avatarBtn) avatarBtn.setAttribute('aria-expanded', 'false');
}

function renderUserMenu(user) {
  const avatarBtn = document.getElementById('avatar-btn');
  const userMenu = document.getElementById('user-menu');
  if (!avatarBtn || !userMenu) return;

  if (user) {
    avatarBtn.textContent = user.username.slice(0, 2).toUpperCase();
    userMenu.innerHTML = `
      <div class="user-menu-header">${user.username}</div>
      <button type="button" class="user-menu-logout" id="btn-logout" role="menuitem">Logout</button>
    `;
    document.getElementById('btn-logout')?.addEventListener('click', () => {
      clearAuth();
      closeUserMenu();
      renderUserMenu(null);
    });
  } else {
    avatarBtn.textContent = 'UREI';
    userMenu.innerHTML = `
      <a href="/login" role="menuitem">Sign In</a>
      <a href="/register" role="menuitem">Register</a>
    `;
  }
}

async function initAuthUI() {
  const cachedUser = localStorage.getItem('urei_user');
  if (cachedUser) {
    try {
      renderUserMenu(JSON.parse(cachedUser));
    } catch (err) {
      clearAuth();
      renderUserMenu(null);
      return;
    }
  } else {
    renderUserMenu(null);
    return;
  }

  if (!localStorage.getItem('urei_token')) return;

  try {
    const data = await fetchJSON('/api/auth/me');
    localStorage.setItem('urei_user', JSON.stringify(data.user));
    renderUserMenu(data.user);
  } catch (err) {
    clearAuth();
    renderUserMenu(null);
  }
}

function initTopBar() {
  const searchInput = document.getElementById('top-search');
  const searchWrap = document.getElementById('search-wrap');
  const avatarBtn = document.getElementById('avatar-btn');

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim();
      if (!query) {
        closeSearchResults();
        return;
      }
      renderSearchResults(filterSearch(query));
    });

    searchInput.addEventListener('keydown', (e) => {
      const items = searchWrap?.querySelectorAll('.search-result-item');
      if (!items?.length) {
        if (e.key === 'Escape') closeSearchResults();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeSearchIdx = Math.min(activeSearchIdx + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle('active', i === activeSearchIdx));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeSearchIdx = Math.max(activeSearchIdx - 1, 0);
        items.forEach((el, i) => el.classList.toggle('active', i === activeSearchIdx));
      } else if (e.key === 'Enter') {
        if (activeSearchIdx >= 0) {
          e.preventDefault();
          items[activeSearchIdx].click();
        } else {
          const results = filterSearch(searchInput.value);
          if (results.length) selectSearchResult(results[0]);
        }
      } else if (e.key === 'Escape') {
        closeSearchResults();
      }
    });

    searchInput.addEventListener('focus', () => {
      if (searchInput.value.trim()) {
        renderSearchResults(filterSearch(searchInput.value));
      }
    });
  }

  if (avatarBtn) {
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !document.getElementById('user-menu')?.hidden;
      if (isOpen) {
        closeUserMenu();
      } else {
        openUserMenu();
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!searchWrap?.contains(e.target)) closeSearchResults();
    if (!document.getElementById('user-dropdown')?.contains(e.target)) closeUserMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeUserMenu();
  });
}

// ── Boot ──
document.addEventListener('DOMContentLoaded', () => {
  initColors();
  initTopBar();
  initAuthUI();
  initDashboard();

  const sectionFromHash = window.location.hash.slice(1);
  const validSections = new Set(['dashboard', 'pca', 'models', 'predictor', 'map']);
  if (validSections.has(sectionFromHash)) {
    navigateToSection(sectionFromHash);
  }

  window.addEventListener('hashchange', () => {
    const section = window.location.hash.slice(1);
    if (validSections.has(section)) navigateToSection(section);
  });

  // set initial aria-current on active nav
  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav) activeNav.setAttribute('aria-current', 'true');

  // sidebar toggle (mobile)
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  if (sidebarToggle && sidebar && sidebarBackdrop) {
    sidebarToggle.addEventListener('click', () => {
      const open = sidebar.classList.toggle('open');
      document.body.classList.toggle('sidebar-open', open);
      sidebarBackdrop.classList.toggle('visible', open);
    });
    sidebarBackdrop.addEventListener('click', () => {
      sidebar.classList.remove('open');
      document.body.classList.remove('sidebar-open');
      sidebarBackdrop.classList.remove('visible');
    });
  }
});
