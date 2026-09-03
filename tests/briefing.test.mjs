// Tages-Briefing: die KI formuliert nur, die Zahlen kommen aus eigenen
// Quellen. Geprüft wird darum vor allem, dass
//   1. der Text auch OHNE KI entsteht (Ausfall, leeres Kontingent),
//   2. das Modell nichts erfinden kann, weil es nur die Rohwerte bekommt,
//   3. pro Tag genau EIN Aufruf passiert (Uhrzeit + Idempotenz),
//   4. die Wiener Zeitzone samt Sommerzeit richtig gerechnet wird.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "briefing", "_gen.js").replace(/\\/g, "/");
const { viennaNow, plainText, compose, generate, loadCfg } = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// ---------- Zeitzone ----------
{
  // Winter (UTC+1): 05:30 UTC = 06:30 Wien
  const w = viennaNow(new Date("2026-01-15T05:30:00Z"));
  assert("Winterzeit: 05:30 UTC → 6 Uhr Wien", w.day === "2026-01-15" && w.hour === 6);
  // Sommer (UTC+2): 05:30 UTC = 07:30 Wien
  const s = viennaNow(new Date("2026-07-15T05:30:00Z"));
  assert("Sommerzeit: 05:30 UTC → 7 Uhr Wien", s.day === "2026-07-15" && s.hour === 7);
  // Datumswechsel: 23:30 UTC im Sommer ist in Wien schon der nächste Tag
  const n = viennaNow(new Date("2026-07-15T23:30:00Z"));
  assert("Sommerzeit: 23:30 UTC → schon der nächste Wiener Tag", n.day === "2026-07-16" && n.hour === 1);
}

// ---------- Nüchterner Text ----------
const RAW = {
  weather: { min: 16.4, max: 27.9, mm: 0.3, prob: 45, text: "teils bewölkt" },
  sprit: { fuel: "Diesel", price: 1.559, name: "Turmöl", city: "Korneuburg", dist: 3.2, diffCent: -2.1, stations: 12 },
  fire: { bezirk: "Korneuburg", count: 3, open: 1, letzte: [{ was: "Brand", wo: "Langenzersdorf" }] },
};
{
  const t = plainText(RAW);
  assert("Text nennt das Wetter", /teils bewölkt/.test(t) && /16 bis 28 Grad/.test(t));
  assert("Regenwahrscheinlichkeit ab 30 % erwähnt", /45 %/.test(t));
  assert("Text nennt Preis mit Komma", /1,559 €/.test(t));
  assert("Text nennt die Station und Entfernung", /Turmöl/.test(t) && /3,2 km/.test(t));
  assert("gefallener Preis wird als gefallen benannt", /um 2,1 Cent gefallen/.test(t));
  assert("Text nennt Einsätze mit offenen", /3 Einsätze im Bezirk Korneuburg \(1 noch offen\)/.test(t));
}
{
  const t = plainText({ ...RAW, sprit: { ...RAW.sprit, diffCent: 1.4 } });
  assert("gestiegener Preis wird als gestiegen benannt", /um 1,4 Cent gestiegen/.test(t));
}
{
  const t = plainText({ weather: null, sprit: null, fire: { bezirk: "Tulln", count: 0, open: 0, letzte: [] } });
  assert("nur Feuerwehr konfiguriert → nur dieser Satz", /Keine Einsätze im Bezirk Tulln/.test(t) && !/Wetter/.test(t));
}
{
  assert("gar nichts konfiguriert → Hinweis statt leerem Text",
    /nichts eingestellt/.test(plainText({ weather: null, sprit: null, fire: null })));
}
{
  // Ein Preis, der sich kaum bewegt hat, soll nicht als Bewegung gemeldet werden.
  const t = plainText({ ...RAW, sprit: { ...RAW.sprit, diffCent: 0.0 } });
  assert("Preisänderung unter 0,1 Cent wird weggelassen", !/Cent/.test(t));
}

