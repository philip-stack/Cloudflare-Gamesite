// Saison-/Liga-API mit gemockter D1: Wochenwertung über alle Spiele,
// Rang-Punkte-Aggregation, Vorsaison-Champion.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "season.js").replace(/\\/g, "/");
const mod = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// Zeilen: { game, name, score, week: "cur" | "prev" }
function mockDB(rows) {
  return {
    prepare(sql) {
      return {
        sql, args: [],
        bind(...a) { this.args = a; return this; },
        async first() {
          if (/COUNT\(\*\) AS n FROM rate/.test(this.sql)) return { n: 0 };
          if (/strftime\('%Y-%W','now'\) AS cur/.test(this.sql)) return { cur: "2026-30", prev: "2026-29" };
          return {};
        },
        async run() { return {}; },
        async all() {
          if (/FROM scores/.test(this.sql)) {
            const week = /-7 days/.test(this.sql) ? "prev" : "cur";
            const game = this.args[0];
            const best = {};   // lowerName -> {name, score}
            for (const r of rows.filter(r => r.game === game && r.week === week)) {
              const lk = r.name.toLowerCase();
              if (!best[lk] || r.score > best[lk].score) best[lk] = { name: r.name, score: r.score };
            }
            return { results: Object.values(best).sort((a, b) => b.score - a.score).slice(0, 20) };
          }
          return { results: [] };
        },
      };
    },
  };
}

const rows = [
  { game: "funkelfeld", name: "Alice", score: 100, week: "cur" },
  { game: "funkelfeld", name: "Bob", score: 50, week: "cur" },
  { game: "komet", name: "Bob", score: 200, week: "cur" },
  { game: "komet", name: "Alice", score: 150, week: "cur" },
  { game: "sternensturm", name: "Alice", score: 300, week: "cur" },
  { game: "galopp", name: "Zoe", score: 500, week: "prev" },
];

const env = { DB: mockDB(rows) };
const r = await mod.onRequestGet({ request: new Request("https://x/api/season"), env });
const d = await r.json();

assert("Saison geladen (200)", r.status === 200);
assert("Saison-Id gesetzt", d.season === "2026-30");
// Alice: funkelfeld #1 (25) + komet #2 (18) + sternensturm #1 (25) = 68
// Bob:   funkelfeld #2 (18) + komet #1 (25) = 43
assert("Alice führt mit 68 Punkten", d.standings[0].name === "Alice" && d.standings[0].points === 68);
assert("Bob Zweiter mit 43 Punkten", d.standings[1].name === "Bob" && d.standings[1].points === 43);
assert("Spitzenreiter Funkelfeld = Alice", (d.games.find(g => g.key === "funkelfeld").leader || {}).name === "Alice");
assert("Spitzenreiter Komet = Bob", (d.games.find(g => g.key === "komet").leader || {}).name === "Bob");
assert("Leeres Spiel ohne Spitzenreiter", d.games.find(g => g.key === "meeri").leader === null);
assert("Vorsaison-Champion = Zoe", d.prevChampion && d.prevChampion.name === "Zoe");
assert("resetInMs plausibel (0..8 Tage)", d.resetInMs >= 0 && d.resetInMs <= 8 * 86400000);

console.log("\n" + (ok ? "SEASON-TESTS OK" : "SEASON-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
