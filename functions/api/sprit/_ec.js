// ====================================================================
// E-Control Spritpreisrechner (offizielle, kostenlose Pflicht-Meldedaten).
//   GET https://api.e-control.at/sprit/1.0/search/gas-stations/by-address
//       ?latitude=&longitude=&fuelType=DIE|SUP|GAS&includeClosed=false
// Liefert bis zu 10 günstigste Tankstellen rund um den Punkt inkl. Preis,
// Adresse, Koordinaten, Öffnungszeiten. Wir proxen serverseitig (CSP) und
// cachen kurz in D1 (sprit_cache), weil der Routen-Modus mehrere Punkte
// abfragt. Nur Diesel/Super 95 sind für uns relevant (Premium gibt es nicht).
// ====================================================================

const BASE = "https://api.e-control.at/sprit/1.0/search/gas-stations/by-address";
const UA = "SpieleabendTanken/1.0 (+https://philip-stack.pages.dev/tanken/; privat)";

export const FUELS = { DIE: "Diesel", SUP: "Super 95" };
export const normFuel = f => (f === "SUP" ? "SUP" : "DIE");   // Default Diesel

// Rohantwort → schlanke, einheitliche Tankstellen-Objekte.
function slim(list, fuel) {
  const out = [];
  for (const s of (Array.isArray(list) ? list : [])) {
    const pr = (s.prices || []).find(p => p.fuelType === fuel);
    if (!pr || typeof pr.amount !== "number") continue;
    const loc = s.location || {};
    out.push({
      id: s.id,
      name: s.name || "Tankstelle",
      addr: loc.address || "",
      plz: loc.postalCode || "",
      city: loc.city || "",
      lat: loc.latitude, lng: loc.longitude,
      price: pr.amount,
      open: s.open !== false,
      dist: typeof s.distance === "number" ? s.distance : null,
    });
  }
  return out;
}

// E-Control-Abfrage mit ~10-min-D1-Cache (gerundete Koordinate + Treibstoff).
export async function ecByAddress(env, lat, lng, fuel) {
  fuel = normFuel(fuel);
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${fuel}`;
  try {
    if (env && env.DB) {
      const hit = await env.DB.prepare(
        "SELECT data FROM sprit_cache WHERE k = ? AND at > datetime('now','-10 minutes')"
      ).bind(key).first();
      if (hit && hit.data) { try { return JSON.parse(hit.data); } catch (_) {} }
    }
  } catch (_) {}

  const url = `${BASE}?latitude=${lat}&longitude=${lng}&fuelType=${fuel}&includeClosed=false`;
  let slimmed = [];
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      slimmed = slim(await res.json(), fuel);
      break;
    } catch (e) { if (i === 0) await new Promise(r => setTimeout(r, 350)); }
  }

  try {
    if (env && env.DB) {
      await env.DB.prepare(
        "INSERT INTO sprit_cache (k, data, at) VALUES (?, ?, CURRENT_TIMESTAMP) " +
        "ON CONFLICT(k) DO UPDATE SET data=excluded.data, at=CURRENT_TIMESTAMP"
      ).bind(key, JSON.stringify(slimmed)).run();
      await env.DB.prepare("DELETE FROM sprit_cache WHERE at < datetime('now','-1 day')").run();
    }
  } catch (_) {}
  return slimmed;
}
