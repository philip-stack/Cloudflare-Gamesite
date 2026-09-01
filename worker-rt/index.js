import { DurableObject } from "cloudflare:workers";
import { RoomMixin } from "./base-room.js";
import { rtLogError, rtTouchRoom, rtDropRoom } from "./rt-db.js";
import { D_CATS, D_CAT_KEYS, D_TURN, D_CHOOSE, D_REVEAL, dNorm, dLev, wordPool, pickWords, guessGain, drawerGain, wordLetters, catOf, hintCount } from "./draw-logic.js";
import { Q_TURN, Q_TURN_MAX, Q_REVEAL, Q_ROUNDS, Q_ROUND_CHOICES, Q_DIFF_CHOICES, Q_CAT_KEYS, questionPool, pickQuestions, shuffleOptions, answerGain, streakBonus, turnTime, Q_TB_TURN, Q_TB_REVEAL, Q_TB_MAX } from "./quiz-logic.js";

// D1-Helfer (rtLogError/rtTouchRoom/rtDropRoom) und die geteilten Raum-Primitive
// (bc/toId/pget/partKey/syncPart/touchLive/hostAfterLeave/recordScores) liegen jetzt
// in rt-db.js bzw. base-room.js — die drei Spielräume erben sie über RoomMixin.

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

