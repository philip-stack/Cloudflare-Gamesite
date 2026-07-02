import { json, loadGame } from "../_util.js";

// GET /api/games – Liste (vollständige Spielstände, klein genug bei privater Nutzung)
export async function onRequestGet({ env }) {
  const ids = (await env.DB.prepare(
    "SELECT id FROM games ORDER BY id DESC LIMIT 50"
  ).all()).results;
  const games = [];
  for (const { id } of ids) {
    const g = await loadGame(env, id);
    if (g) games.push(g);
  }
  return json(games);
}

// POST /api/games – neues Spiel anlegen
// body: { name?, players:[Namen], starter_index?, turn_index?, status? }
export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const players = (body.players || []).map(p => String(p).trim()).filter(Boolean);
  if (players.length < 2) {
    return json({ error: "Mindestens 2 Spieler angeben" }, 400);
  }

  const name = (body.name && String(body.name).trim()) || "Würfelpoker";
  const status = ["starter", "active", "finished"].includes(body.status) ? body.status : "starter";
  const starterIndex = Number.isInteger(body.starter_index) ? body.starter_index : null;
  const turnIndex = Number.isInteger(body.turn_index) ? body.turn_index : null;

  const game = await env.DB.prepare(
    "INSERT INTO games (name, status, starter_index, turn_index) VALUES (?, ?, ?, ?) RETURNING id"
  ).bind(name, status, starterIndex, turnIndex).first();

  const stmts = players.map((p, i) =>
    env.DB.prepare("INSERT INTO players (game_id, name, seat_order) VALUES (?, ?, ?)")
      .bind(game.id, p, i)
  );
  await env.DB.batch(stmts);

  return json({ id: game.id }, 201);
}
