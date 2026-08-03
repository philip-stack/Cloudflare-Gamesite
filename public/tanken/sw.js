// Service Worker der Sprit-Radar-PWA. Scope /tanken/. Netz zuerst, Cache als
// Fallback. /api/… (Preise/Route) und /sprit/tiles/… (Kacheln) werden NICHT
// vom SW gecacht — Preise sollen frisch sein, Kacheln cachen Edge/Browser selbst.
const CACHE = "sprit-v8";
const SHELL = [
  "./", "./index.html", "./app.js?v=8", "./style.css?v=4",
  "./vendor/leaflet.js", "./vendor/leaflet.css",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;             // Preise/Route: immer live
  if (url.pathname.startsWith("/sprit/tiles/")) return;     // Kacheln: eigenes Caching
  e.respondWith(
    fetch(e.request)
      .then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return res; })
      .catch(async () => {
        const hit = await caches.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
        if (e.request.mode === "navigate") { const s = await caches.match("./"); if (s) return s; }
        return Response.error();
      })
  );
});
