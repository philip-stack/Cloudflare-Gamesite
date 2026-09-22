// Logik-Tests für MEERI-MANIA — prüft die reine Wirtschafts-/Merge-Logik
// aus public/meeri/app.js. Die Datei braucht das DOM und ist nicht importierbar,
// darum wird der reine Kopfteil (Stufen, Varianten, Wirtschafts-Konstanten)
// aus dem echten Quelltext geschnitten und in node:vm ausgeführt — früher
// standen die Zahlen hier als Kopie und prüften längst veraltete Werte.
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "..", "public", "meeri", "app.js"), "utf8");
const from = src.indexOf("// ---------- Evolutionsstufen"), to = src.indexOf("// ---------- Upgrade-Shop");
if (from < 0 || to < from) { console.log("FAIL Abschnitts-Marker in meeri/app.js nicht gefunden"); process.exit(1); }
const M = vm.runInContext(src.slice(from, to) +
  ";({ TIERS, MAXT, coinVal, BUY_BASE, BUY_GROW, CAP_START, CAP_STEP, CAP_MAXLEVEL, EXP_BASE, EXP_GROW, OFFLINE_EFF, OFFLINE_CAP_H })",
  vm.createContext({ Math }), { filename: "meeri/app.js" });

let ok = true;
const t = (name, cond) => { console.log((cond ? "OK   " : "FAIL ") + name); if (!cond) ok = false; };

const TIER_COUNT = M.TIERS.length;
const { coinVal, BUY_BASE, BUY_GROW, CAP_START, CAP_STEP, CAP_MAXLEVEL, EXP_BASE, EXP_GROW } = M;
// Die echten Kosten-/Platz-Funktionen des Spiels hängen am Zustand
// (buyCount, capLevel) — wir holen sie aus dem Quelltext und füttern den
// Zustand im vm-Kontext.
const fnLine = name => (src.match(new RegExp("^function " + name + "\\(\\) \\{.*\\}\\r?$", "m")) || [""])[0];
t("buyCost/capacity/expCost im Quelltext gefunden", ["buyCost", "capacity", "expCost"].every(n => fnLine(n)));
const S = vm.createContext({ Math, ...M, buyCount: 0, capLevel: 0 });
vm.runInContext(["buyCost", "capacity", "expCost"].map(fnLine).join("\n") + "\n;this.fns = { buyCost, capacity, expCost };", S);
const withState = (k, fn) => v => { S[k] = v; return S.fns[fn](); };
const buyCost = withState("buyCount", "buyCost");
const capacity = withState("capLevel", "capacity");
const expCost = withState("capLevel", "expCost");
t("MAXT = letzte Stufe", M.MAXT === TIER_COUNT - 1 && TIER_COUNT >= 10);

// Münzwert steigt streng monoton mit der Stufe
t("coinVal Stufe 0 = 1", coinVal(0) === 1);
let mono = true; for (let i = 1; i < TIER_COUNT; i++) if (coinVal(i) <= coinVal(i - 1)) mono = false;
t("coinVal streng steigend", mono);
t("Endstufe deutlich wertvoller", coinVal(TIER_COUNT - 1) > coinVal(0) * 1000);

// Kaufkosten steigen mit jedem Kauf
t("erster Kauf = BUY_BASE", buyCost(0) === BUY_BASE && BUY_BASE > 0);
t("Kauf 5 teurer als Kauf 0", buyCost(5) > buyCost(0));
let buyMono = true; for (let i = 1; i < 30; i++) if (buyCost(i) < buyCost(i - 1)) buyMono = false;
t("Kaufkosten monoton steigend", buyMono);

// Wiese-Ausbau
t("Start-Kapazität hat Platz zum Mergen (>= 4)", capacity(0) === CAP_START && CAP_START >= 4);
t("Kapazität wächst je Ausbau um CAP_STEP", capacity(3) === capacity(0) + 3 * CAP_STEP && CAP_STEP > 0);
t("Max-Kapazität bei CAP_MAXLEVEL", capacity(CAP_MAXLEVEL) === CAP_START + CAP_MAXLEVEL * CAP_STEP);
let expMono = true; for (let i = 1; i <= CAP_MAXLEVEL; i++) if (expCost(i) <= expCost(i - 1)) expMono = false;
t("Ausbau wird teurer (streng steigend)", expMono && expCost(0) === EXP_BASE);
t("erster Ausbau teurer als erster Kauf", expCost(0) > buyCost(0));

// Merge-Regel: gleiche Stufe -> +1, Endstufe nicht überschreitbar
function merge(a, b) { if (a !== b) return null; if (a >= TIER_COUNT - 1) return a; return a + 1; }
t("gleiche Stufe merged +1", merge(2, 2) === 3);
t("verschiedene Stufen mergen nicht", merge(2, 3) === null);
t("Endstufe bleibt Endstufe", merge(TIER_COUNT - 1, TIER_COUNT - 1) === TIER_COUNT - 1);

// Offline-Ertrag ist gedeckelt (ohne Perks; Formel wie applyOffline())
const { OFFLINE_CAP_H, OFFLINE_EFF } = M;
function offline(ratePerSec, elapsedSec) { return Math.floor(ratePerSec * OFFLINE_EFF * Math.min(elapsedSec, OFFLINE_CAP_H * 3600)); }
t("Offline-Werte plausibel (Effizienz < 1, Deckel > 0)", OFFLINE_EFF > 0 && OFFLINE_EFF < 1 && OFFLINE_CAP_H > 0);
t("Offline gedeckelt auf OFFLINE_CAP_H", offline(10, 999999) === offline(10, OFFLINE_CAP_H * 3600) && offline(10, 999999) === Math.floor(10 * OFFLINE_EFF * OFFLINE_CAP_H * 3600));
t("Offline < Cap linear", offline(10, 600) === Math.floor(10 * OFFLINE_EFF * 600));

// Rückkehr aus dem Hintergrund zahlt die verborgene Zeit aus (nicht nur Kaltstart)
t("visibilitychange ruft applyOffline()", /visibilitychange[\s\S]{0,600}applyOffline\(\)/.test(src));
t("save() hält lastSeen im Hintergrund fest", /lastSeen = hiddenAt \|\| Date\.now\(\)/.test(src));

console.log("\n" + (ok ? "MEERI-LOGIK OK" : "MEERI-LOGIK FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
