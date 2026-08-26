// ====================================================================
// Reine Entscheidungslogik des Sprit-Preis-Alarms — ohne DB/Netz, damit sie
// in Node getestet werden kann (tests/sprit.test.mjs). Spiegelt die Schritte
// im Cron (cron.js) wider.
// ====================================================================

// Zustandsübergang eines Alarms beim aktuellen Preis:
//   "fire"  → Ziel erreicht UND Alarm scharf → pushen + entschärfen
//   "rearm" → Preis wieder ÜBER dem Ziel UND entschärft → neu scharf schalten
//   "none"  → nichts tun (inkl. ungültiger Preise)
export function alertTransition(armed, price, target) {
  if (typeof price !== "number" || !Number.isFinite(price)) return "none";
  if (typeof target !== "number" || !Number.isFinite(target)) return "none";
  if (armed && price <= target) return "fire";
  if (!armed && price > target) return "rearm";
  return "none";
}

// Gruppenschlüssel für die E-Control-Abfrage: gleiche Treibstoff-Sorte + auf
// 2 Nachkommastellen gerundete Koordinate teilen sich eine Abfrage (Cache).
export function groupKey(fuel, lat, lng) {
  return fuel + "|" + Number(lat).toFixed(2) + "," + Number(lng).toFixed(2);
}
