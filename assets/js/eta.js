/* ============================================================
   QCU Student Portal — eta.js
   Live Campus ETA using MapLibre GL JS + TomTom Traffic-Aware Routing
   ============================================================ */

// Verified QCU Main Campus Coordinates: 673 Quirino Highway, San Bartolome, Novaliches, Quezon City
const QCU_COORDS = [121.0343, 14.7001]; // [Longitude, Latitude]

// TomTom Routing API Configuration
// API key should be restricted to this domain in TomTom Developer Portal
const ROUTE_API = "/api/route";
const TOMTOM_BASE = 'https://api.tomtom.com/routing/1/calculateRoute';
const TOMTOM_TRAFFIC_STYLE = 'relative'; // 'relative' | 'relative-delay' | 'absolute' | 'disabled'

let map = null;
let userMarker = null;
let qcuMarker = null;
let watchId = null;
let lastCoords = null;
let lastTimestamp = 0;
let lastAccuracy = null;
let isTracking = true;
let isUserPanning = false;
let hasFirstFix = false;
let lastRouteTime = 0;

const ROUTE_THROTTLE_MS = 15000; // 15s throttle between automatic route queries
const ROUTE_DEBOUNCE_METERS = 80; // Recalculate route if user moved > 80m

// Schedule & Traffic State
let scheduleData = null;
let lastETAMinutes = null;
let lastRouteData = null; // Store full route response for traffic details
let lastUpdatedAt = null; // Date of the most recent successful route render
let refreshTimer = null;  // Interval id for background traffic refresh

/**
 * Load student schedule from data/schedule.json
 */
async function loadSchedule() {
  try {
    const res = await fetch('data/schedule.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    scheduleData = await res.json();
  } catch (err) {
    console.warn('Schedule load failed:', err);
    scheduleData = null;
  }
}

/**
 * Day name → short form mapping for schedule matching
 */
const DAY_MAP = {
  0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday',
  4: 'Thursday', 5: 'Friday', 6: 'Saturday'
};

/**
 * Parse HH:MM time string to minutes since midnight
 */
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Find the next upcoming class from scheduleData for the given Date.
 * Returns { subject, course, start, end, building, room } or null.
 * Handles: today's remaining classes, tomorrow's first class (if after midnight).
 */
function getNextClass(date) {
  if (!scheduleData || !Array.isArray(scheduleData) || scheduleData.length === 0) return null;

  const dayName = DAY_MAP[date.getDay()];
  const nowMinutes = date.getHours() * 60 + date.getMinutes();

  // Today's classes (filter out noClasses days)
  const todayClasses = scheduleData.filter(c => c.day === dayName && !c.noClasses);

  // Find next class today (start > now, give 5min grace for late arrivals)
  const nextToday = todayClasses
    .filter(c => timeToMinutes(c.start) > nowMinutes - 5)
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))[0];

  if (nextToday) return nextToday;

  // No more classes today → find first class tomorrow
  const dayOrder = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  for (let i = 1; i <= 7; i++) {
    const nextDayName = dayOrder[(date.getDay() + i) % 7];
    const nextDayClasses = scheduleData
      .filter(c => c.day === nextDayName && !c.noClasses)
      .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    if (nextDayClasses.length > 0) return nextDayClasses[0];
  }
  return null;
}

/**
 * Configurable tuning for ETA display and next-class verdict thresholds.
 * Buffers are minutes of margin between estimated arrival and class start.
 *
 * Honesty policy: we NEVER fabricate a live-traffic figure. Real traffic
 * comes only from TomTom (free-flow vs traffic-aware durations). When only
 * base routing (OSRM) or a straight-line estimate is available, traffic is
 * reported as UNAVAILABLE — we do not invent a delay multiplier.
 */
const ETA_TUNING = {
  onTimeBufferMin: 15,   // arrival ≥ 15 min before start → ON TIME
  tightBufferMin: 5,     // arrival ≥ 5 min before start  → TIGHT
  // 0 ≤ margin < tightBufferMin → AT RISK ; margin < 0 → LATE
  periodicRefreshMs: 90000 // background traffic refresh cadence while tracking (not per-second)
};

/**
 * Generates a 32-point geodesic circle polygon in GeoJSON format.
 * Scales accurately with real-world ground meters at any map zoom level.
 */