export class DrawRoom extends RoomMixin(DurableObject) {
  constructor(ctx, env) {
    super(ctx, env);
    this.GAME = "kritzeln"; this.SCORE_TABLE = "draw_score"; this.SCORE_PAGE = "kritzeln";
    this.conns = new Map(); this.state = "lobby"; this.hostId = null; this.nextId = 1;
    this.order = []; this.turnIdx = 0; this.rounds = 2; this.turnTime = D_TURN; this.drawerId = null;
    this.word = ""; this.revealed = []; this.timers = []; this.turnEndsAt = 0;
    this.cats = [];          // ausgewählte Kategorien (leer = alle)
    this.customWords = [];   // eigene Wortliste des Hosts (überschreibt Kategorien)
    this.turnGains = [];     // Punkte-Zuwachs des laufenden Zugs (für die Zusammenfassung)
    this.turnHits = 0;       // Anzahl korrekter Rater:innen im laufenden Zug (Platz-Bonus)
    this.drawOps = [];       // Zeichen-Ops des laufenden Zugs (für Snapshot bei Reconnect)
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    this.code = (new URL(request.url).searchParams.get("code") || this.code || "").toUpperCase();
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

  // bc/toId/pget/partKey/syncPart/touchLive/logErr → aus RoomMixin (base-room.js).
  scoreboard() { return [...this.conns.values()].map(p => ({ id: p.id, name: p.name, score: p.score, guessed: p.guessed, drawer: p.id === this.drawerId })).sort((a, b) => b.score - a.score); }
  sendLobby() { this.touchLive(); this.bc({ t: "lobby", state: this.state, hostId: this.hostId, players: this.scoreboard(), cats: this.cats, rounds: this.rounds, turnTime: this.turnTime, customCount: this.customWords.length }); }
  clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers = []; }

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
        // Stabile Geräte-ID (wie bei der Scores-Bestenliste) für das Namens-Eigentum.
        if (m.dev) p.dev = String(m.dev).slice(0, 64);
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
      case "turnTime": if (p.id === this.hostId && (this.state === "lobby" || this.state === "over")) { const n = m.n | 0; if ([45, 60, 75, 90].includes(n)) { this.turnTime = n; this.sendLobby(); } } break;
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
      // Reaktionen/Emotes: nur eine feste Auswahl zulassen, dann an alle relayen.
      // Sender ausschließen (p.id): der/die zeigt das Emote schon lokal sofort an,
      // sonst käme es doppelt (lokal + Server-Echo).
      case "emote": { const e = String(m.e || ""); if (["👍", "❤️", "😂", "😮", "🎉", "🔥"].includes(e)) this.bc({ t: "emote", e, name: p.name }, p.id); break; }
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
      try { this.ctx.waitUntil(rtDropRoom(this.env, this.code)); } catch (_) {}
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
    this.used = new Set();   // in DIESEM Spiel bereits gespielte Wörter (keine Wiederholung)
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
    this.chooseEndsAt = Date.now() + D_CHOOSE * 1000;
    this.bc({ t: "turn", phase: "choose", drawerId: this.drawerId, round, rounds: this.rounds, turn: this.turnIdx + 1, total, chooseTime: D_CHOOSE });
    this.toId(this.drawerId, { t: "choices", words: this.choices, time: D_CHOOSE });
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
        const ctime = Math.max(1, Math.round(((this.chooseEndsAt || Date.now()) - Date.now()) / 1000));
        ws.send(JSON.stringify({ t: "turn", phase: "choose", drawerId: this.drawerId, round, rounds: this.rounds, chooseTime: ctime }));
        if (p.id === this.drawerId && this.choices) ws.send(JSON.stringify({ t: "choices", words: this.choices, time: ctime }));
      } else if (this.state === "drawing") {
        const time = Math.max(1, Math.round((this.turnEndsAt - Date.now()) / 1000));
        ws.send(JSON.stringify({ t: "turn", phase: "draw", drawerId: this.drawerId, round, rounds: this.rounds, time, pattern: this.pattern(), cat: catOf(this.word) }));
        if (p.id === this.drawerId) ws.send(JSON.stringify({ t: "word", word: this.word }));
        // Bisher Gemaltes nachliefern, damit (Neu-)Beitretende kein leeres Blatt sehen.
        if (this.drawOps && this.drawOps.length) ws.send(JSON.stringify({ t: "snapshot", ops: this.drawOps }));
      }
    } catch (_) {}
  }

  // Delegiert an die reine (getestete) Logik in draw-logic.js. Schließt Wörter
  // aus, die in DIESEM Spiel schon dran waren — erst wenn zu wenige übrig sind,
  // wird der „benutzt"-Speicher zurückgesetzt (Pool erschöpft).
  pickWords(n) {
    const full = wordPool(this.cats, this.customWords);
    let pool = this.used ? full.filter(w => !this.used.has(w)) : full;
    if (pool.length < n) { this.used = new Set(); pool = full; }
    return pickWords(pool, n);
  }
  pattern() { const chars = [...this.word]; return chars.map((c, i) => c === " " ? " " : (this.revealed[i] ? c : "_")).join(""); }

  beginDrawing(word) {
    this.clearTimers();
    if (this.used) this.used.add(word);   // Wort für dieses Spiel als benutzt markieren
    this.word = word; this.revealed = [...word].map(() => false);
    this.turnGains = []; this.turnHits = 0; this.turnDrawerGain = 0; this.drawOps = [];
    const T = this.turnTime;
    this.state = "drawing"; this.turnEndsAt = Date.now() + T * 1000;
    const ids = this.order.filter(id => this.pget(id));
    const round = Math.floor(this.turnIdx / Math.max(1, ids.length)) + 1;
    this.bc({ t: "turn", phase: "draw", drawerId: this.drawerId, round, rounds: this.rounds, time: T, pattern: this.pattern(), wordLen: [...word].length, cat: catOf(word) });
    this.toId(this.drawerId, { t: "word", word });
    // Hinweise: je nach Wortlänge n Buchstaben, gleichmäßig über die Zugzeit verteilt.
    const n = hintCount(wordLetters(word));
    for (let i = 0; i < n; i++) {
      const frac = 0.35 + 0.5 * ((i + 1) / (n + 1));
      this.timers.push(setTimeout(() => this.reveal(), T * frac * 1000));
    }
    this.timers.push(setTimeout(() => this.endTurn(), T * 1000));
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
      const gain = guessGain({ remain, turnTotal: this.turnTime, place, letters: wordLetters(this.word) });
      p.score += gain;
      // Zeichner:in bekommt pro Errater:in Punkte (skaliert leicht mit Tempo).
      const drawer = this.pget(this.drawerId);
      const dGain = drawerGain({ remain, turnTotal: this.turnTime });
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

  // saveScores/recordScores → aus RoomMixin (schreibt in this.SCORE_TABLE = draw_score).
}

