// Tests für die Sprit-Radar-Logik: reine Entscheidungslogik des Preis-Alarms
// (Zustandsübergang armed/re-arm, Gruppenschlüssel) und die Treibstoff-
// Normalisierung. Deckt die im Cron folgenreiche Logik ohne DB/Netz ab.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const f = (...p) => "file://" + path.join(__dirname, "..", "functions", "api", ...p).replace(/\\/g, "/");

const { alertTransition, groupKey } = await import(f("sprit", "_logic.js"));
const { normFuel, FUELS } = await import(f("sprit", "_ec.js"));

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// ---- alertTransition ----
assert("fire: scharf & Preis unter Ziel", alertTransition(1, 1.499, 1.50) === "fire");
assert("fire: scharf & Preis genau am Ziel", alertTransition(1, 1.50, 1.50) === "fire");
assert("none: scharf & Preis über Ziel", alertTransition(1, 1.60, 1.50) === "none");
assert("rearm: entschärft & Preis wieder über Ziel", alertTransition(0, 1.60, 1.50) === "rearm");
assert("none: entschärft & Preis noch unter Ziel", alertTransition(0, 1.40, 1.50) === "none");
assert("none: ungültiger Preis", alertTransition(1, null, 1.50) === "none");
assert("none: ungültiges Ziel", alertTransition(1, 1.40, undefined) === "none");
// Kein Dauer-Spam: einmal ausgelöst (→ armed=0) feuert bei weiter fallendem Preis nicht erneut.
assert("kein Re-Fire bei entschärft & weiter fallend", alertTransition(0, 1.30, 1.50) === "none");

// ---- groupKey ----
assert("groupKey rundet auf 2 Stellen", groupKey("DIE", 48.20817, 16.37383) === "DIE|48.21,16.37");
assert("groupKey trennt nach Treibstoff", groupKey("SUP", 48.2, 16.3) !== groupKey("DIE", 48.2, 16.3));
assert("groupKey teilt nahe Koordinaten", groupKey("DIE", 48.204, 16.371) === groupKey("DIE", 48.203, 16.374));

// ---- normFuel ----
assert("normFuel Default Diesel", normFuel("") === "DIE" && normFuel("XXX") === "DIE");
assert("normFuel SUP/GAS bleiben", normFuel("SUP") === "SUP" && normFuel("GAS") === "GAS");
assert("FUELS-Labels vorhanden", FUELS.DIE && FUELS.SUP && FUELS.GAS);


