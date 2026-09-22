-- Zwei Indizes gegen Vollscans, die mit dem Verkehr wuchsen.
--
--   rate.at                  → Aufräum-Löschung in rateLimit (_util.js). Der
--                              bestehende idx_rate_k_at beginnt mit k und hilft
--                              bei "WHERE at < ?" nicht: jede Aufräumrunde las
--                              die ganze Tabelle, und die wächst selbst mit dem
--                              Verkehr → Lesekosten quadratisch.
--   scores(game, created_at) → Saison-Liga & Wochen-/Tagesfenster: filtern nach
--                              Spiel + Zeitraum (season.js grenzt dafür jetzt
--                              zusätzlich per created_at-Bereich ein).

CREATE INDEX IF NOT EXISTS idx_rate_at              ON rate(at);
CREATE INDEX IF NOT EXISTS idx_scores_game_created  ON scores(game, created_at);
