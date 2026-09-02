// ====================================================================
// Gemeinsamer Hell/Dunkel-Umschalter für alle Apps der Gamesite.
// - Auswahl liegt in localStorage ("gamesite_theme") und gilt überall.
// - Setzt data-theme="light|dark" auf <html>; die Apps stylen
//   [data-theme="light"] in ihrem eigenen CSS.
// - Jeder Button mit [data-theme-toggle] schaltet um und bekommt
//   automatisch das passende Icon (auch nach Re-Renders).
// ====================================================================
(function () {
  const KEY = "gamesite_theme";
  const get = () => localStorage.getItem(KEY) === "light" ? "light" : "dark";

  function apply(t) {
    document.documentElement.dataset.theme = t;
    // Android-15-Edge-to-Edge: die Statusleiste ist transparent, dahinter liegt
    // der obere Seiten-Inset. Den färbt weder theme-color noch color-scheme
    // zuverlässig — also malen wir das Wurzelelement (html) selbst in der Modus-
    // Grundfarbe. Das füllt exakt den Rand-/Inset-Bereich (der Seiteninhalt liegt
    // im body darüber). color-scheme zusätzlich für Scrollbars/Formfelder/Canvas.
    const root = document.documentElement;
    root.style.colorScheme = t;
    root.style.backgroundColor = t === "light" ? "#dbe6d6" : "#0a0e0b";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      if (!meta.dataset.dark) meta.dataset.dark = meta.content;
      // Hell: an den oberen Rand des core.css-Hell-Hintergrunds angeglichen
      // (#dbe6d6), damit die System-/Adressleiste nahtlos mit der Seite
      // verschmilzt statt als abgesetzter Balken zu wirken.
      meta.content = t === "light" ? (meta.dataset.light || "#dbe6d6") : meta.dataset.dark;
    }
  }

  function refreshButtons() {
    document.querySelectorAll("[data-theme-toggle]").forEach(b => {
      const icon = get() === "light" ? "☀️" : "🌙";
      if (b.textContent !== icon) b.textContent = icon;
      b.title = get() === "light" ? "Dunkelmodus" : "Hellmodus";
      // Icon-only → Screenreader braucht einen Namen; synchron zum title halten.
      b.setAttribute("aria-label", b.title);
    });
  }

  // Barrierefreiheit: Icon-only-Buttons (nur Emoji/Symbol, kein Text) haben für
  // Screenreader keinen Namen. Wo ein `title` gesetzt ist, spiegeln wir ihn nach
  // `aria-label`. Buttons mit sichtbarem Text bleiben unberührt. Plattformweit,
  // damit jedes Spiel (auch künftige) automatisch profitiert.
  function labelIconButtons() {
    document.querySelectorAll("button[title]:not([aria-label])").forEach(b => {
      const hasText = /[\p{L}\p{N}]/u.test(b.textContent || "");
      if (!hasText) b.setAttribute("aria-label", b.getAttribute("title"));
    });
  }

  window.gsTheme = {
    get,
    toggle() {
      const t = get() === "light" ? "dark" : "light";
      localStorage.setItem(KEY, t);
      apply(t);
      refreshButtons();
      return t;
    },
  };

  apply(get());

  // ------------------------------------------------------------------
  // Barrierefreiheit (plattformweit, einmal injiziert):
  //  - prefers-reduced-motion: Wer im Betriebssystem „Bewegung reduzieren"
  //    gewählt hat, bekommt keine langen CSS-Animationen/Übergänge mehr
  //    (Canvas-Spiele laufen über rAF und sind davon unberührt).
  //  - :focus-visible: sichtbarer Tastatur-Fokusring auf jeder Seite —
  //    auch dort, wo eigenes CSS den Fokus wegstylt (deshalb !important,
  //    greift aber nur bei Tastatur/Programm-Fokus, nicht per Maus).
  // ------------------------------------------------------------------
  (function injectA11y() {
    const css =
      "@media (prefers-reduced-motion: reduce){*,::before,::after{" +
      "animation-duration:.001ms!important;animation-iteration-count:1!important;" +
      "transition-duration:.001ms!important;scroll-behavior:auto!important}}" +
      ":focus-visible{outline:3px solid #57c7ff!important;outline-offset:2px!important}" +
      // Energiesparen: teure Blur-Filter (Karten, Overlays) plattformweit aus.
      ":root[data-lowpower] *{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}";
    const st = document.createElement("style");
    st.id = "gs-a11y";
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  })();

  // Energiesparen: setzt data-lowpower auf <html>; CSS schaltet damit teure
  // Dauer-Effekte ab, Canvas-Spiele (z. B. meeri) drosseln die Bildrate.
  // Wird zusätzlich automatisch aktiv, wenn das Betriebssystem „Bewegung
  // reduzieren" meldet — außer die/der Nutzer:in hat es explizit abgeschaltet.
  const prefersReducedMotion = () => {
    try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; }
  };
  const applyLowPower = () => {
    try {
      const explicit = localStorage.getItem("gs_lowpower");        // "1" | "0" | null
      const on = explicit === "1" || (explicit == null && prefersReducedMotion());
      if (on) document.documentElement.setAttribute("data-lowpower", "");
      else document.documentElement.removeAttribute("data-lowpower");
    } catch (_) {}
  };
  applyLowPower();
  try { matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", applyLowPower); } catch (_) {}
  window.gsLowPower = {
    // Effektiver Zustand (inkl. automatischem reduced-motion), nicht nur das Flag.
    on: () => document.documentElement.hasAttribute("data-lowpower"),
    toggle() { const next = !this.on(); try { localStorage.setItem("gs_lowpower", next ? "1" : "0"); } catch (_) {} applyLowPower(); return next; },
  };

  // ------------------------------------------------------------------
  // Persistenter Speicher (gilt für die ganze Herkunft/Origin).
  // iOS/Safari & Browser mit ITP löschen localStorage sonst nach einiger
  // Zeit automatisch — das trifft alle Spielstände der Seite. Einmal je
  // Seitenaufruf bitten wir den Browser, den Speicher zu behalten.
  // ------------------------------------------------------------------
  try {
    if (navigator.storage && navigator.storage.persist && navigator.storage.persisted) {
      navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist().catch(() => {}); }).catch(() => {});
    }
  } catch (_) {}

  // Prüft einmalig, ob localStorage wirklich schreibbar ist (im privaten
  // Modus wirft setItem). Spiele können window.gsStorageOK abfragen.
  window.gsStorageOK = (function () {
    try {
      localStorage.setItem("__gs_test__", "1");
      const ok = localStorage.getItem("__gs_test__") === "1";
      localStorage.removeItem("__gs_test__");
      return ok;
    } catch (_) { return false; }
  })();

  // ------------------------------------------------------------------
  // Zuverlässige Viewport-Höhe (--app-h).
  // Auf manchen mobilen Browsern löst 100dvh beim ersten Laden auf die
  // GROSSE Höhe (ohne Adressleiste) auf, sodass Vollbild-Layouts unten
  // aus dem Sichtbereich laufen — erst ein Reflow (z. B. Theme-Wechsel)
  // korrigiert das. Wir setzen die Höhe darum aus visualViewport und
  // aktualisieren sie bei jeder echten Größenänderung.
  // Die Canvas-Spiele nutzen: #app { height: var(--app-h, 100dvh); }
  // ------------------------------------------------------------------
  function setAppHeight() {
    const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    if (h) document.documentElement.style.setProperty("--app-h", Math.round(h) + "px");
  }
  setAppHeight();
  requestAnimationFrame(setAppHeight);
  window.addEventListener("resize", setAppHeight);
  window.addEventListener("orientationchange", () => setTimeout(setAppHeight, 200));
  window.addEventListener("pageshow", setAppHeight);
  window.addEventListener("load", setAppHeight);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", setAppHeight);

  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-theme-toggle]");
    if (btn) window.gsTheme.toggle();
  });

  // Buttons können jederzeit (neu) gerendert werden → Icon + aria-label nachziehen
  function syncButtons() { refreshButtons(); labelIconButtons(); }
  function watch() {
    syncButtons();
    new MutationObserver(syncButtons).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) watch();
  else document.addEventListener("DOMContentLoaded", watch);

  // PWA: Service Worker registrieren (alle Apps laden theme.js).
  // Übernimmt eine neue Version die Kontrolle, zeigen wir einen
  // dezenten "Neu laden"-Hinweis statt still Altes anzuzeigen.
  function showUpdateToast() {
    if (document.getElementById("gs-update-toast")) return;
    const el = document.createElement("div");
    el.id = "gs-update-toast";
    el.innerHTML = `✨ Neue Version verfügbar &nbsp;<button type="button">Neu laden</button>`;
    el.style.cssText = "position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9999;display:flex;align-items:center;background:rgba(20,24,20,0.92);color:#f4efe2;padding:10px 12px 10px 18px;border-radius:999px;font:600 0.9rem system-ui,sans-serif;box-shadow:0 0 0 1px rgba(232,193,90,0.35) inset,0 12px 32px -8px rgba(0,0,0,0.6);backdrop-filter:blur(10px)";
    const btn = el.querySelector("button");
    btn.style.cssText = "margin-left:10px;border:0;border-radius:999px;padding:7px 14px;font:700 0.85rem system-ui,sans-serif;background:linear-gradient(160deg,#f0cd6e,#e8c15a);color:#1a1508;cursor:pointer";
    btn.onclick = () => location.reload();
    document.body.appendChild(el);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
      let hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController) { hadController = true; return; } // Erstinstallation
        showUpdateToast();
      });
      healPush();
    });
  }

  // ------------------------------------------------------------------
  // Push-Selbstheilung (app-weit): Ein einmal aktiviertes Abo (gs_push_on)
  // wird auf JEDER Seite wiederhergestellt, falls es fehlt — Push-Abos werden
  // vom Browser/FCM turnusmäßig rotiert bzw. laufen ab. So bleiben die
  // Benachrichtigungen an, ohne dass man extra ins Profil muss. Nichts passiert,
  // wenn nie aktiviert wurde oder die Erlaubnis fehlt (kein ungefragtes Abo).
  // ------------------------------------------------------------------
  async function healPush() {
    try {
      if (localStorage.getItem("gs_push_on") !== "1") return;
      if (!("Notification" in window) || Notification.permission !== "granted" || !("PushManager" in window)) return;
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      const fresh = !sub;
      if (!sub) {
        const key = (await (await fetch("/api/push")).json()).key;
        const pad = "=".repeat((4 - key.length % 4) % 4);
        const s = (key + pad).replace(/-/g, "+").replace(/_/g, "/");
        const raw = atob(s); const u = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u });
      }
      // Server-Eintrag auffrischen: immer nach Neu-Abo, sonst höchstens alle 12 h.
      const last = Number(localStorage.getItem("gs_push_ping") || 0);
      if (!fresh && Date.now() - last < 12 * 3600 * 1000) return;
      const name = (localStorage.getItem("bb_name") || "").trim().slice(0, 16) || null;
      const device = localStorage.getItem("gs_device") || null;
      await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON(), name, device }) });
      try { localStorage.setItem("gs_push_ping", String(Date.now())); } catch (_) {}
    } catch (_) { /* Push ist optional — nie stören */ }
  }

  // ------------------------------------------------------------------
  // Anonymer Fehler-Melder: JS-Fehler kurz an /api/log schicken, damit
  // Defekte auf fremden Geräten auffallen. Gedrosselt (max. 5 pro Seite,
  // keine Duplikate) und rein "fire and forget".
  // ------------------------------------------------------------------
  (function () {
    let sent = 0; const seen = new Set();
    function report(msg, extra) {
      try {
        if (sent >= 5) return;
        msg = String(msg || "").slice(0, 300);
        if (!msg || seen.has(msg)) return;
        seen.add(msg); sent++;
        const body = JSON.stringify({
          msg, extra: extra ? String(extra).slice(0, 200) : "",
          page: location.pathname, ua: navigator.userAgent.slice(0, 200),
        });
        if (navigator.sendBeacon) navigator.sendBeacon("/api/log", new Blob([body], { type: "application/json" }));
        else fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      } catch (_) {}
    }
    window.addEventListener("error", e => report(e.message, (e.filename || "") + ":" + (e.lineno || "")));
    window.addEventListener("unhandledrejection", e => {
      const r = e.reason; report("unhandledrejection: " + ((r && r.message) || r), r && r.stack ? String(r.stack).slice(0, 200) : "");
    });
  })();
})();
