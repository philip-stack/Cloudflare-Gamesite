// Scores-API-Tests mit gemockter D1: Lauf-Token (signierter Seed),
// Plausibilität, Namensschutz, Tages-/Wochen-Modus.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "scores", "[game].js").replace(/\\/g, "/");
const mod = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

function mockDB() {
  const rows = [];
  return {
    _rows: rows,
    prepare(sql) {
      return {
        sql, args: [],
        bind(...a) { this.args = a; return this; },
        async all() { return { results: rows.filter(r => r.game === this.args[0]).map(r => ({ name: r.name, score: r.score })) }; },
        async first() {
          if (/COUNT\(\*\) AS n/.test(this.sql)) return { n: 0 };
          if (/SELECT device FROM scores/.test(this.sql)) return null;
          if (/MAX\(score\) AS m FROM scores WHERE game = \? AND LOWER/.test(this.sql)) {
            const [g, nm] = this.args;
            const mine = rows.filter(r => r.game === g && r.name.toLowerCase() === String(nm).toLowerCase());
            return { m: mine.length ? Math.max(...mine.map(r => r.score)) : null };
          }
          if (/COUNT\(\*\) \+ 1 AS r/.test(this.sql)) return { r: 1 };
          return {};
        },
        async run() { const [game, name, device, score] = this.args; rows.push({ game, name, device, score }); return {}; },
      };
    },
  };
}

const env = { DB: mockDB() };
const device = "abcd1234efgh5678";
const getToken = async (game = "galopp") => (await (await mod.onRequestGet({
  request: new Request(`https://x/?token=1&device=${device}`), env, params: { game },
})).json()).token;
const post = async (body, game = "galopp") => {
  const res = await mod.onRequestPost({
    request: new Request("https://x/api/scores/" + game, { method: "POST", body: JSON.stringify(body) }),
    env, params: { game },
  });
  return { status: res.status, data: await res.json() };
};

const token = await getToken();
assert("Token ausgestellt", typeof token === "string" && token.includes("."));

let r = await post({ name: "Tester", score: 150, device, token, meta: { meters: 100, coins: 5 } });
assert("Gültiger Post (201)", r.status === 201 && r.data.ok);
r = await post({ name: "Tester", score: 150, device, meta: { meters: 100, coins: 5 } });
assert("Ohne Token abgelehnt (403)", r.status === 403);
r = await post({ name: "Tester", score: 150, device, token: token.slice(0, -1) + "0", meta: { meters: 100, coins: 5 } });
assert("Manipuliertes Token abgelehnt", r.status === 403);
r = await post({ name: "Tester", score: 150, device: "zzzz9999zzzz9999", token, meta: { meters: 100, coins: 5 } });
assert("Token an Gerät gebunden", r.status === 403);
r = await post({ name: "Tester", score: 999, device, token: await getToken(), meta: { meters: 100, coins: 5 } });
assert("Meta-Mismatch abgelehnt (400)", r.status === 400);

const gw = await mod.onRequestGet({ request: new Request("https://x/api/scores/galopp?weekly=1"), env, params: { game: "galopp" } });
assert("Weekly GET ok", gw.status === 200);
r = await post({ name: "Tester", score: 150, device, token: await getToken(), weekly: true, meta: { meters: 100, coins: 5 } });
assert("Weekly Post (201)", r.status === 201);
assert("Weekly-Bucket getrennt", env.DB._rows.some(x => x.game === "galopp:weekly"));

r = await post({ name: "Tester", score: 5000, device, token: await getToken("funkelfeld") }, "funkelfeld");
assert("Funkelfeld Post (201)", r.status === 201);

console.log("\n" + (ok ? "API-TESTS OK" : "API-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
