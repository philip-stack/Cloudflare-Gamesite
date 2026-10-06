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

const BASE = "https://api.openf1.org/v1/";
const UA = "Rennticker/1.0 (+https://philip-stack.pages.dev/f1/; privat)";

// Endpunkt → Cache-Dauer in Sekunden (Listen ändern sich, Session-Daten kaum)
export const ENDPOINTS = {
  sessions: 1800, meetings: 1800,
  drivers: 3600, position: 3600, intervals: 3600, laps: 3600,
  stints: 3600, pit: 3600, race_control: 3600, session_result: 3600,
  championship_drivers: 3600, championship_teams: 3600,
  weather: 3600,          // Wetter je Minute
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

// Reifen aus dem offiziellen F1-Archiv (livetiming.formula1.com/static):
// OpenF1-Stints sind teils verschoben, die F1-Stints stimmen. Die Session-
// Schlüssel sind dieselben wie bei OpenF1.
//   GET /f1data/archive?year=2026&session_key=11731[&topic=TimingData]
// liefert den Endstand eines Themas (Standard: TimingAppData = Reifen).
// Training/Qualifying zeigt der Rennticker komplett aus dem Archiv.
const ARCHIVE = "https://livetiming.formula1.com/static/";
export const TOPICS = ["TimingAppData", "TimingData", "DriverList", "SessionInfo", "SessionStatus", "TrackStatus", "RaceControlMessages", "TeamRadio", "WeatherData", "TimingStats"];
const stripBom = t => t.replace(/^﻿/, "");
export async function archivePath(year, key, fetchJson) {
  const idx = await fetchJson(`${ARCHIVE}${year}/Index.json`);
  for (const m of (idx && idx.Meetings) || []) for (const s of m.Sessions || []) if (s.Key === key && s.Path) return s.Path;
  return null;
}
async function archive(search) {
  const q = new URLSearchParams(search);
  const year = q.get("year"), key = q.get("session_key"), topic = q.get("topic") || "TimingAppData";
  if (!PARAMS.year.test(year || "") || !PARAMS.session_key.test(key || "") || !TOPICS.includes(topic)) return new Response("bad request", { status: 400 });
  const fetchJson = async url => {
    const r = await fetch(url, { headers: { "User-Agent": UA }, cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!r.ok) return null;
    return JSON.parse(stripBom(await r.text()));
  };
  try {
    const path = await archivePath(year, +key, fetchJson);
    // Pfad kommt vom F1-Server; trotzdem kein Ausbrechen aus /static/ (z. B. São Paulo → encodeURI)
    const data = path && !/\.\.|[?#\\]/.test(path) ? await fetchJson(ARCHIVE + encodeURI(path) + topic + ".json") : null;
    if (!data) return new Response(JSON.stringify({ error: 404 }), { status: 404, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=600" },
    });
  } catch (_) {
    return new Response(JSON.stringify({ error: "fetch" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}

// Boxenfunk: MP3 aus dem F1-Archiv, same-origin (CSP media-src 'self').
//   GET /f1data/radio?path=2026/…/2026-10-04_Race/&file=VER_3_20261004_143127.mp3
//   GET /f1data/radio?year=2026&session_key=11731&file=…   (Pfad über Index.json)
export const RADIO_FILE = /^[A-Z]{3}[A-Z0-9]?_\d{1,2}_\d{8}_\d{6}\.mp3$/;
export const SESSION_PATH = /^20\d\d\/[^?#\\]+\/$/;
async function radio(search) {
  const q = new URLSearchParams(search);
  const file = q.get("file") || "";
  let path = q.get("path");
  if (!RADIO_FILE.test(file) || (path && (!SESSION_PATH.test(path) || path.includes("..")))) return new Response("bad request", { status: 400 });
  try {
    if (!path) {
      const year = q.get("year"), key = q.get("session_key");
      if (!PARAMS.year.test(year || "") || !PARAMS.session_key.test(key || "")) return new Response("bad request", { status: 400 });
      path = await archivePath(year, +key, async url => {
        const r = await fetch(url, { headers: { "User-Agent": UA }, cf: { cacheTtl: 3600, cacheEverything: true } });
        return r.ok ? JSON.parse(stripBom(await r.text())) : null;
      });
      if (!path || path.includes("..")) return new Response("not found", { status: 404 });
    }
    const r = await fetch(ARCHIVE + encodeURI(path) + "TeamRadio/" + file, { headers: { "User-Agent": UA }, cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!r.ok) return new Response("not found", { status: r.status === 404 ? 404 : 502 });
    return new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" } });
  } catch (_) {
    return new Response("fetch failed", { status: 502 });
  }
}

export async function onRequestGet({ params, request }) {
  const ep = String(params.ep || "");
  if (ep === "radio") return radio(new URL(request.url).search);
  if (ep === "archive") return archive(new URL(request.url).search);
  if (ep === "fia") return fiaList(new URL(request.url).search);
  if (ep === "fia-pdf") return fiaPdf(new URL(request.url).search);
  const url = buildUrl(ep, new URL(request.url).search);
  if (!url) return new Response("bad request", { status: 400 });
  const ttl = ENDPOINTS[ep];
  try {
    let res;
    for (let i = 0; i < 3; i++) {
      res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/json" },
        cf: { cacheTtl: ttl, cacheEverything: true, cacheTtlByStatus: { "200-299": ttl, "400-599": 0 } },
      });
      if (res.status !== 429) break;
      await new Promise(r => setTimeout(r, 1100));
    }
    if (!res.ok) {
      // 401/403 = Live-Session (nur für OpenF1-Sponsoren), 404 = keine Daten
      return new Response(JSON.stringify({ error: res.status }), {
        status: res.status === 404 ? 404 : res.status === 401 || res.status === 403 ? 403 : 502,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    const r = new Response(res.body, res);
    r.headers.set("Content-Type", "application/json; charset=utf-8");
    r.headers.set("Cache-Control", `public, max-age=${Math.min(ttl, 600)}`);
    r.headers.delete("set-cookie");
    return r;
  } catch (_) {
    return new Response(JSON.stringify({ error: "fetch" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
