import { json, loadGame, makeCode, codeFromRequest, clientIp, rateLimit } from "../_util.js";

// GET /api/games?code=XXXXXX – Spiel per Beitritts-Code finden.
// Es gibt bewusst keine öffentliche Liste aller Spiele mehr.
export async function onRequestGet({ request, env }) {
  // Der Beitritts-Code ist die einzige Zugangshürde → Rate-Limit gegen
  // Durchprobieren (30 Codes/Minute pro IP; der Code-Raum ist riesig, echte
  // Beitritte liegen weit darunter).
  if (!(await rateLimit(env, "gamesjoin:" + clientIp(request), 30, 60))) {
    return json({ error: "Zu viele Versuche, kurz warten." }, 429);
  }
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
  // Anlegen ist anonym → Rate-Limit gegen Spam-Spiele (20/Minute pro IP).
  if (!(await rateLimit(env, "gamesnew:" + clientIp(request), 20, 60))) {
    return json({ error: "Zu viele neue Spiele, kurz warten." }, 429);
  }
  const body = await request.json().catch(() => ({}));
  const players = (body.players || []).map(p => String(p).trim().slice(0, 40)).filter(Boolean);
  if (players.length < 2) {
    return json({ error: "Mindestens 2 Spieler angeben" }, 400);
  }
  // Obergrenze: schützt den Batch-Insert vor missbräuchlich riesigen Listen
  // (ein realer Würfelpoker-Tisch bleibt weit darunter).
  if (players.length > 12) {
    return json({ error: "Höchstens 12 Spieler" }, 400);
  }

  const name = (body.name && String(body.name).trim()) || "Würfelpoker";
  const status = ["starter", "active", "finished"].includes(body.status) ? body.status : "starter";
  const starterIndex = Number.isInteger(body.starter_index) ? body.starter_index : null;
  const turnIndex = Number.isInteger(body.turn_index) ? body.turn_index : null;
  // Spalten pro Spieler: mind. 1, nach oben nur eine Vernunftgrenze
  const cols = Math.min(50, Math.max(1, Number.isInteger(body.cols) ? body.cols : 1));

  let code = makeCode();
  for (let i = 0; i < 5; i++) {
    const exists = await env.DB.prepare("SELECT 1 FROM games WHERE code = ?").bind(code).first();
    if (!exists) break;
    code = makeCode();
  }

  const game = await env.DB.prepare(
    "INSERT INTO games (name, status, cols, round, starter_index, turn_index, code) VALUES (?, ?, ?, 1, ?, ?, ?) RETURNING id"
  ).bind(name, status, cols, starterIndex, turnIndex, code).first();

  const stmts = players.map((p, i) =>
    env.DB.prepare("INSERT INTO players (game_id, name, seat_order) VALUES (?, ?, ?)")
      .bind(game.id, p, i)
  );
  await env.DB.batch(stmts);

  return json({ id: game.id, code }, 201);
}
