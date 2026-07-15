import { json, loadGame, authGame } from "../../_util.js";

// Alle Zugriffe auf ein Spiel erfordern den passenden Beitritts-Code (?code=).

// GET /api/games/:id?code=XXXXXX – vollständiger Spielstand
export async function onRequestGet({ request, env, params }) {
  const auth = await authGame(env, params.id, request);
  if (!auth) return json({ error: "Spiel nicht gefunden oder Code falsch" }, 404);
  return json(await loadGame(env, auth.id));
}

// PATCH /api/games/:id?code=XXXXXX – Status / Runde / Startspieler / Zug setzen
// body: { status?, round?, starter_index?, turn_index? }
export async function onRequestPatch({ request, env, params }) {
  const auth = await authGame(env, params.id, request);
  if (!auth) return json({ error: "Spiel nicht gefunden oder Code falsch" }, 404);
  const body = await request.json();

  const sets = [];
  const vals = [];
  if (body.status !== undefined) {
    if (!["starter", "active", "round_end", "finished"].includes(body.status)) {
      return json({ error: "Ungültiger status" }, 400);
    }
    sets.push("status = ?"); vals.push(body.status);
  }
  if (body.round !== undefined) {
    if (!Number.isInteger(body.round) || body.round < 1) {
      return json({ error: "Ungültige Runde" }, 400);
    }
    sets.push("round = ?"); vals.push(body.round);
  }
  if (body.starter_index !== undefined) { sets.push("starter_index = ?"); vals.push(body.starter_index); }
  if (body.turn_index !== undefined) { sets.push("turn_index = ?"); vals.push(body.turn_index); }
  if (!sets.length) return json({ error: "Nichts zu ändern" }, 400);

  vals.push(auth.id);
  await env.DB.prepare(`UPDATE games SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return json({ ok: true });
}

// DELETE /api/games/:id?code=XXXXXX – Spiel samt Spielern und Zellen löschen
export async function onRequestDelete({ request, env, params }) {
  const auth = await authGame(env, params.id, request);
  if (!auth) return json({ error: "Spiel nicht gefunden oder Code falsch" }, 404);
  // Kind-Datensätze explizit entfernen (D1 erzwingt FK-Cascade nicht sicher)
  await env.DB.batch([
    env.DB.prepare("DELETE FROM cells WHERE game_id = ?").bind(auth.id),
    env.DB.prepare("DELETE FROM players WHERE game_id = ?").bind(auth.id),
    env.DB.prepare("DELETE FROM games WHERE id = ?").bind(auth.id),
  ]);
  return json({ ok: true });
}
