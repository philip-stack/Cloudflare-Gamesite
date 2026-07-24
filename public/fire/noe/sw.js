// ====================================================================
// Eigener Service Worker der Feuerwehr-NÖ-PWA. Scope: /fire/noe/
// (bewusst getrennt vom Spiele-Hub-SW an "/"). Macht die App
// installierbar und offline-tauglich. Strategie: Netz zuerst,
// Cache als Fallback. /api/… liegt außerhalb des Scopes → immer live.
// ====================================================================
const CACHE = "fire-noe-v7";
const SHELL = [
  "./", "./index.html", "./app.js?v=8", "./style.css?v=7",
  "./vendor/leaflet.js", "./vendor/leaflet.css",
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

// ---- Web-Push (Bezirks-Alarm) ----
// Wir bekommen einen payload-losen „Tickle" und holen die eigentlichen
// Nachrichten aus der Server-Queue (/api/push, action:"pending").
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
    if (!messages.length) messages = [{ title: "🚒 Feuerwehr NÖ", body: "Neuer Einsatz.", url: "/fire/noe/" }];
    await Promise.all(messages.map(m =>
      self.registration.showNotification(m.title || "Feuerwehr NÖ", {
        body: m.body || "",
        icon: "/fire/noe/icons/icon-192.png",
        badge: "/fire/noe/icons/icon-192.png",
        data: { url: m.url || "/fire/noe/" },
        tag: "fire-" + (m.title || ""),
      })
    ));
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/fire/noe/";
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) { try { await c.navigate(url); } catch (_) {} return c.focus(); } }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});

// Abo rotiert/abgelaufen → neu anlegen und Bezirke am Server behalten.
self.addEventListener("pushsubscriptionchange", e => {
  e.waitUntil((async () => {
    try {
      const key = (await (await fetch("/api/push")).json()).key;
      const pad = "=".repeat((4 - key.length % 4) % 4);
      const s = (key + pad).replace(/-/g, "+").replace(/_/g, "/");
      const raw = atob(s); const appKey = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) appKey[i] = raw.charCodeAt(i);
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
      // Bezirke sind endpoint-gebunden; ohne alten Endpoint kann der Server sie
      // nicht übernehmen — der Client richtet sie beim nächsten Öffnen neu ein.
      await fetch("/api/fire/alert", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get", endpoint: sub.endpoint }),
      });
    } catch (_) {}
  })());
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
