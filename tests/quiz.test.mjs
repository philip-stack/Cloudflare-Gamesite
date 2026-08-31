// Quiz-Duell — reine Spiel-Logik (worker-rt/quiz-logic.js): Fragensatz-
// Integrität, Pool/Auswahl, Options-Mischen (Lösung wandert korrekt mit) und
// die Punkte-Formel. Keine Runtime/DO nötig.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "worker-rt", "quiz-logic.js").replace(/\\/g, "/");
const L = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// ---------- Fragensatz-Integrität ----------
let total = 0, bad = 0, dupeOpts = 0;
for (const k of L.Q_CAT_KEYS) {
  for (const item of L.Q_CATS[k]) {
    total++;
    if (typeof item.q !== "string" || !item.q.trim()) bad++;
    if (!Array.isArray(item.a) || item.a.length !== 4) bad++;
    if (!(item.c >= 0 && item.c < 4)) bad++;
    if (new Set(item.a.map(x => String(x).toLowerCase())).size !== item.a.length) dupeOpts++;
  }
}
assert("Fragensatz: großer Pool (>= 500 für wenig Wiederholung)", total >= 500);
assert("Fragensatz: jede Frage 4 Optionen + gültiger c-Index", bad === 0);
assert("Fragensatz: keine doppelten Optionen innerhalb einer Frage", dupeOpts === 0);
// Kein doppelter Fragetext im GESAMTEN Satz (verhindert versehentliche Kopien).
const allQ = L.Q_CAT_KEYS.flatMap(k => L.Q_CATS[k].map(x => x.q.trim().toLowerCase()));
assert("Fragensatz: keine identischen Fragetexte im ganzen Satz", new Set(allQ).size === allQ.length);
assert("Fragensatz: jede Kategorie hat ein Label", L.Q_CAT_KEYS.every(k => typeof L.Q_CAT_LABELS[k] === "string"));
assert("Fragensatz: Kategorien essen, film & schwer vorhanden", ["essen", "film", "schwer"].every(k => Array.isArray(L.Q_CATS[k]) && L.Q_CATS[k].length >= 10));

// ---------- questionPool ----------
const poolAll = L.questionPool([]);
assert("questionPool: leer = alle", poolAll.length === total);
const poolGeo = L.questionPool(["geografie"]);
assert("questionPool: nur gewählte Kategorie", poolGeo.length === L.Q_CATS.geografie.length);
const poolTwo = L.questionPool(["geografie", "sport"]);
assert("questionPool: mehrere Kategorien", poolTwo.length === L.Q_CATS.geografie.length + L.Q_CATS.sport.length);
assert("questionPool: unbekannte Kategorie ignoriert → alle", L.questionPool(["quatsch"]).length === total);

// ---------- pickQuestions ----------
const seq = [0, 0, 0.5, 0.99, 0.2];
let i = 0; const rnd = () => seq[i++ % seq.length];
const picked = L.pickQuestions(poolGeo, 3, rnd);
assert("pickQuestions: n verschiedene Fragen", picked.length === 3 && new Set(picked).size === 3);
assert("pickQuestions: kappt auf Pool-Größe", L.pickQuestions(poolGeo, 9999).length === poolGeo.length);
// #5 Doppel-Fragen-Garantie: viele Ziehungen mit echtem Zufall — NIE dieselbe
// Frage zweimal in EINEM Spiel (auch nicht bei kleinem Pool / großer Rundenzahl).
let dupInGame = false;
for (let t = 0; t < 200 && !dupInGame; t++) {
  const g = L.pickQuestions(poolGeo, 20).map(x => x.q);
  if (new Set(g).size !== g.length) dupInGame = true;
}
assert("pickQuestions: keine Frage doppelt in einem Spiel (200 Läufe)", !dupInGame);

