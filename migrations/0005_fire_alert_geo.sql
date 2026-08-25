-- 0005_fire_alert_geo — Umkreis-Alarm (Radius um Heimatort) + Abschluss-Push.
--
-- Umkreis: Ein Abo kann statt/zusätzlich zu Bezirken einen Heimatpunkt +
-- Radius hinterlegen. Diese Werte hängen am Endpoint, werden aber (wie schon
-- kinds) auf einer eigenen Zeile mit dem Marker-„Bezirk" '~' gespeichert — so
-- bleibt das Bezirks-Matching (WHERE bezirk=? OR bezirk='*') unberührt und die
-- Umkreis-Abos lassen sich mit WHERE bezirk='~' getrennt laden.
ALTER TABLE fire_alert ADD COLUMN home_lat  REAL;
ALTER TABLE fire_alert ADD COLUMN home_lng  REAL;
ALTER TABLE fire_alert ADD COLUMN radius_km INTEGER;

-- Abschluss-Push: Wer den Start-Push zu einem Einsatz bekommen hat, wird beim
-- Ende einmal benachrichtigt. Merkt sich (Endpoint × Einsatznr.); wird beim
-- Ende gelöscht, plus TTL-Aufräumen im maintenance().
CREATE TABLE IF NOT EXISTS fire_alert_sent (
  endpoint TEXT NOT NULL,
  n        TEXT NOT NULL,
  at       TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (endpoint, n)
);
CREATE INDEX IF NOT EXISTS idx_fire_alert_sent_n ON fire_alert_sent(n);