// ---------- compose(): Rückfall ohne KI ----------
{
  const r = await compose({}, RAW);                       // kein env.AI
  assert("ohne KI-Bindung → nüchterner Text", r.via === "plain" && r.text === plainText(RAW));
}
{
  const env = { AI: { run: async () => ({ response: "kurz" }) } };
  const r = await compose(env, RAW);
  assert("zu kurze KI-Antwort → Rückfall", r.via === "plain");
}
{
  const env = { AI: { run: async () => { throw new Error("kein Kontingent"); } } };
  const r = await compose(env, RAW);
  assert("KI-Fehler → Rückfall statt Absturz", r.via === "plain" && r.text.length > 40);
}
{
  let gesehen = null;
  const env = { AI: { run: async (m, opt) => { gesehen = opt; return { response: "Guten Morgen! Heute ist es teils bewölkt bei 16 bis 28 Grad, Diesel kostet 1,559 € bei der Turmöl in Korneuburg." }; } } };
  const r = await compose(env, RAW);
  assert("brauchbare KI-Antwort wird genommen", r.via === "ai" && /Guten Morgen/.test(r.text));
  // Der Prompt darf NUR die Rohwerte enthalten und muss das Erfinden verbieten.
  const p = gesehen.messages[0].content;
  assert("Prompt enthält die Rohdaten als JSON", p.includes('"price":1.559') || p.includes('"price": 1.559'));
  assert("Prompt verbietet Erfinden", /erfinde nichts/i.test(p));
  assert("Antwort ist kurz gehalten (max_tokens)", gesehen.max_tokens <= 300);
}

{
  // Beim ersten echten Lauf hat das Modell den Spritpreis weggelassen, obwohl
  // er in den Daten stand. Ein Text ohne den Preis ist unvollstaendig.
  const env = { AI: { run: async () => ({ response: "Guten Morgen! Heute ist es teils bewoelkt bei 16 bis 28 Grad, und im Bezirk Korneuburg war wenig los." }) } };
  const r = await compose(env, RAW);
  assert("KI laesst den Preis weg → Rueckfall auf die nuechterne Fassung", r.via === "plain" && /1,559/.test(r.text));
}
{
  const env = { AI: { run: async () => ({ response: "Guten Morgen! Teils bewoelkt, 16 bis 28 Grad. Diesel kostet 1,559 € bei der Turmoel in Korneuburg. Drei Einsaetze im Bezirk." }) } };
  const r = await compose(env, RAW);
  assert("Preis mit Komma zaehlt als vorhanden", r.via === "ai");
}
{
  const env = { AI: { run: async () => ({ response: "Guten Morgen! Teils bewoelkt, 16 bis 28 Grad. Diesel kostet 1.559 Euro bei der Turmoel. Drei Einsaetze im Bezirk." }) } };
  const r = await compose(env, RAW);
  assert("Preis mit Punkt zaehlt auch als vorhanden", r.via === "ai");
}
{
  // Ohne Sprit-Block darf die Pruefung nicht zuschlagen.
  const ohne = { ...RAW, sprit: null };
  const env = { AI: { run: async () => ({ response: "Guten Morgen! Teils bewoelkt bei 16 bis 28 Grad, im Bezirk Korneuburg drei Einsaetze." }) } };
  const r = await compose(env, ohne);
  assert("ohne Sprit-Daten keine Preis-Pruefung", r.via === "ai");
}
{
  let p = null;
  const env = { AI: { run: async (m, o) => { p = o.messages[0].content; return { response: "x".repeat(60) + " 1,559 " }; } } };
  await compose(env, RAW);
  assert("Prompt verlangt die Du-Form", /mit DU an/.test(p) && /nicht mit Sie/i.test(p));
  assert("Prompt verlangt alle Blöcke", /JEDER vorhandene Block/.test(p));
}

// ---------- generate(): Zeitpunkt, Idempotenz, Push ----------
// Kleine D1-Attrappe: app_config als Map, briefing als Map, fire_op als Liste.
function mockEnv(cfg, opts = {}) {
  const conf = { ...cfg };
  const briefing = { ...(opts.briefing || {}) };
  const pushes = [];
  const env = {
    VAPID_PRIVATE_JWK: opts.vapid === false ? null : "jwk",
    AI: opts.ai === false ? null : { run: async () => ({ response: "Guten Morgen! Im Bezirk Korneuburg war es ruhig, es gab keine Einsätze in den letzten vierzehn Stunden." }) },
    DB: {
      prepare(sql) {
        return {
          args: [],
          bind(...a) { this.args = a; return this; },
          async all() {
            if (/FROM app_config/.test(sql)) {
              return { results: Object.entries(conf).map(([k, v]) => ({ k, v })) };
            }
            if (/FROM fire_op/.test(sql)) return { results: opts.ops || [] };
            if (/FROM push_sub/.test(sql)) return { results: [{ endpoint: "https://push.example/abc" }] };
            return { results: [] };
          },
          async first() {
            if (/SELECT day FROM briefing/.test(sql)) return briefing[this.args[0]] ? { day: this.args[0] } : null;
            if (/COUNT\(\*\) n, SUM/.test(sql)) {
              const list = opts.ops || [];
              return { n: list.length, offen: list.filter(x => !x.ended).length };
            }
            if (/FROM sprit_price_log/.test(sql)) return null;
            return null;
          },
          async run() {
            if (/INSERT INTO briefing/.test(sql)) briefing[this.args[0]] = { text: this.args[1], via: this.args[3] };
            if (/INSERT INTO push_queue/.test(sql)) pushes.push({ title: this.args[1], body: this.args[2] });
            return {};
          },
        };
      },
    },
  };
  return { env, briefing, pushes, conf };
}
// tickle() in push.js schickt einen echten fetch los — abfangen.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

