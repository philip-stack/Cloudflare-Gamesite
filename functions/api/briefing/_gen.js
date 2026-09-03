// ====================================================================
// Tages-Briefing: Rohdaten sammeln → in Sätze gießen → speichern.
//
// Die KI formuliert hier nur; ALLE Zahlen kommen aus eigenen Quellen
// (E-Control, NÖ-Einsatzfeed, open-meteo). Damit kann das Modell nichts
// Falsches behaupten, sondern höchstens holprig schreiben — und wenn Workers
// AI ausfällt oder das Kontingent leer ist, schreibt plainText() denselben
// Inhalt nüchtern zusammen. Das Briefing darf nie ausfallen, nur schöner
// oder schlichter sein.
//
// Konfiguriert wird im Admin-Panel (app_config, briefing_*). Jeder Baustein
// ist einzeln optional: ohne Koordinaten kein Wetter und kein Sprit, ohne
// Bezirk keine Einsätze.
// ====================================================================

import { ecByAddress, normFuel, FUELS } from "../sprit/_ec.js";
import { bezName } from "../fire/_bezirk.js";
import { sendToName } from "../push.js";
import { bumpStat } from "../stat.js";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// WMO-Wettercodes → kurze deutsche Beschreibung (nur die Gruppen, die man
// morgens wirklich unterscheiden will).
const WMO = [
  [0, "klar"], [1, "überwiegend klar"], [2, "teils bewölkt"], [3, "bedeckt"],
  [45, "Nebel"], [48, "Nebel"],
  [51, "leichter Nieselregen"], [53, "Nieselregen"], [55, "starker Nieselregen"],
  [61, "leichter Regen"], [63, "Regen"], [65, "starker Regen"],
  [71, "leichter Schneefall"], [73, "Schneefall"], [75, "starker Schneefall"],
  [80, "Regenschauer"], [81, "Regenschauer"], [82, "kräftige Schauer"],
  [95, "Gewitter"], [96, "Gewitter mit Hagel"], [99, "Gewitter mit Hagel"],
];
const wmoText = (c) => (WMO.find(([k]) => k === c) || [null, "wechselhaft"])[1];

// „YYYY-MM-DD" und Stunde in Wiener Zeit — der Cron läuft in UTC, das
// Briefing soll aber um 6:30 LOKAL kommen (Sommer- wie Winterzeit).
export function viennaNow(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  }).formatToParts(now);
  const g = (t) => (p.find(x => x.type === t) || {}).value;
  return { day: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) };
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

export async function loadCfg(env) {
  const rows = await env.DB.prepare("SELECT k, v FROM app_config WHERE k LIKE 'briefing_%'").all();
  const m = {};
  for (const r of (rows.results || [])) m[r.k] = r.v;
  return {
    on: m.briefing_on === "1",
    hour: Math.min(23, Math.max(0, Number(m.briefing_hour ?? 6) || 0)),
    name: (m.briefing_name || "").trim(),
    lat: num(m.briefing_lat),
    lng: num(m.briefing_lng),
    fuel: normFuel(m.briefing_fuel || "DIE"),
    bezirk: (m.briefing_bezirk || "").trim(),
  };
}

// ---------- Rohdaten ----------

