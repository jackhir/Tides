const NOAA_STATIONS_URL =
  "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";

const SANTA_MONICA = {
  name: "Santa Monica, CA",
  lat: 34.0195,
  lng: -118.4912
};

const fallbackStations = [
  { id: "9410840", name: "Santa Monica, CA", state: "CA", lat: 34.008, lng: -118.5 },
  { id: "9410660", name: "Los Angeles, CA", state: "CA", lat: 33.72, lng: -118.273 },
  { id: "9411340", name: "Port Hueneme, CA", state: "CA", lat: 34.147, lng: -119.195 },
  { id: "9410230", name: "La Jolla, CA", state: "CA", lat: 32.867, lng: -117.257 },
  { id: "9414290", name: "San Francisco, CA", state: "CA", lat: 37.806, lng: -122.465 }
];

const stationSelect = document.getElementById("stationSelect");
const stationSearch = document.getElementById("stationSearch");
const santaMonicaBtn = document.getElementById("santaMonicaBtn");
const stationCount = document.getElementById("stationCount");
const santaButtons = document.getElementById("santaButtons");
const dateInput = document.getElementById("dateInput");
const fetchBtn = document.getElementById("fetchBtn");
const statusEl = document.getElementById("status");
const nextTideLabel = document.getElementById("nextTideLabel");
const nextTideTime = document.getElementById("nextTideTime");
const highestTide = document.getElementById("highestTide");
const lowestTide = document.getElementById("lowestTide");
const eventsCount = document.getElementById("eventsCount");
const stationName = document.getElementById("stationName");
const timeline = document.getElementById("timeline");
const curve = document.getElementById("curve");
const forecast = document.getElementById("forecast");

let stations = [];
let stationMap = null;
const stationMarkers = new Map();

function initDateControl() {
  const todayUtc = new Date().toISOString().split("T")[0];
  dateInput.value = todayUtc;
}

function normalizeStation(raw) {
  const id = String(raw?.id ?? raw?.stationId ?? "").trim();
  const name = String(raw?.name ?? raw?.stationName ?? "").trim();
  const lat = Number(raw?.lat ?? raw?.latitude);
  const lng = Number(raw?.lng ?? raw?.lon ?? raw?.longitude);
  const state = String(raw?.state ?? "").trim();

  if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { id, name, state, lat, lng };
}

async function loadStations() {
  const response = await fetch(NOAA_STATIONS_URL, { mode: "cors" });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error("NOAA station metadata is unavailable right now.");
  }

  const rawList = payload?.stationList ?? payload?.stations ?? [];
  const unique = new Map();

  rawList
    .map((entry) => normalizeStation(entry))
    .filter(Boolean)
    .forEach((station) => {
      unique.set(station.id, station);
    });

  const loadedStations = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));

  if (!loadedStations.length) {
    throw new Error("No tide-prediction stations were returned by NOAA.");
  }

  return loadedStations;
}

function stationOptionLabel(station) {
  const region = station.state ? `, ${station.state}` : "";
  return `${station.name}${region} (${station.id})`;
}

