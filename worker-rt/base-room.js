// ====================================================================
// Gemeinsame Raum-Basis für die Echtzeit-Spiele (DrawRoom / QuizRoom).
// Früher war jede dieser Primitive in jeder Raum-Klasse Wort für
// Wort dupliziert (bc/toId/pget/partKey/syncPart/touchLive/recordScores).
//
// Als Mixin `RoomMixin(Base)` statt fester Basisklasse, damit die Räume weiter
// `extends RoomMixin(DurableObject)` schreiben können UND die Logik hier ohne
// `cloudflare:workers`-Import in Node testbar ist (tests/room.test.mjs).
//
// Erwartete Instanz-Felder je Raum:
//   this.conns  Map<ws, player>      — verbundene Spieler:innen
//   this.state  string               — Spielphase (für den Heartbeat)
//   this.code   string               — Raum-Code (aus der URL)
//   this.GAME   string               — "kritzeln" | "quiz"
//   this.hostId number|null
//   this.parts  Map                  — Teilnehmer:innen fürs Werten (optional)
//   this.SCORE_TABLE / this.SCORE_PAGE — für recordScores (nur wertende Räume)
//   this.env / this.ctx              — von DurableObject
//   this.onEmpty()                   — Reset „alle weg" (für die Leerlauf-Abschaltung)
// ====================================================================
import { rtLogError, rtTouchRoom, rtDropRoom } from "./rt-db.js";

// Nur diese Tabellen dürfen aus recordScores beschrieben werden (der Tabellenname
// wird interpoliert, nicht gebunden — Whitelist gegen versehentliche Fremdwerte).
const SCORE_TABLES = new Set(["draw_score", "quiz_score"]);

// Leerlauf-Abschaltung: DrawRoom/QuizRoom nutzen reguläre WebSockets (kein
// Hibernation — der ganze Spiel-State liegt im RAM), und Clients pingen alle
// 15–20 s. Ein vergessener Tab hielte das DO sonst rund um die Uhr wach und
// verbrennt das Gratis-Kontingent an DO-Laufzeit. Deshalb: kam so lange KEINE
// echte Nachricht (Pings zählen nicht), werden alle Verbindungen geschlossen.
export const IDLE_LOBBY_MS = 15 * 60e3;   // Warteraum / Spielende
export const IDLE_PLAY_MS = 30 * 60e3;    // laufendes Spiel (Timer laufen allein weiter)
export const IDLE_CHECK_MS = 60e3;        // Prüf-Intervall (±1 min Genauigkeit reicht)
// Die Clients verbinden nach einem close sofort neu (kritzeln 6×, quiz 8×, mit
// Backoff ≈ 12–20 s). Damit das nicht gleich wieder 15 min Wachzeit kauft, werden
// Upgrades kurz nach der Abschaltung abgewiesen → Client landet im Menü.
export const IDLE_REFUSE_MS = 40e3;
export const IDLE_CLOSE_CODE = 4000;      // eigener Close-Code (Client kann ihn erkennen)

