// ====================================================================
// Same-Origin-Proxy für OpenF1 (Rennticker unter /f1/).
//   GET /f1data/{endpoint}?session_key=…  →  https://api.openf1.org/v1/{endpoint}
// Die CSP erlaubt nur 'self', darum geht der Browser über uns. Die Antwort
// wird unverändert durchgereicht (kein Parsen → kaum CPU) und am Edge
// gecacht. Bewusst NICHT unter /api/ (dort erzwingt _headers "no-store").
// Gratis-Stufe von OpenF1: nur abgeschlossene Sessions (ab ~30 min danach),
// 3 Anfragen/s — bei 429 einmal kurz warten und nochmal versuchen.
// ====================================================================

import { fiaList, fiaPdf } from "./_fia.js";
import { teamDuel } from "./_duel.js";
import { synthState, SYNTH_PARTS } from "./_state.js";

const BASE = "https://api.openf1.org/v1/";
const UA = "Rennticker/1.0 (+https://philip-stack.pages.dev/f1/; privat)";

// Endpunkt → Cache-Dauer in Sekunden (Listen ändern sich, Session-Daten kaum)
export const ENDPOINTS = {
  sessions: 1800, meetings: 1800,
  drivers: 3600, position: 3600, intervals: 3600, laps: 3600,
  stints: 3600, pit: 3600, race_control: 3600, session_result: 3600,
  championship_drivers: 3600, championship_teams: 3600,
  weather: 3600,          // Wetter je Minute
  team_radio: 3600,       // Funk-Clips (Ersatz fürs F1-Archiv)
  location: 86400,          // Streckenkarte: x/y je Auto (nur mit Zeitfenster)
};
const PARAMS = { session_key: /^\d{1,6}$/, meeting_key: /^\d{1,6}$/, year: /^20\d\d$/, session_type: /^[A-Za-z]{1,20}$/,
  driver_number: /^\d{1,2}$/, from: /^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z?$/, to: /^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z?$/ };

export function buildUrl(ep, search) {
  if (!Object.prototype.hasOwnProperty.call(ENDPOINTS, ep)) return null;
  const q = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(search)) {
    if (!PARAMS[k] || !PARAMS[k].test(v)) return null;
    q.set(k, v);
  }
  // Session-Daten nur mit session_key — sonst käme die ganze Saison
  if (ep !== "sessions" && ep !== "meetings" && !q.has("session_key")) return null;
  // from/to → OpenF1-Zeitfilter (date>= / date<=). location gibt es nur mit
  // Fenster von höchstens 5 Minuten (sonst Millionen Zeilen).
  const from = q.get("from"), to = q.get("to");
  q.delete("from"); q.delete("to");
  if (ep === "location" && (!from || !to || Date.parse(to) - Date.parse(from) > 300000 || Date.parse(to) < Date.parse(from))) return null;
  const range = (from ? `&date>=${from}` : "") + (to ? `&date<=${to}` : "");
  const qs = q.toString() + range;
  return BASE + ep + (qs ? "?" + qs.replace(/^&/, "") : "");
}

