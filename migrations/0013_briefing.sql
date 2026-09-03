-- Tages-Briefing: ein Eintrag je Tag (Wiener Datum).
--
-- Der Text wird vom Cron erzeugt und gespeichert, NICHT beim Seitenaufruf —
-- sonst kostet jedes Nachschauen einen KI-Aufruf und der Text ändert sich
-- unter der Hand. Die Rohwerte liegen als JSON daneben, damit die Seite die
-- Zahlen zeigen kann, aus denen der Satz entstanden ist.
CREATE TABLE IF NOT EXISTS briefing (
  day  TEXT PRIMARY KEY,               -- YYYY-MM-DD (Europe/Vienna)
  text TEXT NOT NULL,
  data TEXT,                           -- JSON der Rohwerte
  via  TEXT,                           -- 'ai' | 'plain' (Rückfall ohne KI)
  at   TEXT NOT NULL DEFAULT (datetime('now'))
);
