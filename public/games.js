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
//   accent   – Akzentfarbe der App (färbt Icon-Kachel); harmoniert mit dem
//              Midnight-Felt-System, macht die Emojis zu einem gewollten Satz
//   href     – Pfad zur App
//   desc     – Tagline: kurz, selbstbewusst, de-AT (steht auf der Karte)
//   long     – ausführliche Beschreibung (für Spiel-Seiten / später)
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
      key: "wuerfelpoker", name: "Würfelpoker", icon: "🎲", accent: "#e8c15a", href: "/wuerfelpoker/",
      desc: "Escalero für den Tisch.",
      long: "Escalero-Verrechnungsblatt — lokal spielen oder mit Beitritts-Code teilen.",
      bestKey: null, scored: false, gsBadges: false, daily: false, weekly: false,
    },
    {
      key: "funkelfeld", name: "Funkelfeld", icon: "💎", accent: "#45cfd6", href: "/funkelfeld/",
      desc: "Match-3 mit Biss.",
      long: "8×8-Puzzle — Funkelsteine sammeln, Combos jagen, Skins freispielen, weltweite Bestenliste.",
      bestKey: "bb_best", scored: true, gsBadges: true, daily: true, weekly: true,
    },
    {
      key: "komet", name: "Komet", icon: "☄️", accent: "#ffb454", href: "/komet/",
      desc: "Von Stern zu Stern schwingen.",
      long: "One-Touch-Arcade — am Lichtseil von Stern zu Stern schwingen, Funken sammeln, Distanzrekord jagen.",
      bestKey: "km_best", scored: true, gsBadges: true, daily: true, weekly: true,
    },
    {
      key: "sternensturm", name: "Sternensturm", icon: "🚀", accent: "#5b9cff", href: "/sternensturm/",
      desc: "Wellen überstehen. NOVA zünden.",
      long: "Roguelite-Space-Shooter — Wellen überstehen, Upgrades wählen, NOVA zünden, Bosse zerlegen.",
      bestKey: "ss_best", scored: true, gsBadges: true, daily: true, weekly: true,
    },
    {
      key: "galopp", name: "Galopp", icon: "🦄", accent: "#ff6f91", href: "/galopp/",
      desc: "Lauf. Spring. Kristall behalten.",
      long: "Endless-Runner — du hast den Zuckerkristall geklaut und ein wütendes Einhorn im Nacken: springen, ducken, Spur wechseln.",
      bestKey: "galopp_best", scored: true, gsBadges: true, daily: true, weekly: true,
    },
    {
      key: "wumms", name: "WUMMS!", icon: "🦝", accent: "#b678ff", href: "/wumms/",
      desc: "Blöcke legen, Reihen sprengen.",
      long: "Comic-Block-Puzzle mit Tier-Helden — Blöcke legen, Reihen abräumen, Helden-Power zünden und den Bösewicht zurückschlagen.",
      bestKey: "wumms_best", scored: true, gsBadges: true, daily: true, weekly: false,
    },
    {
      key: "meeri", name: "MEERI-MANIA", icon: "🐹", accent: "#57d98a", href: "/meeri/",
      desc: "Meeries mergen, Wiese ausbauen.",
      long: "Merge-Idle mit Meerschweinchen — gleiche Meeries zusammenziehen, immer absurdere Evolutionen entdecken, Münzen sammeln und die Wiese ausbauen.",
      bestKey: "meeri_best", scored: true, gsBadges: true, daily: false, weekly: false,
    },
    {
      key: "schlange", name: "Neon-Schlange", icon: "🐍", accent: "#a6e34d", href: "/schlange/",
      desc: "Fressen, wachsen, nicht selbst beißen.",
      long: "Slither-Arcade — als leuchtende Neon-Schlange Orbs fressen, wachsen, boosten und dich bloß nicht selbst beißen; weltweite Bestenliste.",
      bestKey: "schlange_best", scored: true, gsBadges: true, daily: true, weekly: true,
    },
    {
      key: "kritzeln", name: "Kritzeln & Raten", icon: "🎨", accent: "#ff8a5c", href: "/kritzeln/",
      desc: "Einer malt, alle raten.",
      long: "Echtzeit-Multiplayer (2–10) — einer malt, die anderen raten live; Kategorien, Fülleimer/Radierer/Undo, Speed-Punkte, Runden und Sieger:in des Abends.",
      bestKey: null, scored: false, gsBadges: false, daily: false, weekly: false,
    },
    {
      key: "quiz", name: "Wer weiß's?", icon: "🧠", accent: "#a97bff", href: "/quiz/",
      desc: "Alle raten, Tempo zählt.",
      long: "Echtzeit-Live-Trivia (2–10) — alle beantworten dieselbe Multiple-Choice-Frage gleichzeitig; richtig + schnell = mehr Punkte, Kategorien wählbar, Sieger:in des Abends und dauerhafte Bestenliste.",
      bestKey: null, scored: false, gsBadges: true, daily: false, weekly: false,
    },
    // Neon-Tron (/tron/) bleibt als Route bestehen, ist aber bewusst NICHT
    // registriert (dormant, nicht auf der Startseite verlinkt).
  ];

  // Werkzeuge / Neben-Apps: eigenständige Tools, KEINE Spiele (kein Rekord/Rang,
  // keine Weltbestenliste). Bewusst getrennt von GAMES, damit Profil/Saison
  // (die über GAMES iterieren) unberührt bleiben — aber über die Startseite
  // auffindbar statt „verwaist". Reihenfolge = Anzeige-Reihenfolge.
  const TOOLS = [
    {
      key: "kochstudio", name: "KI-Kochstudio", icon: "🍳", accent: "#ff9f4d", href: "/kochstudio/",
      desc: "Kühlschrank rein, Rezept raus.",
      long: "Sag, was im Kühlschrank ist — die KI schlägt Rezepte vor und sucht echte Links dazu.",
    },
    {
      key: "tanken", name: "Sprit-Radar", icon: "⛽", accent: "#4fd18b", href: "/tanken/",
      desc: "Die günstigste Tankstelle, sofort.",
      long: "Günstigste Tankstellen im Umkreis oder entlang deiner Route (E-Control, gratis).",
    },
    {
      key: "fire", name: "Feuerwehr NÖ", icon: "🚒", accent: "#e2685a", href: "/fire/noe/",
      desc: "Einsätze in NÖ, live.",
      long: "Aktuelle Feuerwehr-Einsätze in Niederösterreich — Karte, Bezirks-Alarm, Historie.",
    },
  ];

  const esc = s => String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);

  // Markup einer Spielkarte für die Startseite. Die Akzentfarbe (--accent)
  // färbt die Icon-Kachel, damit die Emojis als gewollter Satz wirken.
  function cardHTML(g, i) {
    const accent = g.accent ? `;--accent:${g.accent}` : "";
    return `<a class="app-card" href="${g.href}" style="--i:${i}${accent}" data-game="${esc(g.key)}">
        <span class="app-icon">${g.icon}</span>
        <span class="app-info">
          <span class="app-name">${esc(g.name)}</span>
          <span class="app-desc" style="display:block">${esc(g.desc)}</span>
        </span>
        <span class="app-arrow">→</span>
      </a>`;
  }

  window.GAMES = GAMES;
  window.TOOLS = TOOLS;
  window.GAMES_BYKEY = Object.fromEntries(GAMES.map(g => [g.key, g]));
  window.gameCardHTML = cardHTML;
})();
