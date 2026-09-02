// ====================================================================
// Zentrale Metadaten der GEWERTETEN Spiele (Server-Seite, eine Quelle).
// Verhindert Drift zwischen Saison-Liga (season.js) und Bestenlisten-API
// (scores/[game].js) — genau diese Drift hatte „Neon-Schlange" aus der
// Wochenwertung geworfen. Der Client pflegt sein eigenes public/games.js
// (kann Server-Module nicht importieren); Reihenfolge hier = Anzeige-
// reihenfolge in der Saison.
// ====================================================================
export const SCORED_GAMES = {
  funkelfeld:   { name: "Funkelfeld",    icon: "💎" },
  komet:        { name: "Komet",         icon: "☄️" },
  flatterfink:  { name: "Flatterfink",   icon: "🐦" },
  sternensturm: { name: "Sternensturm",  icon: "🚀" },
  galopp:       { name: "Galopp",        icon: "🦄" },
  wumms:        { name: "WUMMS!",        icon: "🦝" },
  meeri:        { name: "MEERI-MANIA",   icon: "🐹" },
  schlange:     { name: "Neon-Schlange", icon: "🐍" },
};

export const SCORED_KEYS = Object.keys(SCORED_GAMES);
export const gameName = k => (SCORED_GAMES[k] && SCORED_GAMES[k].name) || k;
export const gameIcon = k => (SCORED_GAMES[k] && SCORED_GAMES[k].icon) || "🎮";
