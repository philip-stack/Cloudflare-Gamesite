-- Migration: Würfelpoker auf Runden + Spalten (Rest der DB unberührt)
DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS cells;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS games;

CREATE TABLE games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT,
  status        TEXT NOT NULL DEFAULT 'starter',
  cols          INTEGER NOT NULL DEFAULT 1,
  round         INTEGER NOT NULL DEFAULT 1,
  starter_index INTEGER,
  turn_index    INTEGER,
  code          TEXT,
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
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  round     INTEGER NOT NULL DEFAULT 1,
  col       INTEGER NOT NULL DEFAULT 0,
  cat_key   TEXT NOT NULL,
  kind      TEXT NOT NULL,
  value     INTEGER NOT NULL,
  serviert  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (player_id, round, col, cat_key)
);

CREATE INDEX idx_players_game ON players(game_id);
CREATE INDEX idx_cells_game   ON cells(game_id);
