import { json, clientIp, rateLimit } from "../_util.js";

// ====================================================================
// Geocoding für die Einsatz-Karte: Ort(+PLZ) → Koordinaten.
//   GET /api/fire/geo?q=<Ort>&plz=<PLZ optional>
//     → { lat, lng } | { miss: true }
//
// Ergebnisse werden dauerhaft in D1 (geo_cache) gespeichert — Orte ändern
// sich nicht. So wird jeder Ort nur EINMAL bei Nominatim (OpenStreetMap)
// angefragt. Der Cache-Schlüssel basiert nur auf dem Ortsnamen, damit die
// Liste (ohne PLZ) dieselben Koordinaten wiederfindet.
// ====================================================================
const UA = "SpieleabendFireNoe/1.0 (+https://philip-stack.pages.dev/fire/noe/; philip.stix@workheld.com)";

export function normKey(ort) {
  return String(ort || "").toLowerCase().trim().replace(/\s+/g, " ");
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const ort = String(url.searchParams.get("q") || "").trim();
  const plz = String(url.searchParams.get("plz") || "").trim();
  if (!ort || ort.length > 80) return json({ error: "kein Ort" }, 400);
  if (!env || !env.DB) return json({ miss: true });

  const key = normKey(ort);

  // 1) Cache
  const hit = await env.DB.prepare("SELECT lat, lng, miss FROM geo_cache WHERE q = ?").bind(key).first();
  if (hit) {
    if (hit.miss) return json({ miss: true });
    return cacheable(json({ lat: hit.lat, lng: hit.lng }));
  }

  // Nur neue Orte lösen aus (schützt Nominatim). Bei zu vielen neuen Orten
  // in kurzer Zeit: höflich ablehnen, der Client versucht es später erneut.
  if (env.DB && !(await rateLimit(env, "geo:" + clientIp(request), 30, 60))) {
    return json({ retry: true }, 429);
  }

  // 2) Nominatim (OpenStreetMap)
  try {
    const q = (plz ? plz + " " : "") + ort + ", Niederösterreich, Österreich";
    const api = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=at&accept-language=de&q=" + encodeURIComponent(q);
    const res = await fetch(api, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    const arr = res.ok ? await res.json() : [];
    if (Array.isArray(arr) && arr.length && arr[0].lat && arr[0].lon) {
      const lat = Math.round(parseFloat(arr[0].lat) * 1e6) / 1e6;
      const lng = Math.round(parseFloat(arr[0].lon) * 1e6) / 1e6;
      await env.DB.prepare("INSERT OR REPLACE INTO geo_cache (q, lat, lng, miss) VALUES (?, ?, ?, 0)").bind(key, lat, lng).run();
      return cacheable(json({ lat, lng }));
    }
    // Fehltreffer merken, damit wir nicht ständig neu anfragen
    await env.DB.prepare("INSERT OR REPLACE INTO geo_cache (q, lat, lng, miss) VALUES (?, NULL, NULL, 1)").bind(key).run();
    return json({ miss: true });
  } catch (_) {
    return json({ miss: true });  // nicht cachen: nächster Versuch darf's nochmal probieren
  }
}

function cacheable(res) {
  const r = new Response(res.body, res);
  r.headers.set("Cache-Control", "public, max-age=86400");
  return r;
}
