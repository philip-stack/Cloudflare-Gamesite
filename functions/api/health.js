import { json } from "./_util.js";

// Alter eines Zeitstempels in Sekunden. Zwei Formate:
//  - iso=true: ISO-String mit Z (z. B. sprit_cron_at = new Date().toISOString())
//  - iso=false: SQLite CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC ohne Z)
function ageSec(s, iso = false) {
  if (!s) return null;
  const t = iso ? Date.parse(String(s)) : Date.parse(String(s).replace(" ", "T") + "Z");
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null;
}

// Betriebs-Healthcheck. Meldet DB-Status und ob die kritischen Secrets/Bindings
// gesetzt sind — damit ein fehlendes SCORE_SECRET (Anti-Cheat) o. Ä. NICHT
// still bleibt, sondern hier sichtbar wird. Gibt keine Werte preis, nur ob da.
//
// Cron-Dead-Man's-Switch: die Crons (Worker philip-stack-rt, alle 2 min) hinter-
// lassen einen „zuletzt gelaufen"-Stempel (fire_health.last_run, app_config.
// sprit_cron_at). Wird ein Cron zu lange still (Token/Origin falsch, Worker tot),
// steigt das Alter unbegrenzt. Ein externer Uptime-Ping auf
//   /api/health?require=cron
// bekommt dann 503 und schlägt Alarm — der Cron kann sich nicht selbst über-
// wachen (läuft er nicht, alarmiert er auch nicht). Ohne den Parameter bleibt
// /api/health rein informativ (200), damit bestehende Aufrufer unberührt bleiben.
//
// Schwellen: Fire schreibt bei JEDEM Lauf (alle 2 min) → 15 min = klar tot.
// Sprit drosselt sich selbst auf ~12 min → großzügigere 40 min.
const FIRE_STALE = 15 * 60;
const SPRIT_STALE = 40 * 60;

export async function onRequestGet({ request, env }) {
  const config = {
    scoreSecret: !!(env && env.SCORE_SECRET),
    adminToken: !!(env && env.ADMIN_TOKEN),
    cronToken: !!(env && env.CRON_TOKEN),
    // Nur VAPID_PRIVATE_JWK zählt — genau das liest push.js. (Ein bloßes
    // VAPID_PRIVATE würde Push NICHT funktionsfähig machen, also hier nicht als
    // „gesund" melden.)
    vapid: !!(env && env.VAPID_PRIVATE_JWK),
    ai: !!(env && env.AI),
    partyRoom: !!(env && env.PARTY_ROOM),
    drawRoom: !!(env && env.DRAW_ROOM),
  };

  // Cron-Alter erheben (best-effort; fehlende Tabellen → null = „unbekannt").
  const cron = { fireAgeSec: null, spritAgeSec: null, fireStaleSec: FIRE_STALE, spritStaleSec: SPRIT_STALE };
  try {
    const fh = await env.DB.prepare("SELECT last_run FROM fire_health WHERE k='cron'").first();
    cron.fireAgeSec = ageSec(fh?.last_run, false);
  } catch (_) { /* Tabelle fehlt (frische DB) → unbekannt */ }
  try {
    const sh = await env.DB.prepare("SELECT v FROM app_config WHERE k='sprit_cron_at'").first();
    cron.spritAgeSec = ageSec(sh?.v, true);
  } catch (_) { /* dito */ }
  // Unbekannt (null) gilt als stale: entweder nie gelaufen oder Tabelle weg.
  cron.fireStale = cron.fireAgeSec == null || cron.fireAgeSec > FIRE_STALE;
  cron.spritStale = cron.spritAgeSec == null || cron.spritAgeSec > SPRIT_STALE;
  cron.ok = !cron.fireStale && !cron.spritStale;

  const strictCron = new URL(request.url).searchParams.get("require") === "cron";

  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS games FROM games").first();
    // Strikter Modus (Uptime-Ping): 503, sobald ein Cron zu lange still ist.
    if (strictCron && !cron.ok) {
      return json({ ok: false, db: "connected", reason: "cron-stale", games: row.games, config, cron }, 503);
    }
    return json({ ok: true, db: "connected", games: row.games, config, cron });
  } catch (e) {
    // Fehlermeldung nicht roh nach außen geben (Info-Leak) — nur der Zustand.
    return json({ ok: false, db: "error", config, cron }, 500);
  }
}
