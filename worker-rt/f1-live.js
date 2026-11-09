// ====================================================================
// F1Live — Durable Object für den Rennticker (/f1/). Hängt sich an den
// offiziellen Live-Timing-Feed der Formel 1 (SignalR Core, anonym, derselbe
// Feed wie die F1-App), führt die Änderungen zum Gesamtstand zusammen und
// liefert auf Abfrage eine schlanke Zeitenliste (F1Model.fromLive).
//
//   Pages /api/f1-live  →  dieses DO (ein einziges, Name "live")
//
// Verbindet nur, solange jemand abfragt: Nach IDLE_MS ohne Abfrage trennt
// der Alarm die Leitung wieder. Inoffiziell — ändert die F1 etwas am Feed,
// liefert das DO ok:false und die Seite fällt auf die Nachschau zurück.
// ====================================================================
import { DurableObject } from "cloudflare:workers";
import F1 from "../public/f1/model.js";
import F1Track from "../public/f1/trackcal.js";
import { rtLogError } from "./rt-db.js";
import { KEEP_TOPICS } from "../functions/f1data/_state.js";

const HOST = "https://livetiming.formula1.com/signalrcore";
const UA = "Rennticker/1.0 (+https://philip-stack.pages.dev/f1/; privat)";
const RS = "\x1e";   // SignalR-Trennzeichen
export const TOPICS = ["Heartbeat", "SessionInfo", "SessionStatus", "TrackStatus", "LapCount",
  "DriverList", "TimingData", "TimingAppData", "RaceControlMessages", "ChampionshipPrediction", "TeamRadio", "Position.z",
  "WeatherData", "TimingStats"];
const IDLE_MS = 5 * 60 * 1000;
const PING_MS = 15 * 1000;
const LOG_EVERY_MS = 10 * 60 * 1000;   // gleiche Störung höchstens alle 10 min ins error_log
const HIST_SAVE_MS = 60 * 1000;        // Live-Verlauf so oft in D1 sichern (überlebt Neustart/Deploy)
const STATE_SAVE_MS = 60 * 1000;       // Feed-Stand der Session (Ersatz fürs gesperrte F1-Archiv)

// Kleine D1-Ablage in f1_cache (gzip), dieselbe Tabelle wie der Proxy
async function cachePut(env, k, text) {
  if (!env || !env.DB) return;
  const body = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  await env.DB.prepare("INSERT INTO f1_cache (k, body, at) VALUES (?, ?, datetime('now')) ON CONFLICT(k) DO UPDATE SET body = excluded.body, at = excluded.at").bind(k, body).run();
}
async function cacheGet(env, k) {
  if (!env || !env.DB) return null;
  const r = await env.DB.prepare("SELECT body FROM f1_cache WHERE k = ?").bind(k).first();
  if (!r || !r.body) return null;
  const bin = r.body instanceof ArrayBuffer ? r.body : new Uint8Array(r.body).buffer;
  return new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

// Lastbalancer-Cookies aus der Negotiate-Antwort (die Verbindung muss am
// selben Server landen).
// Position.z: base64 + raw deflate → { Position: [{ Timestamp, Entries: { n: { X, Y, Status } } }] }
// Nur der jüngste Eintrag zählt → { t, cars: { n: [x, y] } }
export async function decodePositions(b64) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const txt = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  const list = (JSON.parse(txt).Position || []);
  const last = list[list.length - 1];
  if (!last) return null;
  const cars = {};
  for (const [n, e] of Object.entries(last.Entries || {})) if (e && e.Status === "OnTrack" && (e.X || e.Y)) cars[n] = [e.X, e.Y];
  return { t: last.Timestamp, cars };
}

// Mini-Sektoren je Sektor (aus dem Stand eines beliebigen Autos) → [8, 8, 8] | null
export function segCounts(state) {
  for (const l of Object.values(((state || {}).TimingData || {}).Lines || {})) {
    const S = l && l.Sectors ? Object.values(l.Sectors) : [];
    const c = S.map(x => (x && x.Segments ? Object.keys(x.Segments).length : 0));
    if (c.length && c.every(Boolean)) return c;
  }
  return null;
}

