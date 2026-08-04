-- 0003_draw_score_device — Namens-Eigentum für die Kritzeln-Bestenliste.
-- Bisher ist draw_score nur nach Name verschlüsselt (global). Diese Spalte
-- ermöglicht dieselbe „Name gehört dem ersten Gerät"-Regel wie bei `scores`:
-- der DrawRoom trägt beim ersten Werten die Geräte-ID ein und lehnt spätere
-- Einträge unter demselben Namen von einem ANDEREN Gerät ab.
--
-- NACH dem Anwenden dieser Migration in Produktion kann die Durchsetzung im
-- worker-rt/index.js (recordScores) aktiviert werden. Vorher NICHT aktivieren:
-- ohne die Spalte würde der INSERT scheitern und die Bestenliste stumm ausfallen.
ALTER TABLE draw_score ADD COLUMN device TEXT;
