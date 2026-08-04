import { DurableObject } from "cloudflare:workers";
import { D_CATS, D_CAT_KEYS, D_TURN, D_CHOOSE, D_REVEAL, dNorm, dLev, wordPool, pickWords, guessGain, drawerGain, wordLetters } from "./draw-logic.js";

// Fehler aus dem Echtzeit-Worker in dieselbe D1-Tabelle error_log schreiben,
// die auch die Pages-Seite nutzt — damit DO-/DrawRoom-Störungen im Betreiber-
// Dashboard sichtbar werden statt nur in `wrangler tail`. Best-effort.
async function rtLogError(env, msg, page, extra) {
  try {
    if (!env || !env.DB) return;
    await env.DB.prepare("INSERT INTO error_log (msg, page, extra) VALUES (?, ?, ?)")
      .bind(String(msg == null ? "" : msg).slice(0, 500), page || "worker-rt",
            extra == null ? null : String(extra).slice(0, 1000)).run();
  } catch (_) { /* Logging darf nie zum Problem werden */ }
}

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

// ====================================================================
// DrawRoom — Echtzeit „Kritzeln & Raten" (skribbl-artig, 2–10 Spieler).
// Event-getrieben (kein Dauer-Loop): eine:r malt, die anderen raten im
// Chat. Das DO ist Wahrheit für Wort, Punkte, Runden & Timer; Zeichen-
// Striche werden nur an die Ratenden weitergereicht. Reguläre WebSockets.
//
// Client→DO: {t:join,name} {t:start} {t:choose,word} {t:stroke,...}
//            {t:clear} {t:guess,text} {t:again} {t:ping}
// DO→Client: {t:welcome,id} {t:lobby,...} {t:choices,words} {t:turn,...}
//            {t:word,word} {t:draw,...} {t:clear} {t:chat,...} {t:guessed,id}
//            {t:close} {t:hint,pattern} {t:turnEnd,word,players} {t:over,players}
//            {t:full} {t:pong} {t:snapshot,ops} {t:kicked}
//
// BEWUSSTE TRADE-OFFS (Partyspiel, kein Bankensystem):
//  • State liegt rein im RAM. Bei Redeploy/Eviction MITTEN im Spiel ist die
//    laufende Runde weg — Clients verbinden neu in eine frische Lobby. Bereits
//    gewertete Spiele stehen sicher in D1; nur die *laufende* Runde geht verloren.
//    Bewusst nicht in ctx.storage persistiert (Aufwand ≫ Nutzen für ein Kritzelspiel).
//  • Die Strich-Merge-Logik (s-Flag → neuer Strich / anhängen) existiert doppelt:
//    hier in opStroke() und im Client (public/kritzeln/app.js). Beide MÜSSEN
//    identisch bleiben, sonst weicht der Reconnect-Snapshot vom Live-Bild ab.
//  • Pure Spiel-Logik (Wörter, Levenshtein, Punkte) liegt in draw-logic.js und
//    ist per tests/kritzeln.test.mjs abgesichert.
// ====================================================================
// Zeichen-/Missbrauchs-Limits (Härtung gegen fehlerhafte oder böswillige Clients).
const D_MAX_PTS = 300;        // Punkte pro stroke-Nachricht
const D_MAX_OPS = 1500;       // gepufferte Ops pro Zug (begrenzt Snapshot-Größe)
const D_RATE_N = 120, D_RATE_MS = 2000;   // max. Nachrichten je Verbindung pro Fenster

