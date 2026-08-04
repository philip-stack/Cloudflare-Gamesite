// Kritzeln & Raten — reine Spiel-Logik (worker-rt/draw-logic.js).
// Keine Runtime/DO nötig: Wort-Normalisierung, Levenshtein, Wort-Pool
// (Kategorien/eigene Wörter) und die Punkte-Berechnung.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "worker-rt", "draw-logic.js").replace(/\\/g, "/");
const L = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// ---------- dNorm ----------
assert("dNorm: Groß/Klein + trim", L.dNorm("  HaUs ") === "haus");
assert("dNorm: Mehrfach-Leerzeichen", L.dNorm("roter  bus") === "roter bus");
assert("dNorm: Satzzeichen raus", L.dNorm("Auto!!!") === "auto");
assert("dNorm: Umlaute bleiben", L.dNorm("Erdäpfel") === "erdäpfel");
assert("dNorm: leere Eingabe", L.dNorm(null) === "" && L.dNorm(undefined) === "");

// ---------- dLev ----------
assert("dLev: identisch = 0", L.dLev("Katze", "katze") === 0);
assert("dLev: ein Tippfehler = 1", L.dLev("katze", "katue") === 1);
assert("dLev: große Längendiff gekappt (>2 → 9)", L.dLev("a", "abcdef") === 9);
assert("dLev: nah dran (<=1) erkennt Tippfehler", L.dLev("elefant", "elefent") <= 1);

// ---------- wordPool ----------
const tiere = L.D_CATS.tiere;
const poolTiere = L.wordPool(["tiere"], []);
assert("wordPool: nur gewählte Kategorie", poolTiere.every(w => tiere.includes(w)) && poolTiere.length === tiere.length);
const poolAll = L.wordPool([], []);
assert("wordPool: leere Auswahl = alle Kategorien", poolAll.length > tiere.length);
const poolTwo = L.wordPool(["tiere", "essen"], []);
assert("wordPool: mehrere Kategorien kombiniert", poolTwo.length === new Set([...L.D_CATS.tiere, ...L.D_CATS.essen]).size);
assert("wordPool: eigene Wörter (>=3) schlagen Kategorien", JSON.stringify(L.wordPool(["tiere"], ["Oma", "Netflix", "Trampolin"])) === JSON.stringify(["Oma", "Netflix", "Trampolin"]));
assert("wordPool: <3 eigene Wörter → Fallback auf Kategorien", L.wordPool(["tiere"], ["Oma", "Netflix"]).every(w => tiere.includes(w)));
assert("wordPool: unbekannte Kategorie ignoriert, Fallback auf alle", L.wordPool(["quatsch"], []).length > 0);

// ---------- pickWords (deterministisch mit injizierter Zufallsfunktion) ----------
const seq = [0, 0, 0.5, 0.99];  // erzwingt Dupe-Übersprung
let i = 0; const rnd = () => seq[i++ % seq.length];
const picked = L.pickWords(["A", "B", "C", "D"], 3, rnd);
assert("pickWords: liefert n verschiedene Wörter", picked.length === 3 && new Set(picked).size === 3);

// ---------- guessGain ----------
// Formel: 50 + round(remain/turnTotal*100) + Platz([30,20,10][place]||0) + Länge(min(60,max(0,(letters-4)*8)))
// Zeit-Anteil (place 0 = +30, letters 4 = +0): sofort 180, spät 80
assert("guessGain: sofort (180) > spät (80)",
  L.guessGain({ remain: L.D_TURN, turnTotal: L.D_TURN, place: 0, letters: 4 }) === 180 &&
  L.guessGain({ remain: 0, turnTotal: L.D_TURN, place: 0, letters: 4 }) === 80);
// Platz-Bonus (remain 0, letters 4): place 0/1/2 → +30/+20/+10, ab place 3 → 0
assert("guessGain: Platz-Bonus (erste:r +30, dann fallend)",
  L.guessGain({ remain: 0, place: 0, letters: 4 }) === 80 &&
  L.guessGain({ remain: 0, place: 1, letters: 4 }) === 70 &&
  L.guessGain({ remain: 0, place: 2, letters: 4 }) === 60 &&
  L.guessGain({ remain: 0, place: 3, letters: 4 }) === 50);
// Längen-Bonus isoliert (place 3 → kein Platz-Bonus, remain 0)
assert("guessGain: Längen-Bonus steigt, gedeckelt bei 60",
  L.guessGain({ remain: 0, place: 3, letters: 4 }) === 50 &&
  L.guessGain({ remain: 0, place: 3, letters: 5 }) === 58 &&
  L.guessGain({ remain: 0, place: 3, letters: 12 }) === 110 &&
  L.guessGain({ remain: 0, place: 3, letters: 20 }) === 110);
assert("guessGain: kurzes Wort kein negativer Bonus", L.guessGain({ remain: 0, place: 3, letters: 2 }) === 50);

// ---------- drawerGain ----------
assert("drawerGain: sofort 35, spät 20",
  L.drawerGain({ remain: L.D_TURN, turnTotal: L.D_TURN }) === 35 &&
  L.drawerGain({ remain: 0, turnTotal: L.D_TURN }) === 20);

// ---------- wordLetters ----------
assert("wordLetters: zählt ohne Leerzeichen", L.wordLetters("roter bus") === 8 && L.wordLetters("Haus") === 4);

console.log(ok ? "\n✅ kritzeln: alle Tests grün" : "\n❌ kritzeln: Tests fehlgeschlagen");
process.exit(ok ? 0 : 1);
