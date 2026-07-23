// Gemeinsame Helfer für die Würfelpoker-API (D1)

export const CAT_KEYS = ["9", "10", "B", "D", "K", "A", "S", "F", "P", "G"];
export const CAT_COUNT = CAT_KEYS.length;

export function json(data, status = 200) {
  return Response.json(data, { status });
}

// Client-IP hinter Cloudflare (Fallbacks für lokale Tests)
export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "0.0.0.0";
}

// Einfaches Rate-Limit über die gemeinsame Tabelle `rate`.
// true  = Anfrage erlaubt (unter dem Limit), false = drosseln.
// Fehlertolerant: bei DB-Problemen wird NIE blockiert.
export async function rateLimit(env, key, max, windowSec) {
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM rate WHERE k = ? AND at > datetime('now', ?)"
    ).bind(key, `-${windowSec} seconds`).first();
    if (row && row.n >= max) return false;
    await env.DB.prepare("INSERT INTO rate (k) VALUES (?)").bind(key).run();
    // gelegentlich alte Einträge wegräumen (kleine Tabelle halten)
    await env.DB.prepare("DELETE FROM rate WHERE at < datetime('now', '-1 day')").run();
    return true;
  } catch { return true; }
}

// 6-stelliger Beitritts-Code ohne verwechselbare Zeichen (0/O, 1/I/L)
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function makeCode() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return [...a].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function codeFromRequest(request) {
  const code = new URL(request.url).searchParams.get("code");
  return code ? code.trim().toUpperCase() : null;
}

// Echtzeit-Signal an alle Clients eines Party-Raums: sagt dem Durable Object
// (Klasse PartyRoom in party-live.js), allen Verbundenen "neu laden" zu senden.
// Bewusst hier (ohne cloudflare:workers-Import), damit party.js es einbinden
// kann, ohne die DO-Runtime in die Node-Tests zu ziehen. Ohne Binding: No-op.
export async function broadcastParty(env, code) {
  try {
    if (!env || !env.PARTY_ROOM) return;
    const stub = env.PARTY_ROOM.get(env.PARTY_ROOM.idFromName(code));
    await stub.fetch("https://do/broadcast");
  } catch (_) { /* Echtzeit ist optional — nie den Aufrufer stören */ }
}

// Zugriff nur mit passendem Code – Spiele ohne Code sind nie erreichbar.
export async function authGame(env, id, request) {
  const code = codeFromRequest(request);
  if (!code) return null;
  const g = await env.DB.prepare(
    "SELECT id, code, status, cols, round FROM games WHERE id = ?"
  ).bind(Number(id)).first();
  if (!g || !g.code || g.code !== code) return null;
  return g;
}

// Lädt ein Spiel inkl. Spieler und Zellen und bringt es in die Form,
// die das Frontend erwartet.
export async function loadGame(env, id) {
  const game = await env.DB.prepare(
    "SELECT id, name, status, cols, round, starter_index, turn_index, created_at, code FROM games WHERE id = ?"
  ).bind(id).first();
  if (!game) return null;

  const players = (await env.DB.prepare(
    "SELECT id, name, seat_order FROM players WHERE game_id = ? ORDER BY seat_order"
  ).bind(id).all()).results;

  const cellRows = (await env.DB.prepare(
    "SELECT player_id, round, col, cat_key, kind, value, serviert FROM cells WHERE game_id = ?"
  ).bind(id).all()).results;

  // cells[pid][runde][spalte][kategorie] = { kind, v, serviert }
  const cells = {};
  for (const p of players) cells[p.id] = {};
  for (const c of cellRows) {
    (((cells[c.player_id] ||= {})[c.round] ||= {})[c.col] ||= {})[c.cat_key] = {
      kind: c.kind,
      v: c.value,
      serviert: !!c.serviert,
    };
  }

  return {
    id: game.id,
    name: game.name,
    code: game.code,
    status: game.status,
    cols: game.cols,
    round: game.round,
    starterIndex: game.starter_index,
    turnIndex: game.turn_index,
    createdAt: game.created_at,
    players,
    cells,
  };
}

// Anzahl gefüllter Zellen einer Runde – für die "Runde fertig?"-Erkennung.
export async function cellCount(env, gameId, round) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM cells WHERE game_id = ? AND round = ?"
  ).bind(gameId, round).first();
  return row.n;
}
