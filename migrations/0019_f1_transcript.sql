-- Rennticker (/f1/): Abschriften des Boxenfunks (Whisper + Übersetzung).
-- Schlüssel = Dateiname des Clips (Fahrer_Nummer_Datum_Uhrzeit.mp3, eindeutig).
-- segs = JSON [{ s, e, t, d }]: Start/Ende in Sekunden, Englisch, Deutsch.
-- Nur Funk-Texte der F1 (öffentlich), keine Nutzerdaten.
CREATE TABLE IF NOT EXISTS f1_transcript (
  file TEXT PRIMARY KEY,
  segs TEXT NOT NULL,
  at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_f1_transcript_at ON f1_transcript (at);
