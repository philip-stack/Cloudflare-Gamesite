-- Rennticker (/f1/): dauerhafte Kopien von OpenF1-Daten für die Zeit, in der
-- OpenF1 gesperrt ist (während jeder Live-Session für Gratis-Nutzer) oder
-- ausfällt. Der Cron füllt die Tabelle selbst: Kalender (k = "openf1/<URL>")
-- und jedes fertige Rennen/Sprint als Paket (k = "bundle/<session_key>").
-- body = gzip-komprimiertes JSON. Nur öffentliche Renndaten, keine Nutzerdaten.
CREATE TABLE IF NOT EXISTS f1_cache (
  k    TEXT PRIMARY KEY,
  body BLOB NOT NULL,
  at   TEXT NOT NULL DEFAULT (datetime('now'))
);
