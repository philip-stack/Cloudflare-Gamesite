// Service Worker des Renntickers (PWA, Scope /f1/). Netz zuerst, Cache als
// Fallback für die App-Hülle. Renndaten (/f1data/, /api/) gehen nie in den
// Cache — sie sind groß bzw. müssen frisch sein.
const CACHE = "f1-v2";
// CacheStorage ist pro Origin — nur eigene Caches (gleicher Präfix) aufräumen,
// sonst verschwinden die Hüllen von Hub, Sprit-Radar und Feuerwehr.
const PREFIX = CACHE.replace(/-v\d+$/, "-");
const SHELL = [
  "./", "./core.js", "./push.js", "./tyres.js", "./chart.js", "./wm.js", "./docs.js", "./model.js", "./style.css", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./fonts/titillium-400.woff2", "./fonts/titillium-600.woff2", "./fonts/titillium-700.woff2",
  "./fonts/titillium-700i.woff2", "./fonts/titillium-900.woff2",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (!url.pathname.startsWith("/f1/")) return;          // /f1data/, /api/ → direkt ans Netz
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok && !url.pathname.includes("/vendor/")) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(e.request) || await caches.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      if (e.request.mode === "navigate") return (await caches.match("./")) || Response.error();
      throw err;
    }
  })());
});

// ---- Web-Push: payload-loser „Tickle“, Nachrichten aus der Server-Queue holen ----
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
    if (!messages.length) messages = [{ title: "🏎️ Rennticker", body: "Es gibt Neuigkeiten.", url: "/f1/" }];
    await Promise.all(messages.map(m =>
      self.registration.showNotification(m.title || "Rennticker", {
        body: m.body || "",
        icon: "/f1/icons/icon-192.png",
        badge: "/f1/icons/icon-192.png",
        data: { url: m.url || "/f1/" },
        tag: "f1-" + (m.title || ""),
      })
    ));
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/f1/";
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const mine = all.find(c => new URL(c.url).pathname.startsWith("/f1/"));
    if (mine) { try { await mine.navigate(url); } catch (_) {} return mine.focus(); }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});

// Abo rotiert (Browser) → neu abonnieren; die Auswahl hängt am alten Endpoint
// und muss in der App einmal neu gespeichert werden (wie beim Sprit-Radar).
self.addEventListener("pushsubscriptionchange", e => {
  e.waitUntil((async () => {
    try {
      const key = (await (await fetch("/api/push")).json()).key;
      const pad = "=".repeat((4 - key.length % 4) % 4);
      const raw = atob((key + pad).replace(/-/g, "+").replace(/_/g, "/"));
      const appKey = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) appKey[i] = raw.charCodeAt(i);
      await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    } catch (_) {}
  })());
});
