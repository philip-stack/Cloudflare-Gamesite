// Spieleabend-Raum-API mit gemockter D1: Raum anlegen, beitreten,
// Ergebnisse melden, Rang-Punkte-Wertung.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "party.js").replace(/\\/g, "/");
const mod = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

function mockDB() {
  const party = new Map();      // code -> gamesJson
  const members = [];           // {code,name}
  const scores = [];            // {code,name,game,score}
  return {
    prepare(sql) {
      return {
        sql, args: [],
        bind(...a) { this.args = a; return this; },
        async run() {
          if (/INSERT INTO party /.test(this.sql)) party.set(this.args[0], this.args[1]);
          else if (/INSERT OR IGNORE INTO party_member/.test(this.sql)) {
            const [code, name] = this.args;
            if (!members.some(m => m.code === code && m.name === name)) members.push({ code, name });
          } else if (/INSERT INTO party_score/.test(this.sql)) {
            const [code, name, game, score] = this.args;
            const ex = scores.find(s => s.code === code && s.name === name && s.game === game);
            if (ex) ex.score = Math.max(ex.score, score); else scores.push({ code, name, game, score });
          }
          return {};
        },
        async first() {
          if (/COUNT\(\*\) AS n FROM rate/.test(this.sql)) return { n: 0 };
          if (/SELECT 1 FROM party/.test(this.sql)) return party.has(this.args[0]) ? { 1: 1 } : null;
          if (/SELECT games FROM party/.test(this.sql)) return party.has(this.args[0]) ? { games: party.get(this.args[0]) } : null;
          return null;
        },
        async all() {
          if (/FROM party_member/.test(this.sql)) return { results: members.filter(m => m.code === this.args[0]).map(m => ({ name: m.name })) };
          if (/FROM party_score/.test(this.sql)) return { results: scores.filter(s => s.code === this.args[0]).map(s => ({ name: s.name, game: s.game, score: s.score })) };
          return { results: [] };
        },
      };
    },
  };
}

const env = { DB: mockDB() };
const post = async body => { const r = await mod.onRequestPost({ request: new Request("https://x/api/party", { method: "POST", body: JSON.stringify(body) }), env }); return { status: r.status, data: await r.json() }; };
const get = async code => { const r = await mod.onRequestGet({ request: new Request("https://x/api/party?code=" + code), env }); return { status: r.status, data: await r.json() }; };

// Raum anlegen
let r = await post({ action: "create", games: ["komet", "galopp", "wumms"], name: "Alice" });
assert("Raum erstellt (200) + 6-stelliger Code", r.status === 200 && /^[A-Z0-9]{6}$/.test(r.data.code));
const code = r.data.code;

// Ungültiges Spiel bei create wird gefiltert
r = await post({ action: "create", games: ["gibtsnicht"] });
assert("create ohne gültige Spiele abgelehnt (400)", r.status === 400);

// Beitreten
r = await post({ action: "join", code, name: "Bob" });
assert("Bob beigetreten (200)", r.status === 200);

// Ergebnisse melden
await post({ action: "submit", code, name: "Alice", game: "komet", score: 100 });
await post({ action: "submit", code, name: "Alice", game: "galopp", score: 50 });
await post({ action: "submit", code, name: "Bob", game: "komet", score: 200 });
await post({ action: "submit", code, name: "Bob", game: "galopp", score: 40 });
await post({ action: "submit", code, name: "Bob", game: "wumms", score: 300 });

// Spiel gehört nicht zum Raum
r = await post({ action: "submit", code, name: "Bob", game: "meeri", score: 999 });
assert("Fremdes Spiel abgelehnt (400)", r.status === 400);

// Wertung: komet Bob(10)/Alice(7); galopp Alice(10)/Bob(7); wumms Bob(10)
// → Bob 27, Alice 17
r = await get(code);
assert("Standings geladen (200)", r.status === 200 && r.data.standings.length === 2);
const bob = r.data.standings[0], alice = r.data.standings[1];
assert("Bob führt mit 27 Punkten", bob.name === "Bob" && bob.points === 27);
assert("Alice hat 17 Punkte", alice.name === "Alice" && alice.points === 17);
assert("Per-Spiel-Scores vorhanden", bob.scores.wumms === 300 && alice.scores.komet === 100);

// Unbekannter Raum
r = await get("ZZZZZZ");
assert("Unbekannter Raum (404)", r.status === 404);

console.log("\n" + (ok ? "PARTY-TESTS OK" : "PARTY-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