{
  const { env } = mockEnv({ briefing_on: "0", briefing_hour: "0" });
  const r = await generate(env);
  assert("ausgeschaltet → nichts tun", r.skipped === "aus");
}
{
  // Stunde 23 eingestellt, es ist früher → nichts tun (außer es ist gerade 23 Uhr).
  const jetzt = viennaNow().hour;
  const stunde = jetzt === 23 ? 22 : 23;
  const { env } = mockEnv({ briefing_on: "1", briefing_hour: String(stunde) });
  const r = await generate(env);
  if (jetzt === 23) assert("Stunde erreicht → erzeugt (Sonderfall 23 Uhr)", r.ok && !r.skipped);
  else assert("Stunde noch nicht erreicht → nichts tun", r.skipped === "zu früh");
}
{
  const heute = viennaNow().day;
  const { env } = mockEnv({ briefing_on: "1", briefing_hour: "0" }, { briefing: { [heute]: { text: "alt" } } });
  const r = await generate(env);
  assert("heute schon erzeugt → kein zweiter Aufruf", r.skipped === "heute schon erledigt");
}
{
  const { env, briefing, pushes } = mockEnv(
    { briefing_on: "1", briefing_hour: "0", briefing_bezirk: "09", briefing_name: "Flip" },
    { ops: [] });
  const r = await generate(env);
  const heute = viennaNow().day;
  assert("erzeugt und gespeichert", r.ok && !r.skipped && !!briefing[heute]);
  assert("Text kommt von der KI", r.via === "ai" && /Guten Morgen/.test(briefing[heute].text));
  assert("Push wird verschickt, wenn ein Name steht", r.pushed === true && pushes.length === 1);
  assert("Push trägt den Text im Rumpf", /Guten Morgen/.test(pushes[0].body));
}
{
  const { env, pushes } = mockEnv(
    { briefing_on: "1", briefing_hour: "0", briefing_bezirk: "09" });   // kein Name
  const r = await generate(env);
  assert("ohne Namen: erzeugen ja, pushen nein", r.ok && r.pushed === false && pushes.length === 0);
}
{
  // force übergeht Zustand, Uhrzeit und „heute schon erledigt" (Admin-Knopf)
  const heute = viennaNow().day;
  const { env, briefing } = mockEnv({ briefing_on: "0", briefing_hour: "23" }, { briefing: { [heute]: { text: "alt" } } });
  const r = await generate(env, { force: true, push: false });
  assert("force erzeugt trotz aus/zu früh/schon erledigt", r.ok && !r.skipped && briefing[heute].text !== "alt");
  assert("force mit push:false schickt nichts", r.pushed === false);
}
{
  // Ohne KI-Bindung muss trotzdem etwas Brauchbares entstehen.
  const { env, briefing } = mockEnv(
    { briefing_on: "1", briefing_hour: "0", briefing_bezirk: "19" },
    { ai: false, ops: [{ ended: 0 }, { ended: 1 }] });
  const r = await generate(env, { push: false });
  const heute = viennaNow().day;
  assert("ohne KI → nüchterner Text gespeichert", r.via === "plain" && /Einsätze im Bezirk Tulln/.test(briefing[heute].text));
}

// ---------- loadCfg(): Vorgaben und Grenzen ----------
{
  const { env } = mockEnv({});
  const c = await loadCfg(env);
  assert("Vorgabe: aus, 6 Uhr, Diesel", c.on === false && c.hour === 6 && c.fuel === "DIE");
  assert("Vorgabe: keine Koordinaten", c.lat === null && c.lng === null);
}
{
  const { env } = mockEnv({ briefing_hour: "99", briefing_fuel: "Unsinn", briefing_lat: "48.31", briefing_lng: "16.36" });
  const c = await loadCfg(env);
  assert("Stunde wird begrenzt", c.hour === 23);
  assert("unbekannte Sorte fällt auf Diesel zurück", c.fuel === "DIE");
  assert("Koordinaten werden als Zahl gelesen", c.lat === 48.31 && c.lng === 16.36);
}

console.log(ok ? "\n✅ briefing: alle Tests grün" : "\n❌ briefing: Tests fehlgeschlagen");
process.exit(ok ? 0 : 1);
