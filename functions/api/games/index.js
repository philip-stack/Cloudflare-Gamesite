import { json, loadGame, makeCode, codeFromRequest } from "../_util.js";

// GET /api/games?code=XXXXXX – Spiel per Beitritts-Code finden.
// Es gibt bewusst keine öffentliche Liste aller Spiele mehr.
export async function onRequestGet({ request, env }) {
  const code = codeFromRequest(request);
  if (!code) return json({ error: "Beitritts-Code fehlt" }, 400);
  const row = await env.DB.prepare(
    "SELECT id FROM games WHERE code = ?"
  ).bind(code).first();
  if (!row) return json({ error: "Kein Spiel mit diesem Code gefunden" }, 404);
  return json(await loadGame(env, row.id));
}

// POST /api/games – neues geteiltes Spiel anlegen (bekommt einen Code)
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

  let code = makeCode();
  for (let i = 0; i < 5; i++) {
    const exists = await env.DB.prepare("SELECT 1 FROM games WHERE code = ?").bind(code).first();
    if (!exists) break;
    code = makeCode();
  }

  const game = await env.DB.prepare(
    "INSERT INTO games (name, status, starter_index, turn_index, code) VALUES (?, ?, ?, ?, ?) RETURNING id"
  ).bind(name, status, starterIndex, turnIndex, code).first();

  const stmts = players.map((p, i) =>
    env.DB.prepare("INSERT INTO players (game_id, name, seat_order) VALUES (?, ?, ?)")
      .bind(game.id, p, i)
  );
  await env.DB.batch(stmts);

  return json({ id: game.id, code }, 201);
}