export function lbCookies(h) {
  const raw = typeof h.getSetCookie === "function" ? h.getSetCookie().join(", ") : (h.get("set-cookie") || "");
  return (raw.match(/AWSALB(?:CORS)?=[^;,\s]+/g) || []).join("; ");
}

export class F1Live extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ws = null; this.state = null; this.ready = false;
    this.connecting = null; this.lastPoll = 0; this.lastMsg = 0; this.ping = null;
    this.cache = null; this.cacheAt = 0; this.error = "";
    this.logged = new Map();
    this.prog = {};      // Live-Karte: je Auto letzter Mini-Sektor { s, k, t, lapAt }
    this.hist = null;    // Live-Verlauf der Session (F1Model.histStep), höchstens alle 2 s fortgeschrieben
    this.histAt = 0; this.histSavedAt = 0;
    this.stateSavedAt = 0;   // jüngste Nachricht, deren Stand schon in D1 liegt
    this.segN = null;    // Mini-Sektoren je Sektor (z. B. [8, 8, 8])
    this.lapRec = {}; this.calLaps = [];   // gemessene Runden fürs Nachschärfen der Karte
    this.calChecked = false;               // Mini-Sektor-Aufteilung der Eichung schon abgeglichen?
  }

  // Verlauf in D1 sichern / nach Neustart zurückholen (Schlüssel = Session-Pfad)
  saveHist(now) {
    const h = this.hist;
    if (!h || !h.key || now - this.histSavedAt < HIST_SAVE_MS || (!Object.keys(h.hist).length && !Object.keys(h.laps).length)) return;
    this.histSavedAt = now;
    const { prev, ...keep } = h;
    this.ctx.waitUntil(cachePut(this.env, "hist/" + h.key, JSON.stringify(keep)).catch(e => this.log("Verlauf sichern fehlgeschlagen", e && e.message)));
  }
  // Feed-Stand der Session als state/<Key> in D1: Daraus zeigt der Rennticker
  // die Session später (Training/Qualifying, Funk, Startaufstellung, Reifen) —
  // das F1-Archiv ist seit Okt. 2026 nur noch angemeldet abrufbar.
  saveState(force) {
    const st = this.state, info = st && st.SessionInfo;
    if (!this.ready || !info || !info.Key || !(st.TimingData || {}).Lines || this.lastMsg <= this.stateSavedAt) return;
    if (!force && Date.now() - this.stateSavedAt < STATE_SAVE_MS) return;
    this.stateSavedAt = this.lastMsg;
    const keep = {};
    for (const t of KEEP_TOPICS) if (st[t] != null) keep[t] = st[t];
    this.ctx.waitUntil(cachePut(this.env, "state/" + info.Key, JSON.stringify(keep)).catch(e => this.log("Stand sichern fehlgeschlagen", e && e.message)));
  }
  async restoreHist() {
    const path = (this.state && this.state.SessionInfo || {}).Path;
    if (!path) return;
    try {
      const txt = await cacheGet(this.env, "hist/" + path);
      if (!txt || !this.state || (this.state.SessionInfo || {}).Path !== path) return;
      const old = JSON.parse(txt);
      const h = this.hist && this.hist.key === path ? this.hist : { key: path, hist: {}, laps: {}, events: [], prev: null, pitAt: {}, wx: [] };
      // Gesicherter Stand ergänzt, was die neue Verbindung noch nicht kennt
      h.hist = { ...old.hist, ...h.hist };
      for (const [n, m] of Object.entries(old.laps || {})) h.laps[n] = { ...m, ...(h.laps[n] || {}) };
      const seen = new Set(h.events.map(e => e.t));
      h.events = (old.events || []).filter(e => !seen.has(e.t)).concat(h.events).sort((a, b) => a.t - b.t).slice(-300);
      h.pitAt = { ...(old.pitAt || {}), ...h.pitAt };
      const have = new Set((h.wx || []).map(x => x.t));
      h.wx = (old.wx || []).filter(x => !have.has(x.t)).concat(h.wx || []).sort((a, b) => a.t - b.t).slice(-400);
      this.hist = h;
    } catch (e) { this.log("Verlauf laden fehlgeschlagen", e && e.message); }
  }

  // Eichung der Strecke für die Live-Karte (D1 trackcal/<Strecke>): legt der
  // Cron vor jedem Wochenende aus OpenF1 an (genähert, functions/api/f1/_trackcal.js);
  // hier wird sie mit den gemessenen Mini-Sektor-Zeiten nachgeschärft.
  async trackCal(circuit) {
    return cacheGet(this.env, "trackcal/" + circuit).catch(() => null);
  }
  // Saubere Runden sammeln (je Auto, F1Track.lapRecStep) und die genäherte
  // Eichung nach 5, 10, 20 und 40 Runden nachschärfen (beim ersten Mal
  // nur die Mini-Sektor-Aufteilung abgleichen)
  recordLap(n, p, now) {
    const N = (this.segN || []).reduce((x, y) => x + y, 0);
    if (!N || !(p.s >= 0)) return;
    if (!this.calChecked) { this.calChecked = true; this.ctx.waitUntil(this.refineCal()); }
    const base = this.segN.slice(0, p.s).reduce((x, y) => x + y, 0);
    const line = ((this.state.TimingData || {}).Lines || {})[n] || {};
    const r = F1Track.lapRecStep(this.lapRec[n], base + p.k, now / 1000, N, !!(line.InPit || line.PitOut));
    this.lapRec[n] = r.rec;
    if (!r.lap) return;
    this.calLaps.push(r.lap);
    if (this.calLaps.length > 60) this.calLaps.shift();
    if ([5, 10, 20, 40].includes(this.calLaps.length)) this.ctx.waitUntil(this.refineCal());
  }
  async refineCal() {
    const circuit = ((((this.state || {}).SessionInfo || {}).Meeting || {}).Circuit || {}).Key;
    if (!circuit) return;
    try {
      const txt = await this.trackCal(circuit);
      const cal = txt && JSON.parse(txt);
      // Nur genäherte Eichungen anfassen; eine bessere (mehr Runden) nicht verschlechtern
      const same = String(cal && cal.counts) === String(this.segN);
      if (!cal || !cal.approx || (same && (cal.refined || 0) > this.calLaps.length && this.calLaps.length < 20)) return;
      const fine = F1Track.refineCal(cal, this.calLaps, this.segN);
      if (fine) await cachePut(this.env, "trackcal/" + circuit, JSON.stringify(fine));
    } catch (e) { this.log("Strecke nachschärfen fehlgeschlagen", e && e.message); }
  }

  // Verlauf fortschreiben — aus dem Feed, unabhängig davon, ob gerade jemand schaut
  snap() {
    const now = Date.now();
    if (now - this.histAt < 2000 || !this.ready) return;
    this.histAt = now;
    try { this.hist = F1.histStep(this.hist, F1.fromLive(this.state), now); this.saveHist(now); }
    catch (e) { this.log("Verlauf fehlgeschlagen", e && e.stack || e); }
  }

  // Störungen ins gemeinsame error_log (Admin-Dashboard), gedrosselt je Art —
  // eine hängende Verbindung soll das Protokoll nicht fluten.
  log(kind, detail) {
    const now = Date.now();
    if (now - (this.logged.get(kind) || 0) < LOG_EVERY_MS) return;
    this.logged.set(kind, now);
    this.ctx.waitUntil(rtLogError(this.env, "F1-Live: " + kind, "f1-live", detail == null ? null : String(detail)));
  }

  async fetch(request) {
    const url = request ? new URL(request.url) : null;
    // Streckeneichung braucht keine Live-Verbindung
    if (url && url.pathname === "/trackcal") {
      const circuit = url.searchParams.get("circuit") || "";
      if (!/^\d{1,4}$/.test(circuit)) return Response.json({ ok: false, error: "bad request" }, { status: 400 });
      const txt = await this.trackCal(circuit);
      return txt ? new Response(txt, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } })
        : Response.json({ ok: false, error: "keine Eichung" }, { status: 404 });
    }
    this.lastPoll = Date.now();
    const wantHist = url && url.pathname === "/hist";
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 60000);
    try { await this.connect(); } catch (e) { this.error = String(e && e.message || e); this.log("Verbindung fehlgeschlagen", this.error); }
    // Erster Gesamtstand kommt kurz nach dem Abo
    for (let i = 0; i < 25 && !this.ready && this.ws; i++) await new Promise(r => setTimeout(r, 200));
    if (!this.ready) {
      if (this.ws) this.log("kein Gesamtstand nach Abo", this.error || "Timeout 5 s");
      return Response.json({ ok: false, error: this.error || "connecting" }, { status: 503 });
    }
    // Ganzer Verlauf (einmal beim Öffnen der Seite)
    if (wantHist) {
      this.snap();
      const h = this.hist || { key: "", hist: {}, laps: {}, events: [], wx: [] };
      const laps = {};
      for (const [n, m] of Object.entries(h.laps)) laps[n] = Object.values(m);
      return Response.json({ ok: true, key: h.key, hist: Object.values(h.hist), laps, events: h.events, wx: h.wx || [] }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!this.cache || Date.now() - this.cacheAt > 1000) {
      try {
        let pos = null;
      if (this.posRaw) { try { pos = await decodePositions(this.posRaw); } catch (_) { pos = null; } }
      // Mini-Sektor je Auto mit Alter in ms (Karte schätzt daraus die Position)
      const now = Date.now(), prog = {};
      for (const [n, p] of Object.entries(this.prog)) if (p.s >= 0) prog[n] = [p.s, p.k, now - p.t];
      prog._n = this.segN = this.segN || segCounts(this.state);
      this.cache = JSON.stringify({ ok: true, updated: this.lastMsg, ...F1.fromLive(this.state), pos, prog, topics: this.topicsGot || [], posSeen: !!this.posRaw });
      } catch (e) {
        // Feed-Format geändert? Stand verwerfen, beim nächsten Abruf frisch abonnieren
        this.log("Auswertung fehlgeschlagen", e && e.stack || e);
        this.drop();
        return Response.json({ ok: false, error: "parse" }, { status: 503 });
      }
      this.cacheAt = Date.now();
    }
    return new Response(this.cache, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }

  async alarm() {
    this.saveState(false);
    if (Date.now() - this.lastPoll > IDLE_MS) { this.saveState(true); this.drop(); return; }
    if (!this.ws) { try { await this.connect(); } catch (e) { this.error = String(e && e.message || e); this.log("Neuverbindung fehlgeschlagen", this.error); } }
    await this.ctx.storage.setAlarm(Date.now() + 60000);
  }

  drop() {
    clearInterval(this.ping); this.ping = null;
    try { this.ws && this.ws.close(1000, "idle"); } catch (_) {}
    this.ws = null; this.state = null; this.ready = false; this.cache = null; this.posRaw = null; this.prog = {};
    this.hist = null; this.histAt = 0; this.histSavedAt = 0; this.stateSavedAt = 0;
    this.segN = null; this.lapRec = {}; this.calLaps = []; this.calChecked = false;
  }

  connect() {
    if (this.ws) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const neg = await fetch(HOST + "/negotiate?negotiateVersion=1", { method: "POST", headers: { "User-Agent": UA } });
      if (!neg.ok) throw new Error("negotiate " + neg.status);
      const { connectionToken } = await neg.json();
      const res = await fetch(HOST + "?id=" + encodeURIComponent(connectionToken), {
        headers: { Upgrade: "websocket", Cookie: lbCookies(neg.headers), "User-Agent": UA },
      });
      const ws = res.webSocket;
      if (!ws) throw new Error("upgrade " + res.status);
      ws.accept();
      this.ws = ws; this.ready = false; this.state = {}; this.error = "";
      let handshaken = false;
      ws.addEventListener("message", ev => {
        // Nachzügler einer schon getrennten Leitung nicht in den neuen Stand mischen
        if (this.ws !== ws) return;
        this.lastMsg = Date.now();
        for (const part of String(ev.data).split(RS)) {
          if (!part || this.ws !== ws) continue;
          let m; try { m = JSON.parse(part); } catch (_) { continue; }
          if (!handshaken) {
            handshaken = true;
            if (m.error) { this.error = m.error; this.log("Handshake abgelehnt", m.error); ws.close(); return; }
            ws.send(JSON.stringify({ type: 1, invocationId: "1", target: "Subscribe", arguments: [TOPICS] }) + RS);
            continue;
          }
          if (m.type === 3 && m.invocationId === "1") {
            if (m.error) { this.error = m.error; this.log("Abo abgelehnt", m.error); continue; }
            this.topicsGot = Object.keys(m.result || {});
            for (const [t, v] of Object.entries(m.result || {})) {
              if (t === "Position.z") this.posRaw = typeof v === "string" ? v : null;   // erst bei Abfrage entpacken
              else this.state[t] = v;
            }
            // Startstand der Mini-Sektoren (ohne Rundenzähler, sonst greift die Nachzügler-Sperre)
            const now0 = Date.now();
            this.prog = {};
            for (const [n, l] of Object.entries((this.state.TimingData || {}).Lines || {})) this.prog[n] = F1.segStep(null, { Sectors: l && l.Sectors }, now0);
            this.ready = true; this.cache = null;
            this.ctx.waitUntil(this.restoreHist());
          } else if (m.type === 1 && m.target === "feed" && Array.isArray(m.arguments)) {
            const [topic, data] = m.arguments;
            // Neue Session (z. B. Training → Sprint-Qualifying) auf derselben
            // Leitung: alten Stand NICHT weiterführen (Stints, Runden, Meldungen
            // der vorigen Session blieben sonst hängen) → neu abonnieren
            const oldPath = (this.state.SessionInfo || {}).Path;
            if (topic === "SessionInfo" && data && data.Path && oldPath && data.Path !== oldPath) {
              this.saveState(true);
              this.drop();
              return;
            }
            if (topic === "Position.z") { if (typeof data === "string") this.posRaw = data; this.cache = null; }
            else if (TOPICS.includes(topic)) {
              const moved = [];
              if (topic === "TimingData" && data && data.Lines) {
                const now = Date.now();
                for (const [n, l] of Object.entries(data.Lines)) {
                  const old = this.prog[n];
                  this.prog[n] = F1.segStep(old, l, now);
                  if (this.prog[n] !== old && this.prog[n].t === now) moved.push(n);
                }
              }
              this.state[topic] = F1.mergeFeed(this.state[topic], data); this.cache = null;
              if (moved.length) {
                this.segN = this.segN || segCounts(this.state);
                for (const n of moved) this.recordLap(n, this.prog[n], this.prog[n].t);
              }
              if (topic === "TimingData" || topic === "LapCount" || topic === "TrackStatus") this.snap();
            }
          } else if (m.type === 7) {
            if (m.error) this.log("Feed hat getrennt", m.error);
            ws.close();
          }
        }
      });
      const gone = ev => {
        if (this.ws !== ws) return;
        clearInterval(this.ping); this.ping = null; this.ws = null; this.ready = false;
        // Unerwartet weg, während jemand zuschaut → protokollieren (Alarm verbindet neu)
        const code = ev && ev.code;
        if (Date.now() - this.lastPoll < 60000 && code !== 1000) this.log("Verbindung abgebrochen", "Code " + (code ?? "error") + (ev && ev.reason ? " " + ev.reason : ""));
      };
      ws.addEventListener("close", gone);
      ws.addEventListener("error", gone);
      ws.send(JSON.stringify({ protocol: "json", version: 1 }) + RS);
      clearInterval(this.ping);
      this.ping = setInterval(() => { try { ws.send(JSON.stringify({ type: 6 }) + RS); } catch (_) {} }, PING_MS);
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }
}
