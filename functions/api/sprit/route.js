import { json, clientIp, rateLimit } from "../_util.js";
import { ecByAddress, normFuel, FUELS } from "./_ec.js";
import { geocode } from "./_geo.js";
import { haversineKm } from "../fire/_parse.js";

// ====================================================================
// Modus 2 (Route A→B): die 3 günstigsten Tankstellen entlang der Strecke,
// mit minimalem Umweg.
//   GET /api/sprit/route?from=&to=&fuel=DIE|SUP&off=<km>
//     → { from, to, route:{distanceKm,durationMin,geometry}, fuel, stations:[3] }
//
// Vorgehen: from/to geocoden → OSRM-Route holen → entlang der Strecke alle
// ~18 km einen Stützpunkt abfragen (E-Control liefert je Punkt die günstigsten)
// → dedupen → Tankstellen, deren Luftlinie zur Route ≤ off (Standard 2 km,
// ≈ ~5 min Umweg) → nach Preis sortiert die 3 günstigsten.
// ====================================================================

const OSRM = "https://router.project-osrm.org/route/v1/driving";
const UA = "SpieleabendTanken/1.0 (+https://philip-stack.pages.dev/tanken/; privat)";
const SAMPLE_KM = 18;      // Abstand der Preis-Stützpunkte entlang der Route
const DEFAULT_OFF = 2.0;   // max. Luftlinie Tankstelle→Route (km) ≈ ~5 min Umweg

export async function onRequestGet({ request, env }) {
  if (env && env.DB && !(await rateLimit(env, "sprit:" + clientIp(request), 40, 60))) {
    return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
  }
  const p = new URL(request.url).searchParams;
  const fuel = normFuel(p.get("fuel"));
  const off = Math.min(8, Math.max(0.5, parseFloat(p.get("off")) || DEFAULT_OFF));
  const fromQ = p.get("from"), toQ = p.get("to");
  if (!fromQ || !toQ) return json({ error: "Start und Ziel angeben" }, 400);

  const [from, to] = await Promise.all([geocode(env, fromQ), geocode(env, toQ)]);
  if (!from) return json({ error: "Start nicht gefunden", notFound: "from" }, 200);
  if (!to) return json({ error: "Ziel nicht gefunden", notFound: "to" }, 200);

  // ---- Route holen (OSRM) ----
  let coords = [], distanceKm = 0, durationMin = 0;
  try {
    const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    const d = res.ok ? await res.json() : {};
    const r = (d.routes || [])[0];
    if (!r) return json({ error: "Keine Route gefunden" }, 200);
    coords = r.geometry.coordinates || [];          // [ [lng,lat], … ]
    distanceKm = r.distance / 1000; durationMin = Math.round(r.duration / 60);
  } catch (_) {
    return json({ error: "Routing nicht verfügbar" }, 200);
  }
  if (coords.length < 2) return json({ error: "Keine Route gefunden" }, 200);

  // ---- Stützpunkte entlang der Route (alle ~SAMPLE_KM) ----
  const samples = [[coords[0][1], coords[0][0]]];   // [lat,lng]
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = [coords[i - 1][1], coords[i - 1][0]], b = [coords[i][1], coords[i][0]];
    acc += haversineKm(a, b);
    if (acc >= SAMPLE_KM) { samples.push(b); acc = 0; }
  }
  const last = [coords[coords.length - 1][1], coords[coords.length - 1][0]];
  if (haversineKm(samples[samples.length - 1], last) > 2) samples.push(last);

  // ---- Preise je Stützpunkt holen und dedupen ----
  const byId = new Map();
  const results = await Promise.all(samples.map(s => ecByAddress(env, s[0], s[1], fuel)));
  for (const list of results) for (const st of list) if (!byId.has(st.id)) byId.set(st.id, st);

  // ---- Für jede Tankstelle Luftlinie zur Route (dezimiert) ----
  const step = Math.max(1, Math.floor(coords.length / 600));   // Perf-Deckel
  const route = [];
  for (let i = 0; i < coords.length; i += step) route.push([coords[i][1], coords[i][0]]);

  const onWay = [];
  for (const st of byId.values()) {
    if (typeof st.lat !== "number" || typeof st.lng !== "number") continue;
    let min = Infinity;
    for (const rp of route) { const d = haversineKm([st.lat, st.lng], rp); if (d < min) min = d; }
    if (min <= off) onWay.push(Object.assign({}, st, { offKm: Math.round(min * 2 * 10) / 10 }));
  }

  onWay.sort((a, b) => a.price - b.price);
  const stations = onWay.slice(0, 3);

  // Geometrie für die Karte verschlanken (~300 Punkte reichen).
  const gstep = Math.max(1, Math.floor(coords.length / 300));
  const geometry = [];
  for (let i = 0; i < coords.length; i += gstep) geometry.push([coords[i][1], coords[i][0]]);
  geometry.push(last);

  return withCache(json({
    from: { lat: from.lat, lng: from.lng, label: from.label || fromQ },
    to: { lat: to.lat, lng: to.lng, label: to.label || toQ },
    route: { distanceKm: Math.round(distanceKm * 10) / 10, durationMin, geometry },
    fuel, fuelLabel: FUELS[fuel], off,
    stations,
    checked: byId.size,
    stand: new Date().toISOString(),
  }), 120);
}

function withCache(res, seconds) {
  const r = new Response(res.body, res);
  r.headers.set("Cache-Control", `public, max-age=${seconds}`);
  return r;
}
