// Anonyme Nutzungszähler (functions/api/stat.js) mit gemockter D1: gültige
// Ereignisse werden hochgezählt, ungültige still verworfen — und NIE eine
// Kennung gespeichert.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "stat.js").replace(/\\/g, "/");
const mod = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// Mock-D1: merkt sich stat_daily-Inserts, beantwortet die Rate-COUNT-Abfrage.
function mockDB() {
  const inserts = [];
  return {
    inserts,
    prepare(sql) {
      return {
        sql, args: [],
        bind(...a) { this.args = a; return this; },
        async first() { if (/COUNT\(\*\) AS n FROM rate/.test(this.sql)) return { n: 0 }; return {}; },
        async run() { if (/INTO stat_daily/.test(this.sql)) inserts.push({ sql: this.sql, args: this.args }); return {}; },
      };
    },
  };
}
const post = (db, body) => mod.onRequestPost({
  request: new Request("https://x/api/stat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  env: { DB: db },
});

// Gültiges Ereignis wird gezählt.
{
  const db = mockDB();
  const r = await post(db, { ev: "play", game: "galopp" });
  assert("gültiges play → 204", r.status === 204);
  assert("gültiges play → ein Insert", db.inserts.length === 1);
  assert("Insert-Schlüssel = ev:game", db.inserts[0].args[1] === "play:galopp");
  assert("Insert-Tag ist YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(db.inserts[0].args[0]));
  assert("Insert speichert KEINE Kennung (nur day + key)", db.inserts[0].args.length === 2);
}
// duel/share ebenso erlaubt, game wird kleingeschrieben.
{
  const db = mockDB();
  await post(db, { ev: "duel", game: "Komet" });
  assert("duel → gezählt, game kleingeschrieben", db.inserts.length === 1 && db.inserts[0].args[1] === "duel:komet");
}
// Unbekanntes Ereignis wird verworfen.
{
  const db = mockDB();
  const r = await post(db, { ev: "hack", game: "galopp" });
  assert("unbekanntes ev → 204, kein Insert", r.status === 204 && db.inserts.length === 0);
}
// Ungültiger game-Wert (Sonderzeichen) wird verworfen.
{
  const db = mockDB();
  await post(db, { ev: "play", game: "../etc" });
  assert("ungültiger game-Wert → kein Insert", db.inserts.length === 0);
}
// Fehlendes game wird verworfen.
{
  const db = mockDB();
  await post(db, { ev: "play" });
  assert("fehlendes game → kein Insert", db.inserts.length === 0);
}
// Kaputter Body stürzt nicht ab.
{
  const db = mockDB();
  const r = await mod.onRequestPost({ request: new Request("https://x/api/stat", { method: "POST", body: "nicht-json" }), env: { DB: db } });
  assert("kaputter Body → 204, kein Insert", r.status === 204 && db.inserts.length === 0);
}
// GET verrät keine Daten.
{
  const r = await mod.onRequestGet();
  const j = await r.json();
  assert("GET → ok:true ohne Daten", j.ok === true && !("usage" in j));
}

console.log("\n" + (ok ? "STAT-TESTS OK" : "STAT-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
