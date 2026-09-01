-- Client-Fehlermeldungen (/api/log) in EIGENE Tabelle trennen. Bisher landeten
-- sie in error_log und der 1000-Zeilen-Trim dort konnte echte Server-Fehler und
-- gemeldete Quiz-Fragen (page='quiz-report') verdrängen — ein Angreifer hätte das
-- Admin-Dashboard so blenden können. Getrennt kann Client-Rauschen niemanden
-- mehr aus dem eigentlichen Fehler-Log kippen.
CREATE TABLE IF NOT EXISTS client_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  msg        TEXT,
  page       TEXT,
  ua         TEXT,
  extra      TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_client_log_id ON client_log(id DESC);
