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
})();