export const RoomMixin = (Base) => class extends Base {
  // An alle senden (optional eine:n ausnehmen).
  bc(obj, exceptId) {
    const s = JSON.stringify(obj);
    for (const [ws, p] of this.conns) { if (exceptId && p.id === exceptId) continue; try { ws.send(s); } catch (_) {} }
  }
  // Gezielt an eine:n senden.
  toId(id, obj) { for (const [ws, p] of this.conns) if (p.id === id) { try { ws.send(JSON.stringify(obj)); } catch (_) {} return; } }
  // Spieler:in per id finden.
  pget(id) { for (const p of this.conns.values()) if (p.id === id) return p; return null; }
  // Teilnehmer:innen-Schlüssel fürs Werten (überlebt Reconnects via uid).
  partKey(p) { return p.uid || ("id" + p.id); }
  syncPart(p) { if (!this.parts) this.parts = new Map(); this.parts.set(this.partKey(p), { name: p.name, score: p.score | 0, device: p.dev || null }); }

  // Host neu bestimmen, wenn der/die bisherige gegangen ist.
  hostAfterLeave(leftId) { if (this.hostId === leftId) { const f = this.conns.values().next().value; this.hostId = f ? f.id : null; } }

  // Heartbeat fürs Admin-Dashboard, gedrosselt (≤ alle 8 s; Zustandswechsel sofort).
  touchLive() {
    const now = Date.now();
    if (this._lt && now - this._lt < 8000 && this._ls === this.state) return;
    this._lt = now; this._ls = this.state;
    try { this.ctx.waitUntil(rtTouchRoom(this.env, this.code, this.GAME, this.conns.size, this.state)); } catch (_) {}
  }
  // Raum-Zeile löschen (beim Leeren).
  dropLive() { try { this.ctx.waitUntil(rtDropRoom(this.env, this.code)); } catch (_) {} }

  // ---- Leerlauf-Abschaltung (siehe IDLE_* oben) ----
  // Echte Aktivität merken (neue Verbindung, jede Nachricht außer ping).
  markActive(now = Date.now()) { this._act = now; this.armIdle(); }
  idleLimit() { return (this.state === "lobby" || this.state === "over") ? IDLE_LOBBY_MS : IDLE_PLAY_MS; }
  // Ein einziger Prüf-Timer, solange jemand verbunden ist (getrennt von this.timers,
  // damit clearTimers() der Spiel-Logik ihn nicht mitnimmt).
  armIdle() {
    if (this._idleT || !this.conns.size) return;
    this._idleT = setTimeout(() => { this._idleT = null; this.checkIdle(); }, IDLE_CHECK_MS);
  }
  clearIdle() { if (this._idleT) { clearTimeout(this._idleT); this._idleT = null; } }
  checkIdle(now = Date.now()) {
    if (!this.conns.size) return false;
    if (now - (this._act || now) < this.idleLimit()) { this.armIdle(); return false; }
    this.idleShutdown(now); return true;
  }
  // Alle Verbindungen schließen und den Raum wie „alle weg" zurücksetzen (onEmpty
  // der jeweiligen Klasse). conns vorher leeren → die close-Events laufen ins Leere.
  idleShutdown(now = Date.now()) {
    this._idleShut = now; this.clearIdle();
    const socks = [...this.conns.keys()]; this.conns = new Map();
    const note = JSON.stringify({ t: "chat", kind: "system", text: "Raum wegen Inaktivität geschlossen." });
    for (const ws of socks) { try { ws.send(note); } catch (_) {} try { ws.close(IDLE_CLOSE_CODE, "idle"); } catch (_) {} }
    try { if (this.onEmpty) this.onEmpty(); } catch (err) { this.logErr("idleShutdown", err && err.stack || err); }
  }
  // Upgrade kurz nach einer Leerlauf-Abschaltung abweisen (Reconnect-Schleife brechen).
  idleRefused(now = Date.now()) { return !!this._idleShut && now - this._idleShut < IDLE_REFUSE_MS; }

  logErr(msg, extra) { console.error(this.GAME + "Room", msg, extra || ""); try { this.ctx.waitUntil(rtLogError(this.env, msg, this.GAME, extra)); } catch (_) {} }

  // Am Spielende jede:n Teilnehmer:in in die dauerhafte Bestenliste rollen.
  // Aggregation nach Name (bewusst ohne Geräte-Eigentumssperre — ein gemeinsamer
  // Name über alle Spiele/Geräte). Identisch für Kritzeln & Quiz, nur Tabelle/Label
  // unterscheiden sich (this.SCORE_TABLE / this.SCORE_PAGE).
  saveScores(parts) {
    const run = this.recordScores(parts).catch(err => rtLogError(this.env, "recordScores", this.SCORE_PAGE, err && err.stack || err));
    try { this.ctx.waitUntil(run); } catch (_) {}
  }
  async recordScores(parts) {
    if (!this.env || !this.env.DB || !parts || parts.length < 2) return;
    const table = SCORE_TABLES.has(this.SCORE_TABLE) ? this.SCORE_TABLE : null;
    if (!table) return;
    let winName = null, top = 0;
    for (const p of parts) { const s = p.score | 0; if (s > top) { top = s; winName = p.name; } }
    if (top <= 0) return;   // niemand hat Punkte → nicht werten
    for (const p of parts) {
      if (!p.name) continue;
      const pts = p.score | 0, win = p.name === winName ? 1 : 0;
      try {
        await this.env.DB.prepare(
          "INSERT INTO " + table + " (name, points, games, wins, best, device) VALUES (?, ?, 1, ?, ?, ?) " +
          "ON CONFLICT(name) DO UPDATE SET points = points + excluded.points, games = games + 1, " +
          "wins = wins + excluded.wins, best = MAX(best, excluded.best), " +
          "device = COALESCE(" + table + ".device, excluded.device), updated_at = datetime('now')"
        ).bind(p.name, pts, win, pts, p.device || null).run();
      } catch (err) { await rtLogError(this.env, "recordScores row " + p.name, this.SCORE_PAGE, err && err.stack || err); }
    }
  }
};
