// Tests für /api/health, speziell den Cron-Dead-Man's-Switch:
//   /api/health           → immer 200 (informativ), cron-Alter im Body
//   /api/health?require=cron → 503, sobald ein Cron zu lange still ist
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "health.js").replace(/\\/g, "/");
const { onRequestGet } = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// SQLite-Format "YYYY-MM-DD HH:MM:SS" (UTC, ohne Z) für fire_health.last_run.
const sqliteTs = ms => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
// ISO (mit Z) für app_config.sprit_cron_at.
const isoTs = ms => new Date(ms).toISOString();

// DB-Mock: liefert konfigurierbare Cron-Stempel; games-COUNT immer ok.
function mockDB({ fireMs, spritMs }) {
  return {
    prepare(sql) {
      return {
        args: [], bind(...a) { this.args = a; return this; },
        async first() {
          if (/fire_health/.test(sql)) return fireMs == null ? null : { last_run: sqliteTs(fireMs) };
          if (/sprit_cron_at/.test(sql)) return spritMs == null ? null : { v: isoTs(spritMs) };
          if (/COUNT\(\*\) AS games/.test(sql)) return { games: 3 };
          return null;
        },
        async run() { return {}; },
      };
    },
  };
}
const now = Date.now();
const get = (env, strict = false) => onRequestGet({
  request: new Request("https://x/api/health" + (strict ? "?require=cron" : "")), env,
});

// ---- Beide frisch ----
{
  const env = { DB: mockDB({ fireMs: now - 60_000, spritMs: now - 120_000 }), SCORE_SECRET: "s", VAPID_PRIVATE_JWK: "j" };
  const res = await get(env);
  const body = await res.json();
  assert("frisch → 200 ok", res.status === 200 && body.ok === true);
  assert("frisch → cron.ok true", body.cron.ok === true && body.cron.fireStale === false && body.cron.spritStale === false);
  assert("frisch → strict bleibt 200", (await get(env, true)).status === 200);
  assert("vapid nur bei JWK true", body.config.vapid === true);
}

// ---- Fire-Cron tot ----
{
  const env = { DB: mockDB({ fireMs: now - 60 * 60_000, spritMs: now - 120_000 }) };   // fire 1 h alt
  const res = await get(env);
  const body = await res.json();
  assert("fire tot → /health bleibt informativ (200)", res.status === 200);
  assert("fire tot → cron.fireStale true, cron.ok false", body.cron.fireStale === true && body.cron.ok === false);
  const strict = await get(env, true);
  const sBody = await strict.json();
  assert("fire tot → strict 503", strict.status === 503 && sBody.ok === false && sBody.reason === "cron-stale");
}

// ---- Nie gelaufen (null) gilt als stale ----
{
  const env = { DB: mockDB({ fireMs: null, spritMs: null }) };
  const body = await (await get(env)).json();
  assert("null → beide stale", body.cron.fireStale === true && body.cron.spritStale === true);
  assert("null → strict 503", (await get(env, true)).status === 503);
}

// ---- Sprit-Schwelle großzügiger als Fire (12-min-Selbstdrossel) ----
{
  // 20 min alt: Fire wäre stale (>15), Sprit noch ok (<40).
  const env = { DB: mockDB({ fireMs: now - 20 * 60_000, spritMs: now - 20 * 60_000 }) };
  const body = await (await get(env)).json();
  assert("20 min → fire stale, sprit ok", body.cron.fireStale === true && body.cron.spritStale === false);
}

console.log("\n" + (ok ? "HEALTH-TESTS OK" : "HEALTH-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
