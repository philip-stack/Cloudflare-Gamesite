import { json, clientIp, rateLimit } from "../_util.js";

// ====================================================================
// Adress-Autovervollständigung (wie bei Google Maps) für die Tank-App.
//   GET /api/sprit/suggest?q=<Teiltext>  → [ { label, lat, lng } … ]
// Nutzt Photon (photon.komoot.io, OSM-basiert, gratis, ohne Key, für
// Type-ahead gemacht). Serverseitig geproxt (CSP), auf Österreich gefiltert.
// ====================================================================

const UA = "SpieleabendTanken/1.0 (+https://philip-stack.pages.dev/tanken/; privat)";
const BBOX = "9.5,46.3,17.2,49.1";   // grob Österreich (minLon,minLat,maxLon,maxLat)

export async function onRequestGet({ request, env }) {
  if (env && env.DB && !(await rateLimit(env, "spritac:" + clientIp(request), 120, 60))) {
    return json([], 200);
  }
  const q = String(new URL(request.url).searchParams.get("q") || "").trim();
  if (q.length < 3) return json([]);

  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=de&limit=6&bbox=${BBOX}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) return json([]);
    const data = await res.json();
    const out = [];
    for (const f of (data.features || [])) {
      const p = f.properties || {};
      if (p.countrycode && p.countrycode !== "AT") continue;
      const c = f.geometry && f.geometry.coordinates;
      if (!c || c.length < 2) continue;
      const head = p.street ? (p.street + (p.housenumber ? " " + p.housenumber : "")) : (p.name || "");
      const tail = [(p.postcode || "") + (p.city ? " " + p.city : "")].join("").trim() || p.state || "";
      const label = [head, tail].filter(Boolean).join(", ") || p.name || q;
      out.push({ label, lat: +c[1], lng: +c[0] });
    }
    // Duplikate (gleiches Label) entfernen
    const seen = new Set(), uniq = [];
    for (const o of out) { if (seen.has(o.label)) continue; seen.add(o.label); uniq.push(o); }
    return withCache(json(uniq.slice(0, 6)), 300);
  } catch (_) {
    return json([]);
  }
}
function withCache(res, seconds) {
  const r = new Response(res.body, res);
  r.headers.set("Cache-Control", `public, max-age=${seconds}`);
  return r;
}
