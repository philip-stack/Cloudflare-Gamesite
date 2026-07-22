// ====================================================================
// Zentrale Spiele-Registry der Gamesite — Single Source of Truth.
//
// Jedes Spiel steht GENAU hier einmal. Startseite (index.html) und
// Profil-Seite (/profil/) bauen ihre Karten, Rekord-Zeilen und Ränge
// aus dieser Liste. Neues Spiel = ein Eintrag hier (+ ggf. ein Eintrag
// in der Allowlist von functions/api/scores/[game].js, wenn es eine
// Weltbestenliste bekommen soll).
//
// Felder:
//   key      – Kennung (= Score-API-Schlüssel, falls scored)
//   name     – Anzeigename
//   icon     – Emoji fürs Karten-Icon
//   href     – Pfad zur App
//   desc     – Kurzbeschreibung
//   bestKey  – localStorage-Schlüssel des persönlichen Rekords (Zahl)
//              oder null, wenn es keinen simplen Zahlen-Rekord gibt
//   scored   – hat eine Weltbestenliste über /api/scores
//   gsBadges – nutzt das gemeinsame Abzeichen-System (gs_badges_<key>)
//   daily/weekly – Tages-/Wochenwertung vorhanden
//   tool     – true = Werkzeug/kein klassisches Spiel (kein Rekord/Rang)
// ====================================================================
(function () {
  const GAMES = [
    {
      key: "wuerfelpoker", name: "Würfelpoker", icon: "🎲", href: "/wuerfelpoker/",
      desc: "Escalero-Verrechnungsblatt — lokal spielen oder mit Beitritts-Code teilen",
      bestKey: null, scored: false, gsBadges: false, daily: false, weekly: false,
    },
    {
      key: "funkelfeld", name: "Funkelfeld", icon: "💎", href: "/funkelfeld/",
      desc: "8×8-Puzzle — Funkelsteine sammeln, Combos jagen, Skins freispielen, weltweite Bestenliste",
      bestKey: "bb_best", scored: true, gsBadges: true, daily: false, weekly: false,
    },
    {
      key: "komet", name: "Komet", icon: "☄️", href: "/komet/",
      desc: "One-Touch-Arcade — am Lichtseil von Stern zu Stern schwingen, Funken sammeln, Distanzrekord jagen",
      bestKey: "km_best", scored: true, gsBadges: true, daily: false, weekly: false,
    },
    {
      key: "sternensturm", name: "Sternensturm", icon: "🚀", href: "/sternensturm/",
      desc: "Roguelite-Space-Shooter — Wellen überstehen, Upgrades wählen, NOVA zünden, Bosse zerlegen",
      bestKey: "ss_best", scored: true, gsBadges: true, daily: false, weekly: false,
    },
    {
      key: "galopp", name: "Galopp", icon: "🦄", href: "/galopp/",
      desc: "Endless-Runner — du hast den Zuckerkristall geklaut und ein wütendes Einhorn im Nacken: springen, ducken, Spur wechseln",
      bestKey: "galopp_best", scored: true, gsBadges: true, daily: true, weekly: true,
    },
    {
      key: "wumms", name: "WUMMS!", icon: "🦝", href: "/wumms/",
      desc: "Comic-Block-Puzzle mit Tier-Helden — Blöcke legen, Reihen abräumen, Helden-Power zünden und den Bösewicht zurückschlagen",
      bestKey: "wumms_best", scored: true, gsBadges: true, daily: true, weekly: false,
    },
    {
      key: "meeri", name: "MEERI-MANIA", icon: "🐹", href: "/meeri/",
      desc: "Merge-Idle mit Meerschweinchen — gleiche Meeries zusammenziehen, immer absurdere Evolutionen entdecken, Münzen sammeln und die Wiese ausbauen",
      bestKey: "meeri_best", scored: true, gsBadges: false, daily: false, weekly: false,
    },
    // Hinweis: /kochstudio/ ist bewusst NICHT hier registriert — es bleibt
    // abgekapselt und nur direkt unter /kochstudio/ erreichbar.
  ];

  const esc = s => String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);

  // Markup einer Spielkarte für die Startseite (identisch zum alten Layout).
  function cardHTML(g, i) {
    return `<a class="app-card" href="${g.href}" style="--i:${i}" data-game="${esc(g.key)}">
        <span class="app-icon">${g.icon}</span>
        <span class="app-info">
          <span class="app-name">${esc(g.name)}</span>
          <span class="app-desc" style="display:block">${esc(g.desc)}</span>
        </span>
        <span class="app-arrow">→</span>
      </a>`;
  }

  window.GAMES = GAMES;
  window.GAMES_BYKEY = Object.fromEntries(GAMES.map(g => [g.key, g]));
  window.gameCardHTML = cardHTML;
})();
