-- Rennticker (/f1/): Push-Meldungen. Je Push-Endpoint (eigener Service Worker
-- mit Scope /f1/, kein push_sub-Eintrag) die gewählten Meldungen:
--   start = Session beginnt in Kürze, flags = Safety Car / VSC / Rote Flagge /
--   Zielflagge, fia = neue FIA-Entscheidung zum Lieblingsfahrer (fav = Startnummer).
-- Merkzettel des Crons (welche Session/Flagge/Dokumente schon gemeldet sind)
-- liegen in app_config unter f1_push_*.
CREATE TABLE IF NOT EXISTS f1_alert (
  endpoint TEXT PRIMARY KEY,
  fav      INTEGER,
  start    INTEGER NOT NULL DEFAULT 1,
  flags    INTEGER NOT NULL DEFAULT 1,
  fia      INTEGER NOT NULL DEFAULT 1,
  at       TEXT NOT NULL DEFAULT (datetime('now'))
);
