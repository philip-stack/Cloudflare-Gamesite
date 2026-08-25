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
const UA = "SpieleabendFireNoe/1.0 (+https://philip-stack.pages.dev/fire/noe/; philipstix@gmail.com)";

export function normKey(ort) {
  return String(ort || "").toLowerCase().trim().replace(/\s+/g, " ");
}

// Wiederverwendbarer Kern: Ort(+PLZ) → { lat, lng } | null. Cache zuerst
// (geo_cache), sonst Nominatim (Ergebnis inkl. Fehltreffer wird gecacht).
// opts.cacheOnly=true fragt NUR den Cache ab (keine Nominatim-Last) — genutzt
// vom Cron. Wird sowohl vom Client-Endpoint als auch vom Umkreis-Alarm genutzt.
export async function geocode(env, ort, plz, opts = {}) {
  if (!env || !env.DB || !ort) return null;
  const key = normKey(ort);
  const hit = await env.DB.prepare("SELECT lat, lng, miss FROM geo_cache WHERE q = ?").bind(key).first();
  if (hit) return hit.miss ? null : { lat: hit.lat, lng: hit.lng };
  if (opts.cacheOnly) return null;
  try {
    const q = (plz ? plz + " " : "") + ort + ", Niederösterreich, Österreich";
    const api = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=at&accept-language=de&q=" + encodeURIComponent(q);
    const res = await fetch(api, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    const arr = res.ok ? await res.json() : [];
    if (Array.isArray(arr) && arr.length && arr[0].lat && arr[0].lon) {
      const lat = Math.round(parseFloat(arr[0].lat) * 1e6) / 1e6;
      const lng = Math.round(parseFloat(arr[0].lon) * 1e6) / 1e6;
      await env.DB.prepare("INSERT OR REPLACE INTO geo_cache (q, lat, lng, miss) VALUES (?, ?, ?, 0)").bind(key, lat, lng).run();
      return { lat, lng };
    }
    // Fehltreffer merken, damit wir nicht ständig neu anfragen.
    await env.DB.prepare("INSERT OR REPLACE INTO geo_cache (q, lat, lng, miss) VALUES (?, NULL, NULL, 1)").bind(key).run();
    return null;
  } catch (_) {
    return null;   // nicht cachen: nächster Versuch darf's nochmal probieren
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const ort = String(url.searchParams.get("q") || "").trim();
  const plz = String(url.searchParams.get("plz") || "").trim();
  if (!ort || ort.length > 80) return json({ error: "kein Ort" }, 400);
  if (!env || !env.DB) return json({ miss: true });

  const key = normKey(ort);
  // 1) Cache (ohne Rate-Limit — nur Treffer)
  const hit = await env.DB.prepare("SELECT lat, lng, miss FROM geo_cache WHERE q = ?").bind(key).first();
  if (hit) return hit.miss ? json({ miss: true }) : cacheable(json({ lat: hit.lat, lng: hit.lng }));

  // Nur neue Orte lösen Nominatim aus → hier greift das Rate-Limit.
  if (!(await rateLimit(env, "geo:" + clientIp(request), 30, 60))) return json({ retry: true }, 429);

  const r = await geocode(env, ort, plz);
  return r ? cacheable(json(r)) : json({ miss: true });
}

function cacheable(res) {
  const r = new Response(res.body, res);
  r.headers.set("Cache-Control", "public, max-age=86400");
  return r;
}