// ====================================================================
// Freitext-Suche (parseFrei / validateIntent / /api/sprit/ask)
//
// Der Wert der Regeln ist nicht Bequemlichkeit, sondern Kosten: was hier
// erkannt wird, kostet KEINE Neuronen. Und validateIntent ist das Tor, durch
// das auch die Modell-Antwort muss — es entscheidet, was die App zu sehen
// bekommt.
// ====================================================================
{
  const { parseFrei, freiSicher, validateIntent, REST_TOLERANZ } = await import(f("sprit", "_logic.js"));
  const deutung = t => validateIntent(parseFrei(t));

  const faelle = [
    ["billig diesel richtung graz, max 3 km umweg", { mode: "route", to: "graz", fuel: "DIE", off: 3 }],
    ["von wien nach graz diesel", { mode: "route", to: "graz", from: "wien", fuel: "DIE" }],
    ["von gerasdorf nach krems 4 km umweg", { mode: "route", to: "krems", from: "gerasdorf", off: 4 }],
    ["richtung graz super 95", { mode: "route", to: "graz", fuel: "SUP" }],
    ["diesel in wien", { mode: "near", q: "wien", fuel: "DIE" }],
    ["diesel wien", { mode: "near", q: "wien", fuel: "DIE" }],
    ["cng graz", { mode: "near", q: "graz", fuel: "GAS" }],
    ["super 95 in der nähe", { mode: "near", here: true, fuel: "SUP" }],
    ["benzin um mich, 10 km", { mode: "near", here: true, fuel: "SUP", radius: 10 }],
    ["nur offene tankstellen in linz", { mode: "near", q: "linz", open: true }],
    ["erdgas bei mir", { mode: "near", here: true, fuel: "GAS" }],
    ["billig diesel nach hause", { mode: "near", home: true, fuel: "DIE" }],
    ["tanken daheim", { mode: "near", home: true }],
    ["super zuhause", { mode: "near", home: true, fuel: "SUP" }],
    ["günstig tanken in st. pölten", { mode: "near", q: "st. pölten" }],
  ];
  for (const [text, erwartet] of faelle) {
    const d = deutung(text) || {};
    const passt = Object.keys(erwartet).every(k => d[k] === erwartet[k]);
    assert(`Regel: "${text}"`, passt);
  }
  assert("Regeln sparen das Modell bei den Normalfällen",
    faelle.every(([t]) => freiSicher(parseFrei(t))));

  // Der Ortsname darf keine Rest-Wörter einsammeln.
  assert("Treibstoff landet nicht im Ortsnamen", deutung("von wien nach graz diesel").to === "graz");
  assert("Kilometer landen nicht im Ortsnamen", deutung("nach krems 4 km umweg").to === "krems");
  assert("„3 km“ ist kein Ziel", deutung("nach 3 km") === null);
  // Saetze enden nicht am Ortsnamen: „nach krems fahre“ darf nicht „krems fahre“ ergeben.
  assert("Verb landet nicht im Ortsnamen",
    deutung("wenn ich morgen zu meiner schwester nach krems fahre").to === "krems");
  assert("Zeitangabe landet nicht im Ortsnamen", deutung("richtung graz, fahre heute").to === "graz");
  // ... aber ein Ort, der zufaellig so anfaengt, bleibt ganz.
  assert("Ortsname mit Verb-Anfang bleibt heil", deutung("nach fahrenbach").to === "fahrenbach");
  assert("mehrteiliger Ortsname bleibt heil", deutung("nach bad voeslau").to === "bad voeslau");
  // „nach hause" ist Heimatort, „nach Hausruck" ein echtes Ziel.
  assert("Heimat-Regel kapert keine echten Orte", deutung("nach hausruck").to === "hausruck");
  assert("Heimatort braucht kein Modell", freiSicher(parseFrei("diesel nach hause")));

  // ---- Die Regeln muessen ihre Grenzen kennen ----
  // Beobachtet: bei einem ganzen Satz lieferten sie zufrieden {near,here} und
  // liessen "was Gruenes" (CNG) fallen. Ein Ort allein ist also NICHT genug.
  {
    const langerSatz = "ich brauch was gruenes zum volltanken, am liebsten ganz in meiner umgebung, aber nur wo grad offen ist";
    const r = parseFrei(langerSatz);
    assert("langer Satz: Regeln melden viel Unverstandenes", r.restWorte >= REST_TOLERANZ);
    assert("langer Satz geht trotz gefundenem Ort ans Modell", !freiSicher(r));
    assert("kurzer Satz bleibt gratis", freiSicher(parseFrei("billig diesel richtung graz bitte")));
    assert("Rest wird gezaehlt", parseFrei("diesel in wien").restWorte === 0);
    assert("Toleranz ist klein aber nicht null", REST_TOLERANZ >= 2 && REST_TOLERANZ <= 5);
  }

  // Was die Regeln NICHT können, geht ans Modell — nicht raten.
  assert("unklarer Satz → kein Ergebnis aus den Regeln",
    !freiSicher(parseFrei("wo tanke ich am besten wenn ich morgen zu meiner schwester fahre")));

  // ---- validateIntent als Tor (gilt für Regeln UND Modell) ----
  assert("Müll → null", validateIntent(null) === null && validateIntent("x") === null && validateIntent([]) === null);
  assert("Route ohne Ziel → null", validateIntent({ mode: "route", from: "wien" }) === null);
  assert("Umkreis ohne Ort und ohne Standort → null", validateIntent({ mode: "near" }) === null);
  assert("unbekannter Modus → null", validateIntent({ mode: "fliegen", q: "wien" }) === null);
  assert("erfundener Treibstoff fliegt raus", validateIntent({ mode: "near", q: "wien", fuel: "WASSERSTOFF" }).fuel === undefined);
  assert("unbekannte Felder werden nicht durchgereicht",
    validateIntent({ mode: "near", q: "wien", evil: "rm -rf", url: "http://x" }).evil === undefined);
  assert("Umweg wird auf die Server-Grenze gedeckelt (8 km)",
    validateIntent({ mode: "route", to: "graz", km: 99 }).off === 8);
  assert("Umweg-Untergrenze 0,5 km", validateIntent({ mode: "route", to: "graz", km: 0.1 }).off === 0.5);
  assert("Radius rastet auf die Werte des Auswahlfeldes ein",
    validateIntent({ mode: "near", q: "wien", km: 7 }).radius === 5 &&
    validateIntent({ mode: "near", q: "wien", km: 17 }).radius === 20);
  assert("Steuerzeichen werden aus dem Ort entfernt",
    validateIntent({ mode: "near", q: "wi\u0000en\nstadt" }).q === "wi en stadt");
  assert("überlanger Ort wird gekürzt",
    validateIntent({ mode: "near", q: "a".repeat(200) }).q.length === 60);
  assert("open nur bei echtem true", validateIntent({ mode: "near", q: "wien", open: "ja" }).open === undefined);
}

