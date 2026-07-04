import { json } from "../_util.js";

// GET /api/blockblast/scores – Top 50 der globalen Bestenliste
export async function onRequestGet({ env }) {
  const rows = (await env.DB.prepare(
    "SELECT name, score, created_at FROM blockblast_scores ORDER BY score DESC, created_at ASC LIMIT 50"
  ).all()).results;
  return json({ top: rows });
}

// POST /api/blockblast/scores – Score eintragen
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

  const rank = (await env.DB.prepare(
    "SELECT COUNT(*) + 1 AS r FROM blockblast_scores WHERE score > ?"
  ).bind(score).first()).r;

  return json({ ok: true, rank }, 201);
}
