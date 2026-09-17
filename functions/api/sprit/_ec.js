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
function viennaNow() {
  const now = new Date();
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Vienna", weekday: "short" }).format(now);
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const map = { Mon: "MO", Tue: "DI", Wed: "MI", Thu: "DO", Fri: "FR", Sat: "SA", Sun: "SO" };
  return { day: map[wd] || "", mins: (+hm.slice(0, 2)) * 60 + (+hm.slice(3, 5)) };
}
const toMin = t => { const m = /^(\d{2}):(\d{2})/.exec(String(t || "")); return m ? +m[1] * 60 + +m[2] : null; };

// Rohantwort → schlanke, einheitliche Tankstellen-Objekte (inkl. „offen bis").
function slim(list, fuel) {
  const tn = viennaNow();
  const out = [];
  for (const s of (Array.isArray(list) ? list : [])) {
    const pr = (s.prices || []).find(p => p.fuelType === fuel);
    if (!pr || typeof pr.amount !== "number") continue;
    const loc = s.location || {};
    // Heutige Öffnungszeit → „offen bis" / „durchgehend" / offen-jetzt.
    const today = (s.openingHours || []).find(o => o.day === tn.day);
    let till = null, openNow = s.open !== false, is24 = false;
    if (today) {
      if (today.from === today.to) {
        is24 = true;   // 00:00–00:00 = durchgehend geöffnet (24 h)
      } else {
        const f = toMin(today.from), t = toMin(today.to);
        if (f != null && t != null) {
          const within = t > f ? (tn.mins >= f && tn.mins < t) : (tn.mins >= f || tn.mins < t);
          openNow = within;
          if (within && today.to !== "00:00") till = today.to;
        }
      }
    }
    let openText;
    if (!openNow) openText = "geschlossen";
    else if (till) openText = "offen bis " + till;
    else if (is24) openText = "durchgehend geöffnet";
    else openText = "offen";

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
  return { stations, status: stations.status || "ok" };
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
    slimmed.status = geantwortet ? "keine-preise" : "quelle-down";
    return slimmed;                 // leer, aber NICHT gecacht
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
