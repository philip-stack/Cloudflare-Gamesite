import { json } from "../_util.js";

// GET /api/funkelfeld/scores – Top 50, pro Name nur der Highscore
// (SQLite garantiert bei MAX(): "name" stammt aus der Zeile mit dem Maximum)
export async function onRequestGet({ env }) {
  const rows = (await env.DB.prepare(
    "SELECT name, MAX(score) AS score FROM blockblast_scores GROUP BY LOWER(name) ORDER BY score DESC LIMIT 50"
  ).all()).results;
  return json({ top: rows });
}

// POST /api/funkelfeld/scores – Score eintragen
// body: { name, score }  →  { ok, rank }
export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => ({}));

  const score = Number(b.score);
  if (!Number.isInteger(score) || score < 0 || score > 5_000_000) {
    return json({ error: "Ungültiger Score" }, 400);
  }

  let name = String(b.name || "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 16);
  if (!name) name = "Anonym";

  await env.DB.prepare(
    "INSERT INTO blockblast_scores (name, score) VALUES (?, ?)"
  ).bind(name, score).run();

  // Rang des Spielers = Anzahl der Namen mit höherem Highscore + 1
  const myBest = (await env.DB.prepare(
    "SELECT MAX(score) AS m FROM blockblast_scores WHERE LOWER(name) = LOWER(?)"
  ).bind(name).first()).m;

  const rank = (await env.DB.prepare(
    "SELECT COUNT(*) + 1 AS r FROM (SELECT MAX(score) AS m FROM blockblast_scores GROUP BY LOWER(name)) WHERE m > ?"
  ).bind(myBest).first()).r;

  return json({ ok: true, rank, best: myBest }, 201);
}