// ====================================================================
// QuizRoom — Echtzeit „Quiz-Duell" (Live-Trivia, 2–10 Spieler).
// Event-getrieben (kein Dauer-Loop): alle beantworten dieselbe Multiple-
// Choice-Frage gleichzeitig; Punkte = richtig + Tempo-Bonus. Das DO ist die
// Wahrheit für Fragen, Lösung, Punkte, Runden & Timer.
//
// Client→DO: {t:join,name,uid,dev} {t:start} {t:answer,i} {t:again}
//            {t:cat,cats} {t:rounds,n} {t:kick,id} {t:emote,e} {t:ping}
// DO→Client: {t:welcome,id} {t:lobby,...} {t:question,idx,total,q,options,time}
//            {t:answered,id} {t:reveal,correct,counts,gains,players}
//            {t:over,players} {t:full} {t:pong} {t:kicked} {t:emote} {t:chat}
//
// BEWUSSTE TRADE-OFFS wie beim DrawRoom: State rein im RAM (Redeploy mitten im
// Spiel → frische Lobby; bereits gewertete Spiele stehen in D1). Reine Logik +
// Fragensatz liegen in quiz-logic.js und sind per tests/quiz.test.mjs geprüft.
// ====================================================================
const Q_RATE_N = 60, Q_RATE_MS = 2000;   // max. Nachrichten je Verbindung/Fenster

export class QuizRoom extends RoomMixin(DurableObject) {
  constructor(ctx, env) {
    super(ctx, env);
    this.GAME = "quiz"; this.SCORE_TABLE = "quiz_score"; this.SCORE_PAGE = "quiz";
    this.conns = new Map(); this.state = "lobby"; this.hostId = null; this.nextId = 1;
    this.cats = []; this.rounds = Q_ROUNDS; this.diff = 0; this.votes = new Map();
    this.questions = []; this.turnIdx = 0; this.current = null; this.turnEndsAt = 0; this.turnTotal = Q_TURN;
    this.turnGains = []; this.history = []; this.lastReveal = null;
    this.tbRound = 0; this.tbIds = null; this.tbWinner = null;   // Stichfrage-Status
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    this.code = (new URL(request.url).searchParams.get("code") || this.code || "").toUpperCase();
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    server.accept();
    if (this.conns.size >= 10) { try { server.send(JSON.stringify({ t: "full" })); server.close(); } catch (_) {} return new Response(null, { status: 101, webSocket: client }); }
    const id = this.nextId++;
    const p = { id, name: "Spieler", score: 0, answered: false, ansIdx: -1, ansRemain: 0, streak: 0, ready: false, jokerUsed: false, tbOut: false, lastSeen: Date.now() };
    this.conns.set(server, p);
    if (this.hostId == null) this.hostId = id;
    server.addEventListener("message", e => { try { this.onMsg(server, e.data); } catch (err) { this.logErr("onMsg", err && err.stack || err); } });
    server.addEventListener("close", () => this.onClose(server));
    server.addEventListener("error", () => this.onClose(server));
    try { server.send(JSON.stringify({ t: "welcome", id })); } catch (_) {}
    this.sendLobby();
    return new Response(null, { status: 101, webSocket: client });
  }

  // bc/toId/pget/partKey/syncPart/touchLive/logErr → aus RoomMixin (base-room.js).
  scoreboard() { return [...this.conns.values()].map(p => ({ id: p.id, name: p.name, score: p.score, answered: p.answered, ready: !!p.ready, streak: p.streak | 0 })).sort((a, b) => b.score - a.score); }

  // Kategorie-Abstimmung: jede:r wählt beliebige Kategorien; gezählt wird, wie oft
  // jede Kategorie gewählt wurde. Nur Stimmen aktiver Verbindungen zählen.
  voteTally() {
    const live = new Set([...this.conns.values()].map(p => p.id));
    const t = {};
    for (const [pid, cats] of this.votes) { if (!live.has(pid)) continue; for (const c of cats) t[c] = (t[c] || 0) + 1; }
    return t;
  }
  // Effektive Kategorien = alle mit mindestens einer Stimme (leer = alle Kategorien).
  applyVotes() {
    const t = this.voteTally();
    this.cats = Object.keys(t).filter(c => Q_CAT_KEYS.includes(c));
  }
  myVote(id) { return this.votes.get(id) || []; }
  sendLobby() { this.touchLive(); this.bc({ t: "lobby", state: this.state, hostId: this.hostId, players: this.scoreboard(), cats: this.cats, rounds: this.rounds, diff: this.diff, catVotes: this.voteTally() }); }
  clearTimers() { for (const t of (this.timers || [])) clearTimeout(t); this.timers = []; }