function createGeoJSONCircle(center, radiusInMeters, points = 32) {
  if (!center || !radiusInMeters || radiusInMeters <= 0) {
    return { type: 'Polygon', coordinates: [[]] };
  }
  const [lon, lat] = center;
  const km = radiusInMeters / 1000;
  const coords = [];
  const distanceX = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const distanceY = km / 110.574;

  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    coords.push([lon + x, lat + y]);
  }
  coords.push(coords[0]); // Close polygon loop
  return {
    type: 'Polygon',
    coordinates: [coords]
  };
}

/**
 * Initialize MapLibre GL JS and map layers
 */
function initETA() {
  if (map) return;

  // Initialize MapLibre Map (Light / OpenFreeMap Liberty style)
  map = new maplibregl.Map({
    container: 'eta-map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: QCU_COORDS,
    zoom: 14,
    attributionControl: false
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }));
  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

  // Custom LocateMe control — floating button on the map
  const locateMeControl = document.createElement('div');
  locateMeControl.className = 'maplibregl-ctrl maplibregl-ctrl-group eta-locate-control';
  locateMeControl.innerHTML = `<button type="button" title="Locate Me" aria-label="Recenter map on my location"><i data-lucide="locate"></i></button>`;
  locateMeControl.querySelector('button').addEventListener('click', () => {
    reacquireLocation();
  });
  map.getContainer().appendChild(locateMeControl);

  // Detect user map interaction to avoid unwanted auto-panning
  map.on('dragstart', () => { isUserPanning = true; });
  map.on('rotatestart', () => { isUserPanning = true; });
  map.on('pitchstart', () => { isUserPanning = true; });
  map.on('touchstart', () => { isUserPanning = true; });
  map.on('wheel', () => { isUserPanning = true; });

  // Add QCU Destination Pin Marker (Anchored at bottom tip)
  const qcuContainer = document.createElement('div');
  qcuContainer.className = 'qcu-marker-container';
  qcuContainer.innerHTML = `
    <div class="qcu-marker-pin" title="Quezon City University — San Bartolome Main Campus"></div>
    <span class="qcu-marker-label">QCU Campus</span>
  `;
  qcuMarker = new maplibregl.Marker({
    element: qcuContainer,
    anchor: 'bottom'
  })
    .setLngLat(QCU_COORDS)
    .addTo(map);

  // Add User Location Marker (Anchored at center of circle)
  const userContainer = document.createElement('div');
  userContainer.className = 'user-marker-container';
  userContainer.innerHTML = `
    <div class="user-marker-pulse"></div>
    <div class="user-marker-core" title="Your current device location"></div>
  `;
  userMarker = new maplibregl.Marker({
    element: userContainer,
    anchor: 'center'
  }).setLngLat(QCU_COORDS);

  // Load student schedule for class-status comparison
  loadSchedule();

  map.on('load', () => {
    // 1. Accuracy Circle Source & Layers (Filled Polygon + Outline)
    map.addSource('accuracy-source', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [[]] }
      }
    });

    map.addLayer({
      id: 'accuracy-fill',
      type: 'fill',
      source: 'accuracy-source',
      paint: {
        'fill-color': '#005BAC',
        'fill-opacity': 0.12
      }
    });

    map.addLayer({
      id: 'accuracy-line',
      type: 'line',
      source: 'accuracy-source',
      paint: {
        'line-color': '#005BAC',
        'line-width': 1.5,
        'line-opacity': 0.45
      }
    });

    // 2. Active Route Source & Layers
    map.addSource('route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [] }
      }
    });

    // Route casing for high contrast on light map
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#0A4DA2',
        'line-width': 7,
        'line-opacity': 0.3
      }
    });

    map.addLayer({
      id: 'route-layer',
      type: 'line',
      source: 'route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#005BAC',
        'line-width': 4.5,
        'line-opacity': 0.95
      }
    });

    // Start continuous tracking
    startTracking();
  });

  // UI Event Listeners
  document.getElementById('btn-eta-locate')?.addEventListener('click', () => {
    reacquireLocation();
  });

  document.getElementById('btn-eta-toggle')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (isTracking) {
      stopTracking();
      isTracking = false;
      btn.innerHTML = '<i data-lucide="play"></i> Resume Tracking';
      btn.style.color = 'var(--blue)';
      updateStatus("Tracking paused", "error");
    } else {
      startTracking();
      isTracking = true;
      btn.innerHTML = '<i data-lucide="pause"></i> Stop Tracking';
      btn.style.color = 'var(--muted)';
      updateStatus("Resuming location…", "active");
    }
    if (window.iconify) window.iconify();
    else if (window.lucide) window.lucide.createIcons();
  });

  // Class panel toggle
  document.getElementById('eta-class-toggle')?.addEventListener('click', (e) => {
    const panel = document.getElementById('eta-class-banner');
    const toggleBtn = document.getElementById('eta-class-toggle');
    if (panel && toggleBtn) {
      const isCollapsed = panel.classList.toggle('collapsed');
      toggleBtn.classList.toggle('collapsed', isCollapsed);
      toggleBtn.setAttribute('aria-label', isCollapsed ? 'Expand class panel' : 'Collapse class panel');
      toggleBtn.title = isCollapsed ? 'Expand' : 'Collapse';
      if (window.lucide) window.lucide.createIcons();
    }
  });
}

