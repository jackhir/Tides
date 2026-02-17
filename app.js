const stations = [
  { id: "9414290", name: "San Francisco, CA", lat: 37.806, lng: -122.465 },
  { id: "9447130", name: "Seattle, WA", lat: 47.602, lng: -122.339 },
  { id: "8418150", name: "Portland, ME", lat: 43.656, lng: -70.246 },
  { id: "8443970", name: "Boston, MA", lat: 42.353, lng: -71.05 },
  { id: "8638610", name: "Sewells Point, VA", lat: 36.946, lng: -76.33 },
  { id: "8724580", name: "Key West, FL", lat: 24.555, lng: -81.808 },
  { id: "8771450", name: "Galveston, TX", lat: 29.31, lng: -94.793 },
  { id: "1612340", name: "Honolulu, HI", lat: 21.306, lng: -157.867 },
  { id: "9461380", name: "Nikiski, AK", lat: 60.68, lng: -151.398 }
];

const stationSelect = document.getElementById("stationSelect");
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

let stationMap = null;
const stationMarkers = new Map();

function initControls() {
  stations.forEach((station) => {
    const option = document.createElement("option");
    option.value = station.id;
    option.textContent = station.name;
    stationSelect.appendChild(option);
  });

  const todayUtc = new Date().toISOString().split("T")[0];
  dateInput.value = todayUtc;
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

  stations.forEach((station) => {
    const marker = L.marker([station.lat, station.lng], {
      icon: stationPin(false)
    }).addTo(stationMap);

    marker.bindPopup(`<strong>${station.name}</strong><br />Station ${station.id}`);

    marker.on("click", () => {
      if (stationSelect.value !== station.id) {
        stationSelect.value = station.id;
      }
      stationSelect.dispatchEvent(new Event("change"));
    });

    stationMarkers.set(station.id, marker);
  });

  syncMapSelection(stationSelect.value, false);
  setTimeout(() => stationMap.invalidateSize(), 120);
}

function stationPin(active) {
  return L.divIcon({
    html: `<span class="station-pin${active ? " active" : ""}"></span>`,
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
}

function syncMapSelection(stationId, pan = true) {
  if (!stationMap || !stationMarkers.size) {
    return;
  }

  stationMarkers.forEach((marker, id) => {
    marker.setIcon(stationPin(id === stationId));
  });

  if (!pan) {
    return;
  }

  const station = stations.find((entry) => entry.id === stationId);
  if (!station) {
    return;
  }

  stationMap.flyTo([station.lat, station.lng], Math.max(stationMap.getZoom(), 4), {
    duration: 0.6
  });
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
  fetchBtn.disabled = isLoading;
  fetchBtn.textContent = isLoading ? "Loading..." : "Ride the Tide";
}

async function fetchTides() {
  const stationId = stationSelect.value;
  const pickedDate = dateInput.value;

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

fetchBtn.addEventListener("click", fetchTides);
stationSelect.addEventListener("change", () => {
  syncMapSelection(stationSelect.value);
  fetchTides();
});
dateInput.addEventListener("change", fetchTides);

initControls();
initMap();
fetchTides();
