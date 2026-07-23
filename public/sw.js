// ====================================================================
// Service Worker der Gamesite (PWA).
// Strategie: Netz zuerst, Cache als Fallback — online ist also immer
// alles aktuell, offline funktionieren bereits besuchte Spiele weiter.
// Zusätzlich wird die App-Shell beim Installieren vorab gecacht, damit
// der Hub auch beim allerersten Offline-Aufruf erscheint.
// API-Anfragen (/api/…) werden nie gecacht.
// ====================================================================
const CACHE = "gamesite-v58";

// Kern-Dateien, die den Hub tragen (klein, lohnt sich vorzucachen).
const SHELL = [
  "/", "/games.js", "/shared.js", "/theme.js", "/qr.js", "/manifest.webmanifest",
  "/profil/", "/party/", "/saison/", "/fonts/fonts.css",
  "/icons/icon-192.png", "/icons/icon-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      // einzeln cachen: ein fehlendes Asset darf die Installation nicht killen
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

// ---- Web-Push ----
// Wir bekommen einen „Tickle"-Push ohne Body. Der SW fragt seine eigenen
// Nachrichten über den Push-Endpoint aus der Server-Queue ab und zeigt sie.
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let messages = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        const res = await fetch("/api/push", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pending", endpoint: sub.endpoint }),
        });
        if (res.ok) messages = (await res.json()).messages || [];
      }
    } catch (_) {}
    // Fallback, falls die Queue (noch) leer ist: dezente Sammel-Meldung
    if (!messages.length) messages = [{ title: "🎲 Spieleabend", body: "Es gibt Neuigkeiten.", url: "/" }];
    await Promise.all(messages.map(m =>
      self.registration.showNotification(m.title || "Spieleabend", {
        body: m.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: m.url || "/" },
        tag: "gs-" + (m.title || ""),
      })
    ));
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) { try { await c.navigate(url); } catch (_) {} return c.focus(); } }
    if (clients.openWindow) return clients.openWindow(url);
  })());
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
      .catch(async () => {
        const hit = await caches.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
        // Offline und nichts im Cache: bei Seitennavigation den Hub zeigen
        if (e.request.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