  kick(id) {
    for (const [ws, q] of this.conns) {
      if (q.id !== id) continue;
      try { ws.send(JSON.stringify({ t: "kicked" })); } catch (_) {}
      this.conns.delete(ws); this.votes.delete(q.id); this.applyVotes(); try { ws.close(); } catch (_) {}
      if (this.hostId === q.id) { const f = this.conns.values().next().value; this.hostId = f ? f.id : null; }
      const playing = this.state === "question" || this.state === "reveal";
      this.bc({ t: "chat", kind: "system", text: (q.name || "Jemand") + " wurde entfernt." });
      if (playing && this.conns.size < 2) return this.endGame();
      if (playing && this.state === "question" && this.allAnswered()) return this.revealQuestion();
      this.sendLobby();
      return;
    }
  }

  // „Alle haben geantwortet?" — Verbindungen, die länger nichts mehr gesendet
  // haben (Tab im Hintergrund / halb-tote Verbindung, deren close der Browser
  // noch nicht gemeldet hat), zählen NICHT ewig als blockierend. Die Toleranz ist
  // bewusst ~2 Fragen-Zyklen lang: wer nur kurz weg ist (Link teilen) und
  // zurückkommt, bleibt Teil der Runde; erst danach gilt die Verbindung als tot
  // und die anderen müssen nicht mehr auf sie warten. Client pingt alle ~15 s.
  allAnswered() {
    const now = Date.now(), ghostMs = 2 * (Q_TURN_MAX + Q_REVEAL) * 1000;
    const active = [...this.conns.values()].filter(q => now - (q.lastSeen || 0) < ghostMs);
    return active.length > 0 && active.every(q => q.answered);
  }

  onMsg(ws, data) {
    const p = this.conns.get(ws); if (!p) return;
    const now = Date.now();
    p.lastSeen = now;
    if (!p.rl || now - p.rl.t > Q_RATE_MS) p.rl = { t: now, n: 0 };
    if (++p.rl.n > Q_RATE_N) return;
    if (typeof data !== "string" || data.length > 4000) return;
    let m; try { m = JSON.parse(data); } catch (_) { return; }
    switch (m.t) {
      case "join": {
        p.name = (String(m.name || "").trim().slice(0, 14)) || "Spieler";
        if (m.dev) p.dev = String(m.dev).slice(0, 64);
        if (m.uid) {
          p.uid = String(m.uid).slice(0, 40);
          // Reconnect-Dedup: bestehende Verbindung gleicher Geräte-ID übernehmen.
          for (const [ws2, q] of this.conns) {
            if (ws2 !== ws && q.uid === p.uid) {
              p.id = q.id; p.score = q.score; p.answered = q.answered; p.ansIdx = q.ansIdx; p.ansRemain = q.ansRemain; p.streak = q.streak | 0; p.ready = !!q.ready; p.jokerUsed = !!q.jokerUsed; p.tbOut = !!q.tbOut;
              if (this.hostId === q.id) this.hostId = p.id;
              this.conns.delete(ws2); try { ws2.close(); } catch (_) {}
            }
          }
          try { ws.send(JSON.stringify({ t: "welcome", id: p.id })); } catch (_) {}
        }
        this.sendLobby();
        this.sendCurrentTurn(ws, p);
        break;
      }
      case "start": if (p.id === this.hostId && (this.state === "lobby" || this.state === "over") && this.conns.size >= 2) this.startGame(); break;
      case "again": if (p.id === this.hostId && this.state === "over") { this.state = "lobby"; for (const q of this.conns.values()) { q.score = 0; q.ready = false; } this.sendLobby(); } break;
      // Kategorie-Abstimmung: JEDE:R darf wählen (nicht nur der Host). Effektive
      // Kategorien = alle mit mindestens einer Stimme (Vereinigung).
      case "vote": if (this.state === "lobby" || this.state === "over") { const cats = Array.isArray(m.cats) ? [...new Set(m.cats.filter(c => Q_CAT_KEYS.includes(c)))] : []; this.votes.set(p.id, cats); this.applyVotes(); this.sendLobby(); } break;
      case "rounds": if (p.id === this.hostId && (this.state === "lobby" || this.state === "over")) { const n = m.n | 0; if (Q_ROUND_CHOICES.includes(n)) { this.rounds = n; this.sendLobby(); } } break;
      case "diff": if (p.id === this.hostId && (this.state === "lobby" || this.state === "over")) { const d = m.d | 0; if (Q_DIFF_CHOICES.includes(d)) { this.diff = d; this.sendLobby(); } } break;
      // „Bereit"-Status (nur Warteraum): der Host sieht, wer startklar ist. Der
      // Host selbst braucht kein Bereit — er startet. Kein Auto-Start, nur Anzeige.
      case "ready": if (this.state === "lobby" || this.state === "over") { p.ready = !!m.v; this.sendLobby(); } break;
      case "kick": if (p.id === this.hostId && m.id !== this.hostId) this.kick(m.id); break;
      // Antwort abgeben ODER ändern — erlaubt, solange die Frage läuft und noch
      // nicht alle geantwortet haben (danach löst die Runde sofort auf). Die
      // Tempo-Wertung nutzt den Zeitpunkt der LETZTEN Änderung (fair).
      case "answer": {
        if (typeof m.i !== "number" || m.i < 0 || m.i >= 4) break;
        if (this.state === "question") {
          const first = !p.answered;
          p.answered = true; p.ansIdx = m.i | 0; p.ansRemain = Math.max(0, (this.turnEndsAt - Date.now()) / 1000);
          if (first) this.bc({ t: "answered", id: p.id });   // Fortschritt nur beim ersten Antworten melden
          this.sendLobby();
          if (this.allAnswered()) this.revealQuestion();
        } else if (this.state === "tiebreak") {
          this.tbAnswer(p, m.i | 0);
        }
        break;
      }
      // 50:50-Joker: einmal pro Spiel, blendet zwei falsche Optionen aus (nur für
      // diese:n Spieler:in). Server kennt die Lösung, der Client nicht — daher hier.
      case "fifty": this.useFifty(ws, p); break;
      // Frage melden: landet im error_log (page "quiz-report") zur späteren Sichtung.
      case "report": this.reportQuestion(p, m); break;
      case "emote": { const e = String(m.e || ""); if (["👍", "❤️", "😂", "😮", "🎉", "🔥"].includes(e)) this.bc({ t: "emote", e, name: p.name }, p.id); break; }
      case "ping": try { ws.send('{"t":"pong"}'); } catch (_) {} break;
    }
  }

