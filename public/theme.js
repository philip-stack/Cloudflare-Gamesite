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
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      if (!meta.dataset.dark) meta.dataset.dark = meta.content;
      meta.content = t === "light" ? (meta.dataset.light || "#efece1") : meta.dataset.dark;
    }
  }

  function refreshButtons() {
    document.querySelectorAll("[data-theme-toggle]").forEach(b => {
      const icon = get() === "light" ? "☀️" : "🌙";
      if (b.textContent !== icon) b.textContent = icon;
      b.title = get() === "light" ? "Dunkelmodus" : "Hellmodus";
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

  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-theme-toggle]");
    if (btn) window.gsTheme.toggle();
  });

  // Buttons können jederzeit (neu) gerendert werden → Icon nachziehen
  function watch() {
    refreshButtons();
    new MutationObserver(refreshButtons).observe(document.body, { childList: true, subtree: true });
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
    });
  }
})();
