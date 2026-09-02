// Service Worker der Sprit-Radar-PWA. Scope /tanken/. Netz zuerst, Cache als
// Fallback. /api/… (Preise/Route) und /sprit/tiles/… (Kacheln) werden NICHT
// vom SW gecacht — Preise sollen frisch sein, Kacheln cachen Edge/Browser selbst.
const CACHE = "sprit-v13";
// CacheStorage ist pro Origin, nicht pro Scope — Hub/Fire/Tanken teilen sich einen
// Speicher. Beim Aufräumen nur eigene Caches (gleicher Präfix) löschen, sonst wischt
// dieser SW die Shells der anderen Apps weg. Präfix = alles vor dem "-vNN"-Suffix.
const PREFIX = CACHE.replace(/-v\d+$/, "-");
const SHELL = [
  "./", "./index.html", "./app.js?v=8", "./style.css?v=4",
  "./vendor/leaflet.js", "./vendor/leaflet.css",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// ---- Web-Push (Preis-Alarm) ----
// Payload-loser „Tickle": die eigentlichen Nachrichten aus der Server-Queue
// holen (/api/push, action:"pending") — derselbe Mechanismus wie bei Fire.
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
    if (!messages.length) messages = [{ title: "⛽ Sprit-Radar", body: "Preis-Alarm.", url: "/tanken/" }];
    await Promise.all(messages.map(m =>
      self.registration.showNotification(m.title || "Sprit-Radar", {
        body: m.body || "",
        icon: "/tanken/icons/icon-192.png",
        badge: "/tanken/icons/icon-192.png",
        data: { url: m.url || "/tanken/" },
        tag: "sprit-" + (m.title || ""),
      })
    ));
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/tanken/";
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});

// Abo rotiert/abgelaufen → neu anlegen (Alarme sind endpoint-gebunden; der
// Client richtet sie beim nächsten Öffnen ggf. neu ein).
self.addEventListener("pushsubscriptionchange", e => {
  e.waitUntil((async () => {
    try {
      const key = (await (await fetch("/api/push")).json()).key;
      const pad = "=".repeat((4 - key.length % 4) % 4);
      const s = (key + pad).replace(/-/g, "+").replace(/_/g, "/");
      const raw = atob(s); const appKey = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) appKey[i] = raw.charCodeAt(i);
      await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    } catch (_) {}
  })());
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
