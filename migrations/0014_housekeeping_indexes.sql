-- Indizes für die Spalten, nach denen im Minutentakt gefiltert wird.
--
-- Befund: Der Fire-Cron läuft alle 2 Minuten (720×/Tag) und stellte dabei
-- jedes Mal Abfragen, deren WHERE-Spalte keinen Index hatte — SQLite muss
-- dann die ganze Tabelle lesen. Das ist der eigentliche Grund, warum das
-- D1-Leselimit bei ~50 % lag, obwohl kaum jemand spielt: verbraucht hat es
-- die Uhr, nicht die Spieler.
--
--   error_log.created_at     → COUNT(*) im 15-Minuten-Fenster (Ampel/Alarm),
--                              Tabelle hält 1000 Zeilen → ~720.000 Zeilen/Tag
--   push_queue.created_at    → tägliche Aufräum-Löschung, lief pro Lauf
--   fire_seen.at             → dito (2-Tage-Löschung)
--   sprit_price_log.day      → 30-Tage-Löschung; der Primärschlüssel ist
--                              (station_id, fuel, day), für "WHERE day < ?"
--                              also nutzlos (day steht an dritter Stelle)
--
-- Indizes kosten beim Schreiben etwas. Alle vier Tabellen werden aber selten
-- geschrieben und häufig nach genau dieser Spalte gefiltert — der Tausch geht
-- klar in unsere Richtung.

CREATE INDEX IF NOT EXISTS idx_error_log_created   ON error_log(created_at);
CREATE INDEX IF NOT EXISTS idx_client_log_created  ON client_log(created_at);
CREATE INDEX IF NOT EXISTS idx_push_queue_created  ON push_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_fire_seen_at        ON fire_seen(at);
CREATE INDEX IF NOT EXISTS idx_sprit_price_log_day ON sprit_price_log(day);