/**
 * Update top-left status strip message and indicator dot
 */
function updateStatus(text, dotState) {
  const textEl = document.getElementById('eta-status-text');
  const dotEl = document.getElementById('eta-status-dot');
  if (textEl) textEl.textContent = text;
  if (dotEl) {
    dotEl.className = 'pulse-dot';
    if (dotState) dotEl.classList.add(dotState);
  }
}

/**
 * Update accuracy badge and display device guidance alert when accuracy is low
 */
function updateAccuracyDisplay(accuracyMeters) {
  const badge = document.getElementById('eta-accuracy-badge');
  const valEl = document.getElementById('eta-accuracy-val');
  const alertSection = document.getElementById('eta-accuracy-alert');
  const alertRadius = document.getElementById('eta-alert-radius');
  const alertTitle = document.getElementById('eta-alert-title');
  const alertDesc = document.getElementById('eta-alert-desc');

  if (!accuracyMeters || isNaN(accuracyMeters)) {
    if (badge) badge.style.display = 'none';
    if (alertSection) alertSection.style.display = 'none';
    return;
  }

  const rounded = Math.round(accuracyMeters);
  const formattedRadius = rounded >= 1000 ? `±${(rounded / 1000).toFixed(1)} km` : `±${rounded} m`;

  // 1. Badge Display
  if (badge && valEl) {
    badge.style.display = 'flex';
    badge.classList.remove('accuracy-good', 'accuracy-moderate', 'accuracy-poor');

    if (rounded <= 40) {
      badge.classList.add('accuracy-good');
      badge.innerHTML = `<i data-lucide="shield-check" style="width:13px;height:13px;"></i> GPS: ${formattedRadius} (High)`;
    } else if (rounded <= 200) {
      badge.classList.add('accuracy-moderate');
      badge.innerHTML = `<i data-lucide="info" style="width:13px;height:13px;"></i> Wi-Fi / Net: ${formattedRadius}`;
    } else {
      badge.classList.add('accuracy-poor');
      badge.innerHTML = `<i data-lucide="alert-triangle" style="width:13px;height:13px;"></i> Network: ${formattedRadius} (Low)`;
    }
  }

  // 2. Alert Guidance Display for Low/Coarse Accuracy
  if (alertSection) {
    if (rounded > 200) {
      alertSection.style.display = 'block';
      if (alertRadius) alertRadius.textContent = formattedRadius;
      if (alertTitle) {
        alertTitle.textContent = rounded > 1000
          ? `Location accuracy is low (${formattedRadius} — ISP / Network estimate)`
          : `Location accuracy is moderate (${formattedRadius})`;
      }
      if (alertDesc) {
        alertDesc.textContent = rounded > 1000
          ? "On laptops without dedicated GPS hardware, location is estimated using your ISP network gateway (which may resolve to another district such as Valenzuela). Enable Windows Location Services and connect to Wi-Fi for an accurate fix."
          : "Position is estimated using Wi-Fi / network beacons. For optimal accuracy, ensure Wi-Fi scanning and device location services are enabled.";
      }
    } else {
      alertSection.style.display = 'none';
    }
  }

  if (window.iconify) window.iconify();
  else if (window.lucide) window.lucide.createIcons();
}

