// Betreiber-Dashboard: Auth (ADMIN_TOKEN) + destruktive POST-Aktionen.
// Der Endpunkt kann Geräte sperren und Scores/Bestenlisten löschen — genau das
// muss gegen unbefugten Zugriff und Tippfehler abgesichert sein.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "admin.js").replace(/\\/g, "/");
const mod = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

const TOKEN = "test-admin-token-1234567890";

// Mock-D1: zeichnet ausgeführte SQL auf; liefert harmlose Defaults für die
// vielen Aggregat-SELECTs des GET-Pfads.
function mockDB() {
  const runs = [];
  const stub = (sql) => ({
    sql, args: [],
    bind(...a) { this.args = a; return this; },
    async first() { return {}; },
    async all() { return { results: [] }; },
    async run() { runs.push({ sql, args: this.args }); return { meta: { changes: 1 } }; },
  });
  return { _runs: runs, prepare(sql) { return stub(sql); } };
}
const envWith = (db) => ({ DB: db, ADMIN_TOKEN: TOKEN });
const req = (opts = {}) => new Request("https://x/api/admin", opts);
const withKey = (extra = {}) => ({ "x-admin-key": TOKEN, ...extra });

// ---------- Auth ----------
{
  const r = await mod.onRequestGet({ request: req(), env: envWith(mockDB()) });
  assert("GET ohne Schlüssel → 401", r.status === 401);
}
{
  const r = await mod.onRequestGet({ request: req({ headers: { "x-admin-key": "falsch" } }), env: envWith(mockDB()) });
  assert("GET mit falschem Schlüssel → 401", r.status === 401);
}
{
  const r = await mod.onRequestPost({ request: req({ method: "POST", body: JSON.stringify({ action: "clearErrors" }) }), env: envWith(mockDB()) });
  assert("POST ohne Schlüssel → 401", r.status === 401);
}
{
  // Ohne gesetztes ADMIN_TOKEN im env ist alles gesperrt (kein Bypass).
  const r = await mod.onRequestGet({ request: req({ headers: { "x-admin-key": "" } }), env: { DB: mockDB() } });
  assert("kein ADMIN_TOKEN gesetzt → 401", r.status === 401);
}

// ---------- Destruktive Aktionen (nur mit Schlüssel) ----------
{
  const db = mockDB();
  const r = await mod.onRequestPost({ request: req({ method: "POST", headers: withKey(), body: JSON.stringify({ action: "deleteScore", id: 42 }) }), env: envWith(db) });
  const body = await r.json();
  assert("deleteScore mit Schlüssel → 200 ok", r.status === 200 && body.ok === true);
  assert("deleteScore führt DELETE mit id aus", db._runs.some(x => /DELETE FROM scores WHERE id/.test(x.sql) && x.args[0] === 42));
}
{
  const db = mockDB();
  const r = await mod.onRequestPost({ request: req({ method: "POST", headers: withKey(), body: JSON.stringify({ action: "deleteScore", id: "nope" }) }), env: envWith(db) });
  assert("deleteScore ohne gültige id → 400", r.status === 400);
}
{
  const db = mockDB();
  const r = await mod.onRequestPost({ request: req({ method: "POST", headers: withKey(), body: JSON.stringify({ action: "banDevice", device: "abcd1234efgh" }) }), env: envWith(db) });
  assert("banDevice mit Schlüssel → 200", r.status === 200);
  assert("banDevice schreibt in banned_device", db._runs.some(x => /INSERT OR IGNORE INTO banned_device/.test(x.sql)));
}
{
  const db = mockDB();
  const r = await mod.onRequestPost({ request: req({ method: "POST", headers: withKey(), body: JSON.stringify({ action: "banDevice", device: "kurz" }) }), env: envWith(db) });
  assert("banDevice mit ungültigem Gerät → 400", r.status === 400);
}
{
  const r = await mod.onRequestPost({ request: req({ method: "POST", headers: withKey(), body: JSON.stringify({ action: "gibtsnicht" }) }), env: envWith(mockDB()) });
  assert("unbekannte Aktion → 400", r.status === 400);
}

// ---------- Fehlversuche landen im Audit-Log (ISMS) ----------
{
  const db = mockDB();
  await mod.onRequestGet({ request: req({ headers: { "x-admin-key": "falsch" } }), env: envWith(db) });
  const row = db._runs.find(x => /INSERT INTO admin_log/.test(x.sql) && /auth:fail/.test(x.sql));
  assert("GET-Fehlversuch wird protokolliert", !!row);
  assert("protokolliert die Quelle, NICHT den Schlüssel",
    !!row && row.args.every(a => String(a).indexOf("falsch") < 0) && /Header/.test(String(row.args[0])));
}
{
  const db = mockDB();
  await mod.onRequestPost({ request: req({ method: "POST", headers: { "x-admin-key": "falsch" }, body: "{}" }), env: envWith(db) });
  assert("POST-Fehlversuch wird protokolliert",
    db._runs.some(x => /INSERT INTO admin_log/.test(x.sql) && /auth:fail/.test(x.sql) && /POST/.test(String(x.args[0]))));
}

// ---------- Erfolgreicher GET: liefert die neuen Kennzahlen ----------
{
  const r = await mod.onRequestGet({ request: req({ headers: withKey() }), env: envWith(mockDB()) });
  const b = await r.json();
  assert("GET mit Schlüssel → 200", r.status === 200);
  assert("Antwort enthält Reichweite", !!b.reach && typeof b.reach.players === "number");
  assert("Antwort enthält Tabellengrößen", !!b.db && typeof b.db.tables === "object");
  // Ohne Fire-Lauf (der Mock liefert eine leere Zeile) MUSS die Ampel warnen —
  // sonst wäre ein hängender Cron ein stiller Grünzustand.
  assert("kein Fire-Lauf → Ampel warnt", b.status === "warn" && b.warns.some(w => /Fire-Cron/.test(w)));
}

console.log(ok ? "\n✅ admin: alle Tests grün" : "\n❌ admin: Tests fehlgeschlagen");
process.exit(ok ? 0 : 1);
