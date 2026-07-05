import { json } from "../_util.js";

// GET /api/lichtwerk/scores – Top 50 (Sterne), pro Name nur der Bestwert
export async function onRequestGet({ env }) {
  const rows = (await env.DB.prepare(
    "SELECT name, MAX(score) AS score FROM lichtwerk_scores GROUP BY LOWER(name) ORDER BY score DESC LIMIT 50"
  ).all()).results;
  return json({ top: rows });
}

// POST /api/lichtwerk/scores – Sterne-Gesamtstand eintragen  →  { ok, rank, best }
export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => ({}));

  const score = Number(b.score);
  if (!Number.isInteger(score) || score < 0 || score > 1000) {
    return json({ error: "Ungültiger Score" }, 400);
  }

  let name = String(b.name || "").trim().slice(0, 16);
  if (!name) name = "Anonym";

  await env.DB.prepare(
    "INSERT INTO lichtwerk_scores (name, score) VALUES (?, ?)"
  ).bind(name, score).run();

  const myBest = (await env.DB.prepare(
    "SELECT MAX(score) AS m FROM lichtwerk_scores WHERE LOWER(name) = LOWER(?)"
  ).bind(name).first()).m;

  const rank = (await env.DB.prepare(
    "SELECT COUNT(*) + 1 AS r FROM (SELECT MAX(score) AS m FROM lichtwerk_scores GROUP BY LOWER(name)) WHERE m > ?"
  ).bind(myBest).first()).r;

  return json({ ok: true, rank, best: myBest }, 201);
}
