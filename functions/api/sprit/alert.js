import { json, clientIp, rateLimit } from "../_util.js";
import { normFuel } from "./_ec.js";

// ====================================================================
// Preis-Alarm für Tankstellen (Sprit-Radar).
//   POST {action:"subscribe", subscription, station:{id,name,lat,lng}, fuel, target}
//   POST {action:"remove", endpoint, id, fuel}
//   POST {action:"clear",  endpoint}
//   POST {action:"list",   endpoint}   → { alerts:[{id,name,fuel,target}] }
//
// Gespeichert wird nur der anonyme Push-Endpoint + Station/Treibstoff/Zielpreis
// (sprit_alert). Versand später zeitgesteuert über /api/sprit/cron.
// ====================================================================

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

export async function onRequestPost({ request, env }) {
  if (env && env.DB && !(await rateLimit(env, "spritalert:" + clientIp(request), 40, 60))) {
    return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
  }
  if (!env || !env.DB) return json({ error: "nicht verfügbar" }, 503);
  const b = await request.json().catch(() => ({}));
  const action = String(b.action || "");

  if (action === "subscribe") {
    const sub = b.subscription || {};
    const endpoint = String(sub.endpoint || "");
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 800) return json({ error: "Ungültiges Abo" }, 400);
    const st = b.station || {};
    const id = String(st.id || "").slice(0, 40);
    const fuel = normFuel(b.fuel);
    const target = num(b.target, 0.5, 5);
    const lat = num(st.lat, 45, 50), lng = num(st.lng, 13, 18);
    if (!id || target == null || lat == null || lng == null) return json({ error: "Ungültige Angaben" }, 400);
    const name = String(st.name || "").slice(0, 80);

    // Obergrenze je Endpoint (Missbrauch/Wildwuchs vermeiden).
    const cnt = (await env.DB.prepare("SELECT COUNT(*) n FROM sprit_alert WHERE endpoint = ?").bind(endpoint).first())?.n ?? 0;
    if (cnt >= 30) return json({ error: "Zu viele Alarme (max. 30)" }, 400);

    await env.DB.prepare(
      `INSERT INTO sprit_alert (endpoint, station_id, fuel, target, name, lat, lng, armed)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(endpoint, station_id, fuel)
       DO UPDATE SET target=excluded.target, name=excluded.name, lat=excluded.lat, lng=excluded.lng, armed=1`
    ).bind(endpoint, id, fuel, target, name, lat, lng).run();
    return json({ ok: true, id, fuel, target });
  }

  if (action === "remove") {
    const endpoint = String(b.endpoint || ""), id = String(b.id || ""), fuel = normFuel(b.fuel);
    if (!endpoint || !id) return json({ error: "fehlt" }, 400);
    await env.DB.prepare("DELETE FROM sprit_alert WHERE endpoint = ? AND station_id = ? AND fuel = ?").bind(endpoint, id, fuel).run();
    return json({ ok: true });
  }

  if (action === "clear") {
    await env.DB.prepare("DELETE FROM sprit_alert WHERE endpoint = ?").bind(String(b.endpoint || "")).run();
    return json({ ok: true });
  }

  if (action === "list") {
    const endpoint = String(b.endpoint || "");
    if (!endpoint) return json({ alerts: [] });
    const rows = (await env.DB.prepare(
      "SELECT station_id AS id, name, fuel, target FROM sprit_alert WHERE endpoint = ? ORDER BY at DESC"
    ).bind(endpoint).all()).results || [];
    return json({ alerts: rows });
  }

  return json({ error: "Unbekannte Aktion" }, 400);
}
