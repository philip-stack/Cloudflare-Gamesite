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

// ====================================================================
// Freitext-Suche: „billig diesel richtung graz, max 3 km umweg"
//
// parseFrei() erkennt den Normalfall OHNE Modell — das ist der eigentliche
// Kostendeckel: die meisten Eingaben kosten damit null Neuronen. Erst wenn
// hier nichts Brauchbares herauskommt, fragt ask.js das Modell.
//
// validateIntent() ist das gemeinsame Tor: dieselbe Prüfung für das Ergebnis
// der Regeln UND das des Modells. Alles, was nicht in die Weißliste passt,
// fällt raus — ein Modell darf keine Werte in die App tragen, die die App
// nicht ohnehin erlaubt.
// ====================================================================

const TREIBSTOFF = [
  [/\b(?:diesel|diesl)\w*\b/, "DIE"],
  [/\b(?:cng|erdgas)\b/, "GAS"],
  [/\b(?:super|benzin|eurosuper|95er|95)\b/, "SUP"],
];

// Füllwörter, die nie Teil eines Ortsnamens sind.
const FUELLER = "diesel|diesl\\w*|cng|erdgas|super|benzin|eurosuper|95er|95|billig\\w*|g(?:ü|ue)nstig\\w*|tanken|tankstelle\\w*|nur|offene?n?|max|maximal|maximum|umweg|preis\\w*|bitte|ich|will|suche|zeig|mir|der|die|das|eine?n?|von|nach|richtung|bis|in|um|bei|nahe|rund|am|zum|zur";

// Wörter, an denen ein Ortsname endet (sonst landet „graz max 3 km" im Ort).
const ENDE = new RegExp("\\s(?:,|;|max|maximal|maximum|nur|mit|ohne|bitte|und|km|kilometer|umweg|offen\\w*|billig\\w*|g(?:ü|ue)nstig\\w*|tanken|tankstelle\\w*|preis\\w*|diesel\\w*|diesl\\w*|super|benzin|eurosuper|cng|erdgas|95er|95|fahre|fahren|fahrn|f(?:ä|ae)hrt|muss|will|m(?:ö|oe)chte|brauche|brauch|komme|gehe|unterwegs|heute|morgen|jetzt|gleich|danach|zurück|zurueck)\\b");

function ortsname(s) {
  let t = " " + String(s || "").trim() + " ";
  const m = ENDE.exec(t);
  if (m) t = t.slice(0, m.index);
  t = t.replace(/^[\s.,;:!?/\\-]+/, "").replace(/[\s.,;:!?/\\-]+$/, "");
  // Angehaengte Zahl abschneiden: "nach krems 4 km" darf nicht "krems 4" ergeben.
  t = t.replace(/\s+\d{1,2}(?:[.,]\d)?$/, "").trim();
  // Zahlen allein sind kein Ort ("3 km" darf nicht als Ziel durchrutschen).
  if (!t || /^\d+$/.test(t)) return null;
  return t.slice(0, 60);
}

