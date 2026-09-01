import { json, clientIp, rateLimit } from "./_util.js";

// ====================================================================
// Anonymer Fehler-Melder. Der Client (theme.js) schickt bei einem
// JS-Fehler eine kurze Meldung hierher — so fallen Defekte auf fremden
// Geräten auf, statt unbemerkt zu bleiben.
//
//   POST /api/log   { msg, page?, ua?, extra? }
//
// Ansehen (nur du, lokal, oder im Admin-Panel unter „Client-Fehler"):
//   npx wrangler d1 execute wuerfelpoker --remote \
//     --command "SELECT created_at,page,msg,extra FROM client_log ORDER BY id DESC LIMIT 50;"
//
// Eigene Tabelle client_log (NICHT error_log): so kann eine Flut an Client-
// Meldungen weder echte Server-Fehler noch gemeldete Quiz-Fragen verdrängen.
// Selbstbegrenzend: es werden nur die letzten ~1000 Einträge behalten.
// ====================================================================

const KEEP = 1000;

export async function onRequestPost({ request, env }) {
  // Drossel gegen Log-Fluten: max. 40 Meldungen pro Minute und IP
  if (!(await rateLimit(env, "log:" + clientIp(request), 40, 60))) {
    return json({ ok: false }, 429);
  }

  const b = await request.json().catch(() => ({}));
  const msg = String(b.msg || "").slice(0, 300).trim();
  if (!msg) return json({ ok: false }, 400);
  const page = String(b.page || "").slice(0, 120);
  const ua = String(b.ua || "").slice(0, 200);
  const extra = String(b.extra || "").slice(0, 200);

  try {
    await env.DB.prepare(
      "INSERT INTO client_log (msg, page, ua, extra) VALUES (?, ?, ?, ?)"
    ).bind(msg, page, ua, extra).run();
    // Alte Einträge kappen (billiger indizierter Delete) — nur die eigene Tabelle.
    await env.DB.prepare(
      "DELETE FROM client_log WHERE id <= (SELECT MAX(id) FROM client_log) - ?"
    ).bind(KEEP).run();
  } catch (_) { /* Logging darf nie den Client stören */ }

  return json({ ok: true });
}
