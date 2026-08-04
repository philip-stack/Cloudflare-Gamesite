-- ⚠️  NUR FÜR LOKALE ENTWICKLUNG — LÖSCHT DATEN. NIEMALS gegen --remote/Prod!
-- Setzt die Würfelpoker-Kern-Tabellen zurück (altes Spielmodell) und legt das
-- Baseline-Schema neu an. Alle laufenden geteilten Spiele gehen dabei verloren.
--
-- Lokal:   wrangler d1 execute wuerfelpoker --local --file=./reset-dev.sql
-- Prod:    NICHT ausführen. Schema-Änderungen laufen über migrations/ mit
--          `wrangler d1 migrations apply wuerfelpoker --remote`.

DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS cells;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS games;

-- Danach das Baseline-Schema anwenden (die migrations/0001_init.sql liste),
-- z. B. via: wrangler d1 migrations apply wuerfelpoker --local