/**
 * Smoothly fits viewport to encompass the user location and QCU campus
 */
function fitMapBounds(userCoords, force = false) {
  if (!map || !userCoords) return;
  if (!force && isUserPanning) return;

  const isMobile = window.innerWidth < 640;
  const padding = isMobile
    ? { top: 65, bottom: 45, left: 30, right: 30 }
    : { top: 80, bottom: 65, left: 65, right: 65 };

  const bounds = new maplibregl.LngLatBounds()
    .extend(userCoords)
    .extend(QCU_COORDS);

  map.fitBounds(bounds, {
    padding,
    maxZoom: 16,
    minZoom: 10,
    duration: force ? 800 : 1000
  });
}

/**
 * Manual Recenter function to refocus map on active tracking
 */
function recenterMap() {
  isUserPanning = false;
  if (lastCoords) {
    fitMapBounds(lastCoords, true);
    updateStatus("Map recentered", "active");
  } else {
    if (map) map.flyTo({ center: QCU_COORDS, zoom: 14, duration: 800 });
    updateStatus("Acquiring location…", "active");
  }
}

/**
 * Handle incoming position data from Geolocation API.
 * Rejects readings that are obviously stale, impossible, or inaccurate.
 */
function handlePositionUpdate(position, isFreshFix = false) {
  const { latitude, longitude, accuracy } = position.coords;
  const timestamp = position.timestamp || Date.now();

  // Basic sanity validation
  if (isNaN(latitude) || isNaN(longitude)) return;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;

  // Stale reading prevention (never go backwards in time)
  if (lastTimestamp && timestamp < lastTimestamp) return;

  const currentCoords = [longitude, latitude]; // MapLibre takes [Lon, Lat]
  const prevAccuracy = lastAccuracy;

  // ── GPS accuracy quality gate ──
  // Reject very poor readings on first fix (> 2 km) — almost certainly ISP gateway
  if (!hasFirstFix && accuracy > 2000) {
    updateStatus("Location imprecise — waiting for a better GPS fix…", "active");
    return;
  }

  lastAccuracy = accuracy;
  lastTimestamp = timestamp;
  updateAccuracyDisplay(accuracy);

  // Warn on degraded accuracy (jump detection)
  if (prevAccuracy !== null && prevAccuracy < 100 && accuracy > prevAccuracy * 2) {
    updateStatus(`GPS accuracy dropped (±${Math.round(accuracy)}m) — recalculating…`, "error");
  } else if (accuracy > 200) {
    updateStatus(`Location coarse (±${Math.round(accuracy)}m) — estimates may differ`, "error");
  }

  // On first valid fix, add user marker to map and fit camera
  if (!hasFirstFix) {
    hasFirstFix = true;
    userMarker.setLngLat(currentCoords).addTo(map);
    fitMapBounds(currentCoords, true);
  } else {
    userMarker.setLngLat(currentCoords);
  }

  // Update GeoJSON Accuracy Circle Polygon on map
  if (map && map.getSource('accuracy-source')) {
    const circleGeoJSON = createGeoJSONCircle(currentCoords, accuracy);
    map.getSource('accuracy-source').setData({
      type: 'Feature',
      properties: {},
      geometry: circleGeoJSON
    });
  }

  // Check if user has moved enough to warrant route recalculation
  const distanceMoved = lastCoords
    ? getDistanceFromLatLonInMeters(lastCoords[1], lastCoords[0], latitude, longitude)
    : Infinity;

  lastCoords = currentCoords;

  // Persist the fix so other pages (Home weather + flood advisory) can center
  // on the user's real location instead of the hardcoded campus coordinate.
  // Reuses the permission already granted here — no second prompt on Home.
  try {
    localStorage.setItem("qcu:user-location", JSON.stringify({
      lat: latitude, lon: longitude, accuracy: accuracy, t: timestamp
    }));
  } catch (e) { /* storage unavailable — non-fatal */ }

  if (isFreshFix || distanceMoved > ROUTE_DEBOUNCE_METERS) {
    fetchRoute(currentCoords, isFreshFix);
  } else {
    updateStatus("Location updated", "success");
  }
}