  onClose(ws) {
    const p = this.conns.get(ws); if (!p) return;
    this.conns.delete(ws); this.votes.delete(p.id);
    if (this.hostId === p.id) { const f = this.conns.values().next().value; this.hostId = f ? f.id : null; }
    if (this.conns.size === 0) {
      if (this.parts && (this.state === "question" || this.state === "reveal" || this.state === "tiebreak")) this.saveScores([...this.parts.values()]);
      try { this.ctx.waitUntil(rtDropRoom(this.env, this.code)); } catch (_) {}
      this.clearTimers(); this.state = "lobby"; this.nextId = 1; this.hostId = null; this.parts = null; this.votes = new Map(); this.tbRound = 0; this.tbIds = null; return;
    }
    // Stichfrage: verbleibende Gleichstand-Menge neu bestimmen; bleibt nur eine:r,
    // gewinnt sie/er; sind alle Verbliebenen bereits raus, nächste Frage.
    if (this.state === "tiebreak") {
      if (this.tbIds) this.tbIds = this.tbIds.filter(id => this.pget(id));
      if (this.conns.size < 2 || !this.tbIds || this.tbIds.length < 2) {
        if (this.tbIds && this.tbIds.length === 1) { this.tbWinner = this.tbIds[0]; return this.tbResolve(); }
        return this.finishGame();
      }
      const stillIn = this.tbIds.filter(id => { const q = this.pget(id); return q && !q.tbOut; });
      if (!stillIn.length) { this.tbNext(); return; }
      this.applyVotes(); this.sendLobby(); return;
    }
    this.applyVotes();
    const playing = this.state === "question" || this.state === "reveal";
    if (playing && this.conns.size < 2) { this.endGame(); return; }
    if (playing && this.state === "question" && this.allAnswered()) { this.revealQuestion(); return; }
    this.sendLobby();
  }

