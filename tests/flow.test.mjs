// E2E-/Flow-Test des kritischen Würfelpoker-Pfades gegen die echten
// Pages-Functions mit gemockter D1: geteiltes Spiel anlegen → per Code laden
// → Felder eintragen → Doppel-Eintrag blockiert → volle Runde erkannt.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const api = rel => "file://" + path.join(__dirname, "..", "functions", "api", rel).replace(/\\/g, "/");
const games = await import(api("games/index.js"));
const cells = await import(api("games/[id]/cells.js"));
const util = await import(api("_util.js"));

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// --- In-Memory-D1, die nur die von den Handlern genutzten Queries kennt ---
function mockDB() {
  const G = [], P = [], C = [];
  let gid = 0, pid = 0, seq = 0;
  const stmt = sql => ({
    sql, args: [],
    bind(...a) { this.args = a; return this; },
    async first() {
      if (/INSERT INTO games/.test(sql)) {
        const [name, status, cols, starter, turn, code] = this.args;
        const g = { id: ++gid, name, status, cols, round: 1, starter_index: starter, turn_index: turn, code, created_at: "2026-01-01" };
        G.push(g); return { id: g.id };
      }
      if (/SELECT 1 FROM games WHERE code/.test(sql)) return G.some(g => g.code === this.args[0]) ? { 1: 1 } : null;
      if (/SELECT id FROM games WHERE code/.test(sql)) { const g = G.find(x => x.code === this.args[0]); return g ? { id: g.id } : null; }
      if (/SELECT id, name/.test(sql)) return G.find(g => g.id === this.args[0]) || null;              // loadGame
      if (/SELECT id, code, status, cols, round FROM games/.test(sql)) return G.find(g => g.id === Number(this.args[0])) || null; // authGame
      if (/SELECT id FROM players WHERE id = \? AND game_id/.test(sql)) { const p = P.find(x => x.id === this.args[0] && x.game_id === this.args[1]); return p ? { id: p.id } : null; }
      if (/SELECT 1 FROM cells WHERE player_id/.test(sql)) { const [p, r, col, k] = this.args; return C.some(c => c.player_id === p && c.round === r && c.col === col && c.cat_key === k) ? { 1: 1 } : null; }
      if (/COUNT\(\*\) AS n FROM players/.test(sql)) return { n: P.filter(p => p.game_id === this.args[0]).length };
      if (/COUNT\(\*\) AS n FROM cells WHERE game_id = \? AND round/.test(sql)) return { n: C.filter(c => c.game_id === this.args[0] && c.round === this.args[1]).length };
      return {};
    },
    async all() {
      if (/FROM players WHERE game_id/.test(sql)) return { results: P.filter(p => p.game_id === this.args[0]).sort((a, b) => a.seat_order - b.seat_order).map(p => ({ id: p.id, name: p.name, seat_order: p.seat_order })) };
      if (/FROM cells WHERE game_id/.test(sql)) return { results: C.filter(c => c.game_id === this.args[0]).map(c => ({ player_id: c.player_id, round: c.round, col: c.col, cat_key: c.cat_key, kind: c.kind, value: c.value, serviert: c.serviert })) };
      return { results: [] };
    },
    async run() {
      if (/INSERT INTO players/.test(sql)) { const [game_id, name, seat_order] = this.args; P.push({ id: ++pid, game_id, name, seat_order }); }
      else if (/INSERT INTO cells/.test(sql)) { const [game_id, player_id, round, col, cat_key, kind, value, serviert] = this.args; C.push({ seq: ++seq, game_id, player_id, round, col, cat_key, kind, value, serviert }); }
      else if (/UPDATE games SET turn_index/.test(sql)) { const [turn, status, id] = this.args; const g = G.find(x => x.id === id); if (g) { g.turn_index = turn; g.status = status; } }
      return {};
    },
  });
  return { prepare: stmt, async batch(list) { for (const s of list) await s.run(); return []; } };
}

const env = { DB: mockDB() };
const jpost = async (mod, url, body, params) => { const r = await mod.onRequestPost({ request: new Request(url, { method: "POST", body: JSON.stringify(body) }), env, params }); return { status: r.status, data: await r.json() }; };

// 1) Geteiltes Spiel anlegen
let r = await jpost(games, "https://x/api/games", { name: "Testrunde", players: ["Alice", "Bob"], cols: 1 });
assert("Spiel angelegt (201) + Code", r.status === 201 && /^[A-Z0-9]{6}$/.test(r.data.code));
const id = r.data.id, code = r.data.code;

// 2) Zu wenige Spieler abgelehnt
r = await jpost(games, "https://x/api/games", { players: ["Solo"] });
assert("Weniger als 2 Spieler abgelehnt (400)", r.status === 400);

// 3) Per Code laden
let g = await (await games.onRequestGet({ request: new Request("https://x/api/games?code=" + code), env })).json();
assert("Per Code geladen: 2 Spieler", g.players.length === 2 && g.players[0].name === "Alice");
const [alice, bob] = g.players;

// 4) Ein Feld eintragen
const put = async (body) => { const res = await cells.onRequestPut({ request: new Request("https://x/api/games/" + id + "/cells?code=" + code, { method: "PUT", body: JSON.stringify(body) }), env, params: { id: String(id) } }); return { status: res.status, data: await res.json() }; };

r = await put({ player_id: alice.id, col: 0, cat_key: "9", kind: "score", value: 3, turn_index: 1 });
assert("Feld eingetragen (201)", r.status === 201 && r.data.ok);

// 5) Dasselbe Feld erneut → 409
r = await put({ player_id: alice.id, col: 0, cat_key: "9", kind: "score", value: 3, turn_index: 1 });
assert("Doppelter Eintrag blockiert (409)", r.status === 409);

// 6) Falscher Code → 404
r = await (await cells.onRequestPut({ request: new Request("https://x/api/games/" + id + "/cells?code=WRONG1", { method: "PUT", body: JSON.stringify({ player_id: alice.id, col: 0, cat_key: "10", kind: "score", value: 2, turn_index: 0 }) }), env, params: { id: String(id) } }));
assert("Falscher Code abgelehnt (404)", r.status === 404);

// 7) Runde füllen (2 Spieler × 10 Kategorien = 20 Felder) → roundFull
let last = null;
for (const p of [alice, bob]) {
  for (const cat of util.CAT_KEYS) {
    if (p.id === alice.id && cat === "9") continue;  // schon gesetzt
    last = await put({ player_id: p.id, col: 0, cat_key: cat, kind: "score", value: 1, turn_index: 0 });
  }
}
assert("Volle Runde erkannt (roundFull)", last && last.data.roundFull === true);
g = await (await games.onRequestGet({ request: new Request("https://x/api/games?code=" + code), env })).json();
assert("Status nach voller Runde = round_end", g.status === "round_end");

console.log("\n" + (ok ? "FLOW-TESTS OK" : "FLOW-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
