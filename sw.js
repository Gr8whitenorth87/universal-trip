// Offline support: the app shell and trip data are cached so the plan, food and hunts work
// with no signal. Map tiles are kept as you view them. Live waits always go to the network.
const VERSION = "ut26-v3";
const SHELL = [
  "./",
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/util.js",
  "js/live.js",
  "js/map.js",
  "data/app-data.json",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "fonts/big-shoulders-display-latin-800-normal.woff2",
  "fonts/big-shoulders-display-latin-700-normal.woff2",
  "fonts/atkinson-hyperlegible-next-latin-400-normal.woff2",
  "fonts/atkinson-hyperlegible-next-latin-700-normal.woff2",
  "fonts/atkinson-hyperlegible-next-latin-400-italic.woff2",
  "icons/icon-192.png",
  "manifest.webmanifest",
];
const TILES = "ut26-tiles";
const MAX_TILES = 1500;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  if (url.hostname === "tile.openstreetmap.org") {
    e.respondWith(tile(e.request));
    return;
  }
  if (url.origin !== location.origin) return; // live waits: straight to the network

  // App files: serve from cache right away, refresh in the background.
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      // no-cache: revalidate with GitHub Pages so fixes show up on the next open, not 10 minutes later
      const fresh = fetch(e.request, { cache: "no-cache" }).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => null);
      if (cached) { e.waitUntil(fresh); return cached; }
      return (await fresh) || new Response("Offline", { status: 503 });
    })
  );
});

async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      cache.put(req, res.clone());
      cache.keys().then((keys) => { if (keys.length > MAX_TILES) cache.delete(keys[0]); });
    }
    return res;
  } catch {
    return new Response("", { status: 504 });
  }
}
