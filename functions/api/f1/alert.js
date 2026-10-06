import { json, clientIp, rateLimit } from "../_util.js";

// ====================================================================
// Push-Meldungen des Renntickers (/f1/).
//   POST {action:"subscribe", subscription, fav, start, flags, fia}
//   POST {action:"get", endpoint}          → { on, fav, start, flags, fia }
//   POST {action:"unsubscribe", endpoint}
// Gespeichert wird nur der anonyme Push-Endpoint + die Auswahl (f1_alert).
// Versand zeitgesteuert über /api/f1/cron.
// ====================================================================

const bit = v => (v ? 1 : 0);

export async function onRequestPost({ request, env }) {
  if (env && env.DB && !(await rateLimit(env, "f1alert:" + clientIp(request), 40, 60))) {
    return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
  }
  if (!env || !env.DB) return json({ error: "nicht verfügbar" }, 503);
  const b = await request.json().catch(() => ({}));
  const action = String(b.action || "");

  if (action === "subscribe") {
    const endpoint = String((b.subscription || {}).endpoint || "");
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 800) return json({ error: "Ungültiges Abo" }, 400);
    const fav = Number.isInteger(b.fav) && b.fav > 0 && b.fav < 100 ? b.fav : null;
    await env.DB.prepare(
      "INSERT INTO f1_alert (endpoint, fav, start, flags, fia, at) VALUES (?, ?, ?, ?, ?, datetime('now')) " +
      "ON CONFLICT(endpoint) DO UPDATE SET fav = excluded.fav, start = excluded.start, flags = excluded.flags, fia = excluded.fia, at = excluded.at"
    ).bind(endpoint, fav, bit(b.start), bit(b.flags), bit(b.fia)).run();
    return json({ ok: true });
  }

  const endpoint = String(b.endpoint || "");
  if (!endpoint) return json({ error: "endpoint fehlt" }, 400);

  if (action === "get") {
    const r = await env.DB.prepare("SELECT fav, start, flags, fia FROM f1_alert WHERE endpoint = ?").bind(endpoint).first();
    return json(r ? { on: true, fav: r.fav, start: !!r.start, flags: !!r.flags, fia: !!r.fia } : { on: false });
  }
  if (action === "unsubscribe") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM f1_alert WHERE endpoint = ?").bind(endpoint),
      env.DB.prepare("DELETE FROM push_queue WHERE endpoint = ?").bind(endpoint),
    ]);
    return json({ ok: true });
  }
  return json({ error: "unbekannte Aktion" }, 400);
}