// ---- /api/sprit/ask: die Stufen und ihre Kosten ----
{
  const api = await import(f("sprit", "ask.js"));
  const req = q => new Request("https://x/api/sprit/ask?q=" + encodeURIComponent(q));

  // Zählt, wie oft das Modell wirklich gefragt wurde.
  const mkEnv = (aiAntwort, opt = {}) => {
    const z = { ai: 0, cacheWrite: 0, stat: [], prompt: "", modelle: [] };
    let zuletztGebunden = [];
    return {
      z,
      env: {
        AI: {
          run: async (modell, opt) => {
            z.ai++;
            z.modelle.push(modell);
            z.prompt = ((opt && opt.messages) || []).map(m => m.content).join("\n");
            if (aiAntwort instanceof Error) throw aiAntwort;
            return { response: aiAntwort };
          },
        },
        DB: {
          prepare(sql) {
            // bumpStat bindet den Schluessel — so sehen wir, WAS gezaehlt wurde.
            return {
              bind(...a) { zuletztGebunden = a; return this; },
              async first() {
                if (/FROM rate/i.test(sql)) return { n: opt.gedrosselt ? 9999 : 0 };
                if (/FROM sprit_cache/i.test(sql)) return opt.cache ? { data: JSON.stringify(opt.cache) } : null;
                return null;
              },
              async run(...a) {
                if (/INTO sprit_cache/i.test(sql)) z.cacheWrite++;
                if (/INTO stat_daily/i.test(sql)) z.stat.push(String(zuletztGebunden[1] || ""));   // bind(tag, schluessel)
                return {};
              },
              async all() { return { results: [] }; },
            };
          },
        },
      },
    };
  };

  {
    const { env, z } = mkEnv('{"mode":"near","q":"egal"}');
    const r = await api.onRequestGet({ request: req("diesel in wien"), env });
    const b = await r.json();
    assert("Regel-Treffer → kein Modell-Aufruf", z.ai === 0);
    assert("Regel-Treffer wird gezählt", z.stat.includes("ask:regel"));
    assert("Regel-Treffer → via regel", b.via === "regel" && b.q === "wien" && b.fuel === "DIE");
  }
  // ---- Kleines Modell zuerst ----
  {
    // Antwortet schon das kleine brauchbar, darf das grosse gar nicht drankommen.
    const { env, z } = mkEnv({ mode: "near", q: "Wien" });
    const r = await api.onRequestPost({
      request: new Request("https://x/api/sprit/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: "ein ganzer satz den die regeln nicht fassen koennen bitte", orte: ["Zuhause Gerasdorf", "Shell Stammersdorf"] }),
      }), env,
    });
    const b = await r.json();
    assert("POST-Weg funktioniert", b.via === "ki" && b.q === "Wien");
    assert("nur EIN Modell-Aufruf, wenn das kleine reicht", z.ai === 1);
    assert("kleines Modell wird als solches gezaehlt", z.stat.includes("ask:ki8") && !z.stat.includes("ask:ki70"));
    assert("bekannte Orte landen in der Anleitung", /Shell Stammersdorf/.test(z.prompt));
    assert("nur Namen, keine Koordinaten im Prompt", !/\d{2}\.\d{3,}/.test(z.prompt));
  }
  {
    // Erst das grosse Modell liefert Brauchbares → zwei Aufrufe, ki70 gezaehlt.
    let n = 0;
    const z = { ai: 0, cacheWrite: 0, stat: [], prompt: "" };
    let zuletztGebunden = [];
    const env = {
      AI: { run: async (modell, opt) => { z.ai++; n++; return { response: n === 1 ? "keine ahnung" : { mode: "near", q: "Linz" } }; } },
      DB: { prepare(sql) { return {
        bind(...a) { zuletztGebunden = a; return this; },
        async first() { return /FROM rate/i.test(sql) ? { n: 0 } : null; },
        async run() { if (/INTO stat_daily/i.test(sql)) z.stat.push(String(zuletztGebunden[1] || "")); return {}; },
        async all() { return { results: [] }; },
      }; } },
    };
    const r = await api.onRequestGet({ request: new Request("https://x/api/sprit/ask?q=" + encodeURIComponent("ein ganzer satz den die regeln nicht fassen koennen bitte")), env });
    const b = await r.json();
    assert("grosses Modell springt ein, wenn das kleine versagt", b.via === "ki" && b.q === "Linz" && z.ai === 2);
    assert("grosses Modell wird getrennt gezaehlt", z.stat.includes("ask:ki70"));
  }
  {
    const { env, z } = mkEnv('Gerne! {"mode":"route","to":"Graz","fuel":"DIE","km":3} — viel Erfolg!');
    const r = await api.onRequestGet({ request: req("wo tanke ich günstig wenn ich zur schwester fahre"), env });
    const b = await r.json();
    assert("unklarer Satz → Modell wird gefragt", z.ai === 1);
    assert("JSON wird aus Fließtext herausgeschnitten", b.mode === "route" && b.to === "Graz" && b.off === 3);
    assert("Modell-Antwort ist als solche gekennzeichnet", b.via === "ki");
    assert("Modell-Weg wird getrennt gezählt", z.stat.includes("ai:sprit") && z.stat.includes("ask:ki8"));
    assert("kleines Modell zuerst", z.modelle[0].includes("8b"));
    assert("Deutung wird zwischengespeichert", z.cacheWrite === 1);
  }
  {
    // Live aufgetreten: die Laufzeit liefert bei reinem JSON ein fertiges
    // OBJEKT statt Text. String() daraus waere "[object Object]".
    const { env, z } = mkEnv({ mode: "route", to: "Graz", fuel: "DIE" });
    const r = await api.onRequestGet({ request: req("blablubb ohne sinn und verstand"), env });
    const b = await r.json();
    assert("Modell-Antwort als fertiges Objekt wird genommen", b.via === "ki" && b.to === "Graz" && b.fuel === "DIE");
  }
  {
    const { env, z } = mkEnv("irgendwas ohne JSON");
    const r = await api.onRequestGet({ request: req("blablubb ohne sinn und verstand"), env });
    const b = await r.json();
    assert("unbrauchbare Modell-Antwort → Formular", b.via === "form" && !b.mode);
    assert("Fehlschlag wird gezählt (sonst weiß niemand, wo die Regeln fehlen)", z.stat.includes("ask:form"));
    assert("nichts Unbrauchbares wird zwischengespeichert", z.cacheWrite === 0);
  }
  {
    const { env, z } = mkEnv(new Error("AI kaputt"));
    const r = await api.onRequestGet({ request: req("blablubb ohne sinn und verstand"), env });
    const b = await r.json();
    assert("Modell-Ausfall → Formular statt Fehler", r.status === 200 && b.via === "form");
  }
  {
    const { env, z } = mkEnv("egal", { cache: { mode: "near", q: "Linz" } });
    const r = await api.onRequestGet({ request: req("blablubb ohne sinn und verstand"), env });
    const b = await r.json();
    assert("Zwischenspeicher-Treffer → kein Modell-Aufruf", z.ai === 0);
    assert("Zwischenspeicher liefert die Deutung", b.via === "cache" && b.q === "Linz");
  }
  {
    const { env, z } = mkEnv("egal", { gedrosselt: true });
    const r = await api.onRequestGet({ request: req("blablubb ohne sinn und verstand"), env });
    assert("Drossel greift VOR dem Modell", r.status === 429 && z.ai === 0);
  }
  {
    const r = await api.onRequestGet({ request: req("x"), env: {} });
    const b = await r.json();
    assert("zu kurze Eingabe → Formular, kein Fehler", r.status === 200 && b.via === "form");
  }
  {
    // Ohne AI-Binding darf nichts krachen.
    const r = await api.onRequestGet({ request: req("blablubb ohne sinn und verstand"), env: {} });
    const b = await r.json();
    assert("ohne AI-Binding → Formular", b.via === "form");
  }
}