  startGame() {
    this.parts = new Map(); this.history = [];
    this.tbRound = 0; this.tbIds = null; this.tbWinner = null;
    for (const q of this.conns.values()) { q.score = 0; q.answered = false; q.ansIdx = -1; q.streak = 0; q.ready = false; q.jokerUsed = false; q.tbOut = false; this.syncPart(q); }
    // Schwierigkeitsfilter (0 = alle). Wird der Pool dadurch zu klein für die
    // gewünschte Rundenzahl (z. B. enge Kategorie + Stufe), fällt er auf den
    // vollen Kategorie-Pool zurück, damit das Spiel nie an zu wenig Fragen scheitert.
    let pool = questionPool(this.cats, this.diff);
    if (pool.length < this.rounds) pool = questionPool(this.cats);
    // Anti-Wiederholung ÜBER MEHRERE SPIELE hinweg: schon gestellte Fragen (nach
    // Fragetext) merken und meiden. Erst wenn zu wenige ungespielte übrig sind
    // (Pool erschöpft), den Speicher zurücksetzen. So kommen bei 2–4 Runden
    // hintereinander praktisch keine Doppler. Wechselt der Host die Kategorien,
    // greift der Filter automatisch auf den neuen (ggf. kleineren) Pool.
    if (!this.usedQ) this.usedQ = new Set();
    let avail = pool.filter(item => !this.usedQ.has(item.q));
    if (avail.length < this.rounds) { this.usedQ = new Set(); avail = pool; }
    const chosen = pickQuestions(avail, this.rounds);
    for (const item of chosen) this.usedQ.add(item.q);
    // pickQuestions zieht per Index dedupliziert — dieselbe Frage kommt innerhalb
    // eines Spiels nie zweimal. Zur Sicherheit dennoch nach Fragetext eindeutig halten.
    const seen = new Set();
    this.questions = chosen.filter(item => { if (seen.has(item.q)) return false; seen.add(item.q); return true; }).map(item => {
      const s = shuffleOptions(item);
      return { q: item.q, options: s.options, correct: s.correct, cat: item.cat, diff: item.diff };
    });
    this.turnIdx = 0; this.state = "playing";
    this.beginQuestion();
  }

  beginQuestion() {
    this.clearTimers();
    if (this.conns.size < 2) return this.endGame();
    if (this.turnIdx >= this.questions.length) return this.endGame();
    const cur = this.questions[this.turnIdx];
    this.current = cur; this.turnGains = [];
    for (const q of this.conns.values()) { q.answered = false; q.ansIdx = -1; q.ansRemain = 0; }
    this.state = "question"; this.lastReveal = null;
    // Zeit richtet sich nach der Schwierigkeit der Frage (schwer = mehr Zeit).
    this.turnTotal = turnTime(cur.diff);
    this.turnEndsAt = Date.now() + this.turnTotal * 1000;
    this.bc({ t: "question", idx: this.turnIdx + 1, total: this.questions.length, q: cur.q, options: cur.options, time: this.turnTotal, cat: cur.cat, diff: cur.diff });
    this.sendLobby();
    this.timers.push(setTimeout(() => this.revealQuestion(), this.turnTotal * 1000));
  }

  // (Re-)Beitretenden den laufenden Stand schicken. Bei einer laufenden Frage die
  // ECHTE Restzeit (aus turnEndsAt) — nicht neu bei 20 s starten. Läuft gerade die
  // Auflösung, den zuletzt gesendeten reveal-Schnappschuss nachreichen, damit man
  // nicht im leeren Warteraum hängt, bis die nächste Frage kommt.
  sendCurrentTurn(ws, p) {
    try {
      if (this.state === "question" && this.current) {
        const time = Math.max(1, Math.round((this.turnEndsAt - Date.now()) / 1000));
        ws.send(JSON.stringify({ t: "question", idx: this.turnIdx + 1, total: this.questions.length, q: this.current.q, options: this.current.options, time, cat: this.current.cat, diff: this.current.diff, locked: !!p.answered, yourIdx: p.answered ? p.ansIdx : -1 }));
      } else if (this.state === "reveal" && this.current && this.lastReveal) {
        ws.send(JSON.stringify({ t: "question", idx: this.turnIdx + 1, total: this.questions.length, q: this.current.q, options: this.current.options, time: 1, cat: this.current.cat, diff: this.current.diff, locked: !!p.answered, yourIdx: p.answered ? p.ansIdx : -1 }));
        const rleft = Math.max(1, Math.round(((this.revealEndsAt || Date.now()) - Date.now()) / 1000));
        ws.send(JSON.stringify({ ...this.lastReveal, next: rleft }));
      } else if (this.state === "tiebreak" && this.current && this.tbIds) {
        const time = Math.max(1, Math.round((this.turnEndsAt - Date.now()) / 1000));
        ws.send(JSON.stringify({ t: "tiebreak", round: this.tbRound, tied: this.tbIds.map(id => { const q = this.pget(id); return { id, name: q ? q.name : "?" }; }), q: this.current.q, options: this.current.options, time, cat: this.current.cat }));
      }
    } catch (_) {}
  }