/**
 * Handle Geolocation Errors
 */
function handlePositionError(error) {
  console.warn("Geolocation error:", error);

  if (error.code === 1) {
    // Permission denied — stop watching to avoid repeated prompts, and guide the user.
    stopTracking();
    updateStatus("Location access denied — allow location, then tap “Locate Me”", "error");
    const el = document.getElementById('eta-updated');
    if (el) el.textContent = 'Enable location in your browser/site settings, then retry.';
    return;
  }

  let message = "GPS signal error";
  if (error.code === 2) message = "Location unavailable — check GPS/network";
  else if (error.code === 3) message = "Location fix timed out — retrying…";
  updateStatus(message, "error");
}

/**
 * Force a fresh location acquisition (no cache)
 */
function reacquireLocation() {
  if (!navigator.geolocation) {
    updateStatus("Geolocation unsupported", "error");
    return;
  }

  updateStatus("Reacquiring fresh location…", "active");
  isUserPanning = false;

  stopTracking();

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      handlePositionUpdate(pos, true);
      startTracking();
    },
    (err) => {
      handlePositionError(err);
      startTracking();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,       // Force fresh location query
      timeout: 15000
    }
  );
}

/**
 * Start continuous Geolocation tracking using watchPosition
 */
function startTracking() {
  if (!navigator.geolocation) {
    updateStatus("Geolocation unsupported", "error");
    return;
  }

  if (watchId !== null) return;

  updateStatus("Acquiring device location…", "active");

  const geoOptions = {
    enableHighAccuracy: true,
    maximumAge: 0,       // Never use stale cached coordinates
    timeout: 12000       // 12-second timeout per reading
  };

  watchId = navigator.geolocation.watchPosition(
    (pos) => handlePositionUpdate(pos, false),
    (err) => handlePositionError(err),
    geoOptions
  );

  // Background refresh so live traffic stays current even while stationary.
  // Reasonable cadence (not per-second); force=true bypasses the move throttle.
  if (refreshTimer === null) {
    refreshTimer = setInterval(() => {
      if (isTracking && lastCoords) fetchRoute(lastCoords, true);
    }, ETA_TUNING.periodicRefreshMs);
  }
}

/**
 * Stop Geolocation watch
 */
function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Classify real traffic level from the ratio of traffic-aware to free-flow time.
 * Canonical states: CLEAR / NORMAL / MODERATE / HEAVY / SEVERE.
 * Only ever called with genuine TomTom durations — never a heuristic.
 * @param {number} staticMinutes  - free-flow travel time (traffic=false)
 * @param {number} trafficMinutes - traffic-aware travel time (traffic=true)
 * @returns {object} { label, level, delayMinutes }
 */
function classifyTraffic(staticMinutes, trafficMinutes) {
  const delayMinutes = Math.max(0, trafficMinutes - staticMinutes);
  const delayRatio = staticMinutes > 0 ? trafficMinutes / staticMinutes : 1;

  let label, level;
  if (delayRatio <= 1.05) {
    label = 'CLEAR';
    level = 'clear';
  } else if (delayRatio <= 1.2) {
    label = 'NORMAL';
    level = 'normal';
  } else if (delayRatio <= 1.5) {
    label = 'MODERATE';
    level = 'moderate';
  } else if (delayRatio <= 2.0) {
    label = 'HEAVY';
    level = 'heavy';
  } else {
    label = 'SEVERE';
    level = 'severe';
  }

  return { label, level, delayMinutes };
}

/**
 * Build TomTom routing URL with traffic
 */
async function fetchRoute(userCoords, force = false) {
  const now = Date.now();
  if (!force && (now - lastRouteTime < ROUTE_THROTTLE_MS)) return;
  updateStatus("Calculating route with live traffic...", "active");
  try {
    const url = ROUTE_API + "?lat=" + encodeURIComponent(userCoords[1]) + "&lon=" + encodeURIComponent(userCoords[0]);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Route proxy HTTP " + res.status);
    const data = await res.json();
    if (!data || data.status !== "OK" || !Array.isArray(data.geometry)) throw new Error("Invalid route response");
    lastRouteTime = Date.now();
    if (map && map.getSource("route")) map.getSource("route").setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: data.geometry } });
    if (!isUserPanning) fitMapBounds(userCoords, false);
    const staticMins = Number(data.normalMins);
    const trafficMins = Number(data.currentMins);
    renderRoute({ normalMins: staticMins, currentMins: trafficMins, km: data.distanceKm, trafficInfo: classifyTraffic(staticMins, trafficMins), hasLiveTraffic: true, trafficRoute: null });
    updateStatus("GPS tracking active - live traffic", "success");
  } catch (err) {
    console.warn("Route proxy unavailable, falling back to OSRM:", err);
    fetchRouteOSRM(userCoords, force);
  }
}
/**
 * Fallback to OSRM if TomTom is unavailable
 */
