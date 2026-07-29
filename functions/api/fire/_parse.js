// ====================================================================
// Reine Hilfsfunktionen rund um Feuerwehr-Einsatzdaten — ohne Seiteneffekte
// und ohne Runtime-Abhängigkeiten, damit sie in Node getestet werden können
// (tests/fire.test.mjs). Spiegeln die Logik im Client (app.js).
// ====================================================================

// Erstbuchstabe der Alarmstufe → Art: B(rand)/T(echnisch)/S(chadstoff)/X(sonst).
export const kindOf = a => {
  const c = String(a || "").trim().toUpperCase()[0];
  return "BTS".includes(c) ? c : "X";
};

// Alarmstufe („T2", „B0", …) → { kind, stufe, label }.
export function classify(a) {
  const s = String(a || "").trim().toUpperCase();
  const kind = "BTS".includes(s[0]) ? s[0] : "X";
  const stufe = (s.match(/\d+/) || [""])[0];
  return { kind, stufe, label: { B: "Brand", T: "Technisch", S: "Schadstoff", X: "Einsatz" }[kind] };
}

// Datum „TT.MM.JJJJ" + Zeit „HH:MM[:SS]" → Date (lokale Zeit) oder null.
export function parseWhen(d, t) {
  const md = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(d || ""));
  const mt = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(t || ""));
  if (!md) return null;
  const date = new Date(+md[3], +md[2] - 1, +md[1], mt ? +mt[1] : 0, mt ? +mt[2] : 0, mt ? +(mt[3] || 0) : 0);
  return isNaN(date.getTime()) ? null : date;
}

// Luftlinie (km) zwischen zwei [lat,lng]. Ohne Eingaben → Infinity.
export function haversineKm(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const la1 = a[0] * rad, la2 = b[0] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
