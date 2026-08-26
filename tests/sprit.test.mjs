// Tests für die Sprit-Radar-Logik: reine Entscheidungslogik des Preis-Alarms
// (Zustandsübergang armed/re-arm, Gruppenschlüssel) und die Treibstoff-
// Normalisierung. Deckt die im Cron folgenreiche Logik ohne DB/Netz ab.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const f = (...p) => "file://" + path.join(__dirname, "..", "functions", "api", ...p).replace(/\\/g, "/");

const { alertTransition, groupKey } = await import(f("sprit", "_logic.js"));
const { normFuel, FUELS } = await import(f("sprit", "_ec.js"));

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// ---- alertTransition ----
assert("fire: scharf & Preis unter Ziel", alertTransition(1, 1.499, 1.50) === "fire");
assert("fire: scharf & Preis genau am Ziel", alertTransition(1, 1.50, 1.50) === "fire");
assert("none: scharf & Preis über Ziel", alertTransition(1, 1.60, 1.50) === "none");
assert("rearm: entschärft & Preis wieder über Ziel", alertTransition(0, 1.60, 1.50) === "rearm");
assert("none: entschärft & Preis noch unter Ziel", alertTransition(0, 1.40, 1.50) === "none");
assert("none: ungültiger Preis", alertTransition(1, null, 1.50) === "none");
assert("none: ungültiges Ziel", alertTransition(1, 1.40, undefined) === "none");
// Kein Dauer-Spam: einmal ausgelöst (→ armed=0) feuert bei weiter fallendem Preis nicht erneut.
assert("kein Re-Fire bei entschärft & weiter fallend", alertTransition(0, 1.30, 1.50) === "none");

// ---- groupKey ----
assert("groupKey rundet auf 2 Stellen", groupKey("DIE", 48.20817, 16.37383) === "DIE|48.21,16.37");
assert("groupKey trennt nach Treibstoff", groupKey("SUP", 48.2, 16.3) !== groupKey("DIE", 48.2, 16.3));
assert("groupKey teilt nahe Koordinaten", groupKey("DIE", 48.204, 16.371) === groupKey("DIE", 48.203, 16.374));

// ---- normFuel ----
assert("normFuel Default Diesel", normFuel("") === "DIE" && normFuel("XXX") === "DIE");
assert("normFuel SUP/GAS bleiben", normFuel("SUP") === "SUP" && normFuel("GAS") === "GAS");
assert("FUELS-Labels vorhanden", FUELS.DIE && FUELS.SUP && FUELS.GAS);

console.log("\n" + (ok ? "SPRIT-TESTS OK" : "SPRIT-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