// Endstand einer Session im Feed-Format (Training/Qualifying, Funk,
// Startaufstellung, Reifen). Die Session-Schlüssel sind dieselben wie bei OpenF1.
//   GET /f1data/archive?year=2026&session_key=11731[&topic=TimingData|all]
// liefert ein Thema (Standard: TimingAppData = Reifen) bzw. alle (topic=all).
// Quelle: D1 (vom Live-DO mitgeschrieben) → F1-Archiv → aus OpenF1 nachgebaut
// (das F1-Archiv ist seit Okt. 2026 nur noch angemeldet abrufbar, siehe _state.js).
const ARCHIVE = "https://livetiming.formula1.com/static/";
export const TOPICS = ["TimingAppData", "TimingData", "DriverList", "SessionInfo", "SessionStatus", "TrackStatus", "RaceControlMessages", "TeamRadio", "WeatherData", "TimingStats"];
const stripBom = t => t.replace(/^﻿/, "");
export async function archivePath(year, key, fetchJson) {
  const idx = await fetchJson(`${ARCHIVE}${year}/Index.json`);
  for (const m of (idx && idx.Meetings) || []) for (const s of m.Sessions || []) if (s.Key === key && s.Path) return s.Path;
  return null;
}
const archiveJson = async url => {
  const r = await fetch(url, { headers: { "User-Agent": UA }, cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) return null;
  return JSON.parse(stripBom(await r.text()));
};
// Je Schub 2 OpenF1-Abrufe, dazwischen 1 s (Gratis-Grenze 3/s, die sich der
// Cron mit uns teilt). Bei 429 kurz warten und nur das Fehlende nachholen.
// Wirft mit e.status (401/403 = Sperre während einer Live-Session).
async function openf1All(reqs) {
  const out = {};
  for (let round = 0; ; round++) {
    const todo = reqs.filter(([k]) => !(k in out));
    let busy = null;
    for (let i = 0; i < todo.length; i += 2) {
      const t0 = Date.now();
      await Promise.all(todo.slice(i, i + 2).map(async ([k, ep, qs]) => {
        const res = await openf1(buildUrl(ep, qs), ENDPOINTS[ep]);
        if (res.ok) out[k] = await res.json();
        else if (res.status === 404) out[k] = [];
        else if (res.status === 429) busy = Object.assign(new Error(ep), { status: 429 });
        else throw Object.assign(new Error(ep), { status: res.status });
      }));
      const wait = 1050 - (Date.now() - t0);
      if (i + 2 < todo.length && wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    if (!busy) return out;
    if (round >= 2) throw busy;
    await new Promise(r => setTimeout(r, 2500));
  }
}
// → Feed-Stand { SessionInfo, TimingData, … } oder null; o.synth = false: nicht aus OpenF1 nachbauen
export async function sessionState(env, year, key, o = {}) {
  const k = "state/" + key;
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const ckey = new Request("https://f1-state.cache/v1/" + key);
  if (cache) { try { const hit = await cache.match(ckey); if (hit) return await hit.json(); } catch (_) { /* weiter */ } }
  const keep = (st, final) => {
    const txt = JSON.stringify(st);
    const jobs = [];
    if (cache) jobs.push(cache.put(ckey, new Response(txt, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" } })).catch(() => {}));
    if (final) jobs.push(dbPut(env, k, txt));
    if (o.waitUntil) jobs.forEach(j => o.waitUntil(j));
    return st;
  };
  // 1. vom Live-DO mitgeschrieben
  const db = await dbGet(env, k);
  if (db) { try { return keep(await db.json(), false); } catch (_) { /* kaputt → weiter */ } }
  // 2. F1-Archiv
  try {
    const path = await archivePath(year, +key, archiveJson);
    if (path && !/\.\.|[?#\\]/.test(path)) {
      const st = {};
      await Promise.all(TOPICS.map(async t => { try { st[t] = await archiveJson(ARCHIVE + encodeURI(path) + t + ".json"); } catch (_) { st[t] = null; } }));
      if (st.TimingData && st.DriverList) return keep(st, true);
    }
  } catch (_) { /* weiter mit OpenF1 */ }
  if (o.synth === false) return null;
  // 3. aus OpenF1 nachbauen
  const qs = "?session_key=" + key;
  const p = await openf1All([["sessions", "sessions", qs], ...SYNTH_PARTS.map(ep => [ep, ep, qs])]);
  const session = (p.sessions || [])[0];
  if (!session || !(p.session_result || []).length) return null;
  const mt = await openf1(buildUrl("meetings", "?meeting_key=" + session.meeting_key), ENDPOINTS.meetings);
  p.meeting = mt.ok ? ((await mt.json()) || [])[0] : null;
  p.session = session;
  // Endgültig erst ein paar Stunden nach dem Ende (OpenF1 korrigiert noch)
  return keep(synthState(p), Date.now() - Date.parse(session.date_end) > 3 * 3600e3);
}
// Ein Thema einer Session als Objekt (für Rennbericht und Abschriften)
export async function archiveTopic(year, key, topic, env) {
  try { const st = await sessionState(env, year, key); return st ? st[topic] ?? null : null; } catch (_) { return null; }
}
async function archive(search, env, waitUntil) {
  const q = new URLSearchParams(search);
  const year = q.get("year"), key = q.get("session_key"), topic = q.get("topic") || "TimingAppData";
  if (!PARAMS.year.test(year || "") || !PARAMS.session_key.test(key || "") || !(topic === "all" || TOPICS.includes(topic))) return new Response("bad request", { status: 400 });
  try {
    const st = await sessionState(env, year, key, { waitUntil });
    const data = st && (topic === "all" ? st : st[topic]);
    if (!data) return new Response(JSON.stringify({ error: 404 }), { status: 404, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=600" },
    });
  } catch (e) {
    const st = e && e.status;
    return new Response(JSON.stringify({ error: st || "fetch" }), { status: st === 401 || st === 403 ? 403 : 502, headers: { "Content-Type": "application/json" } });
  }
}

// Boxenfunk: MP3 aus dem F1-Archiv, same-origin (CSP media-src 'self').
//   GET /f1data/radio?path=2026/…/2026-10-04_Race/&file=VER_3_20261004_143127.mp3
//   GET /f1data/radio?year=2026&session_key=11731&file=…   (Pfad aus dem Endstand der Session)
export const RADIO_FILE = /^[A-Z]{3}[A-Z0-9]?_\d{1,2}_\d{8}_\d{6}\.mp3$/;
export const SESSION_PATH = /^20\d\d\/[^?#\\]+\/$/;
// Quelle eines Funk-Clips im F1-Archiv (auch für /api/f1/transcript)
//   → { url, file } | { status } (400 = ungültig, 404 = Session unbekannt)
export async function radioSource(search, env) {
  const q = new URLSearchParams(search);
  const file = q.get("file") || "";
  let path = q.get("path");
  if (!RADIO_FILE.test(file) || (path && (!SESSION_PATH.test(path) || path.includes("..")))) return { status: 400 };
  if (!path) {
    const year = q.get("year"), key = q.get("session_key");
    if (!PARAMS.year.test(year || "") || !PARAMS.session_key.test(key || "")) return { status: 400 };
    const info = await archiveTopic(year, key, "SessionInfo", env);
    path = info && info.Path;
    if (!path || !SESSION_PATH.test(path) || path.includes("..")) return { status: 404 };
  }
  return { url: ARCHIVE + encodeURI(path) + "TeamRadio/" + file, file };
}
export const RADIO_UA = UA;
async function radio(search, env) {
  try {
    const src = await radioSource(search, env);
    if (!src.url) return new Response(src.status === 400 ? "bad request" : "not found", { status: src.status });
    const r = await fetch(src.url, { headers: { "User-Agent": UA }, cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!r.ok) return new Response("not found", { status: r.status === 404 ? 404 : 502 });
    return new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" } });
  } catch (_) {
    return new Response("fetch failed", { status: 502 });
  }
}

// Ersatzkopie: Jede gute OpenF1-Antwort (und jedes Rennpaket) liegt zusätzlich
// 30 Tage im Edge-Cache. Sperrt OpenF1 (während jeder Live-Session für
// Gratis-Nutzer) oder fällt es aus, kommt diese Kopie — so bleiben Kalender
// und schon einmal geladene Sessions auch während eines Rennens abrufbar.
const STALE_TTL = 30 * 86400;
const staleKey = id => new Request("https://f1-stale.cache/v1/" + encodeURIComponent(id));
function staleCache() { return typeof caches !== "undefined" ? caches.default : null; }
async function staleGet(id) {
  const c = staleCache();
  if (!c) return null;
  try {
    const hit = await c.match(staleKey(id));
    if (!hit) return null;
    const r = new Response(hit.body, hit);
    r.headers.set("Cache-Control", "no-store");
    r.headers.set("X-Rennticker-Stale", "1");
    return r;
  } catch (_) { return null; }
}
function stalePut(id, body, waitUntil) {
  const c = staleCache();
  if (!c) return;
  const p = c.put(staleKey(id), new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${STALE_TTL}` } })).catch(() => {});
  if (waitUntil) waitUntil(p);
}

// Dauerhafte Kopie in D1 (Tabelle f1_cache, gzip): Der Edge-Cache gilt nur je
// Rechenzentrum und verfällt; D1 ist überall gleich. Der Cron füllt sie von
// selbst (Kalender + jedes fertige Rennen/Sprint), sobald OpenF1 frei ist.
async function gzip(text) {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}
export async function dbPut(env, k, text) {
  if (!env || !env.DB) return false;
  try {
    const body = await gzip(text);
    await env.DB.prepare("INSERT INTO f1_cache (k, body, at) VALUES (?, ?, datetime('now')) ON CONFLICT(k) DO UPDATE SET body = excluded.body, at = excluded.at")
      .bind(k, body).run();
    return true;
  } catch (_) { return false; }
}
export async function dbHas(env, k, maxAgeSec) {
  if (!env || !env.DB) return false;
  try {
    const r = await env.DB.prepare("SELECT 1 AS x FROM f1_cache WHERE k = ? AND at > datetime('now', ?)").bind(k, `-${maxAgeSec || 315360000} seconds`).first();
    return !!r;
  } catch (_) { return false; }
}
export async function dbGet(env, k) {
  if (!env || !env.DB) return null;
  try {
    const r = await env.DB.prepare("SELECT body FROM f1_cache WHERE k = ?").bind(k).first();
    if (!r || !r.body) return null;
    const bin = r.body instanceof ArrayBuffer ? r.body : new Uint8Array(r.body).buffer;
    const text = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    return new Response(text, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Rennticker-Stale": "db" } });
  } catch (_) { return null; }
}
// Schlüssel für den Kalender (dieselben URLs, die der Proxy abruft)
export const calKey = url => "openf1/" + url;

// Regenradar für die Strecke (Open-Meteo, gratis, ohne Schlüssel):
//   GET /f1data/rain?place=Marina Bay&country=Singapore
//   → { place, country, slots: [{ t, mm, p }] }  je 15 min, die nächsten 2 h
// Ort aus dem Kalender (location + Land) → Koordinaten per Geocoding (30 Tage gecacht).
const PLACE = /^[\p{L}\p{M} .'\-]{2,60}$/u;
export function pickPlace(results, country) {
  const c = String(country || "").toLowerCase();
  const list = Array.isArray(results) ? results : [];
  return list.find(r => c && String(r.country || "").toLowerCase() === c) || list[0] || null;
}
export function rainSlots(fc) {
  const m = (fc && fc.minutely_15) || {};
  return (m.time || []).map((t, i) => ({ t: Date.parse(t + "Z"), mm: +(m.precipitation || [])[i] || 0, p: +(m.precipitation_probability || [])[i] || 0 }))
    .filter(x => isFinite(x.t));
}
async function rain(search) {
  const q = new URLSearchParams(search);
  const place = (q.get("place") || "").trim(), country = (q.get("country") || "").trim();
  if (!PLACE.test(place) || (country && !PLACE.test(country))) return new Response("bad request", { status: 400 });
  const j = async (url, ttl) => { const r = await fetch(url, { headers: { "User-Agent": UA }, cf: { cacheTtl: ttl, cacheEverything: true } }); return r.ok ? r.json() : null; };
  try {
    const geo = await j(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: place, count: "10", language: "en" })}`, 30 * 86400);
    const g = pickPlace(geo && geo.results, country);
    if (!g) return new Response(JSON.stringify({ error: 404 }), { status: 404, headers: { "Content-Type": "application/json" } });
    const fc = await j(`https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ latitude: g.latitude.toFixed(3), longitude: g.longitude.toFixed(3), minutely_15: "precipitation,precipitation_probability", forecast_minutely_15: "9", timezone: "UTC" })}`, 600);
    if (!fc) throw new Error("forecast");
    return new Response(JSON.stringify({ place: g.name, country: g.country, lat: +g.latitude.toFixed(4), lon: +g.longitude.toFixed(4), slots: rainSlots(fc) }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=600" } });
  } catch (_) {
    return new Response(JSON.stringify({ error: "fetch" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}

// Regenradar-Karte (Wetter-Fenster, live): Radarbilder der letzten 2 h von
// RainViewer (gratis, Kacheln bis Zoom 7), Grundkarte von OpenStreetMap
// (geringe private Nutzung, eigener User-Agent, 30 Tage gecacht — wie es die
// OSM-Kachelregeln verlangen; CARTO will inzwischen einen API-Schlüssel).
// Die CSP erlaubt nur Bilder von uns → Kacheln über den Proxy, am Edge gecacht.
//   GET /f1data/radar  → { frames: [{ t, id }] }  (alle 10 min, älteste zuerst)
//   GET /f1data/tile?k=base|radar&z=7&x=…&y=…[&id=…]
const RADAR_ID = /^[0-9a-f]{6,24}$/;
export function radarFrames(maps) {
  return ((maps && maps.radar && maps.radar.past) || [])
    .map(f => ({ t: f.time * 1000, id: String(f.path || "").split("/").pop() }))
    .filter(f => isFinite(f.t) && RADAR_ID.test(f.id));
}
async function radar() {
  try {
    const r = await fetch("https://api.rainviewer.com/public/weather-maps.json", { headers: { "User-Agent": UA }, cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) throw new Error("rainviewer " + r.status);
    return new Response(JSON.stringify({ frames: radarFrames(await r.json()) }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  } catch (_) {
    return new Response(JSON.stringify({ error: "fetch" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
export function tileUrl(search) {
  const q = new URLSearchParams(search);
  const k = q.get("k"), z = +q.get("z"), x = +q.get("x"), y = +q.get("y"), id = q.get("id") || "";
  const n = 2 ** z;
  if (!Number.isInteger(z) || z < 3 || z > 7 || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) return null;
  if (k === "base") return { url: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, ttl: 30 * 86400 };
  if (k === "radar" && RADAR_ID.test(id)) return { url: `https://tilecache.rainviewer.com/v2/radar/${id}/256/${z}/${x}/${y}/2/1_1.png`, ttl: 86400 };
  return null;
}
async function tile(search) {
  const t = tileUrl(search);
  if (!t) return new Response("bad request", { status: 400 });
  try {
    const r = await fetch(t.url, { headers: { "User-Agent": UA }, cf: { cacheTtl: t.ttl, cacheEverything: true } });
    if (!r.ok) return new Response("not found", { status: r.status === 404 ? 404 : 502 });
    return new Response(r.body, { headers: { "Content-Type": "image/png", "Cache-Control": `public, max-age=${t.ttl}` } });
  } catch (_) {
    return new Response("fetch failed", { status: 502 });
  }
}

// Teamduell der Saison aus den gemerkten Ergebnissen (der Cron sammelt sie)
//   GET /f1data/teamduel?year=2026  →  { sessions, teams: [...] }
async function duel(search, env) {
  const year = new URLSearchParams(search).get("year") || "";
  if (!PARAMS.year.test(year) || !env || !env.DB) return new Response("bad request", { status: 400 });
  try {
    const rows = (await env.DB.prepare("SELECT k FROM f1_cache WHERE k LIKE ?").bind(`result/${year}/%`).all()).results || [];
    const list = [];
    for (const r of rows) { const res = await dbGet(env, r.k); if (res) { try { list.push(JSON.parse(await res.text())); } catch (_) { /* kaputt → weglassen */ } } }
    return new Response(JSON.stringify({ sessions: list.length, teams: teamDuel(list) }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=600" } });
  } catch (_) {
    return new Response(JSON.stringify({ error: "db" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}

// OpenF1 abrufen, bei 429 kurz warten und nochmal (Gratis-Stufe: 3/s)
async function openf1(url, ttl) {
  let res;
  for (let i = 0; i < 3; i++) {
    res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      cf: { cacheTtl: ttl, cacheEverything: true, cacheTtlByStatus: { "200-299": ttl, "400-599": 0 } },
    });
    if (res.status !== 429) break;
    await new Promise(r => setTimeout(r, 1100));
  }
  return res;
}

// Ganzes Rennen in EINER Antwort (Nachschau): statt 10 Anfragen nacheinander
// aus dem Browser holt der Server alles, setzt es als Text zusammen (kein
// Parsen → kaum CPU) und legt das Paket in den Edge-Cache. Jeder weitere
// Aufruf derselben Session kommt sofort.
//   GET /f1data/bundle?session_key=11731&year=2026&end=2026-10-04T10:00:00Z
//   → { drivers, session_result, laps, position, intervals, stints, pit, race_control, weather, tyres }
// end = Sessionende: knapp danach ändert OpenF1 noch (Ergebnis), darum dann
// nur kurz cachen, später eine Woche.
export const BUNDLE_PARTS = ["drivers", "session_result", "laps", "position", "intervals", "stints", "pit", "race_control", "weather"];
const BUNDLE_OPTIONAL = new Set(["weather"]);
const ISO = /^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)?$/;
export function bundleTtl(end, now) {
  const t = Date.parse(end || "");
  return isFinite(t) && now - t > 3 * 3600e3 ? 7 * 86400 : 600;
}
// Rennpaket bauen (auch der Cron nutzt das zum Vorwärmen). Wirft bei Fehler
// mit e.status (401/403 = OpenF1-Sperre während einer Live-Session).
export async function buildBundle(key, year, env) {
  const parts = {};
  // Höchstens 3 gleichzeitig, dann mind. 1 s Pause (OpenF1-Grenze)
  for (let i = 0; i < BUNDLE_PARTS.length; i += 3) {
    const t0 = Date.now();
    await Promise.all(BUNDLE_PARTS.slice(i, i + 3).map(async ep => {
      const res = await openf1(buildUrl(ep, "?session_key=" + key), ENDPOINTS[ep]);
      const txt = res.ok ? (await res.text()).trim() : "";
      if (res.ok && txt.startsWith("[")) parts[ep] = txt;
      else if (res.status === 404 || BUNDLE_OPTIONAL.has(ep)) parts[ep] = "[]";
      else throw Object.assign(new Error(ep), { status: res.status });
    }));
    const wait = 1050 - (Date.now() - t0);
    if (i + 3 < BUNDLE_PARTS.length && wait > 0) await new Promise(r => setTimeout(r, wait));
  }
  // Reifen aus dem Feed-Stand (D1 vom Live-DO bzw. F1-Archiv); fehlt er, rechnet das Modell mit OpenF1
  let tyres = "null";
  try {
    const st = await sessionState(env, year, key, { synth: false });
    if (st && st.TimingAppData) tyres = JSON.stringify(st.TimingAppData);
  } catch (_) { tyres = "null"; }
  return "{" + BUNDLE_PARTS.map(k => JSON.stringify(k) + ":" + parts[k]).join(",") + ',"tyres":' + tyres + "}";
}
async function bundle(search, waitUntil, env) {
  const q = new URLSearchParams(search);
  const key = q.get("session_key") || "", year = q.get("year") || "", end = q.get("end") || "";
  if (!PARAMS.session_key.test(key) || !PARAMS.year.test(year) || (end && !ISO.test(end))) return new Response("bad request", { status: 400 });
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const ckey = new Request(`https://f1-bundle.cache/v1/${key}`);
  if (cache) { const hit = await cache.match(ckey); if (hit) return hit; }
  let body;
  try {
    body = await buildBundle(key, year, env);
  } catch (e) {
    const st = e && e.status;
    const old = (await staleGet("bundle/" + key)) || (await dbGet(env, "bundle/" + key));
    if (old) return old;
    return new Response(JSON.stringify({ error: st || "fetch" }), { status: st === 401 || st === 403 ? 403 : 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  const ttl = bundleTtl(end, Date.now());
  // Abgeschlossenes Rennen (Daten endgültig) dauerhaft in D1 merken
  if (ttl > 3600 && env) { const p = dbPut(env, "bundle/" + key, body); if (waitUntil) waitUntil(p); }
  const res = new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${Math.min(ttl, 3600)}` } });
  stalePut("bundle/" + key, body, waitUntil);
  if (cache) {
    const put = cache.put(ckey, new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${ttl}` } }));
    if (waitUntil) waitUntil(put); else await put;
  }
  return res;
}

export async function onRequestGet({ params, request, waitUntil, env }) {
  const ep = String(params.ep || "");
  if (ep === "bundle") return bundle(new URL(request.url).search, waitUntil, env);
  if (ep === "rain") return rain(new URL(request.url).search);
  if (ep === "radar") return radar();
  if (ep === "tile") return tile(new URL(request.url).search);
  if (ep === "teamduel") return duel(new URL(request.url).search, env);
  if (ep === "radio") return radio(new URL(request.url).search, env);
  if (ep === "archive") return archive(new URL(request.url).search, env, waitUntil);
  if (ep === "fia") return fiaList(new URL(request.url).search);
  if (ep === "fia-pdf") return fiaPdf(new URL(request.url).search);
  const url = buildUrl(ep, new URL(request.url).search);
  if (!url) return new Response("bad request", { status: 400 });
  const ttl = ENDPOINTS[ep];
  try {
    const res = await openf1(url, ttl);
    if (!res.ok) {
      // 401/403 = Live-Session (nur für OpenF1-Sponsoren), 404 = keine Daten
      if (res.status !== 404) { const old = (await staleGet(url)) || (await dbGet(env, calKey(url))); if (old) return old; }
      return new Response(JSON.stringify({ error: res.status }), {
        status: res.status === 404 ? 404 : res.status === 401 || res.status === 403 ? 403 : 502,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    const body = await res.arrayBuffer();
    stalePut(url, body, waitUntil);
    const r = new Response(body, res);
    r.headers.set("Content-Type", "application/json; charset=utf-8");
    r.headers.set("Cache-Control", `public, max-age=${Math.min(ttl, 600)}`);
    r.headers.delete("set-cookie");
    return r;
  } catch (_) {
    const old = (await staleGet(url)) || (await dbGet(env, calKey(url)));
    if (old) return old;
    return new Response(JSON.stringify({ error: "fetch" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
