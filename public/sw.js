// ====================================================================
// Service Worker der Gamesite (PWA).
// Strategie: Netz zuerst, Cache als Fallback — online ist also immer
// alles aktuell, offline funktionieren bereits besuchte Spiele weiter.
// Zusätzlich wird die App-Shell beim Installieren vorab gecacht, damit
// der Hub auch beim allerersten Offline-Aufruf erscheint.
// API-Anfragen (/api/…) werden nie gecacht.
// ====================================================================
const CACHE = "gamesite-v76";
// CacheStorage ist pro Origin (nicht pro Scope) — die drei PWAs (Hub, /fire/noe/,
// /tanken/) teilen sich denselben Speicher. Beim Aufräumen NUR eigene Cache-Namen
// (gleicher Präfix) löschen, sonst wischt der zuletzt aktivierte SW die Shells der
// anderen Apps weg. Präfix = alles vor dem "-vNN"-Suffix.
const PREFIX = CACHE.replace(/-v\d+$/, "-");

// Kern-Dateien, die den Hub tragen + alle Spiele/Tools samt ihren Assets, damit
// jedes Spiel auch beim ALLERERSTEN Offline-Aufruf startet (nicht erst nach einem
// Online-Besuch). Einzeln per allSettled gecacht — fehlt eine Datei, bricht die
// Installation nicht. Beim Ändern der Liste die CACHE-Version oben hochzählen.
const SHELL = [
  // Hub-Shell
  "/", "/games.js", "/shared.js", "/theme.js", "/qr.js", "/manifest.webmanifest",
  "/styles/core.css", "/profil/", "/party/", "/saison/", "/fonts/fonts.css",
  "/icons/icon-192.png", "/icons/icon-512.png",
  // Spiele (Seite + Stil + Skript)
  "/wuerfelpoker/", "/wuerfelpoker/style.css", "/wuerfelpoker/app.js", "/wuerfelpoker/die3d.js",
  "/funkelfeld/", "/funkelfeld/style.css", "/funkelfeld/app.js",
  "/komet/", "/komet/style.css", "/komet/app.js",
  "/flatterfink/", "/flatterfink/style.css", "/flatterfink/app.js",
  "/sternensturm/", "/sternensturm/style.css", "/sternensturm/app.js",
  "/galopp/", "/galopp/style.css", "/galopp/app.js",
  "/wumms/", "/wumms/style.css", "/wumms/app.js",
  "/meeri/", "/meeri/style.css", "/meeri/app.js",
  "/schlange/", "/schlange/style.css", "/schlange/app.js",
  "/kritzeln/", "/kritzeln/style.css", "/kritzeln/app.js",
  "/quiz/", "/quiz/style.css", "/quiz/app.js",
  // Werkzeug (Kochstudio; /tanken/ & /fire/noe/ haben eigene Service-Worker)
  "/kochstudio/", "/kochstudio/style.css", "/kochstudio/app.js",
  // Schriftdateien (latein — deckt de-AT inkl. äöüß ab)
  "/fonts/fraunce-3.woff2", "/fonts/fraunce-4.woff2", "/fonts/outfit-7.woff2",
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
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
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
        const auth = (sub.toJSON().keys || {}).auth || "";   // Abo-Geheimnis → Ownership-Nachweis
        const res = await fetch("/api/push", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pending", endpoint: sub.endpoint, auth }),
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

// Läuft ein Abo ab / rotiert der Browser es, feuert dieses Event — wir
// abonnieren sofort neu und melden es (mit alter Endpoint-Kennung, damit der
// Server den Namen übernimmt). So bleiben Benachrichtigungen auch ohne
// erneuten Seitenbesuch erhalten.
self.addEventListener("pushsubscriptionchange", e => {
  e.waitUntil((async () => {
    try {
      const oldEndpoint = e.oldSubscription && e.oldSubscription.endpoint;
      const key = (await (await fetch("/api/push")).json()).key;
      const pad = "=".repeat((4 - key.length % 4) % 4);
      const s = (key + pad).replace(/-/g, "+").replace(/_/g, "/");
      const raw = atob(s); const appKey = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) appKey[i] = raw.charCodeAt(i);
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
      await fetch("/api/push", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON(), oldEndpoint }),
      });
    } catch (_) {}
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
