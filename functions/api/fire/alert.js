import { json, clientIp, rateLimit } from "../_util.js";

// ====================================================================
// Bezirks-Alarm (Push) für /fire/noe.
//   POST {action:"subscribe", subscription, bezirke:[codes|"*"], kinds?:[B,T,S]}
//   POST {action:"unsubscribe", endpoint}
//   POST {action:"get", endpoint}   → { bezirke:[...], kinds:[...] }
//
// Gespeichert wird nur Endpoint→Bezirk (fire_alert), optional gefiltert nach
// Einsatzart (Spalte kinds, Teilmenge von "BTS"; leer = alle). Der Versand
// erfolgt später zeitgesteuert über /api/fire/cron (payload-loser Tickle +
// Queue, derselbe Mechanismus wie /api/push).
// ====================================================================

// [B,T,S,…] → normalisierter „BTS"-Teilmengen-String bzw. null (= alle Arten).
// Leer ODER alle drei gewählt heißt „keine Einschränkung" → null.
export function normKinds(arr) {
  const set = new Set((Array.isArray(arr) ? arr : []).map(x => String(x).trim().toUpperCase()).filter(x => "BTS".includes(x)));
  if (set.size === 0 || set.size >= 3) return null;
  return [...set].sort().join("");
}

// Heimatpunkt validieren (grob im AT-Umfeld) → {lat,lng} | null.
export function normHome(home) {
  if (!home || typeof home.lat !== "number" || typeof home.lng !== "number") return null;
  if (home.lat < 45 || home.lat > 50 || home.lng < 13 || home.lng > 18) return null;
  return { lat: Math.round(home.lat * 1e6) / 1e6, lng: Math.round(home.lng * 1e6) / 1e6 };
}
export const RADII = [5, 10, 20, 50];   // km — erlaubte Umkreis-Stufen

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
    const kinds = normKinds(b.kinds);
    const home = normHome(b.home);
    const radius = home && RADII.includes(Number(b.radius)) ? Number(b.radius) : null;
    const wantRadius = !!(home && radius);
    if (!bezirke.length && !wantRadius) return json({ error: "Bitte Bezirk(e) oder den Umkreis wählen" }, 400);

    await env.DB.prepare("DELETE FROM fire_alert WHERE endpoint = ?").bind(endpoint).run();
    const insBez = async withKinds => {
      for (const bez of bezirke) {
        await (withKinds
          ? env.DB.prepare("INSERT OR IGNORE INTO fire_alert (endpoint, bezirk, kinds) VALUES (?, ?, ?)").bind(endpoint, bez, kinds)
          : env.DB.prepare("INSERT OR IGNORE INTO fire_alert (endpoint, bezirk) VALUES (?, ?)").bind(endpoint, bez)
        ).run();
      }
    };
    try {
      await insBez(true);
      // Umkreis-Zeile (Marker-Bezirk '~') mit Heimatpunkt + Radius.
      if (wantRadius) {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO fire_alert (endpoint, bezirk, kinds, home_lat, home_lng, radius_km) VALUES (?, '~', ?, ?, ?, ?)"
        ).bind(endpoint, kinds, home.lat, home.lng, radius).run();
      }
    } catch (_) {
      // Spalten kinds/home_* noch nicht migriert → Bezirke ohne Extras speichern.
      await insBez(false);
    }
    return json({ ok: true, bezirke, kinds: kinds ? kinds.split("") : [], home: wantRadius ? home : null, radius });
  }

  if (action === "get") {
    const endpoint = String(b.endpoint || "");
    if (!endpoint) return json({ bezirke: [], kinds: [], home: null, radius: null });
    let rows;
    try {
      rows = (await env.DB.prepare("SELECT bezirk, kinds, home_lat, home_lng, radius_km FROM fire_alert WHERE endpoint = ?").bind(endpoint).all()).results || [];
    } catch (_) {
      try { rows = (await env.DB.prepare("SELECT bezirk, kinds FROM fire_alert WHERE endpoint = ?").bind(endpoint).all()).results || []; }
      catch (_2) { rows = (await env.DB.prepare("SELECT bezirk FROM fire_alert WHERE endpoint = ?").bind(endpoint).all()).results || []; }
    }
    const geoRow = rows.find(r => r.bezirk === "~");
    const bezRows = rows.filter(r => r.bezirk !== "~");
    const kinds = rows.length && rows[0].kinds ? String(rows[0].kinds).split("") : [];
    const home = geoRow && geoRow.home_lat != null ? { lat: geoRow.home_lat, lng: geoRow.home_lng } : null;
    return json({ bezirke: bezRows.map(r => r.bezirk), kinds, home, radius: geoRow ? geoRow.radius_km : null });
  }

  if (action === "unsubscribe") {
    await env.DB.prepare("DELETE FROM fire_alert WHERE endpoint = ?").bind(String(b.endpoint || "")).run();
    return json({ ok: true });
  }

  return json({ error: "Unbekannte Aktion" }, 400);
}
