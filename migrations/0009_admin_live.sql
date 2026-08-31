-- Live-Räume (Heartbeat aus den Echtzeit-DOs) + Admin-Audit-Log.
-- live_room: jeder aktive Spielraum meldet sich; der DO löscht die Zeile beim
-- Leeren. Das Admin liest sie (mit Frische-Filter). Gleiche D1 wie Pages.
CREATE TABLE IF NOT EXISTS live_room (
  code       TEXT PRIMARY KEY,
  game       TEXT,
  players    INTEGER DEFAULT 0,
  state      TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_room_updated ON live_room(updated_at);

-- admin_log: Protokoll der geschützten Admin-Aktionen (Nachvollziehbarkeit).
CREATE TABLE IF NOT EXISTS admin_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_log_id ON admin_log(id DESC);
