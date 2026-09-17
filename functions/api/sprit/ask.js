import { json, clientIp, rateLimit, logError } from "../_util.js";
import { parseFrei, freiSicher, validateIntent } from "./_logic.js";
import { bumpStat } from "../stat.js";

// ====================================================================
// Freitext-Suche für die Tank-App.
//   GET /api/sprit/ask?q=billig diesel richtung graz, max 3 km umweg
//     → { mode, fuel?, q?|here?|to?/from?, off?|radius?, open?, via }
//
// Gibt AUSDRÜCKLICH nur die verstandene Anfrage zurück, niemals Preise.
// Die holt danach der bestehende Weg (/api/sprit/near bzw. /route). Damit
// kann das Modell prinzipiell keinen Preis verfälschen, und es gibt weiter
// genau einen Pfad für Ergebnisse.
//
// Vier Stufen, die erste kostet nichts:
//   1. parseFrei()  — Regeln. Der Normalfall endet hier, 0 Neuronen.
//   2. Drossel      — ab hier kostet es, also pro IP begrenzen.
//   3. Zwischenspeicher (sprit_cache, 1 h) — zweimal dasselbe kostet einmal.
//   4. Modell       — max_tokens 80, Antwort muss durch validateIntent().
//
// `via` sagt der App, woher die Deutung kommt (regel|cache|ki|form). Bei
// "form" zeigt sie einfach das normale Formular — ein ausgefallenes oder
// aufgebrauchtes Modell darf die App nie blockieren.
// ====================================================================

// Slot-Filling ist keine Aufgabe fuer ein 70B-Modell. Das kleine kommt zuerst;
// weil validateIntent() JEDE Antwort prueft, ist ein Fehlgriff nicht bloss
// unwahrscheinlich, sondern abgefangen — dann uebernimmt das grosse.
const MODEL_KLEIN = "@cf/meta/llama-3.1-8b-instruct-fp8";
const MODEL_GROSS = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const CACHE_MIN = 60;
const MAXLEN = 140;

const ANLEITUNG = [
  "Du wandelst eine deutsche Suchanfrage nach Tankstellen in JSON um.",
  "Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Erklärung, ohne Code-Zaun.",
  "Felder (alle optional ausser mode):",
  '  mode: "near" (Umkreis/Ort) oder "route" (Fahrt A nach B)',
  '  q: Ortsname bei mode=near',
  '  here: true, wenn der eigene Standort gemeint ist',
  '  from, to: Start und Ziel bei mode=route',
  '  fuel: "DIE" (Diesel), "SUP" (Super/Benzin) oder "GAS" (CNG/Erdgas)',
  '  km: Zahl — erlaubter Umweg bzw. Umkreis in Kilometern',
  '  open: true, wenn nur offene Tankstellen gemeint sind',
  "Erfinde nichts. Was nicht dasteht, laesst du weg.",
  'Beispiel: "billig diesel richtung graz, max 3 km umweg"',
  '  {"mode":"route","to":"Graz","fuel":"DIE","km":3}',
  'Beispiel: "super in der naehe, nur offene"',
  '  {"mode":"near","here":true,"fuel":"SUP","open":true}',
].join("\n");

// Die App kennt die Namen von Heimatort und Favoriten, das Modell nicht.
// Mit dieser Liste versteht es „zur Shell in Stammersdorf" oder „zu den
// Eltern", wenn die so gespeichert sind. Bewusst nur NAMEN, keine Koordinaten:
// aufloesen tut die App, das Modell soll nur zuordnen.
function orteZeile(orte) {
  const liste = (Array.isArray(orte) ? orte : [])
    .map(x => String(x == null ? "" : x).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40))
    .filter(x => x.length >= 2)
    .slice(0, 8);
  if (!liste.length) return "";
  return "\nBekannte Orte dieser Person (bei Bezug genau so als q bzw. to zurueckgeben): " + liste.join(" · ");
}

