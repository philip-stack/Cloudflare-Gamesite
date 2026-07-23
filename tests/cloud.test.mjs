// Cloud-Backup-API-Tests mit gemockter D1 (Upsert per Code, Validierung).
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "cloud.js").replace(/\\/g, "/");
const mod = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// Minimal-Mock: eine Map code → {data, updated_at}, versteht die 3 SQLs.
function mockDB() {
  const store = new Map();
  const rate = new Map();   // Rate-Limit-Zähler pro Schlüssel
  return {
    prepare(sql) {
      return {
        sql, args: [],
        bind(...a) { this.args = a; return this; },
        async run() {
          if (/INSERT INTO cloud_saves/.test(this.sql)) {
            const [code, data, device] = this.args;
            const ex = store.get(code);
            const n = { data, device: device || null, updated_at: "2026-07-22T00:00:0" + ((store.size % 9)) + "Z" };
            if (ex) { n.prev_data = ex.data; n.prev_at = ex.updated_at; }   // vorige Version aufbewahren
            store.set(code, n);
          } else if (/INSERT INTO rate/.test(this.sql)) {
            rate.set(this.args[0], (rate.get(this.args[0]) || 0) + 1);
          }
          return {};
        },
        async first() {
          if (/COUNT\(\*\) AS n FROM rate/.test(this.sql)) {
            return { n: rate.get(this.args[0]) || 0 };
          }
          if (/SELECT updated_at, device FROM cloud_saves/.test(this.sql)) {
            const r = store.get(this.args[0]); return r ? { updated_at: r.updated_at, device: r.device } : null;
          }
          if (/SELECT data, updated_at, device, prev_data, prev_at FROM cloud_saves/.test(this.sql)) {
            return store.get(this.args[0]) || null;
          }
          return null;
        },
      };
    },
  };
}

const env = { DB: mockDB() };
const post = async body => {
  const res = await mod.onRequestPost({ request: new Request("https://x/api/cloud", { method: "POST", body: JSON.stringify(body) }), env });
  return { status: res.status, data: await res.json() };
};
const get = async code => {
  const res = await mod.onRequestGet({ request: new Request("https://x/api/cloud?code=" + code), env });
  return { status: res.status, data: await res.json() };
};

// Neues Backup ohne Code → Server vergibt einen
let r = await post({ data: { bb_name: "Tester", bb_best: "1234" }, writer: "geraeta12" });
assert("Backup gesichert (200) + Code vergeben", r.status === 200 && /^[A-Z0-9]{6,12}$/.test(r.data.code));
assert("Writer gespeichert", r.data.writer === "geraeta12");
const code = r.data.code;

// Wiederherstellen (inkl. Writer für die Geräte-Erkennung)
r = await get(code);
assert("Wiederherstellen (200)", r.status === 200 && typeof r.data.data === "string");
assert("Writer beim Laden zurück", r.data.writer === "geraeta12");
const restored = JSON.parse(r.data.data);
assert("Daten stimmen", restored.bb_name === "Tester" && restored.bb_best === "1234");

// Upsert unter gleichem Code
r = await post({ code, data: { bb_name: "Neu" } });
assert("Upsert gleicher Code", r.status === 200 && r.data.code === code);
r = await get(code);
assert("Überschrieben", JSON.parse(r.data.data).bb_name === "Neu");
assert("hasPrev nach Überschreiben", r.data.hasPrev === true);

// Vorherige Version abrufbar (1-Schritt-Wiederherstellung)
const rp = await mod.onRequestGet({ request: new Request("https://x/api/cloud?code=" + code + "&prev=1"), env });
const dp = await rp.json();
assert("Vorherige Version abrufbar", rp.status === 200 && JSON.parse(dp.data).bb_name === "Tester");

// Leeres Backup abgelehnt
r = await post({ data: {} });
assert("Leeres Backup abgelehnt (400)", r.status === 400);

// Ungültige Schreiber-Kennung abgelehnt
r = await post({ data: { x: "1" }, writer: "BAD WRITER!" });
assert("Ungültiger Writer abgelehnt (400)", r.status === 400);

// Ungültiger Code beim Laden
r = await get("!!bad!!");
assert("Ungültiger Code (400)", r.status === 400);

// Unbekannter Code
r = await get("ZZZZZZZZ");
assert("Unbekannter Code (404)", r.status === 404);

// Rate-Limit: nach vielen Schreib-Anfragen greift 429 (frische DB/IP)
const env2 = { DB: mockDB() };
const post2 = async body => (await mod.onRequestPost({
  request: new Request("https://x/api/cloud", { method: "POST", body: JSON.stringify(body) }), env: env2,
})).status;
let limited = false;
for (let i = 0; i < 45; i++) { if (await post2({ data: { n: String(i) } }) === 429) { limited = true; break; } }
assert("Rate-Limit greift (429)", limited);

console.log("\n" + (ok ? "CLOUD-TESTS OK" : "CLOUD-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
