// Gemeinsame Helfer für die Würfelpoker-API (D1)

export const CAT_KEYS = ["9", "10", "B", "D", "K", "A", "S", "F", "P", "G"];
export const CAT_COUNT = CAT_KEYS.length;

export function json(data, status = 200) {
  return Response.json(data, { status });
}

// Client-IP hinter Cloudflare (Fallbacks für lokale Tests). IPv6 wird auf das
// /64-Präfix gekürzt: ein Anschluss bekommt meist ein ganzes /64 und könnte
// sonst durch Adresswechsel jede Drossel umgehen.
export function clientIp(request) {
  const ip = request.headers.get("CF-Connecting-IP") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "0.0.0.0";
  return ip.includes(":") ? ipv6Prefix64(ip) : ip;
}
export function ipv6Prefix64(ip) {
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return full.slice(0, 4).map(g => (g || "0").toLowerCase()).join(":") + "::/64";
}

// Schlüssel der rate-Tabelle ohne Klar-IP: SHA-256 über Tagessalz + Schlüssel.
// Das Salz wechselt täglich (alle Fenster sind ≤ 1 Minute, der Wechsel stört
// also nicht) und hängt am Server-Secret — die Hashes lassen sich damit nicht
// per Durchprobieren aller IPv4-Adressen zurückrechnen.
async function rateKey(env, key) {
  const salt = String((env && (env.SCORE_SECRET || env.ADMIN_KEY)) || "") + new Date().toISOString().slice(0, 10);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + "|" + key)));
  const p = key.indexOf(":");
  return (p > 0 ? key.slice(0, p + 1) : "") + [...d.slice(0, 12)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Einfaches Rate-Limit über die gemeinsame Tabelle `rate`.
// true  = Anfrage erlaubt (unter dem Limit), false = drosseln.
// Fehlertolerant: bei DB-Problemen wird NIE blockiert.
export async function rateLimit(env, key, max, windowSec) {
  try {
    const k = await rateKey(env, key);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM rate WHERE k = ? AND at > datetime('now', ?)"
    ).bind(k, `-${windowSec} seconds`).first();
    if (row && row.n >= max) return false;
    await env.DB.prepare("INSERT INTO rate (k) VALUES (?)").bind(k).run();
    // Nur gelegentlich alte Einträge wegräumen (statt bei JEDEM Request drei
    // Schreibvorgänge auf die einzige D1 zu jagen). Alle Fenster sind ≤ 1 Minute
    // → 10 Minuten reichen; idx_rate_at (0016) macht das zur Bereichssuche statt
    // zum Vollscan, dessen Kosten vorher quadratisch mit dem Verkehr wuchsen.
    if (Math.random() < 0.02) {
      await env.DB.prepare("DELETE FROM rate WHERE at < datetime('now', '-10 minutes')").run();
    }
    return true;
  } catch (e) { await logError(env, "rateLimit fehlgeschlagen (Drossel übersprungen)", "rate", e && e.message); return true; }
}

// Kleine D1-Lese-Helfer (früher privat in admin.js). one() = eine Zeile oder
// null; many() = Ergebnis-Array. Beide fehlertolerant.
export async function one(env, sql, ...args) {
  try { return await env.DB.prepare(sql).bind(...args).first(); } catch { return null; }
}
export async function many(env, sql, ...args) {
  try { return (await env.DB.prepare(sql).bind(...args).all()).results || []; } catch { return []; }
}

// EINE Quelle für die Wochen-/Tages-Buckets, damit Bestenliste (scores) und
// Saison-Liga (season) nie auseinanderlaufen. Achtung: %Y-%W ist die Montags-
// Woche von SQLite (NICHT die ISO-Woche) — bewusst konsistent überall gleich.
// mod = optionaler strftime-Modifier, z. B. ",'-7 days'" für die Vorwoche.
export function weekMatch(col = "created_at", mod = "") { return `strftime('%Y-%W', ${col}) = strftime('%Y-%W','now'${mod})`; }
export function dayMatch(col = "created_at", mod = "") { return `date(${col}) = date('now'${mod})`; }

// Häufig gebrauchte Eingabe-Validatoren (früher in scores/push/party dupliziert).
export const DEVICE_RE = /^[A-Za-z0-9_-]{8,40}$/;
export function isDevice(s) { return typeof s === "string" && DEVICE_RE.test(s); }

// ---------- Spielername ----------
// Ein Name gilt für alle Spiele und erscheint in den Bestenlisten. Die Regeln
// stehen hier, damit Begrüßung (/api/name) und Einsendung (/api/scores/*)
// nicht auseinanderlaufen.
export const NAME_MAX = 16;
// Buchstaben aller Sprachen (also auch Umlaute), Zahlen, Leerzeichen und
// . _ - ' — bewusst OHNE Emoji: die sehen in Bestenlisten je Gerät anders aus
// und lassen sich nicht vorlesen.
const NAME_ALLOWED = /^[\p{L}\p{N} ._'-]+$/u;
const NAME_RESERVED = new Set([
  "anonym", "admin", "administrator", "betreiber", "system", "server",
  "gast", "guest", "null", "undefined", "spieleabend",
]);

// → null wenn in Ordnung, sonst ein Satz, der dem Menschen sagt was fehlt.
export function nameProblem(raw) {
  const n = String(raw == null ? "" : raw).trim();
  if (n.length < 2) return "Mindestens 2 Zeichen.";
  if (n.length > NAME_MAX) return `Höchstens ${NAME_MAX} Zeichen.`;
  if (!NAME_ALLOWED.test(n)) return "Erlaubt sind Buchstaben, Zahlen, Leerzeichen und . _ - '";
  if (!/\p{L}/u.test(n)) return "Mindestens ein Buchstabe muss dabei sein.";
  if (/ {2}/.test(n)) return "Keine doppelten Leerzeichen.";
  if (NAME_RESERVED.has(n.toLowerCase())) return "Dieser Name ist reserviert — nimm einen anderen.";
  return null;
}

// Wem gehört ein Name? Regel (unverändert): dem Gerät, das ihn zuerst in eine
// Bestenliste eingetragen hat. → Geräte-Kennung oder null (= frei).
export async function nameOwner(env, name) {
  const row = await env.DB.prepare(
    "SELECT device FROM scores WHERE LOWER(name) = LOWER(?) AND device IS NOT NULL ORDER BY id LIMIT 1"
  ).bind(String(name == null ? "" : name).trim()).first();
  return (row && row.device) || null;
}

// Server-seitiges Fehler-Logging in die bestehende D1-Tabelle `error_log`.
// Best-effort: darf den Aufrufer NIE stören (leerer catch). Ersetzt stumme
// `catch (_) {}`, damit man Störungen im Betrieb überhaupt sehen kann.
export async function logError(env, msg, page, extra) {
  try {
    if (!env || !env.DB) return;
    await env.DB.prepare("INSERT INTO error_log (msg, page, extra) VALUES (?, ?, ?)")
      .bind(String(msg == null ? "" : msg).slice(0, 500), page || null,
            extra == null ? null : String(extra).slice(0, 1000)).run();
  } catch (_) { /* Logging selbst darf nie zum Problem werden */ }
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
