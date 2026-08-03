import { DurableObject } from "cloudflare:workers";

// ====================================================================
// Echtzeit-Worker der Gamesite: hostet das Durable Object PartyRoom
// (ein DO pro Spieleabend-Raum). Cloudflare Pages kann keine Durable
// Objects definieren, nur binden — deshalb dieser eigene Worker. Die
// Pages-Site bindet PARTY_ROOM per script_name = "philip-stack-rt".
//
// Das DO ist ein reiner Pub/Sub-Relay: Clients holen ihre Daten weiter
// über die REST-API (/api/party); hier fließt nur ein „changed"-Signal,
// damit alle sofort neu laden statt zu pollen. Hibernation-WebSockets
// (ctx.acceptWebSocket) → das DO schläft zwischen Nachrichten.
// ====================================================================

export class PartyRoom extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    // Interner Aufruf (vom Pages-Server): allen Verbundenen "changed" senden
    if (url.pathname.endsWith("/broadcast")) {
      const sockets = this.ctx.getWebSockets();
      for (const ws of sockets) { try { ws.send("changed"); } catch (_) {} }
      return new Response(String(sockets.length));
    }

    // Sonst: WebSocket-Upgrade eines Clients
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Ein Client meldet selbst eine Änderung (nach eigener Aktion) → an die
  // anderen weiterreichen. "ping"/"pong" hält die Verbindung am Leben.
  async webSocketMessage(ws, message) {
    const msg = typeof message === "string" ? message : "";
    if (msg === "ping") { try { ws.send("pong"); } catch (_) {} return; }
    if (msg === "changed") {
      for (const s of this.ctx.getWebSockets()) { if (s !== ws) { try { s.send("changed"); } catch (_) {} } }
    }
  }

  async webSocketClose(ws) { try { ws.close(); } catch (_) {} }
  async webSocketError(ws) { try { ws.close(); } catch (_) {} }
}

// ====================================================================
// TronRoom — AUTORITATIVES Echtzeit-Match für Neon-Tron (bis 4 Spieler).
// Anders als PartyRoom ist dies kein schlafender Relay, sondern ein waches
// DO mit fester Spiel-Schleife (30 Hz): es kennt alle Positionen/Spuren,
// prüft Kollisionen und ist die einzige Wahrheit. Clients schicken nur ihre
// Wunsch-Richtung (aim) und bekommen den Weltzustand zurück (interpolieren
// selbst). Reguläre WebSockets (server.accept) halten das DO wach.
//
// Protokoll (JSON):
//   Client→DO: {t:join,name} {t:ready,v} {t:start} {t:again} {t:aim,a} {t:ping}
//   DO→Client: {t:welcome,id,color} {t:lobby,...} {t:setup,...} {t:count,n}
//              {t:go} {t:state,tick,players:[{id,x,y,a,alive}]} {t:dead,id}
//              {t:over,winner} {t:full} {t:pong}
// ====================================================================
const T_TICK = 30, T_DT = 1 / 30, T_ARENA = 1000;
const T_SPEED = 200, T_TURN = 3.0, T_SKIP = 16, T_HITR = 7;
const T_COLORS = ["#28e07a", "#3ad8ff", "#ff5bd0", "#ffd23a"];
const T_SPAWN = [
  { x: 200, y: 200, a: Math.PI / 4 }, { x: 800, y: 800, a: Math.PI / 4 + Math.PI },
  { x: 800, y: 200, a: Math.PI * 3 / 4 }, { x: 200, y: 800, a: -Math.PI / 4 },
];

