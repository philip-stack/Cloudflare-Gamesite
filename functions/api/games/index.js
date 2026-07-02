const DEFAULT_SCORING = {
  "Hoher Wurf": 1,
  "Straße": 2,
  "Straße serviert": 4,
  "Full": 3,
  "Full serviert": 6,
  "Poker": 4,
  "Poker serviert": 8,
  "Grande": 5,
  "Grande serviert": 10
};

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, status, created_at FROM games ORDER BY id DESC LIMIT 50"
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const players = (body.players || []).map(p => String(p).trim()).filter(Boolean);
  if (players.length < 2) {
    return Response.json({ error: "Mindestens 2 Spieler angeben" }, { status: 400 });
  }
  const scoring = JSON.stringify(body.scoring || DEFAULT_SCORING);
  const name = body.name || null;

  const game = await env.DB.prepare(
    "INSERT INTO games (name, scoring) VALUES (?, ?) RETURNING id"
  ).bind(name, scoring).first();

  const stmts = players.map((p, i) =>
    env.DB.prepare("INSERT INTO players (game_id, name, seat_order) VALUES (?, ?, ?)")
      .bind(game.id, p, i)
  );
  await env.DB.batch(stmts);

  return Response.json({ id: game.id }, { status: 201 });
}
