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
assert("Fragensatz: großer Pool (>= 200 für wenig Wiederholung)", total >= 200);
assert("Fragensatz: jede Frage 4 Optionen + gültiger c-Index", bad === 0);
assert("Fragensatz: keine doppelten Optionen innerhalb einer Frage", dupeOpts === 0);
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