async function fetchRouteOSRM(userCoords, force = false) {
  const now = Date.now();
  if (!force && (now - lastRouteTime < ROUTE_THROTTLE_MS)) {
    return;
  }

  updateStatus("Calculating road route (fallback)…", "active");

  const url = `https://router.project-osrm.org/route/v1/driving/${userCoords[0]},${userCoords[1]};${QCU_COORDS[0]},${QCU_COORDS[1]}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM API error (${res.status})`);
    const data = await res.json();

    if (data.routes && data.routes.length > 0) {
      lastRouteTime = Date.now();
      const route = data.routes[0];

      if (map && map.getSource('route')) {
        map.getSource('route').setData({
          type: 'Feature',
          properties: {},
          geometry: route.geometry
        });
      }

      if (!isUserPanning) {
        fitMapBounds(userCoords, false);
      }

      const baseMins = Math.max(1, Math.ceil(route.duration / 60));
      const km = (route.distance / 1000).toFixed(1);

      // OSRM demo server has NO live-traffic feed. We report the base road
      // estimate honestly and mark traffic UNAVAILABLE — we never invent a
      // delay multiplier and present it as real traffic.
      renderRoute({
        normalMins: baseMins,
        currentMins: baseMins,
        km,
        trafficInfo: null,
        hasLiveTraffic: false,
        trafficRoute: null
      });
      updateStatus("Routing active — traffic data unavailable", "active");
    } else {
      throw new Error("No driving route found");
    }
  } catch (err) {
    console.warn("OSRM routing unavailable, using straight-line fallback:", err);
    fallbackETA(userCoords);
  }
}

/**
 * Fallback straight-line estimation if both TomTom and OSRM are offline.
 * Reports an approximate distance-based ETA with traffic UNAVAILABLE.
 */
function fallbackETA(userCoords) {
  if (map && map.getSource('route')) {
    map.getSource('route').setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [userCoords, QCU_COORDS]
      }
    });
  }

  const distMeters = getDistanceFromLatLonInMeters(userCoords[1], userCoords[0], QCU_COORDS[1], QCU_COORDS[0]);
  const km = (distMeters / 1000).toFixed(1);
  const avgTransitSpeedKmh = 35;
  const baseMins = Math.max(1, Math.ceil((distMeters / 1000 / avgTransitSpeedKmh) * 60));

  // Straight-line only — no road network, no traffic. Clearly approximate.
  renderRoute({
    normalMins: baseMins,
    currentMins: baseMins,
    km,
    trafficInfo: null,
    hasLiveTraffic: false,
    approx: true,
    trafficRoute: null
  });
  updateStatus("Routing limited — approximate distance only", "error");

  if (!isUserPanning) {
    fitMapBounds(userCoords, false);
  }
}

/**
 * Calculate and display clock-time of estimated arrival
 */
function updateArrivalTime(durationMins) {
  const el = document.getElementById('eta-class-arrival');
  if (!el) return;

  const arrivalDate = new Date(Date.now() + durationMins * 60000);
  const arrivalStr = arrivalDate.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  el.textContent = `Est. arrival: ${arrivalStr}`;
}

/**
 * Single source of truth for rendering a computed route into the UI.
 * Accepts a normalized route object so every routing source (TomTom / OSRM /
 * straight-line) renders identically and honestly.
 * @param {object} r
 *   normalMins {number}  free-flow / base travel time
 *   currentMins {number} traffic-aware time (== normalMins when no live traffic)
 *   km {string}          distance
 *   trafficInfo {object|null} { label, level, delayMinutes } — only when real
 *   hasLiveTraffic {boolean}  true only for measured TomTom traffic
 *   approx {boolean}     true for straight-line estimate (prefix "~")
 */
