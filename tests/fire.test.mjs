// Tests für die Feuerwehr-NÖ-Logik: reine Helfer (Parsing/Klassifikation/
// Distanz), die zentrale Bezirks-Tabelle und die Statistik-Aggregation
// (stats.js mit gemockter D1). Deckt die Kern-Datenlogik ohne Browser ab.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const f = (...p) => "file://" + path.join(__dirname, "..", "functions", "api", ...p).replace(/\\/g, "/");

const { kindOf, classify, parseWhen, haversineKm, stufeNum } = await import(f("fire", "_parse.js"));
const { BEZIRK, bezName } = await import(f("fire", "_bezirk.js"));
const { normKey } = await import(f("fire", "geo.js"));
const { normKinds, normHome } = await import(f("fire", "alert.js"));
const stats = await import(f("fire", "stats.js"));

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// ---- _parse ----
assert("kindOf B", kindOf("B2") === "B");
assert("kindOf T", kindOf("t1") === "T");
assert("kindOf S", kindOf("S0") === "S");
assert("kindOf leer→X", kindOf("") === "X");
assert("kindOf unbekannt→X", kindOf("Z9") === "X");

assert("stufeNum B3=3", stufeNum("B3") === 3);
assert("stufeNum ohne Zahl=0", stufeNum("B") === 0);
assert("stufeNum leer=0", stufeNum("") === 0);
assert("stufeNum mehrstellig", stufeNum("T10") === 10);
assert("stufeNum Eskalation B2<B3", stufeNum("B2") < stufeNum("B3"));

const cB = classify("B3");
assert("classify Art", cB.kind === "B" && cB.label === "Brand");
assert("classify Stufe", cB.stufe === "3");
assert("classify leer→Einsatz", classify("").label === "Einsatz");

const w = parseWhen("25.07.2026", "10:42:07");
assert("parseWhen gültig", w instanceof Date && !isNaN(w));
assert("parseWhen Jahr/Tag", w.getFullYear() === 2026 && w.getDate() === 25 && w.getHours() === 10);
assert("parseWhen ungültig→null", parseWhen("keindatum", "x") === null);

// Wien → St. Pölten ~55 km Luftlinie
const d = haversineKm([48.2082, 16.3738], [48.2047, 15.6256]);
assert("haversine ~55 km", d > 48 && d < 62);
assert("haversine ohne Punkt→∞", haversineKm(null, [1, 2]) === Infinity);

// ---- _bezirk ----
assert("bezName bekannt", bezName("15") === "Neunkirchen");
assert("bezName unbekannt", bezName("999") === "Bezirk 999");
assert("bezName leer", bezName("") === "");
assert("BEZIRK vollständig (22 Codes)", Object.keys(BEZIRK).length >= 22);

// ---- geo.normKey ----
assert("normKey trimmt/kleinschreibt", normKey("  St.  Pölten ") === "st. pölten");

// ---- alert.normKinds (Einsatzart-Filter) ----
assert("normKinds leer → null (alle)", normKinds([]) === null);
assert("normKinds alle drei → null (alle)", normKinds(["B", "T", "S"]) === null);
assert("normKinds nur Brand", normKinds(["B"]) === "B");
assert("normKinds sortiert+dedupt", normKinds(["s", "b", "b"]) === "BS");
assert("normKinds ignoriert Müll", normKinds(["B", "Z", "x"]) === "B");
assert("normKinds undefined → null", normKinds(undefined) === null);

// ---- alert.normHome (Umkreis-Heimatpunkt) ----
assert("normHome gültig (NÖ)", (() => { const h = normHome({ lat: 47.72, lng: 16.08 }); return h && h.lat === 47.72 && h.lng === 16.08; })());
assert("normHome außerhalb → null", normHome({ lat: 10, lng: 10 }) === null);
assert("normHome ohne Zahlen → null", normHome({ lat: "x", lng: 1 }) === null);
assert("normHome null → null", normHome(null) === null);
assert("normHome rundet", (() => { const h = normHome({ lat: 47.1234567, lng: 16.7654321 }); return h.lat === 47.123457 && h.lng === 16.765432; })());

// ---- stats.js mit gemockter D1 ----
function mockDB(rows) {
  return {
    prepare(sql) {
      return {
        sql, args: [],
        bind(...a) { this.args = a; return this; },
        async first() { return /FROM rate/.test(this.sql) ? { n: 0 } : {}; },
        async run() { return {}; },
        async all() { return /FROM fire_op/.test(this.sql) ? { results: rows } : { results: [] }; },
      };
    },
  };
}
const statRows = [
  { a: "B2", b: "15", ended: 0, first_seen: "2026-07-29 10:00:00", ended_at: null },
  { a: "T1", b: "15", ended: 0, first_seen: "2026-07-29 09:00:00", ended_at: null },
  { a: "S0", b: "02", ended: 1, first_seen: "2026-07-29 08:00:00", ended_at: "2026-07-29 08:30:00" },
];
const sr = await stats.onRequestGet({ request: new Request("https://x/api/fire/stats"), env: { DB: mockDB(statRows) } });
const sd = await sr.json();
assert("stats 200", sr.status === 200);
assert("stats byKind", sd.byKind.B === 1 && sd.byKind.T === 1 && sd.byKind.S === 1 && sd.byKind.X === 0);
assert("stats active=2", sd.active === 2);
assert("stats last24=3", sd.last24 === 3);
assert("stats avgMin=30", sd.avgMin === 30);
assert("stats topBezirk Neunkirchen(2)", sd.topBezirk && sd.topBezirk.name === "Neunkirchen" && sd.topBezirk.count === 2);

console.log("\n" + (ok ? "FIRE-TESTS OK" : "FIRE-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