  revealQuestion() {
    this.clearTimers();
    if (this.state !== "question" || !this.current) return;
    this.state = "reveal";
    const correct = this.current.correct;
    const counts = [0, 0, 0, 0];
    // Pro Spieler:in ein Ergebnis für die Auflösungs-Anzeige (richtig/falsch,
    // Punkte, verbleibende Zeit beim Antworten → daraus leitet der Client die
    // Reihenfolge „schnellste zuerst" ab).
    const results = [];
    for (const p of this.conns.values()) {
      if (p.answered && p.ansIdx >= 0 && p.ansIdx < 4) counts[p.ansIdx]++;
      const isC = p.answered && p.ansIdx === correct;
      const base = answerGain({ remain: p.ansRemain, total: this.turnTotal, correct: isC });
      // Streak: bei richtig hochzählen und Bonus obendrauf, bei falsch/keiner Antwort zurücksetzen.
      if (isC) p.streak = (p.streak | 0) + 1; else p.streak = 0;
      const bonus = isC ? streakBonus(p.streak) : 0;
      const gain = base + bonus;
      if (gain > 0) p.score += gain;
      results.push({ id: p.id, name: p.name, answered: !!p.answered, correct: isC, gain, base, bonus, streak: p.streak, remain: p.answered ? Math.round(p.ansRemain * 10) / 10 : -1 });
      this.syncPart(p);
    }
    // Verlauf für die Ergebnis-Übersicht am Spielende (kompakt: Frage, richtige
    // Antwort, wer sie hatte).
    this.history.push({ n: this.turnIdx + 1, q: this.current.q, answer: this.current.options[correct], ok: results.filter(r => r.correct).map(r => r.id) });
    // revealEndsAt: damit (Re-)Beitretende die ECHTE Restzeit der Auflösung sehen.
    this.revealEndsAt = Date.now() + Q_REVEAL * 1000;
    this.lastReveal = { t: "reveal", correct, counts, results, players: this.scoreboard(), next: Q_REVEAL };
    this.bc(this.lastReveal);
    this.sendLobby();
    this.timers.push(setTimeout(() => { this.turnIdx++; this.beginQuestion(); }, Q_REVEAL * 1000));
  }

  endGame() {
    this.clearTimers();
    // Gleichstand an der Spitze? → Stichfrage (Sudden Death), sofern genug Spieler
    // da sind und das Sicherheitslimit noch nicht erreicht ist.
    const board = this.scoreboard();
    const top = board.length ? board[0].score : 0;
    const tied = top > 0 ? board.filter(b => b.score === top).map(b => b.id) : [];
    if (tied.length >= 2 && this.conns.size >= 2 && (this.tbRound | 0) < Q_TB_MAX && this.questions.length) return this.beginTiebreak(tied);
    this.finishGame();
  }

  finishGame() {
    this.clearTimers(); this.state = "over"; this.current = null; this.lastReveal = null; this.tbIds = null; this.tbWinner = null;
    this.bc({ t: "over", players: this.scoreboard(), history: this.history || [] }); this.sendLobby();
    this.saveScores(this.parts ? [...this.parts.values()] : []);
    this.parts = null;
  }

  // ---- Stichfrage (Sudden Death) bei Gleichstand ----
  beginTiebreak(tiedIds) {
    this.clearTimers();
    this.tbRound = (this.tbRound | 0) + 1;
    this.tbIds = tiedIds.filter(id => this.pget(id));
    if (this.tbIds.length < 2) return this.finishGame();
    let pool = questionPool(this.cats, this.diff);
    if (!pool.length) pool = questionPool(this.cats);
    if (!this.usedQ) this.usedQ = new Set();
    let avail = pool.filter(item => !this.usedQ.has(item.q));
    if (!avail.length) avail = pool;
    const item = pickQuestions(avail, 1)[0];
    if (!item) return this.finishGame();
    this.usedQ.add(item.q);
    const s = shuffleOptions(item);
    this.current = { q: item.q, options: s.options, correct: s.correct, cat: item.cat, diff: item.diff };
    this.state = "tiebreak"; this.tbWinner = null;
    for (const q of this.conns.values()) { q.answered = false; q.ansIdx = -1; q.tbOut = false; }
    this.turnTotal = Q_TB_TURN; this.turnEndsAt = Date.now() + Q_TB_TURN * 1000;
    this.bc({ t: "tiebreak", round: this.tbRound, tied: this.tbIds.map(id => { const q = this.pget(id); return { id, name: q ? q.name : "?" }; }), q: this.current.q, options: this.current.options, time: Q_TB_TURN, cat: this.current.cat });
    this.sendLobby();
    this.timers.push(setTimeout(() => this.tbNext(), Q_TB_TURN * 1000));
  }

