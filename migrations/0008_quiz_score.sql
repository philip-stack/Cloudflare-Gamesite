-- 0008_quiz_score — dauerhafte Bestenliste für „Quiz-Duell" (Live-Trivia).
-- Autoritativ vom QuizRoom-DO am Spielende gepflegt (analog draw_score).
-- Ein Name = eine Zeile, Punkte/Spiele/Siege/Bestleistung werden aggregiert.
CREATE TABLE IF NOT EXISTS quiz_score (
  name       TEXT PRIMARY KEY COLLATE NOCASE,
  points     INTEGER NOT NULL DEFAULT 0,
  games      INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  best       INTEGER NOT NULL DEFAULT 0,
  device     TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quiz_score_points ON quiz_score(points);
