// Logik-Tests für MEERI-MANIA — repliziert die reine Wirtschafts-/Merge-Logik
// aus public/meeri/app.js (die Datei braucht das DOM, daher nicht importierbar).
let ok = true;
const t = (name, cond) => { console.log((cond ? "OK   " : "FAIL ") + name); if (!cond) ok = false; };

const TIER_COUNT = 16;
const coinVal = tier => Math.round(Math.pow(2.1, tier)) || 1;
const BUY_BASE = 10, BUY_GROW = 1.18;
const CAP_START = 6, CAP_STEP = 3, CAP_MAXLEVEL = 8;
const EXP_BASE = 100, EXP_GROW = 2.2;
const buyCost = n => Math.round(BUY_BASE * Math.pow(BUY_GROW, n));
const capacity = lvl => CAP_START + lvl * CAP_STEP;
const expCost = lvl => Math.round(EXP_BASE * Math.pow(EXP_GROW, lvl));

// Münzwert steigt streng monoton mit der Stufe
t("coinVal Stufe 0 = 1", coinVal(0) === 1);
let mono = true; for (let i = 1; i < TIER_COUNT; i++) if (coinVal(i) <= coinVal(i - 1)) mono = false;
t("coinVal streng steigend", mono);
t("Endstufe deutlich wertvoller", coinVal(TIER_COUNT - 1) > coinVal(0) * 1000);

// Kaufkosten steigen mit jedem Kauf
t("erster Kauf = 10", buyCost(0) === 10);
t("Kauf 5 teurer als Kauf 0", buyCost(5) > buyCost(0));
let buyMono = true; for (let i = 1; i < 30; i++) if (buyCost(i) < buyCost(i - 1)) buyMono = false;
t("Kaufkosten monoton steigend", buyMono);

// Wiese-Ausbau
t("Start-Kapazität 6", capacity(0) === 6);
t("Kapazität wächst je Ausbau", capacity(3) === 6 + 9);
t("Max-Kapazität bei Level 8", capacity(CAP_MAXLEVEL) === 6 + 8 * 3);
t("Ausbau wird teurer", expCost(2) > expCost(0) && expCost(0) === 100);

// Merge-Regel: gleiche Stufe -> +1, Endstufe nicht überschreitbar
function merge(a, b) { if (a !== b) return null; if (a >= TIER_COUNT - 1) return a; return a + 1; }
t("gleiche Stufe merged +1", merge(2, 2) === 3);
t("verschiedene Stufen mergen nicht", merge(2, 3) === null);
t("Endstufe bleibt Endstufe", merge(TIER_COUNT - 1, TIER_COUNT - 1) === TIER_COUNT - 1);

// Offline-Ertrag ist gedeckelt
const OFFLINE_CAP_H = 3, OFFLINE_EFF = 0.4;
function offline(ratePerSec, elapsedSec) { return Math.floor(ratePerSec * OFFLINE_EFF * Math.min(elapsedSec, OFFLINE_CAP_H * 3600)); }
t("Offline gedeckelt auf 3h", offline(10, 999999) === Math.floor(10 * 0.4 * 3 * 3600));
t("Offline < Cap linear", offline(10, 600) === Math.floor(10 * 0.4 * 600));

console.log("\n" + (ok ? "MEERI-LOGIK OK" : "MEERI-LOGIK FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