// Zwei Formen kommen zurueck, je nach Modell und Laufzeit:
//  • ein fertiges OBJEKT (Workers AI hat reines JSON schon geparst) — genau
//    das kam hier live an, und String() daraus macht "[object Object]";
//  • oder Text, der das JSON irgendwo enthaelt (mit Einleitung, Code-Zaun) —
//    daher das erste {...} herausschneiden statt blind zu parsen.
function jsonAus(text) {
  if (text && typeof text === "object") return text;
  const s = String(text == null ? "" : text);
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

async function ausCache(env, key) {
  try {
    const row = await env.DB.prepare(
      "SELECT data FROM sprit_cache WHERE k = ? AND at > datetime('now', ?)"
    ).bind(key, `-${CACHE_MIN} minutes`).first();
    return row && row.data ? JSON.parse(row.data) : null;
  } catch { return null; }
}

async function inCache(env, key, obj) {
  try {
    await env.DB.prepare(
      "INSERT INTO sprit_cache (k, data, at) VALUES (?, ?, CURRENT_TIMESTAMP) " +
      "ON CONFLICT(k) DO UPDATE SET data = excluded.data, at = CURRENT_TIMESTAMP"
    ).bind(key, JSON.stringify(obj)).run();
  } catch (_) { /* Zwischenspeicher ist Kür, nicht Pflicht */ }
}

export async function onRequestGet({ request, env }) {
  // GET bleibt fuer schnelle Pruefungen von Hand (curl) — ohne persoenliche
  // Orte, die haben in einer URL nichts verloren.
  return deuten(request, env, String(new URL(request.url).searchParams.get("q") || ""), []);
}

// Die App schickt POST: der Satz UND die Namen ihrer gespeicherten Orte. Als
// Body, nicht als Query — eine URL landet in Zugriffsprotokollen, ein Body nicht.
export async function onRequestPost({ request, env }) {
  let b = {};
  try { b = await request.json(); } catch (_) {}
  return deuten(request, env, String(b.q || ""), b.orte);
}

async function deuten(request, env, roheEingabe, orte) {
  const q = String(roheEingabe || "").trim().slice(0, MAXLEN);
  // Kein 400: die App soll bei allem, was nicht klappt, einfach das Formular
  // zeigen — deshalb ist "nicht verstanden" ein normaler 200er.
  if (q.length < 2) return json({ via: "form" });

  // 1) Regeln zuerst.
  const lokal = parseFrei(q);
  if (freiSicher(lokal)) {
    const v = validateIntent(lokal);
    if (v) { await bumpStat(env, "ask:regel"); return json(Object.assign({ via: "regel" }, v)); }
  }

  // 2) Ab hier kostet es Neuronen.
  if (env && env.DB && !(await rateLimit(env, "spritask:" + clientIp(request), 6, 60))) {
    return json({ via: "form", error: "Zu viele Anfragen — kurz warten" }, 429);
  }

  // 3) Schon einmal gedeutet?
  const key = "ask:" + q.toLowerCase().replace(/\s+/g, " ");
  if (env && env.DB) {
    const hit = await ausCache(env, key);
    const v = validateIntent(hit);
    if (v) { await bumpStat(env, "ask:cache"); return json(Object.assign({ via: "cache" }, v)); }
  }

  // 4) Modell — klein zuerst, gross nur wenn die Pruefung durchfaellt.
  if (!env || !env.AI) { await bumpStat(env, "ask:form"); return json({ via: "form" }); }
  const messages = [
    { role: "system", content: ANLEITUNG + orteZeile(orte) },
    { role: "user", content: q },
  ];
  let letzteAusgabe = null;
  for (const modell of [MODEL_KLEIN, MODEL_GROSS]) {
    try {
      await bumpStat(env, "ai:sprit");
      // 80 waren zu knapp: ein hoefliches Modell verbraucht sie fuer die
      // Einleitung und wird mitten im JSON abgeschnitten. 120 sind immer noch
      // ein Bruchteil eines Rezepts (1400).
      const res = await env.AI.run(modell, { messages, max_tokens: 120 });
      const roh = res && res.response;
      letzteAusgabe = roh;
      const v = validateIntent(jsonAus(roh));
      if (!v && modell === MODEL_KLEIN) {
        // Warum das kleine Modell durchfaellt, muss sichtbar sein — sonst
        // laesst sich nicht entscheiden, ob "klein zuerst" spart oder kostet.
        await bumpStat(env, "ask:ki8fail");
        await logError(env, "ask: kleines Modell unbrauchbar", "sprit/ask",
          (typeof roh === "string" ? roh : JSON.stringify(roh || null)).slice(0, 200));
      }
      if (v) {
        if (env.DB) await inCache(env, key, v);
        await bumpStat(env, modell === MODEL_KLEIN ? "ask:ki8" : "ask:ki70");
        return json(Object.assign({ via: "ki" }, v));
      }
    } catch (e) {
      // Auch ein geworfener Fehler muss sichtbar sein — sonst sieht es aus,
      // als haette das kleine Modell nur schlecht geantwortet.
      if (modell === MODEL_KLEIN) {
        await bumpStat(env, "ask:ki8err");
        await logError(env, "ask: kleines Modell wirft", "sprit/ask", String((e && e.message) || e).slice(0, 200));
      }
    }
  }
  // Sonst ist dieser Fehlerfall unsichtbar: die App zeigt brav das Formular,
  // und niemand erfaehrt je, WARUM kein Modell etwas taugte. Bewusst nur die
  // Modell-AUSGABE, nie die Eingabe der Person.
  await logError(env, "ask: kein Modell lieferte Brauchbares", "sprit/ask",
    (typeof letzteAusgabe === "string" ? letzteAusgabe : JSON.stringify(letzteAusgabe || null)).slice(0, 200));
  await bumpStat(env, "ask:form");
  return json({ via: "form" });
}
