export async function onRequestPost({ request, env, params }) {
  const gameId = Number(params.id);
  const body = await request.json();

  const game = await env.DB.prepare(
    "SELECT scoring, status FROM games WHERE id = ?"
  ).bind(gameId).first();
  if (!game) return Response.json({ error: "Spiel nicht gefunden" }, { status: 404 });
  if (game.status !== "active") {
    return Response.json({ error: "Spiel ist beendet" }, { status: 409 });
  }

  const player = await env.DB.prepare(
    "SELECT id FROM players WHERE id = ? AND game_id = ?"
  ).bind(body.winner_player_id, gameId).first();
  if (!player) return Response.json({ error: "Spieler gehört nicht zu diesem Spiel" }, { status: 400 });

  const scoring = JSON.parse(game.scoring);
  const hand = body.hand;
  const points = body.points ?? scoring[hand];
  if (typeof points !== "number") {
    return Response.json({ error: `Unbekannte Hand '${hand}' und keine Punkte angegeben` }, { status: 400 });
  }

  const last = await env.DB.prepare(
    "SELECT COALESCE(MAX(round_no), 0) AS n FROM rounds WHERE game_id = ?"
  ).bind(gameId).first();

  const round = await env.DB.prepare(
    "INSERT INTO rounds (game_id, round_no, winner_player_id, hand, points) VALUES (?, ?, ?, ?, ?) RETURNING id, round_no"
  ).bind(gameId, last.n + 1, body.winner_player_id, hand, points).first();

  return Response.json(round, { status: 201 });
}

export async function onRequestDelete({ env, params }) {
  const gameId = Number(params.id);
  const last = await env.DB.prepare(
    "SELECT id FROM rounds WHERE game_id = ? ORDER BY round_no DESC LIMIT 1"
  ).bind(gameId).first();
  if (!last) return Response.json({ error: "Keine Runde zum Löschen" }, { status: 404 });
  await env.DB.prepare("DELETE FROM rounds WHERE id = ?").bind(last.id).run();
  return Response.json({ ok: true, deleted: last.id });
}
