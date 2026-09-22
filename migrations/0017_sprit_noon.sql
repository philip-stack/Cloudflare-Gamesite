-- „Vor 12 tanken"-Hinweis zum Preis-Alarm (functions/api/sprit/cron.js):
-- In Österreich dürfen Spritpreise nur um 12:00 steigen. Hat die Alarm-
-- Tankstelle kurz vorher ihren Wochen-Tiefstwert, kommt EIN Push am Tag.
-- noon_day merkt sich den Tag (YYYY-MM-DD, UTC wie sprit_price_log.day),
-- an dem er schon verschickt wurde.
ALTER TABLE sprit_alert ADD COLUMN noon_day TEXT;
