export async function onRequestGet({ env, params }) {
  const id = Number(params.id);
  const game = await env.DB.prepare(
    "SELECT id, name, status, scoring, created_at FROM games WHERE id = ?"
  ).bind(id).first();
  if (!game) return Response.json({ error: "Spiel nicht gefunden" }, { status: 404 });

  const players = (await env.DB.prepare(
    "SELECT id, name, seat_order FROM players WHERE game_id = ? ORDER BY seat_order"
  ).bind(id).all()).results;

  const rounds = (await env.DB.prepare(
    "SELECT id, round_no, winner_player_id, hand, points, created_at FROM rounds WHERE game_id = ? ORDER BY round_no"
  ).bind(id).all()).results;

  const totals = {};
  for (const p of players) totals[p.id] = 0;
  for (const r of rounds) totals[r.winner_player_id] += r.points;

  const lastRound = rounds[rounds.length - 1] || null;

  return Response.json({
    ...game,
    scoring: JSON.parse(game.scoring),
    players,
    rounds,
    totals,
    next_starter_player_id: lastRound ? lastRound.winner_player_id : null
  });
}

export async function onRequestPatch({ request, env, params }) {
  const id = Number(params.id);
  const body = await request.json();
  if (body.status !== "active" && body.status !== "finished") {
    return Response.json({ error: "status muss 'active' oder 'finished' sein" }, { status: 400 });
  }
  await env.DB.prepare("UPDATE games SET status = ? WHERE id = ?").bind(body.status, id).run();
  return Response.json({ ok: true });
}
