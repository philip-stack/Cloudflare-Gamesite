-- Escalero / Würfelpoker – Verrechnungsblatt
-- Achtung: löscht die alten Tabellen (altes Spielmodell) und legt sie neu an.

DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS cells;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS games;

CREATE TABLE games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT,
  status        TEXT NOT NULL DEFAULT 'starter',  -- starter | active | finished
  starter_index INTEGER,                          -- Sitzplatz-Index des Startspielers
  turn_index    INTEGER,                          -- Sitzplatz-Index des aktuellen Spielers
  code          TEXT,                             -- Beitritts-Code (geteilte Spiele)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_games_code ON games(code);

CREATE TABLE players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  seat_order INTEGER NOT NULL
);

CREATE TABLE cells (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,   -- Reihenfolge der Einträge (für Undo)
  game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cat_key   TEXT NOT NULL,                        -- 9 10 B D K A S F P G
  kind      TEXT NOT NULL,                        -- score | strike
  value     INTEGER NOT NULL,
  serviert  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (player_id, cat_key)
);

CREATE INDEX idx_players_game ON players(game_id);
CREATE INDEX idx_cells_game   ON cells(game_id);

-- Funkelfeld – globale Bestenliste (Tabellenname historisch "blockblast_scores")
CREATE TABLE IF NOT EXISTS blockblast_scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  score      INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bb_score ON blockblast_scores(score);

-- Komet – globale Bestenliste
CREATE TABLE IF NOT EXISTS komet_scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  score      INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_komet_score ON komet_scores(score);

-- Sternensturm – globale Bestenliste
CREATE TABLE IF NOT EXISTS sternensturm_scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  score      INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sturm_score ON sternensturm_scores(score);
