-- 0007_sprit_price_log — Preisverlauf je Tankstelle+Treibstoff (für Sparkline).
--
-- Der Preis-Alarm-Cron fragt für Alarm-Stationen ohnehin regelmäßig den Preis
-- ab; hier wird je Tag der TIEFSTPREIS festgehalten (kompakt, entscheidungs-
-- relevant). Nur Stationen mit aktivem Alarm sammeln Historie. Aufräumen > 30 T.
CREATE TABLE IF NOT EXISTS sprit_price_log (
  station_id TEXT NOT NULL,
  fuel       TEXT NOT NULL,
  day        TEXT NOT NULL,
  price      REAL NOT NULL,
  PRIMARY KEY (station_id, fuel, day)
);
