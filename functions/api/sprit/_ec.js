import { logError } from "../_util.js";
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

export const FUELS = { DIE: "Diesel", SUP: "Super 95", GAS: "CNG" };
export const normFuel = f => (f === "SUP" || f === "GAS") ? f : "DIE";   // Default Diesel

// Aktueller Wochentag (E-Control-Code) + Minuten seit Mitternacht in AT-Zeit.
export function viennaNow() {
  const now = new Date();
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Vienna", weekday: "short" }).format(now);
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const map = { Mon: "MO", Tue: "DI", Wed: "MI", Thu: "DO", Fri: "FR", Sat: "SA", Sun: "SO" };
  return { day: map[wd] || "", mins: (+hm.slice(0, 2)) * 60 + (+hm.slice(3, 5)) };
}
const toMin = t => { const m = /^(\d{2}):(\d{2})/.exec(String(t || "")); return m ? +m[1] * 60 + +m[2] : null; };

// Heutige Öffnungszeit → „offen bis" / „durchgehend" / offen-jetzt.
// oh = { f, t } (heutige Zeiten laut E-Control) oder null; fallbackOpen = was
// E-Control beim Abruf als „offen" meldete (gilt, wenn es keine Zeiten gibt).
function openInfo(oh, fallbackOpen, tn) {
  let till = null, openNow = fallbackOpen, is24 = false;
  if (oh) {
    // 00:00–00:00 und 00:00–24:00 (beides kommt von E-Control) = rund um die Uhr;
    // vorher stand bei Letzterem „offen bis 24:00".
    if (oh.f === oh.t || (toMin(oh.f) === 0 && toMin(oh.t) === 24 * 60)) {
      is24 = true;
    } else {
      const f = toMin(oh.f), t = toMin(oh.t);
      if (f != null && t != null) {
        const within = t > f ? (tn.mins >= f && tn.mins < t) : (tn.mins >= f || tn.mins < t);
        openNow = within;
        if (within && oh.t !== "00:00") till = oh.t;
      }
    }
  }
  let openText;
  if (!openNow) openText = "geschlossen";
  else if (till) openText = "offen bis " + till;
  else if (is24) openText = "durchgehend geöffnet";
  else openText = "offen";
  return { open: openNow, till, openText };
}

// Rohantwort → schlanke, einheitliche Tankstellen-Objekte (inkl. „offen bis").
function slim(list, fuel) {
  const tn = viennaNow();
  const out = [];
  for (const s of (Array.isArray(list) ? list : [])) {
    const pr = (s.prices || []).find(p => p.fuelType === fuel);
    if (!pr || typeof pr.amount !== "number") continue;
    const loc = s.location || {};
    const today = (s.openingHours || []).find(o => o.day === tn.day);
    const oh = today ? { f: today.from, t: today.to } : null;
    const { open: openNow, till, openText } = openInfo(oh, s.open !== false, tn);

    out.push({
      id: s.id,
      name: s.name || "Tankstelle",
      addr: loc.address || "",
      plz: loc.postalCode || "",
      city: loc.city || "",
      lat: loc.latitude, lng: loc.longitude,
      price: pr.amount,
      open: openNow,
      till, openText,
      oh,   // für die Neuberechnung, falls dieser Stand später als Rückfall dient
      dist: typeof s.distance === "number" ? s.distance : null,
    });
  }
  return out;
}

// E-Control-Abfrage mit ~10-min-D1-Cache (gerundete Koordinate + Treibstoff).
// Warum der letzte Aufruf leer war — die App soll „gerade keine Preise" nicht
// als „hier gibt es nichts" ausgeben. Bewusst als Rueckgabewert von
// ecAbfrage(), nicht als Modul-Variable: in einem Worker teilen sich mehrere
// Anfragen denselben Isolate.
export async function ecAbfrage(env, lat, lng, fuel) {
  const stations = await ecByAddress(env, lat, lng, fuel);
  // ecByAddress haengt den Grund an das Array (siehe unten) — so bleiben die
  // drei Aufrufer, die ihn nicht brauchen (Cron, Route, Briefing), unveraendert.
  return { stations, status: stations.status || "ok", stand: stations.stand || null };
}

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
  let geantwortet = false;          // hat die Quelle ueberhaupt geantwortet?
  let grund = "", rohLen = 0;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const roh = await res.json();
      rohLen = Array.isArray(roh) ? roh.length : 0;
      slimmed = slim(roh, fuel);
      geantwortet = true;
      break;
    } catch (e) {
      grund = (e && e.message) || String(e);
      if (i === 0) await new Promise(r => setTimeout(r, 350));
    }
  }

  // Ein Fehlschlag ist KEIN Ergebnis. Frueher landete das leere Array trotzdem
  // im Zwischenspeicher — damit sah die App 10 Minuten lang so aus, als gaebe
  // es dort keine Tankstellen, und der eigentliche Fehler war nirgends zu
  // sehen (leeres catch). Beides war dieselbe Wurzel: ein stiller Ausfall,
  // der wie ein gueltiges Ergebnis aussah.
  // Zweiter Fall, live beobachtet: die Quelle ANTWORTET, liefert aber zu jeder
  // Station eine leere Preisliste (beobachtet kurz nach 12:00 Wiener Zeit —
  // dem Zeitpunkt, zu dem Preise steigen duerfen und offenbar umgestellt
  // werden). Das ist kein „hier gibt es keine Tankstellen", sondern „gerade
  // keine Preise" — und darf genauso wenig als Ergebnis zementiert werden.
  const ohnePreise = geantwortet && rohLen > 0 && slimmed.length === 0;
  if (!geantwortet || ohnePreise) {
    await logError(
      env,
      geantwortet ? "E-Control liefert gerade keine Preise" : "E-Control antwortet nicht",
      "sprit/ec",
      `${grund || rohLen + " Stationen ohne Preis"} · ${key}`);
    // Grund am Array vermerken: die Aufrufer, die ihn nicht lesen, merken
    // nichts davon; near.js macht daraus eine ehrliche Meldung.
    // Rückfall: der letzte gute Stand aus dem Zwischenspeicher (bis 6 h alt,
    // Nachbarpunkt bis 3 km) — ehrlich als „veraltet" markiert. Die tägliche
    // Lücke um 12:00 und die Ausfall-Schübe der Quelle trafen genau die
    // Momente, in denen man nachschaut; vorher gab es dann gar nichts.
    const alt = await staleFallback(env, lat, lng, fuel);
    if (alt) return alt;
    slimmed.status = geantwortet ? "keine-preise" : "quelle-down";
    return slimmed;                 // leer, aber NICHT gecacht
  }

  // Jeden frisch gelieferten Preis als Tages-Tiefstwert festhalten — nur
  // Tankstelle, Tag, Preis (kein Personenbezug). Daraus entsteht der
  // Preisverlauf für ALLE Tankstellen, nicht nur für die mit Alarm.
  await logPrices(env, fuel, slimmed);

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

