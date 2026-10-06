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
import { rtLogError } from "./rt-db.js";

const HOST = "https://livetiming.formula1.com/signalrcore";
const UA = "Rennticker/1.0 (+https://philip-stack.pages.dev/f1/; privat)";
const RS = "\x1e";   // SignalR-Trennzeichen
export const TOPICS = ["Heartbeat", "SessionInfo", "SessionStatus", "TrackStatus", "LapCount",
  "DriverList", "TimingData", "TimingAppData", "RaceControlMessages", "ChampionshipPrediction", "TeamRadio", "Position.z",
  "WeatherData", "TimingStats"];
const IDLE_MS = 5 * 60 * 1000;
const PING_MS = 15 * 1000;
const LOG_EVERY_MS = 10 * 60 * 1000;   // gleiche Störung höchstens alle 10 min ins error_log

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
  }

  // Störungen ins gemeinsame error_log (Admin-Dashboard), gedrosselt je Art —
  // eine hängende Verbindung soll das Protokoll nicht fluten.
  log(kind, detail) {
    const now = Date.now();
    if (now - (this.logged.get(kind) || 0) < LOG_EVERY_MS) return;
    this.logged.set(kind, now);
    this.ctx.waitUntil(rtLogError(this.env, "F1-Live: " + kind, "f1-live", detail == null ? null : String(detail)));
  }

  async fetch() {
    this.lastPoll = Date.now();
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 60000);
    try { await this.connect(); } catch (e) { this.error = String(e && e.message || e); this.log("Verbindung fehlgeschlagen", this.error); }
    // Erster Gesamtstand kommt kurz nach dem Abo
    for (let i = 0; i < 25 && !this.ready && this.ws; i++) await new Promise(r => setTimeout(r, 200));
    if (!this.ready) {
      if (this.ws) this.log("kein Gesamtstand nach Abo", this.error || "Timeout 5 s");
      return Response.json({ ok: false, error: this.error || "connecting" }, { status: 503 });
    }
    if (!this.cache || Date.now() - this.cacheAt > 1000) {
      try {
        let pos = null;
      if (this.posRaw) { try { pos = await decodePositions(this.posRaw); } catch (_) { pos = null; } }
      this.cache = JSON.stringify({ ok: true, updated: this.lastMsg, ...F1.fromLive(this.state), pos });
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
    if (Date.now() - this.lastPoll > IDLE_MS) { this.drop(); return; }
    if (!this.ws) { try { await this.connect(); } catch (e) { this.error = String(e && e.message || e); this.log("Neuverbindung fehlgeschlagen", this.error); } }
    await this.ctx.storage.setAlarm(Date.now() + 60000);
  }

  drop() {
    clearInterval(this.ping); this.ping = null;
    try { this.ws && this.ws.close(1000, "idle"); } catch (_) {}
    this.ws = null; this.state = null; this.ready = false; this.cache = null; this.posRaw = null;
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
        this.lastMsg = Date.now();
        for (const part of String(ev.data).split(RS)) {
          if (!part) continue;
          let m; try { m = JSON.parse(part); } catch (_) { continue; }
          if (!handshaken) {
            handshaken = true;
            if (m.error) { this.error = m.error; this.log("Handshake abgelehnt", m.error); ws.close(); return; }
            ws.send(JSON.stringify({ type: 1, invocationId: "1", target: "Subscribe", arguments: [TOPICS] }) + RS);
            continue;
          }
          if (m.type === 3 && m.invocationId === "1") {
            if (m.error) { this.error = m.error; this.log("Abo abgelehnt", m.error); continue; }
            for (const [t, v] of Object.entries(m.result || {})) {
              if (t === "Position.z") this.posRaw = typeof v === "string" ? v : null;   // erst bei Abfrage entpacken
              else this.state[t] = v;
            }
            this.ready = true; this.cache = null;
          } else if (m.type === 1 && m.target === "feed" && Array.isArray(m.arguments)) {
            const [topic, data] = m.arguments;
            if (topic === "Position.z") { if (typeof data === "string") this.posRaw = data; this.cache = null; }
            else if (TOPICS.includes(topic)) { this.state[topic] = F1.mergeFeed(this.state[topic], data); this.cache = null; }
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
