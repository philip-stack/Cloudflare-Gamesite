// ====================================================================
// Adress-/Ortssuche für die Tank-App: Freitext → Koordinaten (Österreich).
// Nominatim (OpenStreetMap), serverseitig, mit dauerhaftem D1-Cache
// (geo_cache, geteilt mit fire/noe). Fair use: valider User-Agent, 1 Anfrage
// pro Suche, Ergebnisse werden gecacht (auch Fehltreffer → miss=1).
// ====================================================================

const UA = "SpieleabendTanken/1.0 (+https://philip-stack.pages.dev/tanken/; philip.stix@workheld.com)";

export const normKey = q => "tanken:" + String(q || "").toLowerCase().trim().replace(/\s+/g, " ");

// "48.21,16.37" direkt als Koordinate erkennen (eigener Standort/Reuse).
function parseLatLng(q) {
  const m = /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/.exec(String(q || ""));
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  if (lat < 46 || lat > 49.1 || lng < 9 || lng > 17.5) return null;   // grob AT
  return { lat, lng, label: "" };
}

export async function geocode(env, q) {
  const direct = parseLatLng(q);
  if (direct) return direct;

  const text = String(q || "").trim();
  if (!text || text.length > 120) return null;
  const key = normKey(text);

  try {
    if (env && env.DB) {
      const hit = await env.DB.prepare("SELECT lat, lng, miss FROM geo_cache WHERE q = ?").bind(key).first();
      if (hit) return hit.miss ? null : { lat: hit.lat, lng: hit.lng, label: "" };
    }
  } catch (_) {}

  let found = null;
  try {
    const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=at&q=" + encodeURIComponent(text);
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json", "Accept-Language": "de" } });
    if (res.ok) {
      const arr = await res.json();
      if (Array.isArray(arr) && arr[0] && arr[0].lat) {
        found = { lat: +arr[0].lat, lng: +arr[0].lon, label: arr[0].display_name || "" };
      }
    }
  } catch (_) {}

  try {
    if (env && env.DB) {
      if (found) {
        await env.DB.prepare(
          "INSERT INTO geo_cache (q, lat, lng, miss) VALUES (?, ?, ?, 0) " +
          "ON CONFLICT(q) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, miss=0"
        ).bind(key, found.lat, found.lng).run();
      } else {
        await env.DB.prepare(
          "INSERT INTO geo_cache (q, lat, lng, miss) VALUES (?, NULL, NULL, 1) " +
          "ON CONFLICT(q) DO UPDATE SET miss=1"
        ).bind(key).run();
      }
    }
  } catch (_) {}
  return found;
}
