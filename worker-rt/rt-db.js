// ====================================================================
// Geteilte D1-Helfer der Echtzeit-Räume. Ausgelagert aus index.js, damit
// base-room.js sie nutzen kann OHNE `cloudflare:workers` zu importieren —
// so bleibt die Raum-Basis in Node unit-testbar (tests/room.test.mjs).
// Alle Funktionen sind best-effort: ein DB-Fehler darf den Spielbetrieb nie
// stören.
// ====================================================================

// Fehler aus dem Echtzeit-Worker in dieselbe D1-Tabelle error_log schreiben,
// die auch die Pages-Seite nutzt — damit DO-Störungen im Betreiber-Dashboard
// sichtbar werden statt nur in `wrangler tail`.
export async function rtLogError(env, msg, page, extra) {
  try {
    if (!env || !env.DB) return;
    await env.DB.prepare("INSERT INTO error_log (msg, page, extra) VALUES (?, ?, ?)")
      .bind(String(msg == null ? "" : msg).slice(0, 500), page || "worker-rt",
            extra == null ? null : String(extra).slice(0, 1000)).run();
  } catch (_) { /* Logging darf nie zum Problem werden */ }
}

// Live-Raum-Heartbeat: aktive Spielräume melden sich in D1 (live_room), damit das
// Admin-Dashboard laufende Spiele + Spielerzahl sieht. Beim Leeren löscht der Raum
// seine Zeile.
export async function rtTouchRoom(env, code, game, players, state) {
  try {
    if (!env || !env.DB || !code) return;
    await env.DB.prepare(
      "INSERT INTO live_room (code, game, players, state, updated_at) VALUES (?, ?, ?, ?, datetime('now')) " +
      "ON CONFLICT(code) DO UPDATE SET game = excluded.game, players = excluded.players, state = excluded.state, updated_at = datetime('now')"
    ).bind(code, game, players | 0, String(state || "").slice(0, 16)).run();
  } catch (_) { /* egal */ }
}
export async function rtDropRoom(env, code) {
  try { if (env && env.DB && code) await env.DB.prepare("DELETE FROM live_room WHERE code = ?").bind(code).run(); } catch (_) { /* egal */ }
}
