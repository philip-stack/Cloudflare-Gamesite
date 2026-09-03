import { json, clientIp, rateLimit } from "../_util.js";

// ====================================================================
// Tages-Briefing lesen.
//   GET /api/briefing     (Header x-admin-key ODER ?key=)  → { today, days }
//
// NICHT öffentlich: der Text nennt Bezirk und Tankstelle in Wohnortnähe.
// Geschützt mit demselben ADMIN_TOKEN wie das Betriebs-Panel — die Seite
// /briefing/ nimmt den Schlüssel aus demselben Speicher, ein einmal am
// Panel angemeldetes Gerät kommt also ohne weitere Eingabe rein.
//
// Erzeugt wird hier NICHTS — das macht ausschließlich der Cron. Ein
// Seitenaufruf darf keinen KI-Aufruf auslösen, sonst könnte jeder Besucher
// das Tageskontingent leeren. Eingestellt wird im Admin-Panel, darum gibt es
// hier auch kein POST.
// ====================================================================

function keyOk(env, request) {
  const want = env && env.ADMIN_TOKEN;
  if (!want) return false;
  const url = new URL(request.url);
  const got = request.headers.get("x-admin-key") || url.searchParams.get("key") || "";
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

export async function onRequestGet({ request, env }) {
  if (env && env.DB && !(await rateLimit(env, "briefing:" + clientIp(request), 60, 60))) {
    return json({ error: "Zu viele Anfragen" }, 429);
  }
  if (!keyOk(env, request)) return json({ error: "Nicht berechtigt" }, 401);
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
      // Persönlich → nur im Browser zwischenspeichern, nie in Zwischenspeichern
      // unterwegs (der Schlüssel steckt eventuell in der Adresse).
      "Cache-Control": "private, max-age=60",
    },
  });
}