function renderRoute(r) {
  const { normalMins, currentMins, km, trafficInfo, hasLiveTraffic, approx } = r;
  const prefix = approx ? '~' : '';

  lastETAMinutes = currentMins;
  lastUpdatedAt = new Date();
  lastRouteData = r;

  const staticEl = document.getElementById('eta-val-static');
  if (staticEl) staticEl.textContent = `${prefix}${normalMins} min`;

  const timeEl = document.getElementById('eta-val-time');
  if (timeEl) timeEl.textContent = `${prefix}${currentMins} min`;

  const distEl = document.getElementById('eta-val-dist');
  if (distEl) distEl.textContent = `${km} km`;

  // TRAFFIC — real state, or explicit "Unavailable"; never a fabricated "Live"
  renderTrafficBox(hasLiveTraffic, trafficInfo);

  updateArrivalTime(currentMins);
  updateClassStatus(currentMins, trafficInfo, hasLiveTraffic);
  renderUpdatedTime();

  if (window.lucide) window.lucide.createIcons();
}

/**
 * Render the Traffic stat box. Color lives ONLY on the small indicator dot —
 * the box background/text stay neutral (institutional restraint).
 */
function renderTrafficBox(hasLiveTraffic, trafficInfo) {
  const el = document.getElementById('eta-val-status');
  if (!el) return;

  el.classList.remove(
    'traffic-clear', 'traffic-normal', 'traffic-moderate',
    'traffic-heavy', 'traffic-severe', 'traffic-unavailable'
  );

  if (!hasLiveTraffic || !trafficInfo) {
    el.classList.add('traffic-unavailable');
    el.innerHTML = '<span class="traffic-ind"></span><span class="traffic-label">Unavailable</span>';
    return;
  }

  el.classList.add(`traffic-${trafficInfo.level}`);
  const delay = trafficInfo.delayMinutes || 0;
  const delayLine = delay > 0
    ? `<span class="traffic-delay">+${delay} min delay</span>`
    : '<span class="traffic-delay">No delay</span>';
  el.innerHTML =
    `<span class="traffic-ind"></span>` +
    `<span class="traffic-label">${trafficInfo.label}</span>${delayLine}`;
}

/**
 * Render the "Updated H:MM · source" line so the freshness of the estimate
 * is always visible (no silent stale data).
 */
function renderUpdatedTime() {
  const el = document.getElementById('eta-updated');
  if (!el || !lastUpdatedAt) return;
  const t = lastUpdatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  let src = 'No live traffic';
  if (lastRouteData && lastRouteData.hasLiveTraffic) src = 'Live traffic';
  else if (lastRouteData && lastRouteData.approx) src = 'Approximate';
  el.textContent = `Updated ${t} · ${src}`;
}

/**
 * Compare final ETA with next scheduled class and update the class status panel.
 * When the next class is on a different day, show info without the on-time comparison.
 * @param {number} etaMinutes - ETA in minutes from now (traffic-aware when available)
 * @param {object|null} traffic - { label, level, delayMinutes } when live traffic exists
 * @param {boolean} hasLiveTraffic - whether `traffic` reflects measured live conditions
 */