// ====================================================================
// „Lohnt sich der Umweg?" (public/tanken/umweg.js)
//
// Eigene Datei genau dafür: die Formel ist hier prüfbar, ohne die App mit
// Karte und Browser nachzubauen — und sie existiert nur einmal.
// ====================================================================
{
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  const quelle = readFileSync(path.join(__dirname, "..", "public", "tanken", "umweg.js"), "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(quelle, sandbox);
  const U = sandbox.window.Umweg;

  assert("umweg.js stellt window.Umweg bereit", !!(U && typeof U.netto === "function"));

  const opt = { liter: 40, verbrauch: 7, faktor: 1.3 };
  // 4 Cent billiger, 5 km weiter (hin und zurück): 0,04*40 = 1,60 € gespart,
  // 5*1,3*2 = 13 km * 7/100 * 1,50 = 1,365 € Fahrtkosten → +0,24 € netto.
  {
    const r = U.netto({ price: 1.50, dist: 6 }, { price: 1.54, dist: 1 }, opt);
    assert("Umweg: Ersparnis richtig", r.ersparnis === 1.6);
    assert("Umweg: Mehrkilometer hin und zurück mit Faktor", r.mehrKm === 13);
    assert("Umweg: knapp positiv", r.netto === 0.24);
  }
  // Dasselbe unterwegs (einfach statt hin und zurück) → klar lohnend.
  {
    const r = U.netto({ price: 1.50, dist: 6 }, { price: 1.54, dist: 1 }, Object.assign({ hinUndZurueck: false }, opt));
    assert("Umweg: unterwegs zählt einfach", r.mehrKm === 6.5 && r.netto === 0.92);
  }
  // Der klassische Denkfehler: weit fahren für 1 Cent.
  {
    const r = U.netto({ price: 1.53, dist: 9 }, { price: 1.54, dist: 1 }, opt);
    assert("Umweg: 1 Cent auf 8 km lohnt NICHT", r.netto < 0);
  }
  assert("Umweg: gleiche Station → netto 0", U.netto({ price: 1.5, dist: 3 }, { price: 1.5, dist: 3 }, opt).netto === 0);
  assert("Umweg: näher UND billiger wird nicht doppelt belohnt",
    U.netto({ price: 1.40, dist: 1 }, { price: 1.50, dist: 4 }, opt).mehrKm === 0);
  assert("Umweg: ohne Entfernung → null", U.netto({ price: 1.5, dist: null }, { price: 1.6, dist: 2 }, opt) === null);
  assert("Umweg: ohne Preis → null", U.netto({ price: null, dist: 1 }, { price: 1.6, dist: 2 }, opt) === null);
  assert("Umweg: fehlender Bezug → null", U.netto({ price: 1.5, dist: 1 }, null, opt) === null);
  assert("Umweg: unsinnige Einstellungen fallen auf die Vorgabe zurück",
    U.netto({ price: 1.50, dist: 6 }, { price: 1.54, dist: 1 }, { liter: 0, verbrauch: -3 }).ersparnis === 1.6);
  // Auf der Route liegen ECHTE Strassenkilometer vor (route.js liest sie aus
  // derselben OSRM-Antwort, aus der auch die Umweg-Minuten kommen).
  // Dann darf NICHT zusaetzlich hochgerechnet werden.
  {
    const mitFaktor = U.netto({ price: 1.50, dist: 6 }, { price: 1.54, dist: 1 }, { hinUndZurueck: false, liter: 40, verbrauch: 7 });
    const echt = U.netto({ price: 1.50, dist: 6 }, { price: 1.54, dist: 1 }, { hinUndZurueck: false, faktor: 1, liter: 40, verbrauch: 7 });
    assert("echte km: keine Hochrechnung", echt.mehrKm === 5 && mitFaktor.mehrKm === 6.5);
    assert("echte km: guenstigeres Ergebnis als die Schaetzung", echt.netto > mitFaktor.netto);
  }
  // Der Heimatort war eine Einbahnstrasse: einmal gesetzt, gab es keinen Weg
  // zurueck — und mit der „nach hause“-Regel wirkte ein Vertipper ueberall weiter.
  {
    const html = readFileSync(path.join(__dirname, "..", "public", "tanken", "index.html"), "utf8");
    const app = readFileSync(path.join(__dirname, "..", "public", "tanken", "app.js"), "utf8");
    assert("Heimatort ist sichtbar", html.includes('id="home-txt"'));
    assert("Heimatort ist aenderbar", html.includes('id="home-set"') && /addEventListener\("click", setHome\)/.test(app));
    assert("Heimatort ist loeschbar", html.includes('id="home-clear"') && /removeItem\("sprit_home"\)/.test(app));
    assert("Heimatort wird mit Namen gespeichert", /jset\("sprit_home", \{ lat, lng, label/.test(app));
  }
  assert("Umweg: Vorgaben plausibel", U.VORGABE.liter === 40 && U.VORGABE.verbrauch === 7 && U.VORGABE.faktor === 1.3);
}

// ====================================================================
// Preisverlauf, Rückfall bei Ausfall, „Vor 12 tanken"
// ====================================================================
{
  const { priceVerdict, noonDue } = await import(f("sprit", "_logic.js"));
  const { ecByAddress, attachTrend } = await import(f("sprit", "_ec.js"));

  // ---- priceVerdict ----
  assert("Verdikt: unter 3 Tagen Verlauf → schweigen", priceVerdict(1.50, [1.55, 1.56]) === null);
  assert("Verdikt: gleich dem Tiefstwert → tief", (priceVerdict(1.50, [1.55, 1.50, 1.58]) || {}).kind === "tief");
  assert("Verdikt: tief nennt die Tage", (priceVerdict(1.49, [1.55, 1.52, 1.58, 1.54]) || {}).days === 4);
  const hoch = priceVerdict(1.60, [1.55, 1.56, 1.57]);
  assert("Verdikt: 4 ¢ über Schnitt → hoch", hoch && hoch.kind === "hoch" && hoch.cent === 4);
  const gut = priceVerdict(1.53, [1.55, 1.52, 1.58, 1.57]);
  assert("Verdikt: 2,5 ¢ unter Schnitt → gut", gut && gut.kind === "gut" && gut.cent === 3);
  assert("Verdikt: Alltagspreis → kein Etikett", priceVerdict(1.555, [1.55, 1.54, 1.57]) === null);
  assert("Verdikt: kaputte Werte werden ignoriert", priceVerdict(1.50, [null, "x", NaN, 1.6, 1.6]) === null);
  assert("Verdikt: ungültiger Preis → null", priceVerdict(null, [1.5, 1.5, 1.5]) === null);

  // ---- noonDue ----
  assert("Mittagsfenster: 11:30 ja", noonDue(11 * 60 + 30));
  assert("Mittagsfenster: 11:00 nein, 12:00 nein", !noonDue(11 * 60) && !noonDue(12 * 60));

  // ---- Mock-D1 für ecByAddress/attachTrend ----
  const utc = ms => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  function db({ cache = [], log = [] } = {}) {
    const writes = [];
    const stmt = (sql, args = []) => ({
      sql, args,
      bind(...a) { return stmt(sql, a); },
      async first() { return null; },   // kein frischer Cache-Treffer
      async all() {
        if (/FROM sprit_cache/.test(sql)) return { results: cache };
        if (/FROM sprit_price_log/.test(sql)) return { results: log.filter(r => args.slice(1).includes(r.station_id)) };
        return { results: [] };
      },
      async run() { writes.push({ sql, args }); return {}; },
    });
    return { writes, prepare: sql => stmt(sql), async batch(list) { for (const x of list) writes.push({ sql: x.sql, args: x.args }); return []; } };
  }
  const realFetch = globalThis.fetch;
  const station = (id, price, lat, lng) => ({ id, name: "T" + id, open: true, location: { latitude: lat, longitude: lng, address: "", postalCode: "", city: "" },
    prices: [{ fuelType: "DIE", amount: price }], openingHours: [], distance: 1 });

  // Quelle fällt aus → letzter guter Stand vom Nachbarpunkt (≈1,1 km), gekennzeichnet
  globalThis.fetch = async () => { throw new Error("down"); };
  {
    const cached = [{ id: 7, name: "Alt", price: 1.499, lat: 48.21, lng: 16.37, open: true, openText: "offen", oh: { f: "00:00", t: "00:00" }, dist: 9 }];
    const env = { DB: db({ cache: [{ k: "48.21,16.37,DIE", data: JSON.stringify(cached), at: utc(Date.now() - 3600e3) }] }) };
    const r = await ecByAddress(env, 48.2, 16.37, "DIE");
    assert("Ausfall: Rückfall liefert den alten Stand", r.length === 1 && r[0].price === 1.499);
    assert("Ausfall: als veraltet markiert, mit Zeitstempel", r.status === "veraltet" && /Z$/.test(r.stand));
    assert("Ausfall: Entfernung zum gefragten Punkt neu gerechnet", r[0].dist > 0.9 && r[0].dist < 1.3);
    assert("Ausfall: Öffnungszeit für jetzt neu gerechnet", r[0].openText === "durchgehend geöffnet");
    assert("Ausfall: nichts wird ins Verlaufs-Log geschrieben", !env.DB.writes.some(w => /sprit_price_log/.test(w.sql)));
  }
  {
    // Zu weit weg (≈ 11 km) → kein Rückfall, ehrliche Meldung wie bisher
    const env = { DB: db({ cache: [{ k: "48.30,16.37,DIE", data: JSON.stringify([{ id: 1, price: 1.4, lat: 48.3, lng: 16.37 }]), at: utc(Date.now()) }] }) };
    const r = await ecByAddress(env, 48.2, 16.37, "DIE");
    assert("Ausfall ohne nahen Stand → leer + quelle-down", r.length === 0 && r.status === "quelle-down");
  }
  // Quelle liefert → jeder Preis landet als Tages-Tiefstwert im Log
  globalThis.fetch = async () => new Response(JSON.stringify([station(1, 1.519, 48.2, 16.37), station(2, 1.539, 48.21, 16.38)]), { status: 200 });
  {
    const env = { DB: db() };
    const r = await ecByAddress(env, 48.2, 16.37, "DIE");
    const logs = env.DB.writes.filter(w => /INSERT INTO sprit_price_log/.test(w.sql));
    assert("Erfolg: beide Preise geloggt", r.length === 2 && logs.length === 2 && logs[0].args[0] === "1" && logs[0].args[2] === 1.519);
    assert("Erfolg: Log behält den Tages-Tiefstwert", /MIN\(price, excluded\.price\)/.test(logs[0].sql));
    assert("Erfolg: Öffnungszeiten für später mitgespeichert", "oh" in r[0]);
  }
  globalThis.fetch = realFetch;

  // ---- attachTrend ----
  {
    const today = new Date().toISOString().slice(0, 10);
    const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    const log = [
      { station_id: "1", day: day(3), price: 1.56 }, { station_id: "1", day: day(2), price: 1.55 },
      { station_id: "1", day: day(1), price: 1.57 }, { station_id: "1", day: today, price: 1.52 },
      { station_id: "2", day: day(1), price: 1.60 },
    ];
    const st = [{ id: 1, price: 1.53 }, { id: 2, price: 1.61 }];
    await attachTrend({ DB: db({ log }) }, "DIE", st, priceVerdict);
    assert("Verlauf: Kurve = Vortage + heutiger Tiefstwert", JSON.stringify(st[0].hist) === JSON.stringify([1.56, 1.55, 1.57, 1.52]));
    assert("Verlauf: Einschätzung aus den Vortagen", st[0].trend && st[0].trend.kind === "tief");
    assert("Verlauf: zu wenig Tage → weder Kurve noch Etikett", !st[1].hist && !st[1].trend);
  }
}

console.log("\n" + (ok ? "SPRIT-TESTS OK" : "SPRIT-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
