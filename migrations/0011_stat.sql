-- Aggregierte, ANONYME Nutzungszähler (kein Personenbezug): pro Kalendertag (UTC)
-- und Schlüssel eine reine Anzahl. Kein Gerät, keine IP, kein Name, keine Sitzung —
-- nur „wie oft ist Ereignis X am Tag Y passiert". Damit lässt sich sehen, welche
-- Spiele wirklich gespielt werden und ob der Duell-/Teilen-Loop überhaupt greift,
-- ohne einzelne Nutzer:innen nachzuverfolgen.
CREATE TABLE IF NOT EXISTS stat_daily (
  day TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  k   TEXT NOT NULL,          -- Ereignis, z. B. "play:galopp", "duel:komet", "share:wumms"
  n   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, k)
);
