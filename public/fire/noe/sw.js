// ====================================================================
// Eigener Service Worker der Feuerwehr-NÖ-PWA. Scope: /fire/noe/
// (bewusst getrennt vom Spiele-Hub-SW an "/"). Macht die App
// installierbar und offline-tauglich. Strategie: Netz zuerst,
// Cache als Fallback. /api/… liegt außerhalb des Scopes → immer live.
// ====================================================================
const CACHE = "fire-noe-v1";
const SHELL = [
  "./", "./index.html", "./app.js?v=2", "./style.css?v=3",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;   // Einsatzdaten nie cachen
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
        if (e.request.mode === "navigate") { const shell = await caches.match("./"); if (shell) return shell; }
        return Response.error();
      })
  );
});
