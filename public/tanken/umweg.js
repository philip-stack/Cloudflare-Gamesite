"use strict";
// ====================================================================
// Lohnt sich der Umweg?
//
// Die Rechnung, die man im Kopf falsch macht: 8 km fahren, um 2 Cent zu
// sparen, ist ein Verlustgeschaeft. Bezugspunkt ist die Station, zu der man
// ohnehin fahren wuerde — im Umkreis die naechstgelegene, an der Route die
// mit dem kleinsten Umweg.
//
// Bewusst eine EIGENE Datei und nicht in app.js: so kann der Test
// (tests/sprit.test.mjs) genau diese Formel pruefen, ohne die halbe App mit
// Karte und Browser-Umgebung nachbauen zu muessen. Und sie existiert nur
// einmal — eine zweite Kopie im Server waere die naechste Stelle, die
// auseinanderlaeuft.
//
// Zwei Ehrlichkeiten stecken in den Vorgaben:
//  • E-Control liefert LUFTLINIE, keine Fahrstrecke. `faktor` rechnet das
//    grob auf Strassenkilometer hoch; genauer waere nur eine echte
//    Routenabfrage je Station — dafuer ist die Aussage zu klein.
//  • Im Umkreis ist es eine eigene Fahrt → hin UND zurueck. An der Route
//    ist es ein Umweg unterwegs → einfach.
// ====================================================================
(function (root) {
  var VORGABE = { liter: 40, verbrauch: 7, faktor: 1.3 };

  function zahl(v, fallback) {
    var n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return isFinite(n) && n > 0 ? n : fallback;
  }

  // → { netto, ersparnis, kosten, mehrKm } in Euro, oder null wenn nicht
  //   berechenbar (fehlende Entfernung oder fehlender Preis).
  function netto(s, ref, opt) {
    opt = opt || {};
    if (!s || !ref) return null;
    if (typeof s.price !== "number" || typeof ref.price !== "number") return null;
    if (typeof s.dist !== "number" || typeof ref.dist !== "number") return null;

    var liter = zahl(opt.liter, VORGABE.liter);
    var verbrauch = zahl(opt.verbrauch, VORGABE.verbrauch);
    var faktor = zahl(opt.faktor, VORGABE.faktor);
    var fahrten = opt.hinUndZurueck === false ? 1 : 2;

    // Negativ kann nicht vorkommen, solange ref die naechste Station ist —
    // aber verlassen wir uns nicht darauf.
    var mehrKm = Math.max(0, s.dist - ref.dist) * faktor * fahrten;
    var ersparnis = (ref.price - s.price) * liter;
    var kosten = mehrKm * (verbrauch / 100) * s.price;
    var r2 = function (n) { return Math.round(n * 100) / 100; };

    return {
      netto: r2(ersparnis - kosten),
      ersparnis: r2(ersparnis),
      kosten: r2(kosten),
      mehrKm: Math.round(mehrKm * 10) / 10,
    };
  }

  root.Umweg = { VORGABE: VORGABE, netto: netto };
})(typeof window !== "undefined" ? window : globalThis);
