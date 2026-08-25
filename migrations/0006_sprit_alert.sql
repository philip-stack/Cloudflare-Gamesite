-- 0006_sprit_alert — Preis-Alarm für Tankstellen (Sprit-Radar).
--
-- Pro Abo (anonymer Push-Endpoint) × Tankstelle × Treibstoff ein Zielpreis.
-- Der Cron prüft regelmäßig den aktuellen Preis (E-Control, by-address an den
-- Koordinaten der Station) und pusht, sobald der Preis den Zielpreis erreicht.
-- armed=1: darf auslösen. Nach dem Auslösen armed=0 → re-armt automatisch,
-- sobald der Preis wieder ÜBER dem Ziel liegt (kein Dauer-Spam).
CREATE TABLE IF NOT EXISTS sprit_alert (
  endpoint   TEXT NOT NULL,
  station_id TEXT NOT NULL,
  fuel       TEXT NOT NULL,
  target     REAL NOT NULL,
  name       TEXT,
  lat        REAL,
  lng        REAL,
  armed      INTEGER NOT NULL DEFAULT 1,
  at         TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (endpoint, station_id, fuel)
);
CREATE INDEX IF NOT EXISTS idx_sprit_alert_station ON sprit_alert(station_id, fuel);
