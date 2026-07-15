// ====================================================================
// Service Worker der Gamesite (PWA).
// Strategie: Netz zuerst, Cache als Fallback — online ist also immer
// alles aktuell, offline funktionieren bereits besuchte Spiele weiter.
// API-Anfragen (/api/…) werden nie gecacht.
// ====================================================================
const CACHE = "gamesite-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== location.origin) return;      // Fonts etc. macht der Browser-Cache
  if (url.pathname.startsWith("/api/")) return;    // Spielstände/Scores nie cachen

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
