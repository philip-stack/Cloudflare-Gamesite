import { json, clientIp, rateLimit } from "../_util.js";

// ====================================================================
// Tages-Briefing lesen (öffentlich, nur Lesen).
//   GET /api/briefing          → { today, days:[…] }
//
// Erzeugt wird NICHTS — das macht ausschließlich der Cron. Ein Seitenaufruf
// darf keinen KI-Aufruf auslösen, sonst könnte jeder Besucher das
// Tageskontingent leeren.
//
// Eingestellt wird im Admin-Panel; darum gibt es hier bewusst kein POST.
// ====================================================================

export async function onRequestGet({ request, env }) {
  if (env && env.DB && !(await rateLimit(env, "briefing:" + clientIp(request), 60, 60))) {
    return json({ error: "Zu viele Anfragen" }, 429);
  }
  if (!env.DB) return json({ error: "keine Datenbank" }, 503);

  const rows = await env.DB.prepare(
    "SELECT day, text, data, via, at FROM briefing ORDER BY day DESC LIMIT 14"
  ).all();

  const days = (rows.results || []).map(r => ({
    day: r.day, text: r.text, via: r.via, at: r.at,
    data: (() => { try { return JSON.parse(r.data || "null"); } catch { return null; } })(),
  }));

  return new Response(JSON.stringify({ today: days[0] || null, days }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Kurz zwischenspeichern: der Text ändert sich einmal am Tag.
      "Cache-Control": "public, max-age=120",
    },
  });
}