export class TronRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.conns = new Map();   // ws -> player
    this.state = "lobby";     // lobby | countdown | playing | over
    this.hostId = null; this.tick = 0; this.count = 0; this.nextId = 1; this.loop = null;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    // Voll (4) oder Match läuft schon → nur kurz abweisen.
    if (this.conns.size >= 4 || (this.state !== "lobby" && this.state !== "over")) {
      try { server.send(JSON.stringify({ t: "full" })); server.close(); } catch (_) {}
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = this.nextId++, color = T_COLORS[(id - 1) % 4];
    const p = { id, name: "Spieler", color, ready: false, x: 0, y: 0, a: 0, aim: 0, alive: false, trail: [] };
    this.conns.set(server, p);
    if (this.hostId == null) this.hostId = id;
    server.addEventListener("message", e => { try { this.onMsg(server, e.data); } catch (_) {} });
    server.addEventListener("close", () => this.onClose(server));
    server.addEventListener("error", () => this.onClose(server));
    try { server.send(JSON.stringify({ t: "welcome", id, color })); } catch (_) {}
    this.sendLobby();
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(obj) { const s = JSON.stringify(obj); for (const ws of this.conns.keys()) { try { ws.send(s); } catch (_) {} } }
  playersList() { return [...this.conns.values()].map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, alive: p.alive })); }
  sendLobby() { this.broadcast({ t: "lobby", state: this.state, hostId: this.hostId, players: this.playersList() }); }
  aliveCount() { let n = 0; for (const p of this.conns.values()) if (p.alive) n++; return n; }

  onMsg(ws, data) {
    const p = this.conns.get(ws); if (!p) return;
    let m; try { m = JSON.parse(data); } catch (_) { return; }
    switch (m.t) {
      case "join": p.name = (String(m.name || "").trim().slice(0, 12)) || "Spieler"; this.sendLobby(); break;
      case "ready": p.ready = !!m.v; this.sendLobby(); break;
      case "aim": if (this.state === "playing" && p.alive && typeof m.a === "number" && isFinite(m.a)) p.aim = m.a; break;
      case "start": if (p.id === this.hostId && (this.state === "lobby" || this.state === "over")) this.startCountdown(); break;
      case "again": if (p.id === this.hostId && this.state === "over") { this.state = "lobby"; for (const q of this.conns.values()) { q.ready = false; q.alive = false; } this.sendLobby(); } break;
      case "ping": try { ws.send('{"t":"pong"}'); } catch (_) {} break;
    }
  }

  onClose(ws) {
    const p = this.conns.get(ws); if (!p) return;
    this.conns.delete(ws);
    if (this.hostId === p.id) { const first = this.conns.values().next().value; this.hostId = first ? first.id : null; }
    if (this.conns.size === 0) { this.stopLoop(); this.state = "lobby"; this.tick = 0; this.nextId = 1; return; }
    if (this.state === "playing" && this.aliveCount() <= 1) this.endMatch();
    else this.sendLobby();
  }

  startCountdown() {
    const ps = [...this.conns.values()];
    if (ps.length < 2) return;
    ps.forEach((p, i) => { const s = T_SPAWN[i % 4]; p.x = s.x; p.y = s.y; p.a = s.a; p.aim = s.a; p.alive = true; p.trail = [{ x: s.x, y: s.y }]; });
    this.state = "countdown"; this.count = 3; this.tick = 0;
    this.broadcast({ t: "setup", arena: T_ARENA, players: ps.map(p => ({ id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, a: p.a })) });
    this.broadcast({ t: "count", n: this.count });
    this.startLoop();
  }

  startLoop() { if (!this.loop) this.loop = setInterval(() => { try { this.step(); } catch (_) {} }, 1000 / T_TICK); }
  stopLoop() { if (this.loop) { clearInterval(this.loop); this.loop = null; } }

  step() {
    if (this.state === "countdown") {
      this.tick++;
      if (this.tick % T_TICK === 0) {
        this.count--;
        if (this.count > 0) this.broadcast({ t: "count", n: this.count });
        else { this.state = "playing"; this.tick = 0; this.broadcast({ t: "go" }); }
      }
      return;
    }
    if (this.state !== "playing") { this.stopLoop(); return; }
    this.tick++;

    // Integrieren
    for (const p of this.conns.values()) {
      if (!p.alive) continue;
      let d = p.aim - p.a; while (d > Math.PI) d -= 6.283185; while (d < -Math.PI) d += 6.283185;
      p.a += Math.max(-T_TURN * T_DT, Math.min(T_TURN * T_DT, d));
      p.x += Math.cos(p.a) * T_SPEED * T_DT; p.y += Math.sin(p.a) * T_SPEED * T_DT;
      p.trail.push({ x: p.x, y: p.y });
    }
    // Kollisionen (gleichzeitig auswerten)
    const r2 = T_HITR * T_HITR, dead = [];
    for (const p of this.conns.values()) {
      if (!p.alive) continue;
      let hit = p.x < T_HITR || p.x > T_ARENA - T_HITR || p.y < T_HITR || p.y > T_ARENA - T_HITR;
      if (!hit) {
        for (const q of this.conns.values()) {
          const tr = q.trail, lim = tr.length - (q === p ? T_SKIP : 0);
          for (let i = 0; i < lim; i++) { const dx = p.x - tr[i].x, dy = p.y - tr[i].y; if (dx * dx + dy * dy < r2) { hit = true; break; } }
          if (hit) break;
        }
      }
      if (hit) dead.push(p);
    }
    for (const p of dead) { p.alive = false; this.broadcast({ t: "dead", id: p.id }); }

    // Zustand senden
    this.broadcast({ t: "state", tick: this.tick, players: [...this.conns.values()].map(p => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), a: +p.a.toFixed(3), alive: p.alive })) });

    if (this.aliveCount() <= 1) this.endMatch();
  }

  endMatch() {
    let winner = null;
    for (const p of this.conns.values()) if (p.alive) winner = { id: p.id, name: p.name, color: p.color };
    this.state = "over"; this.stopLoop();
    this.broadcast({ t: "over", winner });
    this.sendLobby();
  }
}

// Der Worker hostet das DO und trägt zusätzlich den Cron-Trigger für den
// Feuerwehr-Bezirksalarm: Pages kann keine Crons: Der Worker pingt darum
// zeitgesteuert die geschützte Pages-Route /api/fire/cron (dort liegen DB
// und VAPID). Der CRON_TOKEN (Secret hier UND in Pages) schützt den Aufruf.
export default {
  async fetch() { return new Response("Spieleabend-Echtzeit (Durable Object host)", { status: 200 }); },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const base = env.PAGES_ORIGIN || "https://philip-stack.pages.dev";
        await fetch(base + "/api/fire/cron?key=" + encodeURIComponent(env.CRON_TOKEN || ""), {
          headers: { "User-Agent": "philip-stack-rt/cron" },
        });
      } catch (_) { /* nächster Lauf versucht es erneut */ }
    })());
  },
};
