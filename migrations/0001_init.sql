-- 0001_init — Baseline-Schema der Gamesite (Cloudflare D1).
-- IDEMPOTENT & ADDITIV: alles CREATE ... IF NOT EXISTS, KEINE DROPs.
-- Sicher gegen eine bestehende Produktions-DB anwendbar (wird dort zum No-op).
-- Ausrollen:  wrangler d1 migrations apply wuerfelpoker --remote
-- (Lokales Zurücksetzen NUR mit reset-dev.sql — das enthält die DROPs.)

-- ── Würfelpoker (Escalero) — das einzige relational modellierte Feature ──
CREATE TABLE IF NOT EXISTS games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT,
  status        TEXT NOT NULL DEFAULT 'starter',  -- starter | active | round_end | finished
  cols          INTEGER NOT NULL DEFAULT 1,
  round         INTEGER NOT NULL DEFAULT 1,
  starter_index INTEGER,
  turn_index    INTEGER,
  code          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_code ON games(code);

CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  seat_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cells (
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
CREATE INDEX IF NOT EXISTS idx_players_game ON players(game_id);
CREATE INDEX IF NOT EXISTS idx_cells_game   ON cells(game_id);

-- ── Gemeinsame Bestenliste aller Spiele (functions/api/scores/) ──
CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game       TEXT NOT NULL,               -- z. B. "galopp", "galopp:daily"
  name       TEXT NOT NULL,
  device     TEXT,
  score      INTEGER NOT NULL,
  meta       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scores_game_score ON scores(game, score);
CREATE INDEX IF NOT EXISTS idx_scores_device ON scores(device, created_at);
CREATE INDEX IF NOT EXISTS idx_scores_game_lname ON scores(game, lower(name));
CREATE INDEX IF NOT EXISTS idx_scores_lname ON scores(lower(name));

-- ── Anti-Cheat / Moderation (querschnittlich) ──
CREATE TABLE IF NOT EXISTS used_token (
  jti TEXT PRIMARY KEY,
  at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS banned_device (
  device TEXT PRIMARY KEY,
  at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rate (
  k  TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rate_k_at ON rate(k, at);

-- ── Betrieb ──
CREATE TABLE IF NOT EXISTS app_config (
  k TEXT PRIMARY KEY,
  v TEXT
);
CREATE TABLE IF NOT EXISTS error_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  msg        TEXT NOT NULL,
  page       TEXT,
  ua         TEXT,
  extra      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Kritzeln & Raten — dauerhafte Bestenliste (autoritativ vom DrawRoom-DO) ──
CREATE TABLE IF NOT EXISTS draw_score (
  name       TEXT PRIMARY KEY COLLATE NOCASE,
  points     INTEGER NOT NULL DEFAULT 0,
  games      INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  best       INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_draw_score_points ON draw_score(points);

-- ── Cloud-Backup der Spielstände (functions/api/cloud.js) ──
CREATE TABLE IF NOT EXISTS cloud_saves (
  code       TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  device     TEXT,
  prev_data  TEXT,
  prev_at    TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Spieleabend-Raum / Party (functions/api/party.js) ──
CREATE TABLE IF NOT EXISTS party (
  code       TEXT PRIMARY KEY,
  games      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS party_member (
  code      TEXT NOT NULL,
  name      TEXT NOT NULL,
  device    TEXT,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (code, name COLLATE NOCASE)
);
CREATE TABLE IF NOT EXISTS party_score (
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  game       TEXT NOT NULL,
  score      INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (code, name, game)
);
CREATE TABLE IF NOT EXISTS party_reaction (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_party_reaction ON party_reaction(code, id);

-- ── Web-Push (functions/api/push.js) ──
CREATE TABLE IF NOT EXISTS push_sub (
  endpoint   TEXT PRIMARY KEY,
  name       TEXT,
  p256dh     TEXT,
  auth       TEXT,
  device     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Lookup ist WHERE lower(name)=? → Ausdrucks-Index (siehe 0002).
CREATE INDEX IF NOT EXISTS idx_push_sub_lname ON push_sub(lower(name));
CREATE TABLE IF NOT EXISTS push_queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint   TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  url        TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_queue_ep ON push_queue(endpoint, id);

-- ── Feuerwehr NÖ (/fire/noe) — abgekapseltes Feature ──
CREATE TABLE IF NOT EXISTS geo_cache (
  q    TEXT PRIMARY KEY,
  lat  REAL,
  lng  REAL,
  miss INTEGER DEFAULT 0,
  at   TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sprit_cache (
  k    TEXT PRIMARY KEY,
  data TEXT,
  at   TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS fire_alert (
  endpoint TEXT NOT NULL,
  bezirk   TEXT NOT NULL,
  at       TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (endpoint, bezirk)
);
CREATE INDEX IF NOT EXISTS idx_fire_alert_bez ON fire_alert(bezirk);
CREATE TABLE IF NOT EXISTS fire_seen (
  n  TEXT PRIMARY KEY,
  at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS fire_op (
  n           TEXT PRIMARY KEY,
  m           TEXT,
  a           TEXT,
  o           TEXT,
  o2          TEXT,
  b           TEXT,
  plz         TEXT,
  d           TEXT,
  t           TEXT,
  dispo       TEXT,
  last_detail TEXT,
  rolled      INTEGER DEFAULT 0,
  first_seen  TEXT DEFAULT CURRENT_TIMESTAMP,
  last_seen   TEXT DEFAULT CURRENT_TIMESTAMP,
  ended       INTEGER DEFAULT 0,
  ended_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_fire_op_ended ON fire_op(ended, ended_at);
CREATE TABLE IF NOT EXISTS fire_health (
  k              TEXT PRIMARY KEY,
  last_run       TEXT,
  active         INTEGER,
  detail_fetched INTEGER,
  note           TEXT
);
CREATE TABLE IF NOT EXISTS fire_stat_daily (
  day     TEXT NOT NULL,
  b       TEXT NOT NULL,
  kind    TEXT NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  dur_sum INTEGER NOT NULL DEFAULT 0,
  dur_n   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, b, kind)
);
CREATE INDEX IF NOT EXISTS idx_fire_stat_day ON fire_stat_daily(day);