function updateClassStatus(etaMinutes, traffic, hasLiveTraffic) {
  const banner = document.getElementById('eta-class-banner');
  const noclass = document.getElementById('eta-noclass-banner');
  if (!banner || !noclass) return;

  const now = new Date();
  const nextClass = getNextClass(now);

  // No class scheduled → show no-class banner, hide class banner
  if (!nextClass) {
    banner.style.display = 'none';
    noclass.style.display = 'flex';
    document.getElementById('eta-noclass-text').textContent =
      now.getDay() === 0 || now.getDay() === 6
        ? 'No classes on weekends. Enjoy your day off!'
        : 'No more classes scheduled for today.';
    return;
  }

  noclass.style.display = 'none';
  banner.style.display = 'block';

  // Populate class info in new panel structure
  const dayName = DAY_MAP[now.getDay()];
  const isClassToday = nextClass.day === dayName;
  const arrivalMinutes = now.getHours() * 60 + now.getMinutes() + etaMinutes;
  const arrivalTime = new Date(Date.now() + etaMinutes * 60000);
  const arrivalTimeStr = arrivalTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

  document.getElementById('eta-class-day').textContent = isClassToday ? dayName.toUpperCase() : nextClass.day.toUpperCase();
  document.getElementById('eta-class-course').textContent = nextClass.course || '—';
  document.getElementById('eta-class-subject').textContent = nextClass.subject || '—';
  document.getElementById('eta-class-schedule').textContent = `${formatTime12(nextClass.start)} – ${formatTime12(nextClass.end)}`;
  document.getElementById('eta-class-location').textContent = `${nextClass.room || '—'} · ${nextClass.building || '—'}`;
  document.getElementById('eta-class-arrival').textContent = `Est. arrival: ${arrivalTimeStr}`;

  // Traffic source note — honest about whether traffic is live or unavailable
  const trafficEl = document.getElementById('eta-class-traffic');
  if (trafficEl) {
    if (hasLiveTraffic && traffic) {
      const delay = traffic.delayMinutes || 0;
      const delayText = delay > 0
        ? `<span class="traffic-source">+${delay} min delay · via Quirino Highway</span>`
        : `<span class="traffic-source">No delay · via Quirino Highway</span>`;
      trafficEl.innerHTML = `${traffic.label} · Live traffic<br>${delayText}`;
    } else {
      trafficEl.innerHTML = `Traffic data unavailable<br><span class="traffic-source">Estimate via Quirino Highway</span>`;
    }
    if (window.lucide) window.lucide.createIcons();
  }

  // On-time status comparison
  const dot = document.getElementById('eta-class-dot');
  const verdict = document.getElementById('eta-class-verdict');
  const margin = document.getElementById('eta-class-margin');
  const statusBox = document.getElementById('eta-class-status-box');

  // Clear previous verdict state (4 possible tones)
  statusBox.classList.remove('eta-status-ok', 'eta-status-tight', 'eta-status-risk', 'eta-status-late');

  if (isClassToday) {
    const classStartMinutes = timeToMinutes(nextClass.start);
    const diffMinutes = classStartMinutes - arrivalMinutes; // margin before class start

    if (diffMinutes >= ETA_TUNING.onTimeBufferMin) {
      // Comfortable margin
      statusBox.classList.add('eta-status-ok');
      dot.innerHTML = '<i data-lucide="check-circle-2" style="width:14px;height:14px;"></i>';
      verdict.textContent = 'ON TIME';
      margin.textContent = `${diffMinutes} min before class`;
    } else if (diffMinutes >= ETA_TUNING.tightBufferMin) {
      // Tight but should make it
      statusBox.classList.add('eta-status-tight');
      dot.innerHTML = '<i data-lucide="alert-triangle" style="width:14px;height:14px;"></i>';
      verdict.textContent = 'TIGHT';
      margin.textContent = `${diffMinutes} min buffer`;
    } else if (diffMinutes >= 0) {
      // Barely on time — any delay means late
      statusBox.classList.add('eta-status-risk');
      dot.innerHTML = '<i data-lucide="alert-circle" style="width:14px;height:14px;"></i>';
      verdict.textContent = 'AT RISK';
      margin.textContent = `Only ${diffMinutes} min to spare`;
    } else {
      // ETA is after class start
      statusBox.classList.add('eta-status-late');
      dot.innerHTML = '<i data-lucide="x-circle" style="width:14px;height:14px;"></i>';
      verdict.textContent = 'LATE';
      margin.textContent = `${Math.abs(diffMinutes)} min after start`;
    }
  } else {
    // Class is on a different day — show info without comparing ETAs
    statusBox.classList.add('eta-status-ok');
    dot.innerHTML = '<i data-lucide="calendar" style="width:14px;height:14px;"></i>';
    verdict.textContent = 'NEXT CLASS';
    margin.textContent = `First class at ${formatTime12(nextClass.start)}`;
  }
  if (window.lucide) window.lucide.createIcons();
}

/**
 * Convert 24h HH:MM to 12h readable format (e.g., "7:30 AM")
 */
function formatTime12(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return m === 0 ? `${hour12} ${period}` : `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Haversine formula to compute great-circle distance between two points in meters
 */
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