// ---------- Schwierigkeit ----------
assert("questionDifficulty: schwer-Kategorie = Stufe 3", L.questionDifficulty(L.Q_CATS.schwer[0], "schwer") === 3);
assert("questionDifficulty: allgemein-Kategorie = Stufe 1", L.questionDifficulty(L.Q_CATS.allgemein[0], "allgemein") === 1);
assert("questionDifficulty: eigenes d-Feld überschreibt", L.questionDifficulty({ d: 3 }, "allgemein") === 3);
const poolLeicht = L.questionPool([], 1), poolSchwer = L.questionPool([], 3);
assert("questionPool: Stufe filtert echt (leicht < gesamt)", poolLeicht.length > 0 && poolLeicht.length < total);
assert("questionPool: leicht + mittel + schwer = gesamt", (L.questionPool([], 1).length + L.questionPool([], 2).length + L.questionPool([], 3).length) === total);
assert("questionPool: hängt cat & diff an jede Frage", poolAll.every(x => typeof x.cat === "string" && x.diff >= 1 && x.diff <= 3));
assert("questionPool: leichte Fragen sind alle Stufe 1", poolLeicht.every(x => x.diff === 1));

// ---------- streakBonus ----------
assert("streakBonus: 0/1 in Folge = kein Bonus", L.streakBonus(0) === 0 && L.streakBonus(1) === 0);
assert("streakBonus: 2 in Folge = +10", L.streakBonus(2) === 10);
assert("streakBonus: steigt mit der Serie", L.streakBonus(5) > L.streakBonus(3));
assert("streakBonus: gedeckelt bei +50", L.streakBonus(20) === 50);

// ---------- Zeit nach Schwierigkeit ----------
assert("turnTime: schwer gibt mehr Zeit als leicht", L.turnTime(3) > L.turnTime(1));
assert("turnTime: Stufe 2 = Standardzeit", L.turnTime(2) === L.Q_TURN);
assert("turnTime: unbekannt = Fallback Q_TURN", L.turnTime(0) === L.Q_TURN);
assert("turnTime: schwer ≤ Q_TURN_MAX", L.turnTime(3) <= L.Q_TURN_MAX);

// ---------- shuffleOptions ----------
const q = { q: "Test?", a: ["RICHTIG", "A", "B", "C"], c: 0 };
for (let t = 0; t < 50; t++) {
  const r = L.shuffleOptions(q, Math.random);
  if (r.options[r.correct] !== "RICHTIG") { assert("shuffleOptions: Lösung wandert mit (Durchlauf " + t + ")", false); break; }
  if (r.options.length !== 4 || new Set(r.options).size !== 4) { assert("shuffleOptions: alle 4 Optionen erhalten", false); break; }
  if (t === 49) { assert("shuffleOptions: Lösungs-Index stimmt nach Mischen (50×)", true); assert("shuffleOptions: alle 4 Optionen erhalten", true); }
}
assert("shuffleOptions: Original unverändert", q.a[0] === "RICHTIG" && q.c === 0);
// Deterministisch mit fixem rnd: reproduzierbar
const rr = () => 0;   // schiebt immer Position 0
const s1 = L.shuffleOptions(q, rr), s2 = L.shuffleOptions(q, rr);
assert("shuffleOptions: deterministisch bei gleichem rnd", JSON.stringify(s1) === JSON.stringify(s2));

// ---------- answerGain ----------
assert("answerGain: falsch = 0", L.answerGain({ remain: L.Q_TURN, total: L.Q_TURN, correct: false }) === 0);
assert("answerGain: richtig sofort = 200", L.answerGain({ remain: L.Q_TURN, total: L.Q_TURN, correct: true }) === 200);
assert("answerGain: richtig spät = 100", L.answerGain({ remain: 0, total: L.Q_TURN, correct: true }) === 100);
assert("answerGain: früher gibt mehr", L.answerGain({ remain: 15, total: 20, correct: true }) > L.answerGain({ remain: 5, total: 20, correct: true }));

console.log("\n" + (ok ? "QUIZ-LOGIK OK" : "QUIZ-LOGIK FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
