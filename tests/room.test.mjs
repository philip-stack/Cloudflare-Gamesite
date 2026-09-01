// Geteilte Raum-Basis (worker-rt/base-room.js → RoomMixin). Testet die Primitive,
// die früher in jeder DO-Klasse dupliziert waren: Senden, Suchen, Teilnehmer-
// Sync, Host-Übergabe, Heartbeat-Drosselung und das Bestenlisten-Schreiben.
// Läuft rein in Node (das Mixin importiert KEIN cloudflare:workers).
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "worker-rt", "base-room.js").replace(/\\/g, "/");
const { RoomMixin } = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// Fake-WebSocket, das gesendete Strings sammelt.
const fakeWs = () => ({ sent: [], send(s) { this.sent.push(s); } });
// Fake-DurableObject-Kontext.
const fakeCtx = () => ({ n: 0, waitUntil(p) { this.n++; return p; } });

// Instanz der Basis über eine leere Klasse.
class Room extends RoomMixin(class {}) {}
function makeRoom() {
  const r = new Room();
  r.conns = new Map();
  r.ctx = fakeCtx();
  r.env = { DB: null };   // recordScores no-op bei fehlender DB
  r.state = "lobby";
  r.hostId = null;
  return r;
}
function addPlayer(r, id, name, extra = {}) { const ws = fakeWs(); r.conns.set(ws, { id, name, score: 0, ...extra }); return ws; }

// ---------- bc / toId / pget ----------
{
  const r = makeRoom();
  const a = addPlayer(r, 1, "A"), b = addPlayer(r, 2, "B");
  r.bc({ t: "x" });
  assert("bc: sendet an alle", r.conns.get(a).id === 1 && a.sent.length === 1 && b.sent.length === 1);
  r.bc({ t: "y" }, 1);
  assert("bc: exceptId schließt eine:n aus", a.sent.length === 1 && b.sent.length === 2);
  r.toId(2, { t: "z" });
  assert("toId: nur an die gesuchte id", b.sent.length === 3 && a.sent.length === 1);
  assert("pget: findet per id", r.pget(1).name === "A" && r.pget(99) === null);
}

// ---------- partKey / syncPart ----------
{
  const r = makeRoom();
  const p1 = { id: 1, name: "A", score: 10, uid: "u1", dev: "d1" };
  const p2 = { id: 2, name: "B", score: 5 };
  assert("partKey: uid bevorzugt, sonst id", r.partKey(p1) === "u1" && r.partKey(p2) === "id2");
  r.syncPart(p1); r.syncPart(p2);
  assert("syncPart: legt parts an", r.parts.size === 2 && r.parts.get("u1").score === 10 && r.parts.get("u1").device === "d1");
  p1.score = 42; r.syncPart(p1);
  assert("syncPart: aktualisiert bestehende:n", r.parts.size === 2 && r.parts.get("u1").score === 42);
}

// ---------- hostAfterLeave ----------
{
  const r = makeRoom();
  const wa = addPlayer(r, 1, "A"); addPlayer(r, 2, "B");
  r.hostId = 1;
  r.hostAfterLeave(2);
  assert("hostAfterLeave: anderer geht → Host bleibt", r.hostId === 1);
  // Host (1) verlässt den Raum: aus conns entfernen, dann Übergabe.
  r.conns.delete(wa);
  r.hostAfterLeave(1);
  assert("hostAfterLeave: Host geht → nächste:r wird Host", r.hostId === 2);
  // Letzte:r geht → kein Host mehr.
  r.conns.clear();
  r.hostAfterLeave(2);
  assert("hostAfterLeave: niemand mehr → Host null", r.hostId === null);
}

// ---------- touchLive (Drosselung) ----------
{
  const r = makeRoom(); r.GAME = "quiz"; r.code = "ABCD";
  addPlayer(r, 1, "A");
  r.touchLive();
  assert("touchLive: erster Aufruf meldet (waitUntil)", r.ctx.n === 1);
  r.touchLive();
  assert("touchLive: sofortiger zweiter Aufruf gedrosselt", r.ctx.n === 1);
  r.state = "question"; r.touchLive();
  assert("touchLive: Zustandswechsel meldet sofort", r.ctx.n === 2);
}

// ---------- recordScores (Bestenliste) ----------
function mockDB() {
  const inserts = [];
  return {
    inserts,
    prepare(sql) { return { sql, args: [], bind(...a) { this.args = a; return this; }, async run() { inserts.push({ sql: this.sql, args: this.args }); } }; },
  };
}
{
  const r = makeRoom(); r.SCORE_TABLE = "quiz_score"; r.SCORE_PAGE = "quiz";
  const db = mockDB(); r.env = { DB: db };
  await r.recordScores([{ name: "Alice", score: 30, device: "d1" }, { name: "Bob", score: 10 }]);
  assert("recordScores: eine Zeile je Teilnehmer:in", db.inserts.length === 2);
  assert("recordScores: schreibt in die konfigurierte Tabelle", db.inserts.every(i => /INSERT INTO quiz_score/.test(i.sql)));
  const alice = db.inserts.find(i => i.args[0] === "Alice"), bob = db.inserts.find(i => i.args[0] === "Bob");
  // bind-Reihenfolge: (name, points, win, best, device)
  assert("recordScores: Sieger:in bekommt win=1", alice && alice.args[2] === 1);
  assert("recordScores: Verlierer:in bekommt win=0", bob && bob.args[2] === 0);
}
{
  const r = makeRoom(); r.SCORE_TABLE = "quiz_score"; const db = mockDB(); r.env = { DB: db };
  await r.recordScores([{ name: "Solo", score: 10 }]);
  assert("recordScores: < 2 Teilnehmer:innen → nichts schreiben", db.inserts.length === 0);
  await r.recordScores([{ name: "A", score: 0 }, { name: "B", score: 0 }]);
  assert("recordScores: alle 0 Punkte → nichts werten", db.inserts.length === 0);
}
{
  const r = makeRoom(); r.SCORE_TABLE = "verboten_table"; const db = mockDB(); r.env = { DB: db };
  await r.recordScores([{ name: "A", score: 5 }, { name: "B", score: 1 }]);
  assert("recordScores: nur Whitelist-Tabellen (Fremdname → no-op)", db.inserts.length === 0);
}

console.log("\n" + (ok ? "ROOM-BASIS OK" : "ROOM-BASIS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
