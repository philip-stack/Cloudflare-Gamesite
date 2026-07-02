import { json, loadGame } from "../../_util.js";

// GET /api/games/:id – vollständiger Spielstand
export async function onRequestGet({ env, params }) {
  const game = await loadGame(env, Number(params.id));
  if (!game) return json({ error: "Spiel nicht gefunden" }, 404);
  return json(game);
}

// PATCH /api/games/:id – Status / Startspieler / aktueller Zug setzen
// body: { status?, starter_index?, turn_index? }
export async function onRequestPatch({ request, env, params }) {
  const id = Number(params.id);
  const body = await request.json();

  const sets = [];
  const vals = [];
  if (body.status !== undefined) {
    if (!["starter", "active", "finished"].includes(body.status)) {
      return json({ error: "Ungültiger status" }, 400);
    }
    sets.push("status = ?"); vals.push(body.status);
  }
  if (body.starter_index !== undefined) { sets.push("starter_index = ?"); vals.push(body.starter_index); }
  if (body.turn_index !== undefined) { sets.push("turn_index = ?"); vals.push(body.turn_index); }
  if (!sets.length) return json({ error: "Nichts zu ändern" }, 400);

  vals.push(id);
  const res = await env.DB.prepare(`UPDATE games SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  if (!res.meta.changes) return json({ error: "Spiel nicht gefunden" }, 404);
  return json({ ok: true });
}

// DELETE /api/games/:id – Spiel samt Spielern und Zellen löschen
export async function onRequestDelete({ env, params }) {
  const id = Number(params.id);
  // Kind-Datensätze explizit entfernen (D1 erzwingt FK-Cascade nicht sicher)
  await env.DB.batch([
    env.DB.prepare("DELETE FROM cells WHERE game_id = ?").bind(id),
    env.DB.prepare("DELETE FROM players WHERE game_id = ?").bind(id),
    env.DB.prepare("DELETE FROM games WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}
