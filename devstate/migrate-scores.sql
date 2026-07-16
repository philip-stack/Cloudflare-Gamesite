-- Migration: eine gemeinsame scores-Tabelle für alle Spiele.
-- Altdaten werden übernommen; die alten *_scores-Tabellen bleiben
-- unangetastet als Backup stehen (werden nicht mehr gelesen).
CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game       TEXT NOT NULL,               -- z. B. "galopp", "galopp:daily"
  name       TEXT NOT NULL,
  device     TEXT,                        -- Geräte-Token (Rate-Limit, Namensschutz)
  score      INTEGER NOT NULL,
  meta       TEXT,                        -- Spielstatistik (Plausibilitätsprüfung)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scores_game_score ON scores(game, score);
CREATE INDEX IF NOT EXISTS idx_scores_device ON scores(device, created_at);

-- Idempotent: nur kopieren, wenn das Spiel noch keine Zeilen hat
INSERT INTO scores (game, name, score, created_at)
  SELECT 'funkelfeld', name, score, created_at FROM blockblast_scores
  WHERE NOT EXISTS (SELECT 1 FROM scores WHERE game = 'funkelfeld');
INSERT INTO scores (game, name, score, created_at)
  SELECT 'komet', name, score, created_at FROM komet_scores
  WHERE NOT EXISTS (SELECT 1 FROM scores WHERE game = 'komet');
INSERT INTO scores (game, name, score, created_at)
  SELECT 'sternensturm', name, score, created_at FROM sternensturm_scores
  WHERE NOT EXISTS (SELECT 1 FROM scores WHERE game = 'sternensturm');
INSERT INTO scores (game, name, score, created_at)
  SELECT 'galopp', name, score, created_at FROM galopp_scores
  WHERE NOT EXISTS (SELECT 1 FROM scores WHERE game = 'galopp');
