// KI-Kochstudio: Eingabevalidierung + Rate-Limit. Dieser Endpunkt verbrennt
// pro Aufruf AI-Kontingent (bezahlt/kontingentiert) + einen externen Scrape —
// der Rate-Limit-Schutz (Kosten-DoS) muss nachweislich greifen.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "koch.js").replace(/\\/g, "/");
const mod = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// Externe Websuche (DuckDuckGo) stubben → keine echten Netzaufrufe.
globalThis.fetch = async () => new Response("", { status: 200 });

// Rate-aware Mock-D1 (nur die rate-Tabelle ist für koch relevant).
function mockDB() {
  const rate = [];
  return {
    prepare(sql) {
      return {
        sql, args: [],
        bind(...a) { this.args = a; return this; },
        async first() {
          if (/COUNT\(\*\) AS n FROM rate/.test(this.sql)) return { n: rate.filter(k => k === this.args[0]).length };
          return {};
        },
        async all() { return { results: [] }; },
        async run() { if (/INSERT INTO rate/.test(this.sql)) rate.push(this.args[0]); return { meta: { changes: 1 } }; },
      };
    },
  };
}
// Ein Mini-Text taugt als Mock nicht mehr: koch.js PRUEFT die Antwort jetzt
// (Laenge + die vorgegebenen Abschnitte), damit ein halber oder leerer Text
// nicht als Rezept auf der Seite landet.
const REZEPT = "## 🍳 Testgericht\n**Zutaten:** 2 Eier, 100 g Mehl, 1 Prise Salz, 200 ml Milch, Butter zum Braten\n"
  + "**Zubereitung:**\n1. Eier mit Milch verquirlen und das Mehl einruehren.\n2. Teig 10 Minuten ruhen lassen.\n"
  + "3. Butter in der Pfanne erhitzen und den Teig portionsweise goldbraun backen.\n**Tipp:** Pfanne gut vorheizen.";
const mkEnv = (antwort) => ({ DB: mockDB(), AI: { run: async () => ({ response: antwort === undefined ? REZEPT : antwort }) } });
const post = (env, body) => mod.onRequestPost({ request: new Request("https://x/api/koch", { method: "POST", body: JSON.stringify(body) }), env });

// ---------- Validierung ----------
{
  const r = await post(mkEnv(), { ingredients: "x" });
  assert("zu kurze Zutaten → 400", r.status === 400);
}
{
  const r = await post({ DB: mockDB() }, { ingredients: "Tomate, Zwiebel" });
  assert("ohne AI-Binding → 503", r.status === 503);
}

// ---------- Happy path ----------
{
  const r = await post(mkEnv(), { ingredients: "Tomate, Zwiebel, Nudeln" });
  const b = await r.json();
  assert("gültige Anfrage → 200", r.status === 200);
  assert("liefert answer", typeof b.answer === "string" && b.answer.length > 0);
  assert("liefert links (Fallback ≥ 2)", Array.isArray(b.links) && b.links.length >= 2);
}

// ---------- Rate-Limit (6/min/IP) ----------
{
  const env = mkEnv();
  const ing = { ingredients: "Tomate, Zwiebel, Nudeln" };
  let last = 200;
  for (let i = 0; i < 7; i++) { const r = await post(env, ing); last = r.status; }
  assert("7. Anfrage in Folge → 429 (Rate-Limit greift)", last === 429);
}


// ---------- Die Antwort wird geprueft, nicht geglaubt ----------
// Beides heute real beobachtet: env.AI.run liefert je nach Modell auch
// OBJEKTE statt Text — der Client ruft answer.match(...) auf und die Seite
// braeche ab. Und ein abgeschnittener Text ist kein Rezept.
{
  const gueltig = { ingredients: "eier, mehl, milch" };
  const r1 = await post(mkEnv({ mode: "irgendwas" }), gueltig);
  const b1 = await r1.json();
  assert("Objekt statt Text -> kein answer, ehrlicher Fehler", r1.status === 503 && !b1.answer && !!b1.error);
  assert("Links kommen trotzdem mit", Array.isArray(b1.links));

  const r2 = await post(mkEnv("Tut mir leid, dazu faellt mir nichts ein."), gueltig);
  const b2 = await r2.json();
  assert("zu kurzer Text -> kein answer", r2.status === 503 && !b2.answer);

  const r3 = await post(mkEnv(REZEPT.replace("Zubereitung", "Ablauf")), gueltig);
  const b3 = await r3.json();
  assert("fehlender Abschnitt -> kein answer", r3.status === 503 && !b3.answer);

  const r4 = await post(mkEnv(), gueltig);
  const b4 = await r4.json();
  assert("richtiges Rezept geht durch", r4.status === 200 && typeof b4.answer === "string");
}

console.log(ok ? "\n✅ koch: alle Tests grün" : "\n❌ koch: Tests fehlgeschlagen");
process.exit(ok ? 0 : 1);
