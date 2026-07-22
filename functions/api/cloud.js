import { json } from "./_util.js";

// ====================================================================
// Cloud-Backup der Spielstände (plattformweit).
//
//   POST /api/cloud   { code?, data }   → { ok, code, updated_at }
//   GET  /api/cloud?code=XXXXXXXX       → { data, updated_at }
//
// Kein Login: der Code IST das Geheimnis. Er sichert einen kompletten
// localStorage-Schnappschuss (alle Spielstände, Rekorde, Abzeichen,
// Profil) und stellt ihn auf einem anderen Gerät wieder her.
// Codes sind 8-stellig aus einem 30er-Alphabet (≈6·10^11 Möglichkeiten),
// Brute-Force über HTTP ist damit praktisch aussichtslos.
// ====================================================================

const MAX_BYTES = 300_000;                 // ~300 KB pro Backup
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // ohne 0/O/1/I/L
const CODE_RE = /^[A-Z0-9]{6,12}$/;

function newCode() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return [...a].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => ({}));

  let code = String(b.code || "").trim().toUpperCase();
  if (code && !CODE_RE.test(code)) return json({ error: "Ungültiger Code" }, 400);

  const data = typeof b.data === "string" ? b.data : JSON.stringify(b.data || {});
  if (!data || data === "{}") return json({ error: "Nichts zu sichern" }, 400);
  if (data.length > MAX_BYTES) return json({ error: "Backup zu groß" }, 413);

  if (!code) code = newCode();

  await env.DB.prepare(
    `INSERT INTO cloud_saves (code, data, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(code) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`
  ).bind(code, data).run();

  const row = await env.DB.prepare(
    "SELECT updated_at FROM cloud_saves WHERE code = ?"
  ).bind(code).first();

  return json({ ok: true, code, updated_at: row ? row.updated_at : null });
}

export async function onRequestGet({ request, env }) {
  const code = String(new URL(request.url).searchParams.get("code") || "").trim().toUpperCase();
  if (!CODE_RE.test(code)) return json({ error: "Ungültiger Code" }, 400);

  const row = await env.DB.prepare(
    "SELECT data, updated_at FROM cloud_saves WHERE code = ?"
  ).bind(code).first();
  if (!row) return json({ error: "Kein Backup unter diesem Code gefunden" }, 404);

  return json({ data: row.data, updated_at: row.updated_at });
}
