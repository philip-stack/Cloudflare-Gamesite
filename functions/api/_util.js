// Gemeinsame Helfer für die Würfelpoker-API (D1)

export const CAT_KEYS = ["9", "10", "B", "D", "K", "A", "S", "F", "P", "G"];
export const CAT_COUNT = CAT_KEYS.length;

export function json(data, status = 200) {
  return Response.json(data, { status });
}

// Lädt ein Spiel inkl. Spieler und Zellen und bringt es in die Form,
// die das Frontend erwartet.
export async function loadGame(env, id) {
  const game = await env.DB.prepare(
    "SELECT id, name, status, starter_index, turn_index, created_at FROM games WHERE id = ?"
  ).bind(id).first();
  if (!game) return null;

  const players = (await env.DB.prepare(
    "SELECT id, name, seat_order FROM players WHERE game_id = ? ORDER BY seat_order"
  ).bind(id).all()).results;

  const cellRows = (await env.DB.prepare(
    "SELECT player_id, cat_key, kind, value, serviert FROM cells WHERE game_id = ?"
  ).bind(id).all()).results;

  const cells = {};
  for (const p of players) cells[p.id] = {};
  for (const c of cellRows) {
    (cells[c.player_id] ||= {})[c.cat_key] = {
      kind: c.kind,
      v: c.value,
      serviert: !!c.serviert,
    };
  }

  return {
    id: game.id,
    name: game.name,
    status: game.status,
    starterIndex: game.starter_index,
    turnIndex: game.turn_index,
    createdAt: game.created_at,
    players,
    cells,
  };
}

// Anzahl gefüllter Zellen im Spiel – für die "fertig?"-Erkennung.
export async function cellCount(env, gameId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM cells WHERE game_id = ?"
  ).bind(gameId).first();
  return row.n;
}
