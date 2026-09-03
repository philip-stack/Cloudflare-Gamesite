import { json, clientIp, rateLimit } from "./_util.js";

// ====================================================================
// Anonyme Nutzungszähler. Der Client meldet per sendBeacon ein Ereignis
// ({ ev, game }); wir zählen es in stat_daily hoch. BEWUSST minimal &
// ohne Personenbezug:
//   • gespeichert wird NUR (Tag, "ev:game", Anzahl) — keine IP, kein
//     Gerät, kein Name, keine Sitzungs-Kennung, kein Zeitpunkt.
//   • die Client-IP dient nur der Flut-Drossel (rateLimit hasht sie
//     flüchtig) und landet NICHT in der Tabelle.
// So sieht der Betrieb, welche Spiele laufen und ob der Duell-/Teilen-
// Loop greift, ohne einzelne Nutzer:innen nachzuverfolgen.
//
//   POST /api/stat  { ev:"play"|"duel"|"share", game:"galopp" }  → 204
// ====================================================================

const EVENTS = new Set(["play", "duel", "share"]);
const GAME_RE = /^[a-z0-9_-]{1,24}$/;

// Serverseitiger Zähler für dieselbe Tabelle — für Dinge, die KEIN Client
// meldet. Gebraucht für die KI-Aufrufe: Cloudflare liefert die Neuronen,
// weiß aber nicht, WOFÜR sie verbraucht wurden (Kochstudio und Briefing
// laufen auf demselben Modell). Kein Personenbezug, wie beim Rest: nur
// (Tag, Schlüssel, Anzahl).
export async function bumpStat(env, key) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(
      "INSERT INTO stat_daily (day, k, n) VALUES (?, ?, 1) " +
      "ON CONFLICT(day, k) DO UPDATE SET n = n + 1"
    ).bind(day, String(key).slice(0, 40)).run();
  } catch (_) { /* Zähler dürfen nie den Ablauf stören */ }
}

export async function onRequestPost({ request, env }) {
  // Großzügige Drossel gegen versehentliche Schleifen/Missbrauch (IP nur flüchtig).
  if (!(await rateLimit(env, "stat:" + clientIp(request), 300, 60))) {
    return new Response(null, { status: 204 });   // still schlucken, nie stören
  }
  let b = {};
  try { b = await request.json(); } catch { return new Response(null, { status: 204 }); }
  const ev = String(b.ev || "");
  const game = String(b.game || "").toLowerCase();
  if (!EVENTS.has(ev) || !GAME_RE.test(game)) return new Response(null, { status: 204 });

  const day = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD (UTC)
  const k = ev + ":" + game;
  try {
    await env.DB.prepare(
      "INSERT INTO stat_daily (day, k, n) VALUES (?, ?, 1) " +
      "ON CONFLICT(day, k) DO UPDATE SET n = n + 1"
    ).bind(day, k).run();
  } catch (_) { /* Zähler dürfen nie den Spielfluss stören */ }
  return new Response(null, { status: 204 });
}

// GET nur als Health-/Debug-Echo (keine Daten preisgeben).
export function onRequestGet() {
  return json({ ok: true });
}
