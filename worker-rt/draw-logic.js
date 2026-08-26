// ====================================================================
// Kritzeln & Raten — REINE Spiel-Logik (keine Durable-Object-/Runtime-
// Abhängigkeit). Ausgelagert aus dem DrawRoom, damit sie ohne laufenden
// Worker unit-testbar ist (tests/kritzeln.test.mjs). Der DrawRoom
// importiert diese Funktionen; hier steht NUR determinstische Logik.
// ====================================================================

// Wörter nach Kategorie (AT-Vokabular, alle gut zeichenbar).
export const D_CATS = {
  tiere: "Hund,Katze,Maus,Pferd,Kuh,Schwein,Huhn,Fisch,Vogel,Schlange,Elefant,Löwe,Affe,Bär,Igel,Biene,Schmetterling,Spinne,Marienkäfer,Krokodil,Pinguin,Wal,Hai,Qualle,Krebs,Frosch,Schnecke,Eule,Fuchs,Wolf,Reh,Giraffe,Zebra,Kamel,Känguru,Eichhörnchen,Ente,Gans,Schaf,Ziege,Esel,Hase,Maulwurf,Fledermaus,Delfin,Seepferdchen,Seestern,Tintenfisch,Papagei,Storch,Schwan,Ameise,Wespe,Libelle,Schildkröte,Eidechse,Tiger,Nashorn,Nilpferd,Panda,Koala,Waschbär,Hirsch,Robbe,Dachs,Specht,Hummer,Raupe,Regenwurm".split(","),
  essen: "Apfel,Banane,Karotte,Erdäpfel,Palatschinke,Semmel,Brezel,Torte,Eis,Pizza,Burger,Kaffee,Milch,Ei,Käse,Wurst,Pilz,Kipferl,Paradeiser,Birne,Erdbeere,Kirsche,Weintraube,Zitrone,Orange,Melone,Ananas,Gurke,Zwiebel,Brot,Kuchen,Keks,Donut,Popcorn,Pommes,Hotdog,Spaghetti,Suppe,Salat,Honig,Schokolade,Lutscher,Muffin,Krapfen,Marille,Nudel".split(","),
  dinge: "Brille,Hut,Schuh,Socke,Hose,Jacke,Krone,Ring,Uhr,Schlüssel,Schere,Stift,Buch,Zeitung,Ballon,Geschenk,Kerze,Lampe,Sessel,Tisch,Bett,Tür,Fenster,Leiter,Hammer,Säge,Schaufel,Regenschirm,Koffer,Rucksack,Anker,Gitarre,Klavier,Trommel,Trompete,Fußball,Teller,Gabel,Löffel,Messer,Tasse,Flasche,Topf,Pfanne,Zahnbürste,Kamm,Spiegel,Telefon,Fernseher,Computer,Glühbirne,Batterie,Magnet,Waage,Kompass,Fahne,Knopf,Handschuh,Mütze,Krawatte,Gürtel,Besen,Nagel,Schraube,Zange,Pinsel,Radiergummi".split(","),
  fahrzeuge: "Auto,Zug,Flugzeug,Schiff,Fahrrad,Rakete,Traktor,Bagger,Bus,Motorrad,Hubschrauber,Ballon,LKW,Feuerwehrauto,Polizeiauto,Krankenwagen,Taxi,Rennwagen,Panzer,U-Boot,Segelboot,Ruderboot,Kanu,Straßenbahn,Seilbahn,Roller,Skateboard,Einrad,Kutsche,Schlitten,Gondel,Lokomotive".split(","),
  natur: "Haus,Baum,Sonne,Mond,Stern,Blume,Berg,Wolke,Regenbogen,Blitz,Vulkan,Insel,Brücke,Turm,Kirche,Windmühle,Sonnenblume,Kaktus,Herz,Zelt,Pilz,Fluss,See,Palme,Wald,Wüste,Höhle,Wasserfall,Tornado,Schneeflocke,Eiszapfen,Feuer,Regen,Tal,Wiese,Teich,Stein,Blatt,Tanne,Tulpe,Rose,Muschel,Planet,Strand,Klee".split(","),
  fantasie: "Schneemann,Roboter,Gespenst,Hexe,Drache,Schloss,Krone,Zauberer,Einhorn,Meerjungfrau,Ritter,Pirat,Krake,Alien,Zombie,Fee,Kobold,Troll,Riese,Zwerg,Elf,Vampir,Werwolf,Monster,Dinosaurier,Zauberstab,Zaubertrank,Kristallkugel,Schatztruhe,Yeti,Phönix,Greif,UFO,Sternschnuppe,Zauberhut".split(","),
  berufe: "Arzt,Koch,Polizist,Feuerwehrmann,Lehrer,Bäcker,Pilot,Clown,Maler,Gärtner,Friseur,Bauer,Fischer,Astronaut,Krankenschwester,Briefträger,Tänzer,Sänger,Zahnarzt,Richter,Detektiv,Cowboy,Taucher,Imker,Müllmann,Kellner,Schäfer,Schmied,Metzger,Tierarzt,Kapitän,Bergsteiger,Jongleur".split(","),
  sport: "Fußball,Tennis,Ski,Boxen,Klettern,Golf,Reiten,Turnen,Basketball,Volleyball,Eishockey,Rodeln,Surfen,Tauchen,Bogenschießen,Segeln,Snowboard,Karate,Tischtennis,Handball,Angeln,Skaten,Yoga,Gewichtheben,Hürde,Dart,Kegeln,Rudern,Trampolin,Schaukel,Slalom".split(","),
  koerper: "Hand,Fuß,Auge,Nase,Mund,Ohr,Kopf,Haar,Zahn,Zunge,Finger,Herz,Bauch,Bein,Arm,Knie,Rücken,Schulter,Ellbogen,Daumen,Zeh,Wimper,Augenbraue,Lippe,Kinn,Gehirn,Skelett,Faust,Locke,Bart".split(","),
  musik: "Geige,Flöte,Saxofon,Harfe,Mikrofon,Note,Kopfhörer,Schallplatte,Lautsprecher,Xylophon,Akkordeon,Dudelsack,Triangel,Mundharmonika,Cello,Tuba,Banjo,Keyboard,Notenschlüssel,Metronom,Plattenspieler".split(","),
  werkzeug: "Schraubenzieher,Bohrer,Rechen,Maßband,Wasserwaage,Axt,Beil,Feile,Meißel,Bohrmaschine,Spachtel,Schleifpapier,Werkzeugkasten,Dübel,Winkel,Kelle,Schweißgerät,Zollstock,Bügelsäge,Akkuschrauber".split(","),
  weltall: "Galaxie,Satellit,Teleskop,Saturn,Erde,Mars,Außerirdischer,Raumschiff,Raumanzug,Mondlandung,Sternbild,Meteorit,Milchstraße,Komet,Umlaufbahn,Sonnensystem,Mondkrater,Sternwarte,Weltraum".split(","),
};
export const D_CAT_KEYS = Object.keys(D_CATS);

// Erste Kategorie, die dieses Wort enthält (für den Kategorie-Hinweis an
// Ratende). null = keine (z. B. eigenes Wort des Hosts).
export function catOf(word) {
  for (const k of D_CAT_KEYS) if (D_CATS[k].includes(word)) return k;
  return null;
}

// Anzahl der Buchstaben-Hinweise je nach Wortlänge (kurze Wörter weniger,
// lange mehr → fairer). Der DrawRoom verteilt sie über die Zugzeit.
export function hintCount(len) {
  if (len <= 4) return 1;
  if (len <= 7) return 2;
  if (len <= 10) return 3;
  return 4;
}

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
