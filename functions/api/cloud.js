import { json, clientIp, rateLimit } from "./_util.js";

// ====================================================================
// Cloud-Backup der Spielstände (plattformweit).
//
//   POST /api/cloud   { code?, data, writer? }  → { ok, code, updated_at, writer }
//   GET  /api/cloud?code=XXXXXXXX               → { data, updated_at, writer }
//
// Kein Login: der Code IST das Geheimnis. Er sichert einen kompletten
// localStorage-Schnappschuss und stellt ihn auf einem anderen Gerät wieder her.
// Codes sind 8-stellig aus einem 30er-Alphabet (≈6·10^11 Möglichkeiten).
//
// "writer" = zufällige, gerätelokale Kennung des zuletzt sichernden Geräts.
// Damit kann der Client erkennen, ob der jüngste Cloud-Stand von einem
// ANDEREN Gerät kommt (→ Angebot zum Laden) oder vom eigenen (→ still).
// ====================================================================

const MAX_BYTES = 300_000;                 // ~300 KB pro Backup
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // ohne 0/O/1/I/L
const CODE_RE = /^[A-Z0-9]{6,12}$/;
const WRITER_RE = /^[a-z0-9]{6,40}$/;

function newCode() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return [...a].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export async function onRequestPost({ request, env }) {
  // Schreib-Drossel: max. 40 Sicherungen pro Minute und IP
  if (!(await rateLimit(env, "cloudw:" + clientIp(request), 40, 60))) {
    return json({ error: "Zu viele Sicherungen — kurz warten" }, 429);
  }

  const b = await request.json().catch(() => ({}));

  let code = String(b.code || "").trim().toUpperCase();
  if (code && !CODE_RE.test(code)) return json({ error: "Ungültiger Code" }, 400);

  const writer = String(b.writer || "").trim();
  if (writer && !WRITER_RE.test(writer)) return json({ error: "Ungültiger Absender" }, 400);

  const data = typeof b.data === "string" ? b.data : JSON.stringify(b.data || {});
  if (!data || data === "{}") return json({ error: "Nichts zu sichern" }, 400);
  if (data.length > MAX_BYTES) return json({ error: "Backup zu groß" }, 413);

  if (!code) code = newCode();

  // Beim Überschreiben wird die bisherige Version als prev_* aufbewahrt —
  // so lässt sich ein versehentliches/böswilliges Überschreiben rückgängig machen.
  await env.DB.prepare(
    `INSERT INTO cloud_saves (code, data, device, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(code) DO UPDATE SET
       prev_data = cloud_saves.data, prev_at = cloud_saves.updated_at,
       data = excluded.data, device = excluded.device, updated_at = datetime('now')`
  ).bind(code, data, writer || null).run();

  const row = await env.DB.prepare(
    "SELECT updated_at, device FROM cloud_saves WHERE code = ?"
  ).bind(code).first();

  return json({ ok: true, code, updated_at: row ? row.updated_at : null, writer: row ? row.device : null });
}

export async function onRequestGet({ request, env }) {
  // Lese-Drossel: bremst das Durchprobieren von Codes (max. 60/min/IP)
  if (!(await rateLimit(env, "cloudr:" + clientIp(request), 60, 60))) {
    return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
  }

  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") || "").trim().toUpperCase();
  if (!CODE_RE.test(code)) return json({ error: "Ungültiger Code" }, 400);

  const row = await env.DB.prepare(
    "SELECT data, updated_at, device, prev_data, prev_at FROM cloud_saves WHERE code = ?"
  ).bind(code).first();
  if (!row) return json({ error: "Kein Backup unter diesem Code gefunden" }, 404);

  // Vorherige Version anfordern (1-Schritt-Wiederherstellung)
  if (url.searchParams.get("prev") === "1") {
    if (!row.prev_data) return json({ error: "Keine vorherige Version vorhanden" }, 404);
    return json({ data: row.prev_data, updated_at: row.prev_at, prev: true });
  }

  return json({ data: row.data, updated_at: row.updated_at, writer: row.device, hasPrev: !!row.prev_data, prev_at: row.prev_at || null });
}
