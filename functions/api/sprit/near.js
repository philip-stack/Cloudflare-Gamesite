import { json, clientIp, rateLimit } from "../_util.js";
import { ecByAddress, normFuel, FUELS } from "./_ec.js";
import { geocode } from "./_geo.js";

// ====================================================================
// Modus 1 (Umkreis/Ortssuche): günstigste Tankstellen um einen Punkt.
//   GET /api/sprit/near?lat=&lng=&fuel=DIE|SUP        (eigener Standort)
//   GET /api/sprit/near?q=<Adresse/Ort>&fuel=DIE|SUP  (Ortssuche)
//     → { center:{lat,lng,label}, fuel, stations:[ …nach Preis sortiert ] }
// ====================================================================

export async function onRequestGet({ request, env }) {
  if (env && env.DB && !(await rateLimit(env, "sprit:" + clientIp(request), 60, 60))) {
    return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
  }
  const p = new URL(request.url).searchParams;
  const fuel = normFuel(p.get("fuel"));

  let center = null, label = "";
  const lat = parseFloat(p.get("lat")), lng = parseFloat(p.get("lng"));
  if (isFinite(lat) && isFinite(lng)) {
    center = { lat, lng };
  } else {
    const q = p.get("q");
    if (!q) return json({ error: "Standort oder Ort angeben" }, 400);
    const g = await geocode(env, q);
    if (!g) return json({ error: "Ort nicht gefunden", notFound: true }, 200);
    center = { lat: g.lat, lng: g.lng }; label = g.label || "";
  }

  const stations = (await ecByAddress(env, center.lat, center.lng, fuel))
    .slice()
    .sort((a, b) => a.price - b.price);
  const avgPrice = stations.length
    ? Math.round(stations.reduce((s, x) => s + x.price, 0) / stations.length * 1000) / 1000 : null;

  return withCache(json({
    center: { lat: center.lat, lng: center.lng, label },
    fuel, fuelLabel: FUELS[fuel],
    avgPrice,
    stations,
    stand: new Date().toISOString(),
  }), 120);
}

function withCache(res, seconds) {
  const r = new Response(res.body, res);
  r.headers.set("Cache-Control", `public, max-age=${seconds}`);
  return r;
}
