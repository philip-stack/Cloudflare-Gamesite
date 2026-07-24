import { json, clientIp, rateLimit } from "../_util.js";

// ====================================================================
// Bezirks-Alarm (Push) für /fire/noe.
//   POST {action:"subscribe", subscription, bezirke:[codes|"*"]}
//   POST {action:"unsubscribe", endpoint}
//   POST {action:"get", endpoint}   → { bezirke:[...] }
//
// Gespeichert wird nur Endpoint→Bezirk (fire_alert). Der Versand erfolgt
// später zeitgesteuert über /api/fire/cron (payload-loser Tickle + Queue,
// derselbe Mechanismus wie /api/push).
// ====================================================================

export async function onRequestPost({ request, env }) {
  if (env && env.DB && !(await rateLimit(env, "firealert:" + clientIp(request), 40, 60))) {
    return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
  }
  const b = await request.json().catch(() => ({}));
  const action = String(b.action || "");

  if (action === "subscribe") {
    const sub = b.subscription || {};
    const endpoint = String(sub.endpoint || "");
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 800) return json({ error: "Ungültiges Abo" }, 400);
    let bezirke = Array.isArray(b.bezirke) ? b.bezirke : [];
    bezirke = [...new Set(bezirke.map(x => String(x).trim()).filter(x => x === "*" || /^\d{2,3}$/.test(x)))].slice(0, 25);
    if (!bezirke.length) return json({ error: "Keinen Bezirk gewählt" }, 400);

    await env.DB.prepare("DELETE FROM fire_alert WHERE endpoint = ?").bind(endpoint).run();
    for (const bez of bezirke) {
      await env.DB.prepare("INSERT OR IGNORE INTO fire_alert (endpoint, bezirk) VALUES (?, ?)").bind(endpoint, bez).run();
    }
    return json({ ok: true, bezirke });
  }

  if (action === "get") {
    const endpoint = String(b.endpoint || "");
    if (!endpoint) return json({ bezirke: [] });
    const rows = (await env.DB.prepare("SELECT bezirk FROM fire_alert WHERE endpoint = ?").bind(endpoint).all()).results || [];
    return json({ bezirke: rows.map(r => r.bezirk) });
  }

  if (action === "unsubscribe") {
    await env.DB.prepare("DELETE FROM fire_alert WHERE endpoint = ?").bind(String(b.endpoint || "")).run();
    return json({ ok: true });
  }

  return json({ error: "Unbekannte Aktion" }, 400);
}
