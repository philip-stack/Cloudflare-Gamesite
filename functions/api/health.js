import { json } from "./_util.js";

// Betriebs-Healthcheck. Meldet DB-Status und ob die kritischen Secrets/Bindings
// gesetzt sind — damit ein fehlendes SCORE_SECRET (Anti-Cheat) o. Ä. NICHT
// still bleibt, sondern hier sichtbar wird. Gibt keine Werte preis, nur ob da.
export async function onRequestGet({ env }) {
  const config = {
    scoreSecret: !!(env && env.SCORE_SECRET),
    adminToken: !!(env && env.ADMIN_TOKEN),
    cronToken: !!(env && env.CRON_TOKEN),
    vapid: !!(env && (env.VAPID_PRIVATE_JWK || env.VAPID_PRIVATE)),
    ai: !!(env && env.AI),
    partyRoom: !!(env && env.PARTY_ROOM),
    drawRoom: !!(env && env.DRAW_ROOM),
  };
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS games FROM games").first();
    return json({ ok: true, db: "connected", games: row.games, config });
  } catch (e) {
    // Fehlermeldung nicht roh nach außen geben (Info-Leak) — nur der Zustand.
    return json({ ok: false, db: "error", config }, 500);
  }
}