// ---- Rückfall auf den letzten guten Stand ----
const STALE_H = 6, STALE_KM = 3;
function kmBetween(a1, o1, a2, o2) {
  const r = Math.PI / 180, x = (o2 - o1) * r * Math.cos((a1 + a2) / 2 * r), y = (a2 - a1) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}
export async function staleFallback(env, lat, lng, fuel) {
  try {
    if (!env || !env.DB) return null;
    const rows = (await env.DB.prepare(
      `SELECT k, data, at FROM sprit_cache WHERE k LIKE ? AND at > datetime('now','-${STALE_H} hours')`
    ).bind("%," + fuel).all()).results || [];
    let best = null, bestD = Infinity;
    for (const r of rows) {
      const m = /^(-?\d+\.\d+),(-?\d+\.\d+),/.exec(r.k || "");
      if (!m) continue;
      const d = kmBetween(lat, lng, +m[1], +m[2]);
      if (d <= STALE_KM && d < bestD) { best = r; bestD = d; }
    }
    if (!best) return null;
    const list = JSON.parse(best.data);
    if (!Array.isArray(list) || !list.length) return null;
    const tn = viennaNow();
    for (const st of list) {
      // Öffnungszeiten für JETZT neu rechnen (der Stand kann Stunden alt sein)
      if (st.oh !== undefined) Object.assign(st, openInfo(st.oh, st.open, tn));
      // Entfernung zum tatsächlich gefragten Punkt (der Stand kann vom Nachbarpunkt sein)
      if (typeof st.lat === "number" && typeof st.lng === "number") st.dist = Math.round(kmBetween(lat, lng, st.lat, st.lng) * 100) / 100;
    }
    list.status = "veraltet";
    list.stand = String(best.at).replace(" ", "T") + "Z";   // CURRENT_TIMESTAMP ist UTC
    return list;
  } catch (_) { return null; }
}

// ---- Preisverlauf (Tages-Tiefstwert je Tankstelle & Sorte) ----
async function logPrices(env, fuel, list) {
  try {
    if (!env || !env.DB || !list.length) return;
    const sql = "INSERT INTO sprit_price_log (station_id, fuel, day, price) VALUES (?, ?, date('now'), ?) " +
      "ON CONFLICT(station_id, fuel, day) DO UPDATE SET price = MIN(price, excluded.price)";
    const stmts = list.filter(x => x.id != null && typeof x.price === "number")
      .map(x => env.DB.prepare(sql).bind(String(x.id), fuel, x.price));
    if (!stmts.length) return;
    if (env.DB.batch) await env.DB.batch(stmts);   // ein Roundtrip statt zehn
    else for (const st of stmts) await st.run();
  } catch (_) { /* Verlauf ist Beiwerk — die Suche darf daran nie scheitern */ }
}

// Verlauf + Einschätzung an Tankstellen hängen (für near/route):
//   hist  = Tages-Tiefstwerte der letzten 14 Tage inkl. heute (für die Kurve)
//   trend = priceVerdict(aktueller Preis, Vortage) — „Tiefstwert", „x ¢ über üblich"
export async function attachTrend(env, fuel, stations, verdict) {
  try {
    const ids = [...new Set(stations.map(s => s.id).filter(x => x != null).map(String))].slice(0, 40);
    if (!env || !env.DB || !ids.length) return;
    const rows = (await env.DB.prepare(
      `SELECT station_id, day, price FROM sprit_price_log WHERE fuel = ? AND station_id IN (${ids.map(() => "?").join(",")}) AND day >= date('now','-14 days') ORDER BY day ASC`
    ).bind(fuel, ...ids).all()).results || [];
    const today = new Date().toISOString().slice(0, 10);
    const by = new Map();
    for (const r of rows) { let a = by.get(String(r.station_id)); if (!a) by.set(String(r.station_id), a = []); a.push(r); }
    for (const s of stations) {
      const a = by.get(String(s.id)) || [];
      const past = a.filter(r => r.day < today).map(r => r.price);
      const hist = past.slice();
      hist.push(Math.min(s.price, ...a.filter(r => r.day === today).map(r => r.price)));
      if (hist.length >= 3) s.hist = hist;
      const t = verdict(s.price, past);
      if (t) s.trend = t;
    }
  } catch (_) { /* optional */ }
}
