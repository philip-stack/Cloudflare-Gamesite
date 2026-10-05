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

const HOST = "https://livetiming.formula1.com/signalrcore";
const UA = "Rennticker/1.0 (+https://philip-stack.pages.dev/f1/; privat)";
const RS = "\x1e";   // SignalR-Trennzeichen
export const TOPICS = ["Heartbeat", "SessionInfo", "SessionStatus", "TrackStatus", "LapCount",
  "DriverList", "TimingData", "TimingAppData", "RaceControlMessages"];
const IDLE_MS = 5 * 60 * 1000;
const PING_MS = 15 * 1000;

// Lastbalancer-Cookies aus der Negotiate-Antwort (die Verbindung muss am
// selben Server landen).
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
  }

  async fetch() {
    this.lastPoll = Date.now();
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 60000);
    try { await this.connect(); } catch (e) { this.error = String(e && e.message || e); }
    // Erster Gesamtstand kommt kurz nach dem Abo
    for (let i = 0; i < 25 && !this.ready && this.ws; i++) await new Promise(r => setTimeout(r, 200));
    if (!this.ready) return Response.json({ ok: false, error: this.error || "connecting" }, { status: 503 });
    if (!this.cache || Date.now() - this.cacheAt > 1000) {
      this.cache = JSON.stringify({ ok: true, updated: this.lastMsg, ...F1.fromLive(this.state) });
      this.cacheAt = Date.now();
    }
    return new Response(this.cache, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }

  async alarm() {
    if (Date.now() - this.lastPoll > IDLE_MS) { this.drop(); return; }
    if (!this.ws) { try { await this.connect(); } catch (e) { this.error = String(e && e.message || e); } }
    await this.ctx.storage.setAlarm(Date.now() + 60000);
  }

  drop() {
    clearInterval(this.ping); this.ping = null;
    try { this.ws && this.ws.close(1000, "idle"); } catch (_) {}
    this.ws = null; this.state = null; this.ready = false; this.cache = null;
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
            if (m.error) { this.error = m.error; ws.close(); return; }
            ws.send(JSON.stringify({ type: 1, invocationId: "1", target: "Subscribe", arguments: [TOPICS] }) + RS);
            continue;
          }
          if (m.type === 3 && m.invocationId === "1") {
            if (m.error) { this.error = m.error; continue; }
            for (const [t, v] of Object.entries(m.result || {})) this.state[t] = v;
            this.ready = true; this.cache = null;
          } else if (m.type === 1 && m.target === "feed" && Array.isArray(m.arguments)) {
            const [topic, data] = m.arguments;
            if (TOPICS.includes(topic)) { this.state[topic] = F1.mergeFeed(this.state[topic], data); this.cache = null; }
          } else if (m.type === 7) {
            ws.close();
          }
        }
      });
      const gone = () => { if (this.ws === ws) { clearInterval(this.ping); this.ping = null; this.ws = null; this.ready = false; } };
      ws.addEventListener("close", gone);
      ws.addEventListener("error", gone);
      ws.send(JSON.stringify({ protocol: "json", version: 1 }) + RS);
      clearInterval(this.ping);
      this.ping = setInterval(() => { try { ws.send(JSON.stringify({ type: 6 }) + RS); } catch (_) {} }, PING_MS);
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }
}
