import { json, logError } from "../_util.js";
import { pushToEndpoint } from "../push.js";
import { ecByAddress, FUELS } from "./_ec.js";
import { alertTransition, groupKey } from "./_logic.js";
import { houseDue } from "../_ops.js";

// ====================================================================
// Zeitgesteuerte Preis-Prüfung für den Sprit-Alarm.
//   GET /api/sprit/cron?key=<CRON_TOKEN>   (bzw. Header x-cron-key)
// Wird vom Cron-Worker (worker-rt) angepingt. Da Preise sich selten ändern
// (in AT dürfen sie nur um 12:00 steigen, sonst nur fallen), drosselt die
// Route selbst auf ~12 min — der Worker darf ruhig alle 2 min pingen.
//
// Ablauf: Alarme laden → je (Treibstoff, gerundete Koordinate) EINE
// E-Control-Abfrage (10-min-Cache) → Preis der jeweiligen Station heraussuchen
// → bei Preis ≤ Ziel und „armed" pushen (danach entschärfen); steigt der Preis
// wieder über das Ziel, automatisch neu scharf schalten.
// ====================================================================

const MIN_INTERVAL_MS = 12 * 60 * 1000;

function keyEq(got, want) {
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
const eur = p => p.toFixed(3).replace(".", ",") + " €";

export async function onRequestGet({ request, env }) {
  const got = request.headers.get("x-cron-key") || new URL(request.url).searchParams.get("key") || "";
  if (!keyEq(got, env.CRON_TOKEN)) return json({ error: "forbidden" }, 403);
  if (!env.DB) return json({ ok: false, error: "no-db" });

  // ---- Selbst-Drosselung (~12 min); force=1 (Admin-Handauslösung) umgeht sie ----
  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const last = (await env.DB.prepare("SELECT v FROM app_config WHERE k='sprit_cron_at'").first())?.v;
    if (!force && last) { const age = Date.now() - Date.parse(last); if (isFinite(age) && age < MIN_INTERVAL_MS) return json({ ok: true, skipped: true }); }
    await env.DB.prepare(
      "INSERT INTO app_config (k, v) VALUES ('sprit_cron_at', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v"
    ).bind(new Date().toISOString()).run();
  } catch (_) { /* app_config optional → einfach durchlaufen */ }

  let alerts = [];
  try {
    alerts = (await env.DB.prepare(
      "SELECT endpoint, station_id, fuel, target, name, lat, lng, armed FROM sprit_alert"
    ).all()).results || [];
  } catch (e) { await logError(env, "sprit-cron: load " + e.message, "sprit/cron"); return json({ ok: false }); }
  if (!alerts.length) return json({ ok: true, alerts: 0 });

  // Nach (Treibstoff, gerundete Koordinate) gruppieren → eine Abfrage je Gruppe.
  const groups = new Map();
  for (const a of alerts) {
    if (a.lat == null || a.lng == null) continue;
    const k = groupKey(a.fuel, a.lat, a.lng);
    let g = groups.get(k);
    if (!g) { g = { fuel: a.fuel, lat: a.lat, lng: a.lng, items: [] }; groups.set(k, g); }
    g.items.push(a);
  }

  let sent = 0, checked = 0;
  const dropEndpoint = async ep => {
    try { await env.DB.prepare("DELETE FROM sprit_alert WHERE endpoint = ?").bind(ep).run(); } catch (_) {}
    try { await env.DB.prepare("DELETE FROM push_queue WHERE endpoint = ?").bind(ep).run(); } catch (_) {}
  };

  for (const g of groups.values()) {
    let list = [];
    try { list = await ecByAddress(env, g.lat, g.lng, g.fuel); } catch (_) { continue; }
    const priceById = new Map();
    for (const s of list) priceById.set(String(s.id), s);

    // Preise dieser Gruppe fürs Verlaufsdiagramm festhalten (Tiefstpreis/Tag).
    const seen = new Set();
    for (const a of g.items) {
      const s = priceById.get(String(a.station_id));
      if (!s || typeof s.price !== "number") continue;
      const lk = a.station_id + "|" + g.fuel;
      if (!seen.has(lk)) {
        seen.add(lk);
        try {
          await env.DB.prepare(
            "INSERT INTO sprit_price_log (station_id, fuel, day, price) VALUES (?, ?, date('now'), ?) " +
            "ON CONFLICT(station_id, fuel, day) DO UPDATE SET price = MIN(price, excluded.price)"
          ).bind(String(a.station_id), g.fuel, s.price).run();
        } catch (_) {}
      }
    }

    for (const a of g.items) {
      const s = priceById.get(String(a.station_id));
      if (!s || typeof s.price !== "number") continue;   // Station nicht in der Antwort → überspringen
      checked++;
      const price = s.price;
      const move = alertTransition(a.armed, price, a.target);
      if (move === "fire") {
        const pr = await pushToEndpoint(env, a.endpoint, {
          title: "⛽ Günstig tanken: " + (FUELS[a.fuel] || a.fuel) + " " + eur(price),
          body: (a.name || "Tankstelle") + " — jetzt ≤ deinem Ziel " + eur(a.target),
          url: "/tanken/",
        });
        if (pr.ok) {
          sent++;
          try { await env.DB.prepare("UPDATE sprit_alert SET armed=0 WHERE endpoint=? AND station_id=? AND fuel=?").bind(a.endpoint, a.station_id, a.fuel).run(); } catch (_) {}
        }
        if (pr.gone) await dropEndpoint(a.endpoint);
      } else if (move === "rearm") {
        // Preis wieder über dem Ziel → für die nächste Unterschreitung neu scharf.
        try { await env.DB.prepare("UPDATE sprit_alert SET armed=1 WHERE endpoint=? AND station_id=? AND fuel=?").bind(a.endpoint, a.station_id, a.fuel).run(); } catch (_) {}
      }
    }
  }

  // Preisverlauf einmal pro Stunde ausdünnen, nicht alle 2 Minuten: gelöscht
  // werden Zeilen, die 30 Tage alt sind. Der Primärschlüssel beginnt mit
  // station_id, für "WHERE day < ?" gibt es daher einen eigenen Index
  // (Migration 0014) — vorher war das ein voller Scan pro Lauf.
  if (houseDue()) {
    try { await env.DB.prepare("DELETE FROM sprit_price_log WHERE day < date('now','-30 days')").run(); } catch (_) {}
  }
  return json({ ok: true, alerts: alerts.length, checked, sent });
}
