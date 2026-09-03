-- Vorfall-Verlauf: eine Zeile je Statuswechsel (ok ↔ warn).
--
-- Bisher merkte sich app_config nur den LETZTEN Zustand — damit war die Frage
-- „war das am Dienstag wirklich ein Ausfall, und wie lange?" nachträglich
-- unbeantwortbar. Geschrieben wird ausschließlich bei einem Wechsel, also
-- ein paar Zeilen pro Monat, nicht pro Cron-Lauf.
CREATE TABLE IF NOT EXISTS ops_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  status  TEXT NOT NULL,          -- 'ok' | 'warn'
  reasons TEXT                    -- Warnungen, · getrennt (NULL bei 'ok')
);
CREATE INDEX IF NOT EXISTS idx_ops_log_id ON ops_log(id DESC);
