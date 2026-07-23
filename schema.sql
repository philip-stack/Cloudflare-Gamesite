-- Escalero / Würfelpoker – Verrechnungsblatt
-- Achtung: löscht die alten Tabellen (altes Spielmodell) und legt sie neu an.

DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS cells;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS games;

CREATE TABLE games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT,
  status        TEXT NOT NULL DEFAULT 'starter',  -- starter | active | round_end | finished
  cols          INTEGER NOT NULL DEFAULT 1,       -- Spalten (Blätter) pro Spieler
  round         INTEGER NOT NULL DEFAULT 1,       -- aktuelle Runde (1-basiert)
  starter_index INTEGER,                          -- Sitzplatz-Index des Startspielers (der Runde)
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
  round     INTEGER NOT NULL DEFAULT 1,           -- Runde, zu der der Eintrag gehört
  col       INTEGER NOT NULL DEFAULT 0,           -- Spalte (0-basiert)
  cat_key   TEXT NOT NULL,                        -- 9 10 B D K A S F P G
  kind      TEXT NOT NULL,                        -- score | strike
  value     INTEGER NOT NULL,
  serviert  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (player_id, round, col, cat_key)
);

CREATE INDEX idx_players_game ON players(game_id);
CREATE INDEX idx_cells_game   ON cells(game_id);

-- Gemeinsame Bestenliste aller Spiele (Details: functions/api/scores/)
CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game       TEXT NOT NULL,               -- z. B. "galopp", "galopp:daily"
  name       TEXT NOT NULL,
  device     TEXT,                        -- Geraete-Token (Rate-Limit, Namensschutz)
  score      INTEGER NOT NULL,
  meta       TEXT,                        -- Spielstatistik (Plausibilitaetspruefung)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scores_game_score ON scores(game, score);
CREATE INDEX IF NOT EXISTS idx_scores_device ON scores(device, created_at);

-- Cloud-Backup der Spielstände (plattformweit, Details: functions/api/cloud.js)
CREATE TABLE IF NOT EXISTS cloud_saves (
  code       TEXT PRIMARY KEY,            -- portabler 8-stelliger Backup-Code
  data       TEXT NOT NULL,               -- localStorage-Schnappschuss (JSON)
  device     TEXT,                        -- Kennung des zuletzt sichernden Geraets (writer)
  prev_data  TEXT,                        -- vorherige Version (1-Schritt-Wiederherstellung)
  prev_at    TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Spieleabend-Raum / Party (Details: functions/api/party.js)
CREATE TABLE IF NOT EXISTS party (
  code       TEXT PRIMARY KEY,            -- 6-stelliger Raum-Code
  games      TEXT NOT NULL,               -- JSON-Array der gewählten Spiele
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS party_member (
  code      TEXT NOT NULL,
  name      TEXT NOT NULL,
  device    TEXT,                          -- Gerät, dem der Name im Raum gehört
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (code, name)
);
CREATE TABLE IF NOT EXISTS party_score (
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  game       TEXT NOT NULL,
  score      INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (code, name, game)
);
-- Kurzlebige Emoji-Reaktionen im Raum (Live-Feed, selbst-beschränkt)
CREATE TABLE IF NOT EXISTS party_reaction (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_party_reaction ON party_reaction(code, id);

-- Rate-Limit-Buckets (Details: rateLimit() in functions/api/_util.js)
CREATE TABLE IF NOT EXISTS rate (
  k  TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rate_k_at ON rate(k, at);

-- Web-Push: Abos + kurzlebige Nachrichten-Warteschlange (Details: functions/api/push.js)
CREATE TABLE IF NOT EXISTS push_sub (
  endpoint   TEXT PRIMARY KEY,            -- Push-Endpoint des Browsers (eindeutig)
  name       TEXT,                        -- Bestenlisten-Name beim Abonnieren
  p256dh     TEXT,                        -- Client-Public-Key (aktuell nur gespeichert)
  auth       TEXT,                        -- Auth-Secret (aktuell nur gespeichert)
  device     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_sub_name ON push_sub(name);
CREATE TABLE IF NOT EXISTS push_queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint   TEXT NOT NULL,               -- Empfänger-Endpoint
  title      TEXT NOT NULL,
  body       TEXT,
  url        TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_queue_ep ON push_queue(endpoint, id);

-- Passkeys / WebAuthn (Details: functions/api/auth.js)
CREATE TABLE IF NOT EXISTS webauthn_cred (
  cred_id     TEXT PRIMARY KEY,           -- Credential-ID (base64url)
  pubkey_jwk  TEXT NOT NULL,              -- öffentlicher Schlüssel als JWK (ES256)
  sign_count  INTEGER NOT NULL DEFAULT 0, -- Signaturzähler (Replay-Schutz)
  code        TEXT NOT NULL,              -- verknüpfter Cloud-Speicher-Code
  name        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS webauthn_chal (
  chal_id    TEXT PRIMARY KEY,            -- kurzlebige Challenge-Kennung
  challenge  TEXT NOT NULL,               -- Challenge (base64url)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Anonymer Fehler-Melder (Details: functions/api/log.js)
CREATE TABLE IF NOT EXISTS error_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  msg        TEXT NOT NULL,
  page       TEXT,
  ua         TEXT,
  extra      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