// Wie viel vom Satz haben die Regeln NICHT angefasst?
//
// Warum das noetig ist: freiSicher() fragte nur „haben wir einen Ort?" — nicht
// „haben wir den Satz verstanden?". Bei „ich brauch was Gruenes zum Volltanken,
// am liebsten in meiner Umgebung" lieferten die Regeln zufrieden {near, here}
// und liessen „was Gruenes" (CNG) fallen. Ausgerechnet dort, wo das Modell
// ueberlegen ist, haben die Regeln es blockiert.
function restWorte(t, o) {
  let r = " " + t + " ";
  // Alles abziehen, was die Regeln tatsaechlich verstanden haben.
  for (const v of [o.q, o.to, o.from]) {
    if (v) r = r.split(v).join(" ");
  }
  r = r
    .replace(new RegExp("\\b(?:" + FUELLER + ")\\b", "g"), " ")
    .replace(/\b(?:in der n(?:ä|ae)he|in meiner n(?:ä|ae)he|um mich|bei mir|mein standort|umgebung|hier)\b/g, " ")
    .replace(/\b(?:nach hause|nachhause|zu hause|zuhause|daheim|heim|heimat)\b/g, " ")
    .replace(/\d{1,2}(?:[.,]\d)?\s*(?:km|kilometer)?/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ").trim();
  return r ? r.split(" ").filter(w => w.length > 2).length : 0;
}

export function parseFrei(raw) {
  const t = " " + String(raw == null ? "" : raw).toLowerCase().replace(/\s+/g, " ").trim() + " ";
  const o = parseKern(t);
  o.restWorte = restWorte(t, o);
  return o;
}

function parseKern(t) {
  const o = {};

  for (const [re, f] of TREIBSTOFF) if (re.test(t)) { o.fuel = f; break; }
  if (/\boffene?n?\b/.test(t)) o.open = true;

  const km = t.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:km|kilometer)\b/);
  if (km) o.km = Math.round(parseFloat(km[1].replace(",", ".")) * 10) / 10;

  const hier = /\b(?:in der n(?:ä|ae)he|in meiner n(?:ä|ae)he|um mich|bei mir|mein standort|umgebung|hier)\b/.test(t);
  // Zuerst pruefen: „nach hause" wuerde sonst als Route mit dem Ziel „hause"
  // enden. Der Heimatort liegt im Geraet, die App loest ihn auf.
  if (/\b(?:nach hause|nachhause|zu hause|zuhause|daheim|heim|heimat)\b/.test(t)) {
    o.mode = "near"; o.home = true; return o;
  }

  let m = t.match(/\bvon (.+?) (?:nach|richtung|bis) (.+)$/);
  if (m) {
    const von = ortsname(m[1]), nach = ortsname(m[2]);
    if (nach) { o.mode = "route"; o.to = nach; if (von) o.from = von; return o; }
  }
  if ((m = t.match(/\b(?:nach|richtung) (.+)$/))) {
    const nach = ortsname(m[1]);
    if (nach) { o.mode = "route"; o.to = nach; return o; }
  }
  if (hier) { o.mode = "near"; o.here = true; return o; }
  if ((m = t.match(/\b(?:in|um|bei|nahe|rund um) (.+)$/))) {
    const q = ortsname(m[1]);
    if (q) { o.mode = "near"; o.q = q; return o; }
  }

  // Letzter Versuch ohne Präposition: „diesel wien" — alles Bekannte streichen,
  // und wenn ein kurzer Rest übrig bleibt, ist das der Ort.
  const rest = t
    .replace(new RegExp("\\b(?:" + FUELLER + ")\\b", "g"), " ")
    .replace(/\d{1,2}(?:[.,]\d)?\s*(?:km|kilometer)?/g, " ")
    .replace(/\s+/g, " ").trim();
  if (rest && rest.length >= 3 && rest.length <= 40 && !/\d/.test(rest) && rest.split(" ").length <= 3) {
    o.mode = "near"; o.q = rest;
  }
  return o;
}

// Hat parseFrei genug gefunden, um das Modell zu sparen?
//
// Zwei Bedingungen, nicht eine: ein Ziel MUSS da sein — und es darf nicht zu
// viel Unverstandenes danebenstehen. Drei Woerter Toleranz, damit „billig
// diesel richtung graz bitte" gratis bleibt, ganze Saetze aber ans Modell
// gehen. Lieber ein paar Neuronen ausgeben als den halben Satz verschlucken.
export const REST_TOLERANZ = 3;
export function freiSicher(o) {
  if (!o || !(o.q || o.to || o.here || o.home)) return false;
  return (o.restWorte || 0) < REST_TOLERANZ;
}

const FUELS_OK = ["DIE", "SUP", "GAS"];
const RADIEN = [5, 10, 20];

// Gemeinsames Tor für Regeln UND Modell. → geprüftes Objekt oder null.
export function validateIntent(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;

  const txt = v => {
    const s = String(v == null ? "" : v)
      .replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    return s.length >= 2 ? s : null;
  };
  const r = {};
  if (FUELS_OK.includes(o.fuel)) r.fuel = o.fuel;
  if (o.open === true) r.open = true;

  const mode = o.mode === "route" ? "route" : o.mode === "near" ? "near" : null;
  if (mode === "route") {
    const to = txt(o.to);
    if (!to) return null;                       // Route ohne Ziel ist nichts wert
    r.mode = "route"; r.to = to;
    const from = txt(o.from); if (from) r.from = from;
    // route.js deckelt den Umweg selbst auf 0,5–8 km; hier dieselbe Grenze,
    // damit die Anzeige nicht etwas verspricht, was der Server kappt.
    const km = Number(o.km);
    if (Number.isFinite(km) && km > 0) r.off = Math.min(8, Math.max(0.5, Math.round(km * 10) / 10));
  } else if (mode === "near") {
    const q = txt(o.q);
    if (!q && o.here !== true && o.home !== true) return null;
    r.mode = "near";
    if (o.home === true) r.home = true;
    else if (o.here === true) r.here = true;
    else r.q = q;
    const km = Number(o.km);
    if (Number.isFinite(km) && km > 0) {
      // Auf die Werte des Auswahlfeldes runden — andere kann die App nicht.
      r.radius = RADIEN.reduce((b, v) => (Math.abs(v - km) < Math.abs(b - km) ? v : b), RADIEN[0]);
    }
  } else {
    return null;
  }
  return r;
}
