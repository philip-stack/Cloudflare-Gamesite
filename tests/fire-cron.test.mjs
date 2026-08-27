// Verhaltens-Tests für die Fire-Cron-Orchestrierung (functions/api/fire/cron.js).
// Deckt die Garantien mit echter Konsequenz ab, ohne VAPID/Push/Geo zu brauchen:
//   - Auth (falscher/fehlender CRON_TOKEN → 403)
//   - Upstream-Fehler → sauberer {ok:false} + Health "upstream-error"
//   - LEERLISTEN-SICHERHEIT: eine leere Quelle darf NIEMALS Einsätze als
//     "beendet" markieren (sonst Fehlalarm-Fluten an alle Abos)
//   - Happy-Path: neue Einsätze werden als gesehen markiert, in fire_op
//     geschrieben, verschwundene beendet, Health "ok"
//
// Ansatz: globaler fetch wird gemockt (Aktiv-Liste + Detail), env.DB ist ein
// generischer Recorder — alle SELECTs liefern leer (⇒ alles "frisch", keine
// Ziele/Push nötig), jede .run()-Schreiboperation wird protokolliert und
// hinterher gegen SQL-Muster geprüft.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "fire", "cron.js").replace(/\\/g, "/");
const { onRequestGet } = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// Generischer D1-Recorder: SELECTs leer, Schreibvorgänge landen im Log.
function mockDB() {
  const runLog = [];
  return {
    _runLog: runLog,
    prepare(sql) {
      return {
        sql, args: [],
        bind(...a) { this.args = a; return this; },
        async all() { return { results: [] }; },
        async first() { return null; },
        async run() { runLog.push({ sql: this.sql, args: this.args }); return { meta: { changes: 1 } }; },
      };
    },
  };
}
const wrote = (db, re) => db._runLog.some(r => re.test(r.sql));
const countWrites = (db, re) => db._runLog.filter(r => re.test(r.sql)).length;

// fetch-Mock: Aktiv-Endpoint liefert `active`, Detail-Endpoint einen Dispo.
function installFetch(active, { failActive = false } = {}) {
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes("getEinsatzAktiv")) {
      if (failActive) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, json: async () => ({ Einsatz: active }) };
    }
    if (u.includes("getEinsatzData")) {
      return { ok: true, json: async () => ({ p: "3100", Dispo: [{ n: "FF Testdorf", s: 1 }] }) };
    }
    throw new Error("unerwarteter fetch: " + u);
  };
}

const TOKEN = "cron-secret-xyz";
const call = (env, header = TOKEN) => onRequestGet({
  request: new Request("https://x/api/fire/cron", { headers: header ? { "x-cron-key": header } : {} }),
  env,
});

// ---- Auth ----
{
  const env = { DB: mockDB(), CRON_TOKEN: TOKEN };
  installFetch([]);
  const rBad = await call(env, "falsch");
  assert("falscher Token → 403", rBad.status === 403);
  const rNone = await call(env, null);
  assert("fehlender Token → 403", rNone.status === 403);
}

// ---- Upstream-Fehler ----
{
  const env = { DB: mockDB(), CRON_TOKEN: TOKEN };
  installFetch([], { failActive: true });
  const res = await call(env);
  const body = await res.json();
  assert("Upstream-Fehler → ok:false, error:upstream", body.ok === false && body.error === "upstream");
  assert("Upstream-Fehler → Health 'upstream-error'", env.DB._runLog.some(r => /fire_health/.test(r.sql) && r.args.includes("upstream-error")));
  assert("Upstream-Fehler → kein ended-UPDATE", !wrote(env.DB, /UPDATE fire_op SET ended=1/));
}

// ---- LEERLISTEN-SICHERHEIT (der kritische Pfad) ----
{
  const env = { DB: mockDB(), CRON_TOKEN: TOKEN };
  installFetch([]);   // Quelle liefert leere Liste (typischer kurzer Aussetzer)
  const res = await call(env);
  const body = await res.json();
  assert("leere Liste → ok:true, active:0", body.ok === true && body.active === 0 && body.sent === 0);
  assert("leere Liste → NICHTS wird beendet", !wrote(env.DB, /UPDATE fire_op SET ended=1/));
  assert("leere Liste → Health 'empty'", env.DB._runLog.some(r => /fire_health/.test(r.sql) && r.args.includes("empty")));
}

// ---- Happy-Path: zwei aktive Einsätze, keiner bekannt ----
{
  const env = { DB: mockDB(), CRON_TOKEN: TOKEN };
  const active = [
    { n: "11111", a: "B2", m: "Brand", o: "Testdorf", b: "PL", i: "id-1" },
    { n: "22222", a: "T1", m: "Technisch", o: "Musterhausen", b: "ME", i: "id-2" },
  ];
  installFetch(active);
  const res = await call(env);
  const body = await res.json();
  assert("Happy-Path → ok:true", body.ok === true);
  assert("Happy-Path → active=2, fresh=2", body.active === 2 && body.fresh === 2);
  assert("Happy-Path → beide als gesehen markiert (fire_seen INSERT ×2)", countWrites(env.DB, /INSERT OR IGNORE INTO fire_seen/) === 2);
  assert("Happy-Path → beide in fire_op geschrieben (×2)", countWrites(env.DB, /INSERT INTO fire_op/) === 2);
  assert("Happy-Path → verschwundene werden beendet (ended-UPDATE läuft)", wrote(env.DB, /UPDATE fire_op SET ended=1/));
  assert("Happy-Path → Health 'ok'", env.DB._runLog.some(r => /fire_health/.test(r.sql) && r.args.includes("ok")));
}

console.log("\n" + (ok ? "FIRE-CRON-TESTS OK" : "FIRE-CRON-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