function populateStationSelect(filterText = "") {
  const query = filterText.trim().toLowerCase();
  const previous = stationSelect.value;

  let filtered = stations;
  if (query) {
    filtered = stations.filter((station) => {
      const haystack = `${station.name} ${station.state} ${station.id}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  stationSelect.innerHTML = "";

  if (!filtered.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No stations match your search";
    stationSelect.appendChild(option);
    stationSelect.disabled = true;
    return;
  }

  stationSelect.disabled = false;

  const fragment = document.createDocumentFragment();
  filtered.forEach((station) => {
    const option = document.createElement("option");
    option.value = station.id;
    option.textContent = stationOptionLabel(station);
    fragment.appendChild(option);
  });

  stationSelect.appendChild(fragment);

  if (filtered.some((station) => station.id === previous)) {
    stationSelect.value = previous;
  }
}

function updateStationCountMessage() {
  stationCount.textContent = `Loaded ${stations.length.toLocaleString()} NOAA tide stations.`;
}

function initMap() {
  if (!window.L) {
    return;
  }

  stationMap = L.map("stationMap", {
    worldCopyJump: true,
    minZoom: 2
  }).setView([34.5, -97], 3);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(stationMap);

  setTimeout(() => stationMap.invalidateSize(), 120);
}

function markerStyle(active) {
  return {
    radius: active ? 7 : 4,
    color: active ? "#ffd67f" : "#9fdfff",
    weight: active ? 2 : 1,
    fillColor: active ? "#ff9b7f" : "#1cb9e3",
    fillOpacity: active ? 0.95 : 0.74
  };
}

function renderStationMarkers() {
  if (!stationMap) {
    return;
  }

  stationMarkers.forEach((marker) => marker.remove());
  stationMarkers.clear();

  stations.forEach((station) => {
    const marker = L.circleMarker([station.lat, station.lng], markerStyle(false)).addTo(stationMap);

    marker.bindPopup(
      `<strong>${escapeHtml(station.name)}</strong><br />NOAA Station ${escapeHtml(station.id)}`
    );

    marker.on("click", () => {
      if (stationSearch.value) {
        stationSearch.value = "";
        populateStationSelect();
      }

      if (stationSelect.value !== station.id) {
        stationSelect.value = station.id;
      }

      stationSelect.dispatchEvent(new Event("change"));
    });

    stationMarkers.set(station.id, marker);
  });
}

function syncMapSelection(stationId, pan = true) {
  if (!stationMap || !stationMarkers.size) {
    return;
  }

  stationMarkers.forEach((marker, id) => {
    marker.setStyle(markerStyle(id === stationId));
  });

  if (!pan) {
    return;
  }

  const station = stations.find((entry) => entry.id === stationId);
  if (!station) {
    return;
  }

  stationMap.flyTo([station.lat, station.lng], Math.max(stationMap.getZoom(), 6), {
    duration: 0.6
  });
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371;
  const toRad = (value) => (value * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestStations(lat, lng, count = 8, maxKm = 160) {
  const sorted = stations
    .map((station) => ({
      ...station,
      distanceKm: haversineKm(lat, lng, station.lat, station.lng)
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const nearby = sorted.filter((station) => station.distanceKm <= maxKm).slice(0, count);
  return nearby.length ? nearby : sorted.slice(0, count);
}

function renderSantaMonicaButtons() {
  santaButtons.innerHTML = "";

  const nearby = nearestStations(SANTA_MONICA.lat, SANTA_MONICA.lng, 9, 180);
  nearby.forEach((station) => {
    const button = document.createElement("button");
    button.type = "button";

    const miles = station.distanceKm * 0.621371;
    button.textContent = `${station.name} (${miles.toFixed(1)} mi)`;

    button.addEventListener("click", () => {
      if (stationSearch.value) {
        stationSearch.value = "";
        populateStationSelect();
      }

      stationSelect.value = station.id;
      stationSelect.dispatchEvent(new Event("change"));
    });

    santaButtons.appendChild(button);
  });
}

function selectInitialStation() {
  const santaMonicaMatch =
    stations.find((station) => station.id === "9410840") ||
    stations.find((station) => station.name.toLowerCase().includes("santa monica"));

  const initial = santaMonicaMatch || nearestStations(SANTA_MONICA.lat, SANTA_MONICA.lng, 1)[0];

  if (!initial) {
    return;
  }

  stationSelect.value = initial.id;
  syncMapSelection(initial.id, true);
}

function formatDateYmd(dateStr) {
  return dateStr.replaceAll("-", "");
}

function addDaysYmd(ymd, days) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

function classify(type) {
  return type === "H" ? "High" : "Low";
}

function toIsoUtc(noaaDateTime) {
  return `${noaaDateTime.replace(" ", "T")}:00Z`;
}

function stationLabelById(id) {
  return stations.find((station) => station.id === id)?.name ?? id;
}

function toLocalPretty(noaaDateTime) {
  return new Date(toIsoUtc(noaaDateTime)).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

function toFriendlyDay(ymd) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function clearStatus() {
  statusEl.textContent = "";
  statusEl.className = "status";
}

function setStatus(message, variant = "") {
  statusEl.textContent = message;
  statusEl.className = variant ? `status ${variant}` : "status";
}

function setLoading(isLoading) {
  fetchBtn.disabled = isLoading || !stations.length;
  fetchBtn.textContent = isLoading ? "Loading..." : "Ride the Tide";
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function fetchTides() {
  const stationId = stationSelect.value;
  const pickedDate = dateInput.value;

  if (!stationId) {
    setStatus("Choose a station first.", "error");
    return;
  }

  if (!pickedDate) {
    setStatus("Please choose a date.", "error");
    return;
  }

  clearStatus();
  setStatus("Fetching a 5-day tide window from NOAA...");
  setLoading(true);

  const beginDate = formatDateYmd(pickedDate);
  const endDate = formatDateYmd(addDaysYmd(pickedDate, 4));
  const url = new URL("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter");
  url.searchParams.set("product", "predictions");
  url.searchParams.set("application", "tide_pop_app");
  url.searchParams.set("begin_date", beginDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("datum", "MLLW");
  url.searchParams.set("station", stationId);
  url.searchParams.set("time_zone", "gmt");
  url.searchParams.set("interval", "hilo");
  url.searchParams.set("units", "english");
  url.searchParams.set("format", "json");

  try {
    const response = await fetch(url, { mode: "cors" });
    const payload = await response.json();

    if (!response.ok || payload.error) {
      const msg = payload?.error?.message || "Failed to fetch predictions.";
      throw new Error(msg);
    }

    const events = (payload.predictions || [])
      .map((item) => ({
        datetime: item.t,
        height: Number(item.v),
        type: item.type,
        dayKey: item.t.slice(0, 10)
      }))
      .filter((item) => Number.isFinite(item.height));

    if (!events.length) {
      throw new Error("No tide events were returned for this station in the selected range.");
    }

    render(events, stationId, pickedDate);
    setStatus("Fresh 5-day tides loaded.", "ok");
  } catch (error) {
    setStatus(`Could not load tides: ${error.message}`, "error");
    renderEmpty();
  } finally {
    setLoading(false);
  }
}

function render(events, stationId, pickedDate) {
  const focusDayEvents = events.filter((event) => event.dayKey === pickedDate);
  const activeEvents = focusDayEvents.length ? focusDayEvents : events;

  stationName.textContent = stationLabelById(stationId);
  eventsCount.textContent = String(activeEvents.length);

  const highest = activeEvents.reduce((a, b) => (a.height > b.height ? a : b));
  const lowest = activeEvents.reduce((a, b) => (a.height < b.height ? a : b));

  highestTide.textContent = `${highest.height.toFixed(2)} ft`;
  lowestTide.textContent = `${lowest.height.toFixed(2)} ft`;

  const todayUtc = new Date().toISOString().split("T")[0];
  const upcoming =
    pickedDate === todayUtc
      ? events.find((event) => new Date(toIsoUtc(event.datetime)) > new Date()) || activeEvents[0]
      : activeEvents[0];

  if (upcoming) {
    nextTideLabel.textContent = classify(upcoming.type);
    nextTideTime.textContent = `${toLocalPretty(upcoming.datetime)} at ${upcoming.height.toFixed(
      2
    )} ft`;
  } else {
    nextTideLabel.textContent = "-";
    nextTideTime.textContent = "No upcoming tides in this range.";
  }

  renderTimeline(activeEvents);
  renderCurve(activeEvents);
  renderForecast(events, pickedDate);
}

function renderTimeline(events) {
  timeline.innerHTML = "";

  if (!events.length) {
    timeline.innerHTML = '<p class="small">No tide events available for this day.</p>';
    return;
  }

  events.forEach((event, index) => {
    const item = document.createElement("div");
    item.className = "tide-item";
    item.style.animationDelay = `${index * 60}ms`;
    const typeClass = event.type === "H" ? "high" : "low";

    item.innerHTML = `
      <span class="dot ${typeClass}" aria-hidden="true"></span>
      <div>
        <div class="tide-type">${classify(event.type)} Tide</div>
        <div class="tide-meta">${toLocalPretty(event.datetime)}</div>
      </div>
      <div class="tide-type">${event.height.toFixed(2)} ft</div>
    `;

    timeline.appendChild(item);
  });
}

function renderCurve(events) {
  curve.innerHTML = "";

  if (!events.length) {
    curve.innerHTML = '<p class="small">No values to chart.</p>';
    return;
  }

  const heights = events.map((event) => event.height);
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const span = Math.max(max - min, 0.2);

  events.forEach((event, index) => {
    const bar = document.createElement("div");
    bar.className = "curve-bar";

    const px = 10 + ((event.height - min) / span) * 150;
    bar.style.height = `${Math.round(px)}px`;
    bar.style.animationDelay = `${index * 80}ms`;
    bar.title = `${classify(event.type)} ${event.height.toFixed(2)} ft`;

    curve.appendChild(bar);
  });
}

function renderForecast(events, pickedDate) {
  forecast.innerHTML = "";

  for (let i = 0; i < 5; i += 1) {
    const day = addDaysYmd(pickedDate, i);
    const dayEvents = events.filter((event) => event.dayKey === day);

    const card = document.createElement("article");
    card.className = "forecast-card";
    card.style.animationDelay = `${i * 70}ms`;

    if (!dayEvents.length) {
      card.innerHTML = `
        <p class="forecast-date">${toFriendlyDay(day)}</p>
        <p class="forecast-range">No prediction data</p>
        <p class="forecast-count">0 Events</p>
      `;
      forecast.appendChild(card);
      continue;
    }

    const high = dayEvents.reduce((a, b) => (a.height > b.height ? a : b));
    const low = dayEvents.reduce((a, b) => (a.height < b.height ? a : b));

    card.innerHTML = `
      <p class="forecast-date">${toFriendlyDay(day)}</p>
      <p class="forecast-range">High <strong>${high.height.toFixed(2)} ft</strong></p>
      <p class="forecast-range">Low <strong>${low.height.toFixed(2)} ft</strong></p>
      <p class="forecast-count">${dayEvents.length} Events</p>
    `;

    forecast.appendChild(card);
  }
}

function renderEmpty() {
  nextTideLabel.textContent = "-";
  nextTideTime.textContent = "No data loaded.";
  highestTide.textContent = "-";
  lowestTide.textContent = "-";
  eventsCount.textContent = "-";
  stationName.textContent = "-";
  timeline.innerHTML = "";
  curve.innerHTML = "";
  forecast.innerHTML = "";
}

function initEventHandlers() {
  fetchBtn.addEventListener("click", fetchTides);

  stationSelect.addEventListener("change", () => {
    syncMapSelection(stationSelect.value);
    fetchTides();
  });

  dateInput.addEventListener("change", fetchTides);

  stationSearch.addEventListener("input", () => {
    populateStationSelect(stationSearch.value);
  });

  stationSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    if (!stationSelect.value) {
      return;
    }

    syncMapSelection(stationSelect.value);
    fetchTides();
  });

  santaMonicaBtn.addEventListener("click", () => {
    const nearest = nearestStations(SANTA_MONICA.lat, SANTA_MONICA.lng, 1)[0];
    if (!nearest) {
      return;
    }

    if (stationSearch.value) {
      stationSearch.value = "";
      populateStationSelect();
    }

    stationSelect.value = nearest.id;
    stationSelect.dispatchEvent(new Event("change"));
    setStatus(`Centered on tide stations near ${SANTA_MONICA.name}.`, "ok");
  });
}

async function bootstrap() {
  initDateControl();
  initMap();
  initEventHandlers();

  setStatus("Loading NOAA tide station locations...");

  try {
    stations = await loadStations();
    updateStationCountMessage();
  } catch (error) {
    stations = fallbackStations;
    stationCount.textContent =
      "Using fallback stations right now (NOAA metadata feed unavailable in this browser session).";
    setStatus(`Station catalog warning: ${error.message}`, "error");
  }

  populateStationSelect();
  renderStationMarkers();
  renderSantaMonicaButtons();
  selectInitialStation();
  fetchTides();
}

bootstrap();
