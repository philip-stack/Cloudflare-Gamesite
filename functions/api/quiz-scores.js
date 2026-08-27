import { json } from "./_util.js";

// ====================================================================
// Dauerhafte Bestenliste für „Quiz-Duell" (Tabelle quiz_score, vom QuizRoom-DO
// autoritativ gepflegt). Nur Lesen.
//
//   GET /api/quiz-scores[?me=Name]
//     → { top: [{name,points,games,wins,best}], me: {…, rank} | null }
// ====================================================================
export async function onRequestGet({ request, env }) {
  if (!env || !env.DB) return json({ top: [], me: null });
  const url = new URL(request.url);
  let top = [];
  try {
    top = (await env.DB.prepare(
      "SELECT name, points, games, wins, best FROM quiz_score ORDER BY points DESC, best DESC LIMIT 50"
    ).all()).results || [];
  } catch (_) {}

  let me = null;
  const q = String(url.searchParams.get("me") || "").trim().slice(0, 14);
  if (q) {
    try {
      const row = await env.DB.prepare(
        "SELECT name, points, games, wins, best FROM quiz_score WHERE name = ?"
      ).bind(q).first();
      if (row) {
        const r = await env.DB.prepare("SELECT COUNT(*) + 1 AS rank FROM quiz_score WHERE points > ?").bind(row.points).first();
        me = { ...row, rank: r ? r.rank : null };
      }
    } catch (_) {}
  }
  return json({ top, me });
}
