import { json } from "../_util.js";

// ====================================================================
// Gesundheitszustand der Live-Aktualisierung für /fire/noe.
//   GET /api/fire/health → { ok, ageSec, active, note }
// Die App zeigt einen Warnhinweis, wenn der Cron (Worker→/api/fire/cron→
// Quelle) offenbar hängt (ageSec zu groß). ageSec = Sekunden seit letztem
// erfolgreichen Cron-Lauf. Kein Wert (null) = noch nie gelaufen.
// ====================================================================

export async function onRequestGet({ env }) {
  try {
    if (!env || !env.DB) return json({ ok: false, ageSec: null });
    const row = await env.DB.prepare(
      "SELECT last_run, active, detail_fetched, note FROM fire_health WHERE k = 'cron'"
    ).first();
    if (!row || !row.last_run) return json({ ok: false, ageSec: null });
    const t = Date.parse(String(row.last_run).replace(" ", "T") + "Z");
    const ageSec = isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 1000));
    return json({ ok: true, lastRun: row.last_run, ageSec, active: row.active, note: row.note });
  } catch (_) {
    return json({ ok: false, ageSec: null });
  }
}