async function getWeather(cfg) {
  if (cfg.lat == null || cfg.lng == null) return null;
  const u = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${cfg.lat}&longitude=${cfg.lng}`
    + "&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,weather_code"
    + "&timezone=Europe%2FVienna&forecast_days=1";
  try {
    const j = await (await fetch(u, { headers: { "User-Agent": "philip-stack/briefing" } })).json();
    const d = j && j.daily;
    if (!d || !d.time || !d.time.length) return null;
    return {
      min: d.temperature_2m_min[0], max: d.temperature_2m_max[0],
      mm: d.precipitation_sum[0], prob: d.precipitation_probability_max[0],
      text: wmoText(d.weather_code[0]),
    };
  } catch (_) { return null; }
}

async function getSprit(env, cfg) {
  if (cfg.lat == null || cfg.lng == null) return null;
  try {
    const list = await ecByAddress(env, cfg.lat, cfg.lng, cfg.fuel);
    const open = (list || []).filter(s => s.open && typeof s.price === "number");
    if (!open.length) return null;
    const best = open.reduce((a, b) => (b.price < a.price ? b : a));

    // Trend: gestriger Preis DERSELBEN Station aus dem eigenen Preis-Log.
    let diff = null;
    try {
      const y = await env.DB.prepare(
        "SELECT price FROM sprit_price_log WHERE station_id = ? AND fuel = ? AND day < date('now') ORDER BY day DESC LIMIT 1"
      ).bind(String(best.id), cfg.fuel).first();
      if (y && typeof y.price === "number") diff = Math.round((best.price - y.price) * 1000) / 10;   // Cent
    } catch (_) {}

    return {
      fuel: FUELS[cfg.fuel] || cfg.fuel,
      price: best.price,
      name: best.name, city: best.city,
      dist: best.dist == null ? null : Math.round(best.dist * 10) / 10,
      diffCent: diff,
      stations: open.length,
    };
  } catch (_) { return null; }
}

async function getFire(env, cfg) {
  if (!cfg.bezirk) return null;
  try {
    const r = await env.DB.prepare(
      "SELECT COUNT(*) n, SUM(CASE WHEN ended = 0 THEN 1 ELSE 0 END) offen FROM fire_op " +
      "WHERE b = ? AND first_seen > datetime('now','-14 hours')"
    ).bind(cfg.bezirk).first();
    const list = await env.DB.prepare(
      "SELECT m, o FROM fire_op WHERE b = ? AND first_seen > datetime('now','-14 hours') ORDER BY first_seen DESC LIMIT 4"
    ).bind(cfg.bezirk).all();
    return {
      bezirk: bezName(cfg.bezirk),
      count: r?.n ?? 0,
      open: r?.offen ?? 0,
      letzte: (list.results || []).map(x => ({ was: x.m, wo: x.o })),
    };
  } catch (_) { return null; }
}

export async function collect(env, cfg) {
  const [weather, sprit, fire] = await Promise.all([getWeather(cfg), getSprit(env, cfg), getFire(env, cfg)]);
  return { weather, sprit, fire, at: new Date().toISOString() };
}

// ---------- Text ----------

// Deutsche Dezimalschreibweise — sonst steht im Satz "um 2.1 Cent".
const kommaZahl = (n) => n.toFixed(1).replace(".", ",");
const cent = (d) => (d > 0 ? `um ${kommaZahl(d)} Cent gestiegen` : `um ${kommaZahl(Math.abs(d))} Cent gefallen`);

// Nüchterne Fassung — Rückfall ohne KI und gleichzeitig die Vorlage, aus der
// das Modell formulieren soll.
export function plainText(raw) {
  const s = [];
  if (raw.weather) {
    const w = raw.weather;
    s.push(`Wetter: ${w.text}, ${Math.round(w.min)} bis ${Math.round(w.max)} Grad`
      + (w.prob >= 30 ? `, Regenwahrscheinlichkeit ${w.prob} %` : "") + ".");
  }
  if (raw.sprit) {
    const p = raw.sprit;
    s.push(`${p.fuel} am günstigsten bei ${p.name}${p.city ? " in " + p.city : ""} für `
      + `${p.price.toFixed(3).replace(".", ",")} €`
      + (p.dist != null ? ` (${String(p.dist).replace(".", ",")} km)` : "")
      + (p.diffCent != null && Math.abs(p.diffCent) >= 0.1 ? `, ${cent(p.diffCent)}` : "") + ".");
  }
  if (raw.fire) {
    const f = raw.fire;
    s.push(f.count === 0
      ? `Keine Einsätze im Bezirk ${f.bezirk} in den letzten 14 Stunden.`
      : `${f.count} Einsätze im Bezirk ${f.bezirk} (${f.open} noch offen).`);
  }
  return s.length ? s.join(" ") : "Für heute liegen keine Daten vor — im Admin-Panel ist noch nichts eingestellt.";
}

// Die KI bekommt NUR die Rohwerte und darf ausschließlich daraus formulieren.
export async function compose(env, raw) {
  const plain = plainText(raw);
  if (!env.AI) return { text: plain, via: "plain" };

  const prompt =
    "Du schreibst mir ein kurzes Morgen-Briefing. Ich wohne in Niederösterreich. "
    + "Sprich mich mit DU an, nicht mit Sie, und schreib österreichisches Deutsch. "
    + "Verwende AUSSCHLIESSLICH die folgenden Daten und erfinde nichts dazu. "
    + "JEDER vorhandene Block muss vorkommen: Wetter, Spritpreis (mit Preis und Ort) und Einsätze. "
    + "Runde Temperaturen auf ganze Grad. Höchstens drei kurze Sätze, sachlich und freundlich, "
    + "ohne Aufzählung, ohne Überschrift, ohne Emojis. Beginne mit einem kurzen Gruß.\n\n"
    + "Daten (JSON):\n" + JSON.stringify(raw);

  try {
    await bumpStat(env, "ai:briefing");
    const res = await env.AI.run(MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 220,
    });
    const t = String((res && (res.response || res.result)) || "").trim();
    // Zu kurz oder zu lang heißt: das Modell hat nicht getan, was es sollte.
    if (t.length < 40 || t.length > 900) return { text: plain, via: "plain" };
    // Beim ersten Lauf hat das Modell den Spritpreis einfach weggelassen,
    // obwohl er in den Daten stand. Wenn der Preis fehlt, ist der Text
    // unvollständig → nüchterne Fassung, die ihn garantiert enthält.
    if (raw.sprit && raw.sprit.price != null) {
      const p = raw.sprit.price.toFixed(3);
      if (!t.includes(p) && !t.includes(p.replace(".", ","))) return { text: plain, via: "plain" };
    }
    return { text: t, via: "ai" };
  } catch (_) {
    return { text: plain, via: "plain" };
  }
}

// ---------- Erzeugen + speichern + schicken ----------

// force: Uhrzeit und „heute schon erledigt" übergehen (Admin-Knopf).
// push:  false = nur erzeugen, nicht verschicken.
export async function generate(env, { force = false, push = true } = {}) {
  const cfg = await loadCfg(env);
  if (!cfg.on && !force) return { ok: true, skipped: "aus" };

  const { day, hour } = viennaNow();
  if (!force) {
    if (hour < cfg.hour) return { ok: true, skipped: "zu früh" };
    const da = await env.DB.prepare("SELECT day FROM briefing WHERE day = ?").bind(day).first();
    if (da) return { ok: true, skipped: "heute schon erledigt" };
  }

  const raw = await collect(env, cfg);
  const { text, via } = await compose(env, raw);

  await env.DB.prepare(
    "INSERT INTO briefing (day, text, data, via, at) VALUES (?, ?, ?, ?, datetime('now')) " +
    "ON CONFLICT(day) DO UPDATE SET text = excluded.text, data = excluded.data, via = excluded.via, at = excluded.at"
  ).bind(day, text, JSON.stringify(raw), via).run();

  // Nur 14 Tage behalten — das ist ein Tagesblick, kein Archiv.
  try { await env.DB.prepare("DELETE FROM briefing WHERE day < date('now','-14 days')").run(); } catch (_) {}

  let pushed = false;
  if (push && cfg.name) {
    await sendToName(env, cfg.name, {
      title: "Guten Morgen",
      body: text.slice(0, 300),
      url: "/briefing/",
    });
    pushed = true;
  }
  return { ok: true, day, via, pushed, text };
}
