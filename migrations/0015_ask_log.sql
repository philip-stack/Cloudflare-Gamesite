-- Unverstandene Eingaben der Freitext-Suche (/api/sprit/ask).
--
-- Warum: ohne die Sätze, an denen Regeln UND Modell gescheitert sind, lässt
-- sich das Sprachverständnis nur nach Gefühl nachschärfen. Nur diese Fälle
-- werden gespeichert — eine erfolgreich gedeutete Eingabe landet hier nie.
--
-- Bewusste Einschränkungen, weil das Eingaben von Menschen sind:
--   • nur der Satz selbst, kein Gerät, keine IP, kein Name, keine Sitzung
--   • sichtbar ausschließlich im Betriebs-Panel (ADMIN_TOKEN)
--   • wird nach 7 Tagen automatisch gelöscht (Sprit-Cron, stündlich)
-- Abschaltbar, indem der Insert in ask.js entfernt wird — die Suche selbst
-- hängt nicht davon ab.
CREATE TABLE IF NOT EXISTS ask_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  q  TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Nach Zeit gefiltert wird hier (Aufräumen + Anzeige der letzten Tage).
CREATE INDEX IF NOT EXISTS idx_ask_log_at ON ask_log(at);