export class DrawRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.conns = new Map(); this.state = "lobby"; this.hostId = null; this.nextId = 1;
    this.order = []; this.turnIdx = 0; this.rounds = 2; this.drawerId = null;
    this.word = ""; this.revealed = []; this.timers = []; this.turnEndsAt = 0;
    this.cats = [];          // ausgewählte Kategorien (leer = alle)
    this.customWords = [];   // eigene Wortliste des Hosts (überschreibt Kategorien)
    this.turnGains = [];     // Punkte-Zuwachs des laufenden Zugs (für die Zusammenfassung)
    this.turnHits = 0;       // Anzahl korrekter Rater:innen im laufenden Zug (Platz-Bonus)
    this.drawOps = [];       // Zeichen-Ops des laufenden Zugs (für Snapshot bei Reconnect)
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    server.accept();
    if (this.conns.size >= 10) { try { server.send(JSON.stringify({ t: "full" })); server.close(); } catch (_) {} return new Response(null, { status: 101, webSocket: client }); }
    const id = this.nextId++;
    const p = { id, name: "Spieler", score: 0, guessed: false, drawer: false };
    this.conns.set(server, p);
    if (this.hostId == null) this.hostId = id;
    server.addEventListener("message", e => { try { this.onMsg(server, e.data); } catch (err) { this.logErr("onMsg", err && err.stack || err); } });
    server.addEventListener("close", () => this.onClose(server));
    server.addEventListener("error", () => this.onClose(server));
    try { server.send(JSON.stringify({ t: "welcome", id })); } catch (_) {}
    this.sendLobby();
    return new Response(null, { status: 101, webSocket: client });
  }

  bc(obj, exceptId) { const s = JSON.stringify(obj); for (const [ws, p] of this.conns) { if (exceptId && p.id === exceptId) continue; try { ws.send(s); } catch (_) {} } }
  toId(id, obj) { for (const [ws, p] of this.conns) if (p.id === id) { try { ws.send(JSON.stringify(obj)); } catch (_) {} return; } }
  pget(id) { for (const p of this.conns.values()) if (p.id === id) return p; return null; }
  // Teilnehmer:innen eines Spiels (überlebt Disconnects) für die Wertung.
  partKey(p) { return p.uid || ("id" + p.id); }
  syncPart(p) { if (!this.parts) this.parts = new Map(); this.parts.set(this.partKey(p), { name: p.name, score: p.score | 0 }); }
  scoreboard() { return [...this.conns.values()].map(p => ({ id: p.id, name: p.name, score: p.score, guessed: p.guessed, drawer: p.id === this.drawerId })).sort((a, b) => b.score - a.score); }
  sendLobby() { this.bc({ t: "lobby", state: this.state, hostId: this.hostId, players: this.scoreboard(), cats: this.cats, rounds: this.rounds, customCount: this.customWords.length }); }
  clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers = []; }
  // Fehler sichtbar machen (Konsole + persistent in error_log via waitUntil).
  logErr(msg, extra) { console.error("DrawRoom", msg, extra || ""); try { this.ctx.waitUntil(rtLogError(this.env, msg, "kritzeln", extra)); } catch (_) {} }

  // Strich-Op in den Zug-Puffer rollen (identisch zur Client-Logik, damit der
  // Snapshot beim Reconnect exakt dieselbe Zeichnung ergibt).
  opStroke(m) {
    if (this.drawOps.length >= D_MAX_OPS) return;   // Puffer gedeckelt (bounded Snapshot)
    const last = this.drawOps[this.drawOps.length - 1];
    if (m.s || !last || last.k !== "s") this.drawOps.push({ k: "s", pts: (m.pts || []).slice(), c: m.c, w: m.w, e: !!m.e });
    else last.pts.push(...(m.pts || []).slice(1));
  }

  // Host wirft eine:n Spieler:in raus (Nachbereitung wie onClose).
  kick(id) {
    for (const [ws, q] of this.conns) {
      if (q.id !== id) continue;
      try { ws.send(JSON.stringify({ t: "kicked" })); } catch (_) {}
      this.conns.delete(ws); try { ws.close(); } catch (_) {}
      if (this.hostId === q.id) { const f = this.conns.values().next().value; this.hostId = f ? f.id : null; }
      const playing = this.state === "choosing" || this.state === "drawing" || this.state === "reveal";
      this.bc({ t: "chat", kind: "system", text: (q.name || "Jemand") + " wurde entfernt." });
      if (playing && this.conns.size < 2) return this.endGame();
      if (playing && q.id === this.drawerId) return this.endTurn();
      this.sendLobby();
      return;
    }
  }

  onMsg(ws, data) {
    const p = this.conns.get(ws); if (!p) return;
    // Rate-Limit pro Verbindung: überzählige Nachrichten im Fenster verwerfen.
    const now = Date.now();
    if (!p.rl || now - p.rl.t > D_RATE_MS) p.rl = { t: now, n: 0 };
    if (++p.rl.n > D_RATE_N) return;
    if (typeof data !== "string" || data.length > 20000) return;   // übergroße Frames abweisen
    let m; try { m = JSON.parse(data); } catch (_) { return; }
    switch (m.t) {
      case "join": {
        p.name = (String(m.name || "").trim().slice(0, 14)) || "Spieler";
        if (m.uid) {
          p.uid = String(m.uid).slice(0, 40);
          // Reconnect-Dedup: bestehende Verbindung mit gleicher Geräte-ID
          // übernehmen (Identität/Punkte behalten), alte Verbindung schließen.
          for (const [ws2, q] of this.conns) {
            if (ws2 !== ws && q.uid === p.uid) {
              p.id = q.id; p.score = q.score; p.guessed = q.guessed;
              if (this.hostId === q.id) this.hostId = p.id;
              this.conns.delete(ws2); try { ws2.close(); } catch (_) {}
            }
          }
          try { ws.send(JSON.stringify({ t: "welcome", id: p.id })); } catch (_) {}
        }
        this.sendLobby();
        this.sendCurrentTurn(ws, p);   // falls ein Zug läuft: direkt mitnehmen
        break;
      }
      case "start": if (p.id === this.hostId && (this.state === "lobby" || this.state === "over") && this.conns.size >= 2) this.startGame(); break;
      case "again": if (p.id === this.hostId && this.state === "over") { this.state = "lobby"; for (const q of this.conns.values()) q.score = 0; this.sendLobby(); } break;
      // Host stellt Kategorien / Rundenzahl im Warteraum ein.
      case "cat": if (p.id === this.hostId && (this.state === "lobby" || this.state === "over")) { this.cats = Array.isArray(m.cats) ? m.cats.filter(c => D_CAT_KEYS.includes(c)) : []; this.sendLobby(); } break;
      case "rounds": if (p.id === this.hostId && (this.state === "lobby" || this.state === "over")) { const n = m.n | 0; if (n >= 1 && n <= 5) { this.rounds = n; this.sendLobby(); } } break;
      // Host: eigene Wortliste (überschreibt Kategorien). Getrimmt, dedupliziert, begrenzt.
      case "words": if (p.id === this.hostId && (this.state === "lobby" || this.state === "over")) {
        const seen = new Set(), out = [];
        for (const w of (Array.isArray(m.list) ? m.list : [])) { const t = String(w || "").trim().slice(0, 24); const k = t.toLowerCase(); if (t.length >= 2 && !seen.has(k)) { seen.add(k); out.push(t); if (out.length >= 120) break; } }
        this.customWords = out; this.sendLobby();
      } break;
      // Host: Spieler:in rauswerfen.
      case "kick": if (p.id === this.hostId && m.id !== this.hostId) this.kick(m.id); break;
      // Host: laufenden Zug überspringen (Wort aufdecken, weiter).
      case "skip": if (p.id === this.hostId && (this.state === "choosing" || this.state === "drawing")) { if (this.state === "choosing") { this.beginDrawing(this.choices ? this.choices[0] : "?"); } this.endTurn(); } break;
      case "choose": if (this.state === "choosing" && p.id === this.drawerId && this.choices && this.choices.includes(m.word)) this.beginDrawing(m.word); break;
      case "stroke": if (this.state === "drawing" && p.id === this.drawerId && Array.isArray(m.pts) && m.pts.length) {
        if (m.pts.length > D_MAX_PTS) m.pts = m.pts.slice(0, D_MAX_PTS);   // übergroße Striche kappen
        this.bc({ t: "draw", pts: m.pts, c: m.c, w: m.w, s: m.s, e: m.e }, p.id); this.opStroke(m);
      } break;
      case "fill": if (this.state === "drawing" && p.id === this.drawerId) { this.bc({ t: "fill", x: m.x, y: m.y, c: m.c }, p.id); if (this.drawOps.length < D_MAX_OPS) this.drawOps.push({ k: "f", x: m.x, y: m.y, c: m.c }); } break;
      case "undo": if (this.state === "drawing" && p.id === this.drawerId) { this.bc({ t: "undo" }, p.id); this.drawOps.pop(); } break;
      case "clear": if (this.state === "drawing" && p.id === this.drawerId) { this.bc({ t: "clear" }, p.id); this.drawOps = []; } break;
      case "guess": this.onGuess(p, String(m.text || "")); break;
      case "ping": try { ws.send('{"t":"pong"}'); } catch (_) {} break;
    }
  }

  onClose(ws) {
    const p = this.conns.get(ws); if (!p) return;
    this.conns.delete(ws);
    if (this.hostId === p.id) { const f = this.conns.values().next().value; this.hostId = f ? f.id : null; }
    if (this.conns.size === 0) {
      // Alle weg (Tabs geschlossen o. Ä.) mitten im Spiel → trotzdem werten.
      if (this.parts && (this.state === "choosing" || this.state === "drawing" || this.state === "reveal")) this.saveScores([...this.parts.values()]);
      this.clearTimers(); this.state = "lobby"; this.nextId = 1; this.hostId = null; this.parts = null; return;
    }
    const playing = this.state === "choosing" || this.state === "drawing" || this.state === "reveal";
    // Zu wenige übrig → JETZT werten (die verbleibende Verbindung hält das DO
    // wach, der D1-Schreibvorgang läuft zuverlässig durch).
    if (playing && this.conns.size < 2) { this.endGame(); return; }
    if (playing && p.id === this.drawerId) { this.bc({ t: "chat", kind: "system", text: "Der/die Zeichner:in hat den Raum verlassen." }); this.endTurn(); return; }
    this.sendLobby();
  }

  startGame() {
    this.parts = new Map();
    for (const q of this.conns.values()) { q.score = 0; q.guessed = false; this.syncPart(q); }
    this.order = [...this.conns.values()].map(p => p.id);
    this.turnIdx = 0; this.state = "playing";
    this.beginTurn();
  }

  beginTurn() {
    this.clearTimers();
    const ids = this.order.filter(id => this.pget(id));   // nur noch verbundene
    if (ids.length < 2) { return this.endGame(); }
    const total = ids.length * this.rounds;
    if (this.turnIdx >= total) return this.endGame();
    this.drawerId = ids[this.turnIdx % ids.length];
    const round = Math.floor(this.turnIdx / ids.length) + 1;
    for (const q of this.conns.values()) q.guessed = false;
    this.word = ""; this.revealed = [];
    this.choices = this.pickWords(3);
    this.state = "choosing";
    this.bc({ t: "turn", phase: "choose", drawerId: this.drawerId, round, rounds: this.rounds, turn: this.turnIdx + 1, total });
    this.toId(this.drawerId, { t: "choices", words: this.choices });
    this.bc({ t: "clear" });
    this.sendLobby();
    this.timers.push(setTimeout(() => { if (this.state === "choosing") this.beginDrawing(this.choices[0]); }, D_CHOOSE * 1000));
  }

  // (Re-)Beitretenden den laufenden Zug schicken, damit sie sofort mitmachen können.
  sendCurrentTurn(ws, p) {
    const ids = this.order.filter(id => this.pget(id));
    const round = Math.floor(this.turnIdx / Math.max(1, ids.length)) + 1;
    try {
      if (this.state === "choosing") {
        ws.send(JSON.stringify({ t: "turn", phase: "choose", drawerId: this.drawerId, round, rounds: this.rounds }));
        if (p.id === this.drawerId && this.choices) ws.send(JSON.stringify({ t: "choices", words: this.choices }));
      } else if (this.state === "drawing") {
        const time = Math.max(1, Math.round((this.turnEndsAt - Date.now()) / 1000));
        ws.send(JSON.stringify({ t: "turn", phase: "draw", drawerId: this.drawerId, round, rounds: this.rounds, time, pattern: this.pattern() }));
        if (p.id === this.drawerId) ws.send(JSON.stringify({ t: "word", word: this.word }));
        // Bisher Gemaltes nachliefern, damit (Neu-)Beitretende kein leeres Blatt sehen.
        if (this.drawOps && this.drawOps.length) ws.send(JSON.stringify({ t: "snapshot", ops: this.drawOps }));
      }
    } catch (_) {}
  }

  // Delegiert an die reine (getestete) Logik in draw-logic.js.
  pickWords(n) { return pickWords(wordPool(this.cats, this.customWords), n); }
  pattern() { const chars = [...this.word]; return chars.map((c, i) => c === " " ? " " : (this.revealed[i] ? c : "_")).join(""); }

  beginDrawing(word) {
    this.clearTimers();
    this.word = word; this.revealed = [...word].map(() => false);
    this.turnGains = []; this.turnHits = 0; this.turnDrawerGain = 0; this.drawOps = [];
    this.state = "drawing"; this.turnEndsAt = Date.now() + D_TURN * 1000;
    const ids = this.order.filter(id => this.pget(id));
    const round = Math.floor(this.turnIdx / Math.max(1, ids.length)) + 1;
    this.bc({ t: "turn", phase: "draw", drawerId: this.drawerId, round, rounds: this.rounds, time: D_TURN, pattern: this.pattern(), wordLen: [...word].length });
    this.toId(this.drawerId, { t: "word", word });
    // Hinweise: bei ~45% und ~70% je einen Buchstaben aufdecken
    this.timers.push(setTimeout(() => this.reveal(), D_TURN * 0.45 * 1000));
    this.timers.push(setTimeout(() => this.reveal(), D_TURN * 0.7 * 1000));
    this.timers.push(setTimeout(() => this.endTurn(), D_TURN * 1000));
  }

  reveal() {
    if (this.state !== "drawing") return;
    const idx = [...this.word].map((c, i) => i).filter(i => this.word[i] !== " " && !this.revealed[i]);
    if (idx.length <= 1) return;                 // mindestens 1 Buchstabe verdeckt lassen
    this.revealed[idx[Math.floor(Math.random() * idx.length)]] = true;
    this.bc({ t: "hint", pattern: this.pattern() });
  }

  onGuess(p, text) {
    if (!text.trim()) return;
    // Zeichner:in oder wer schon erraten hat → nur normaler Chat
    if (this.state !== "drawing" || p.id === this.drawerId || p.guessed) { this.bc({ t: "chat", kind: "msg", name: p.name, text: text.slice(0, 80) }); return; }
    if (dNorm(text) === dNorm(this.word)) {
      p.guessed = true;
      // Punkte: Zeit-Bonus (früher = mehr) + Platz-Bonus (1./2./3.) + Längen-Bonus.
      const remain = Math.max(0, this.turnEndsAt - Date.now()) / 1000;
      const place = this.turnHits++;                 // 0 = erste:r
      const gain = guessGain({ remain, turnTotal: D_TURN, place, letters: wordLetters(this.word) });
      p.score += gain;
      // Zeichner:in bekommt pro Errater:in Punkte (skaliert leicht mit Tempo).
      const drawer = this.pget(this.drawerId);
      const dGain = drawerGain({ remain, turnTotal: D_TURN });
      if (drawer) { drawer.score += dGain; this.turnDrawerGain += dGain; }
      this.syncPart(p); if (drawer) this.syncPart(drawer);
      this.turnGains.push({ id: p.id, name: p.name, gain, place: place + 1 });
      this.bc({ t: "guessed", id: p.id, name: p.name, place: place + 1, gain });
      this.sendLobby();
      const guessers = [...this.conns.values()].filter(q => q.id !== this.drawerId);
      if (guessers.length && guessers.every(q => q.guessed)) this.endTurn();
      return;
    }
    // Falsch: als Chat zeigen; nah dran → privater Hinweis
    this.bc({ t: "chat", kind: "guess", name: p.name, text: text.slice(0, 80) });
    if (dLev(text, this.word) <= 1) this.toId(p.id, { t: "close" });
  }

  endTurn() {
    this.clearTimers();
    if (this.state === "over" || this.state === "lobby") return;
    this.state = "reveal";
    const drawer = this.pget(this.drawerId);
    this.bc({ t: "turnEnd", word: this.word, players: this.scoreboard(), gains: this.turnGains, drawerId: this.drawerId, drawerName: drawer ? drawer.name : null, drawerGain: this.turnDrawerGain || 0 });
    this.timers.push(setTimeout(() => { this.turnIdx++; this.beginTurn(); }, D_REVEAL * 1000));
  }

  endGame() {
    this.clearTimers(); this.state = "over"; this.drawerId = null;
    const board = this.scoreboard();
    this.bc({ t: "over", players: board }); this.sendLobby();
    this.saveScores(this.parts ? [...this.parts.values()] : []);
    this.parts = null;
  }

  // Wertung robust schreiben — via waitUntil, damit der D1-Schreibvorgang auch
  // dann durchläuft, wenn das Spiel abrupt endet (alle weg). parts = [{name,score}].
  saveScores(parts) {
    const run = this.recordScores(parts).catch(err => rtLogError(this.env, "recordScores", "kritzeln", err && err.stack || err));
    try { this.ctx.waitUntil(run); } catch (_) {}
  }

  // Am Spielende jede:n Teilnehmer:in in die dauerhafte D1-Bestenliste rollen.
  // Autoritativ (im DO), damit Clients keine Fake-Werte einschleusen können.
  async recordScores(parts) {
    if (!this.env || !this.env.DB || !parts || parts.length < 2) return;
    let winName = null, top = 0;
    for (const p of parts) { const s = p.score | 0; if (s > top) { top = s; winName = p.name; } }
    if (top <= 0) return;   // niemand hat geraten → nicht werten
    for (const p of parts) {
      if (!p.name) continue;
      const pts = p.score | 0, win = p.name === winName ? 1 : 0;
      try {
        await this.env.DB.prepare(
          "INSERT INTO draw_score (name, points, games, wins, best) VALUES (?, ?, 1, ?, ?) " +
          "ON CONFLICT(name) DO UPDATE SET points = points + excluded.points, games = games + 1, " +
          "wins = wins + excluded.wins, best = MAX(best, excluded.best), updated_at = datetime('now')"
        ).bind(p.name, pts, win, pts).run();
      } catch (err) { await rtLogError(this.env, "recordScores row " + p.name, "kritzeln", err && err.stack || err); /* Bestenliste nie den Spielfluss stören */ }
    }
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
        // Token im Header statt in der URL-Query (kein Leak in Zugriffs-Logs).
        await fetch(base + "/api/fire/cron", {
          headers: { "User-Agent": "philip-stack-rt/cron", "x-cron-key": env.CRON_TOKEN || "" },
        });
      } catch (_) { /* nächster Lauf versucht es erneut */ }
    })());
  },
};
