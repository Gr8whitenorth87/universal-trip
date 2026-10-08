// Park map: OpenStreetMap tiles, live-wait markers, food and hunt pins, and a GPS dot.
/* global L */

let map, layers, userMarker, userCircle, onPick, getWaitInfo;
let built = false;

export function initMap(el, { onSelect, waitInfo }) {
  onPick = onSelect;
  getWaitInfo = waitInfo;
  map = L.map(el, { zoomControl: false, attributionControl: true, tap: true }).setView([28.4745, -81.4685], 16);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20, maxNativeZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  // Below street level, only beaches and piers keep their labels so pins stay readable.
  const labels = () => el.classList.toggle("labels-few", map.getZoom() < 17);
  map.on("zoomend", labels);
  labels();
  layers = { rides: L.layerGroup().addTo(map), food: L.layerGroup(), hunts: L.layerGroup(), shows: L.layerGroup().addTo(map), places: L.layerGroup().addTo(map) };
  built = true;
  return map;
}

export function mapReady() { return built; }
export function invalidate() { if (map) setTimeout(() => map.invalidateSize(), 50); }

export function showLayer(name, on) {
  if (!map) return;
  if (on) layers[name].addTo(map); else map.removeLayer(layers[name]);
}

export function fitPark(points, labelled = false) {
  if (!map || !points.length) return;
  const b = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
  if (labelled) map.fitBounds(b, { paddingTopLeft: [24, 90], paddingBottomRight: [150, 40], maxZoom: 17 });
  else map.fitBounds(b.pad(0.08), { maxZoom: 18 });
}

export function flyTo(lat, lng, zoom = 18) { if (map) map.flyTo([lat, lng], zoom, { duration: 0.6 }); }

// Cruise ports: one pin per spot, labelled, colored by type.
export function drawPlaces(places) {
  if (!map) return;
  for (const g of Object.values(layers)) g.clearLayers();
  for (const p of places) {
    if (p.lat == null) continue;
    const m = L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        className: "pin-wrap",
        html: `<div class="place-pin place-${p.type}"><i></i><span>${p.name.replace(/[<>&]/g, "")}</span></div>`,
        iconSize: [18, 18], iconAnchor: [9, 9],
      }),
      title: p.name, keyboard: true, zIndexOffset: p.type === "pier" ? 800 : p.type === "beach" ? 400 : 0,
    });
    m.on("click", () => onPick({ type: "place", item: p }));
    layers.places.addLayer(m);
  }
}

export function drawMarkers({ rides, food, hunts, shows }) {
  if (!map) return;
  for (const g of Object.values(layers)) g.clearLayers();
  for (const r of rides) {
    if (r.lat == null) continue;
    const info = getWaitInfo(r);
    const m = L.marker([r.lat, r.lng], {
      icon: L.divIcon({
        className: "pin-wrap",
        html: `<div class="pin pin-${info.tone}${r.done ? " pin-done" : ""}"><b>${info.short}</b></div>`,
        iconSize: [44, 30], iconAnchor: [22, 15],
      }),
      title: r.name, keyboard: true, riseOnHover: true,
    });
    m.on("click", () => onPick({ type: "ride", item: r }));
    layers.rides.addLayer(m);
  }
  for (const s of shows) {
    if (s.lat == null) continue;
    const m = L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: "pin-wrap", html: '<div class="dot dot-show" aria-hidden="true"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      title: s.name,
    });
    m.on("click", () => onPick({ type: "ride", item: s }));
    layers.shows.addLayer(m);
  }
  const seen = new Set();
  for (const f of food) {
    if (f.lat == null) continue;
    const k = `${f.location}|${f.lat}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const m = L.marker([f.lat, f.lng], {
      icon: L.divIcon({ className: "pin-wrap", html: `<div class="dot dot-food${f.category === "butterbeer" ? " dot-bb" : ""}" aria-hidden="true"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }),
      title: f.location,
    });
    m.on("click", () => onPick({ type: "food", item: f }));
    layers.food.addLayer(m);
  }
  const hseen = new Map();
  for (const h of hunts) {
    if (h.lat == null) continue;
    // hunts share a land center; fan them out a little so each can be tapped
    const k = `${h.lat},${h.lng}`;
    const n = hseen.get(k) || 0;
    hseen.set(k, n + 1);
    const ang = n * 2.399, rad = 0.00006 * Math.sqrt(n + 1);
    const lat = h.lat + Math.sin(ang) * rad, lng = h.lng + Math.cos(ang) * rad;
    const m = L.marker([lat, lng], {
      icon: L.divIcon({ className: "pin-wrap", html: `<div class="dot dot-hunt${h.found ? " dot-found" : ""}" aria-hidden="true"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] }),
      title: h.title,
    });
    m.on("click", () => onPick({ type: "hunt", item: h }));
    layers.hunts.addLayer(m);
  }
}

export function setUser(pos) {
  if (!map || !pos) return;
  const ll = [pos.lat, pos.lng];
  if (!userMarker) {
    userCircle = L.circle(ll, { radius: pos.acc || 20, className: "you-acc", interactive: false }).addTo(map);
    userMarker = L.marker(ll, {
      icon: L.divIcon({ className: "pin-wrap", html: '<div class="you" aria-label="You are here"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
      interactive: false, zIndexOffset: 1000,
    }).addTo(map);
  } else {
    userMarker.setLatLng(ll);
    userCircle.setLatLng(ll).setRadius(pos.acc || 20);
  }
}
