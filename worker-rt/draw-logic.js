// ====================================================================
// Kritzeln & Raten — REINE Spiel-Logik (keine Durable-Object-/Runtime-
// Abhängigkeit). Ausgelagert aus dem DrawRoom, damit sie ohne laufenden
// Worker unit-testbar ist (tests/kritzeln.test.mjs). Der DrawRoom
// importiert diese Funktionen; hier steht NUR determinstische Logik.
// ====================================================================

// Wörter nach Kategorie (AT-Vokabular, alle gut zeichenbar).
export const D_CATS = {
  tiere: "Hund,Katze,Maus,Pferd,Kuh,Schwein,Huhn,Fisch,Vogel,Schlange,Elefant,Löwe,Affe,Bär,Igel,Biene,Schmetterling,Spinne,Marienkäfer,Krokodil,Pinguin,Wal,Hai,Qualle,Krebs,Frosch,Schnecke,Eule,Fuchs,Wolf,Reh,Giraffe,Zebra,Kamel,Känguru,Eichhörnchen".split(","),
  essen: "Apfel,Banane,Karotte,Erdäpfel,Palatschinke,Semmel,Brezel,Torte,Eis,Pizza,Burger,Kaffee,Milch,Ei,Käse,Wurst,Pilz,Kipferl,Paradeiser".split(","),
  dinge: "Brille,Hut,Schuh,Socke,Hose,Jacke,Krone,Ring,Uhr,Schlüssel,Schere,Stift,Buch,Zeitung,Ballon,Geschenk,Kerze,Lampe,Sessel,Tisch,Bett,Tür,Fenster,Leiter,Hammer,Säge,Schaufel,Regenschirm,Koffer,Rucksack,Anker,Gitarre,Klavier,Trommel,Trompete,Fußball".split(","),
  fahrzeuge: "Auto,Zug,Flugzeug,Schiff,Fahrrad,Rakete,Traktor,Bagger,Bus,Motorrad,Hubschrauber,Ballon".split(","),
  natur: "Haus,Baum,Sonne,Mond,Stern,Blume,Berg,Wolke,Regenbogen,Blitz,Vulkan,Insel,Brücke,Turm,Kirche,Windmühle,Sonnenblume,Kaktus,Herz,Zelt,Pilz".split(","),
  fantasie: "Schneemann,Roboter,Gespenst,Hexe,Drache,Schloss,Krone,Zauberer,Einhorn,Meerjungfrau,Ritter,Pirat,Krake,Alien,Zombie".split(","),
};
export const D_CAT_KEYS = Object.keys(D_CATS);

// Zug-/Punkte-Konstanten (auch von den Tests referenziert).
export const D_TURN = 75, D_CHOOSE = 15, D_REVEAL = 6;

// Tipp normalisieren: klein, getrimmt, ohne Sonderzeichen, Mehrfach-Leerraum → eins.
export function dNorm(s) { return String(s || "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z0-9äöüß ]/g, ""); }

// Levenshtein-Distanz (für „ganz nah dran"-Hinweis). Kappt bei Längendiff > 2.
export function dLev(a, b) {
  a = dNorm(a); b = dNorm(b); const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

// Wort-Pool: eigene Liste (ab 3 Wörtern) schlägt Kategorien; leere Auswahl = alle.
export function wordPool(cats, custom) {
  if (Array.isArray(custom) && custom.length >= 3) return custom.slice();
  const keys = (Array.isArray(cats) && cats.length) ? cats : D_CAT_KEYS;
  const set = new Set();
  for (const k of keys) for (const w of (D_CATS[k] || [])) set.add(w);
  const pool = [...set];
  return pool.length ? pool : D_CAT_KEYS.flatMap(k => D_CATS[k]);
}

// n verschiedene Wörter zufällig ziehen. rnd() ∈ [0,1) injizierbar (für Tests).
export function pickWords(pool, n, rnd = Math.random) {
  const out = [], used = new Set(); let guard = 0;
  while (out.length < n && guard++ < 500) { const w = pool[Math.floor(rnd() * pool.length)]; if (!used.has(w)) { used.add(w); out.push(w); } }
  return out;
}

// Punkte für eine:n Ratende:n: Zeit-Bonus + Platz-Bonus (1./2./3.) + Längen-Bonus.
export function guessGain({ remain, turnTotal = D_TURN, place = 0, letters = 0 }) {
  const timeBonus = Math.round((Math.max(0, remain) / turnTotal) * 100);
  const placeBonus = [30, 20, 10][place] || 0;
  const lenBonus = Math.min(60, Math.max(0, (letters - 4) * 8));
  return 50 + timeBonus + placeBonus + lenBonus;
}

// Punkte für die zeichnende Person pro Errater:in (leicht tempoabhängig).
export function drawerGain({ remain, turnTotal = D_TURN }) {
  return 20 + Math.round((Math.max(0, remain) / turnTotal) * 15);
}

// Buchstaben eines Worts ohne Leerzeichen (für den Längen-Bonus).
export function wordLetters(word) { return [...String(word || "")].filter(c => c !== " ").length; }
