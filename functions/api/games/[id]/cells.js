import { json, CAT_KEYS, CAT_COUNT, cellCount, authGame } from "../../_util.js";

// PUT /api/games/:id/cells?code=XXXXXX – ein Feld eintragen und Zug weiterschalten
// body: { player_id, cat_key, kind, value, serviert?, turn_index }
export async function onRequestPut({ request, env, params }) {
  const auth = await authGame(env, params.id, request);
  if (!auth) return json({ error: "Spiel nicht gefunden oder Code falsch" }, 404);
  const gameId = auth.id;
  const b = await request.json();

  if (!CAT_KEYS.includes(b.cat_key)) return json({ error: "Unbekanntes Feld" }, 400);
  if (!["score", "strike"].includes(b.kind)) return json({ error: "Ungültige Art" }, 400);
  const value = Number(b.value);
  if (!Number.isInteger(value) || value < 0) return json({ error: "Ungültiger Wert" }, 400);

  const player = await env.DB.prepare(
    "SELECT id FROM players WHERE id = ? AND game_id = ?"
  ).bind(b.player_id, gameId).first();
  if (!player) return json({ error: "Spieler gehört nicht zu diesem Spiel" }, 400);

  const exists = await env.DB.prepare(
    "SELECT 1 FROM cells WHERE player_id = ? AND cat_key = ?"
  ).bind(b.player_id, b.cat_key).first();
  if (exists) return json({ error: "Feld ist bereits ausgefüllt" }, 409);

  await env.DB.prepare(
    "INSERT INTO cells (game_id, player_id, cat_key, kind, value, serviert) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(gameId, b.player_id, b.cat_key, b.kind, value, b.serviert ? 1 : 0).run();

  // Spielerzahl → prüfen ob alle Felder voll sind
  const nPlayers = (await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM players WHERE game_id = ?"
  ).bind(gameId).first()).n;
  const filled = await cellCount(env, gameId);
  const finished = filled >= nPlayers * CAT_COUNT;

  const turnIndex = Number.isInteger(b.turn_index) ? b.turn_index : null;
  await env.DB.prepare("UPDATE games SET turn_index = ?, status = ? WHERE id = ?")
    .bind(turnIndex, finished ? "finished" : "active", gameId).run();

  return json({ ok: true, finished }, 201);
}

// DELETE /api/games/:id/cells?code=XXXXXX – letzten Eintrag rückgängig machen
export async function onRequestDelete({ request, env, params }) {
  const auth = await authGame(env, params.id, request);
  if (!auth) return json({ error: "Spiel nicht gefunden oder Code falsch" }, 404);
  const gameId = auth.id;
  const last = await env.DB.prepare(
    "SELECT c.seq, c.player_id, p.seat_order FROM cells c JOIN players p ON p.id = c.player_id " +
    "WHERE c.game_id = ? ORDER BY c.seq DESC LIMIT 1"
  ).bind(gameId).first();
  if (!last) return json({ error: "Nichts zum Löschen" }, 404);

  await env.DB.prepare("DELETE FROM cells WHERE seq = ?").bind(last.seq).run();
  // Zug zurück auf den Spieler, dessen Eintrag entfernt wurde; Spiel wieder aktiv
  await env.DB.prepare("UPDATE games SET turn_index = ?, status = 'active' WHERE id = ?")
    .bind(last.seat_order, gameId).run();

  return json({ ok: true });
}
