import { json, clientIp, rateLimit } from "../_util.js";
import { normKey } from "./geo.js";

// ====================================================================
// Feuerwehr-Einsätze Niederösterreich (live).
// Abgekapseltes Feature unter /fire/noe — NICHT Teil des Spiele-Hubs.
//
// Reverse Engineering der öffentlichen „Wastl Mobile"/GRISU-Schnittstelle
// des NÖ Landesfeuerwehrverbands (infoscreen.florian10.info). Wir proxen
// serverseitig, damit:
//   • kein CORS-Problem im Browser entsteht,
//   • die Quelle nicht direkt exponiert / mit Anfragen überflutet wird
//     (kurzer Edge-Cache + Rate-Limit),
//   • wir die Antwort robust und einheitlich ausliefern.
//
//   GET /api/fire/noe            → { einsatz: [...], stand }   (aktive Einsätze)
//   GET /api/fire/noe?id=<i>     → Detail eines Einsatzes (inkl. Dispo/Wehren)
//
// Feldbedeutung der Quelle (Liste):
//   m Meldebild · a Alarmstufe (T…technisch, B…Brand, S…Schadstoff)
//   n Einsatznummer · o Ort · o2 Zusatzort · d Datum · t Zeit
//   i ID (für Detail) · b Bezirkscode
// ====================================================================

const BASE = "https://infoscreen.florian10.info/OWS/wastlMobile";
const UA = "Mozilla/5.0 (Spieleabend/fire-noe; +https://philip-stack.pages.dev/fire/noe/)";

async function upstream(url, ttl) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
    // Kurzer Edge-Cache: schont die Quelle, hält die Daten trotzdem frisch.
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!res.ok) throw new Error("upstream " + res.status);
  return res.json();
}

export async function onRequestGet({ request, env }) {
  // Sanftes Limit pro IP — Auto-Refresh (~alle 30 s) bleibt locker darunter.
  if (env && env.DB && !(await rateLimit(env, "fire:" + clientIp(request), 120, 60))) {
    return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
  }

  const params = new URL(request.url).searchParams;
  const id = params.get("id");

  // Beendete Einsätze (eigene Historie aus fire_op, vom Cron gepflegt).
  if (params.get("recent")) {
    try {
      if (!env || !env.DB) return json({ einsatz: [], recent: true, stand: nowIso() });
      const rows = (await env.DB.prepare(
        "SELECT n, m, a, o, o2, b, plz, ended_at FROM fire_op WHERE ended = 1 AND ended_at > datetime('now','-1 day') ORDER BY ended_at DESC LIMIT 120"
      ).all()).results || [];
      await attachCoords(env, rows);
      return withCache(json({ einsatz: rows, recent: true, stand: nowIso() }), 30);
    } catch (_) {
      return json({ einsatz: [], recent: true, stand: nowIso(), error: "Historie nicht verfügbar" }, 200);
    }
  }

  try {
    if (id) {
      if (id.length > 400) return json({ error: "Ungültige ID" }, 400);
      const data = await upstream(`${BASE}/getEinsatzData.ashx?id=${encodeURIComponent(id)}`, 20);
      return withCache(json(data), 15);
    }
    const data = await upstream(`${BASE}/getEinsatzAktiv.ashx`, 15);
    const list = Array.isArray(data && data.Einsatz) ? data.Einsatz : [];
    await attachCoords(env, list);
    return withCache(json({ einsatz: list, stand: nowIso() }), 12);
  } catch (_) {
    // Quelle nicht erreichbar: leere, aber gültige Antwort — der Client
    // behält seine letzte Anzeige und zeigt einen dezenten Hinweis.
    return json({ einsatz: [], stand: nowIso(), error: "Quelle nicht erreichbar" }, 200);
  }
}

// Bereits gecachte Koordinaten an die Liste hängen (kein Geocoding hier —
// das macht der Client gedrosselt über /api/fire/geo). Ein einziger Query.
async function attachCoords(env, list) {
  try {
    if (!env || !env.DB || !list.length) return;
    const keys = [...new Set(list.map(e => normKey(e.o)).filter(Boolean))];
    if (!keys.length) return;
    const rows = (await env.DB.prepare(
      `SELECT q, lat, lng FROM geo_cache WHERE miss = 0 AND q IN (${keys.map(() => "?").join(",")})`
    ).bind(...keys).all()).results || [];
    const map = new Map(rows.map(r => [r.q, r]));
    for (const e of list) {
      const r = map.get(normKey(e.o));
      if (r) { e.lat = r.lat; e.lng = r.lng; }
    }
  } catch (_) { /* Karte ist optional */ }
}

function withCache(res, seconds) {
  const r = new Response(res.body, res);
  r.headers.set("Cache-Control", `public, max-age=${seconds}`);
  return r;
}

// Zeitstempel ohne Date.now-Abhängigkeit in Tests: hier läuft echte Runtime.
function nowIso() {
  try { return new Date().toISOString(); } catch (_) { return ""; }
}
