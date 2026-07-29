// ====================================================================
// Zentrale NÖ-Bezirks-Tabelle (Code → Name). Single Source of Truth für
// die serverseitigen Fire-Funktionen (cron.js, stats.js). Früher lag diese
// Tabelle mehrfach kopiert herum und lief auseinander.
// (Der Client public/fire/noe/app.js hat eine eigene Kopie, weil er als
//  statisches Skript unter strenger CSP kein ESM-Modul importieren kann.)
// ====================================================================

export const BEZIRK = {
  "01": "Amstetten", "02": "Baden", "03": "Bruck/Leitha", "04": "Gänserndorf",
  "05": "Gmünd", "061": "Klosterneuburg", "062": "St. Pölten (Land)", "063": "Bruck/Leitha",
  "07": "Hollabrunn", "08": "Horn", "09": "Korneuburg", "10": "Krems/Donau",
  "11": "Lilienfeld", "12": "Melk", "13": "Mistelbach", "14": "Mödling",
  "15": "Neunkirchen", "17": "St. Pölten", "18": "Scheibbs", "19": "Tulln",
  "20": "Waidhofen/Thaya", "21": "Wr. Neustadt", "22": "Zwettl",
};

// Code → lesbarer Name; unbekannte Codes werden zu „Bezirk <code>".
export const bezName = code => {
  const c = String(code == null ? "" : code);
  return BEZIRK[c] || (c ? "Bezirk " + c : "");
};