  tbAnswer(p, i) {
    if (!this.tbIds || !this.tbIds.includes(p.id) || p.tbOut || p.answered || !this.current) return;
    p.answered = true; p.ansIdx = i;
    if (i === this.current.correct) { this.tbWinner = p.id; return this.tbResolve(); }
    p.tbOut = true; this.bc({ t: "tbout", id: p.id });
    const stillIn = this.tbIds.filter(id => { const q = this.pget(id); return q && !q.tbOut; });
    if (!stillIn.length) this.tbNext();
  }

  // Niemand richtig (Zeit aus oder alle daneben) → Lösung zeigen, dann neue Stichfrage.
  tbNext() {
    this.clearTimers();
    if (this.state !== "tiebreak") return;
    this.bc({ t: "tbreveal", correct: this.current ? this.current.correct : -1 });
    this.timers.push(setTimeout(() => {
      if (this.conns.size < 2) return this.finishGame();
      const board = this.scoreboard();
      const top = board.length ? board[0].score : 0;
      const tied = top > 0 ? board.filter(b => b.score === top).map(b => b.id) : [];
      if (tied.length >= 2 && (this.tbRound | 0) < Q_TB_MAX) this.beginTiebreak(tied);
      else this.finishGame();
    }, Q_TB_REVEAL * 1000));
  }

  tbResolve() {
    this.clearTimers();
    const w = this.pget(this.tbWinner);
    if (w) { w.score += 1; this.syncPart(w); }   // knapper Vorsprung → eindeutiger Sieg
    this.bc({ t: "tbresult", winnerId: this.tbWinner, winnerName: w ? w.name : "", correct: this.current ? this.current.correct : -1, players: this.scoreboard() });
    this.timers.push(setTimeout(() => this.finishGame(), (Q_TB_REVEAL + 1) * 1000));
  }

  // ---- 50:50-Joker ----
  useFifty(ws, p) {
    if (this.state !== "question" || !this.current || p.jokerUsed || p.answered) return;
    const correct = this.current.correct;
    const wrong = [0, 1, 2, 3].filter(i => i !== correct);
    const keep = wrong[Math.floor(Math.random() * wrong.length)];   // eine falsche bleibt
    const hide = wrong.filter(i => i !== keep);
    p.jokerUsed = true;
    try { ws.send(JSON.stringify({ t: "fifty", hide })); } catch (_) {}
  }

  // ---- Frage melden ----
  reportQuestion(p, m) {
    if (!this.current || !(this.state === "question" || this.state === "reveal" || this.state === "tiebreak")) return;
    if (!p.reported) p.reported = new Set();
    const key = this.current.q;
    if (p.reported.has(key)) return;   // pro Frage nur einmal je Spieler:in
    p.reported.add(key);
    const correctText = this.current.options ? this.current.options[this.current.correct] : "";
    const extra = "richtig: " + correctText + " | von: " + (p.name || "?") + " | grund: " + String(m && m.reason || "").slice(0, 80);
    try { this.ctx.waitUntil(rtLogError(this.env, "FRAGE GEMELDET: " + key, "quiz-report", extra)); } catch (_) {}
    try { this.toId(p.id, { t: "reported" }); } catch (_) {}
  }

  // saveScores/recordScores → aus RoomMixin (schreibt in this.SCORE_TABLE = quiz_score).
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
        const headers = { "User-Agent": "philip-stack-rt/cron", "x-cron-key": env.CRON_TOKEN || "" };
        // Token im Header statt in der URL-Query (kein Leak in Zugriffs-Logs).
        // Feuerwehr-Alarm (jeder Lauf) und Sprit-Preis-Alarm (drosselt selbst auf
        // ~12 min) — unabhängig, ein Fehler darf den anderen nicht verhindern.
        await Promise.allSettled([
          fetch(base + "/api/fire/cron", { headers }),
          fetch(base + "/api/sprit/cron", { headers }),
        ]);
      } catch (_) { /* nächster Lauf versucht es erneut */ }
    })());
  },
};
