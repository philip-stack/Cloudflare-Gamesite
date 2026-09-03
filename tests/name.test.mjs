// Namensvergabe: Regeln (_util), Prüf-Endpunkt (/api/name) und die
// Begrüßung auf der Startseite (statisch geprüft).
//
// Warum das Tests wert ist: der Name ist der einzige Anmelde-Schritt, den es
// auf der Seite gibt. Läuft die Regel im Endpunkt und die beim Einsenden
// auseinander, sagt die Begrüßung „frei" und das erste Spiel bringt 409.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = f => "file://" + path.join(__dirname, "..", f).replace(/\\/g, "/");

let ok = true;
const assert = (name, cond) => {
  if (!cond) { ok = false; console.log("FAIL", name); } else console.log("  ok", name);
};

const util = await import(mod("functions/api/_util.js"));
const api = await import(mod("functions/api/name.js"));
const { nameProblem, nameOwner, NAME_MAX } = util;

// ---------- 1) Regeln ----------
console.log("\n— Namensregeln —");
assert("Höchstlänge ist 16", NAME_MAX === 16);
for (const gut of ["Flip", "Anna", "Franz-Josef", "Müllerin", "Sepp 2", "a.b", "O'Brien", "Zwutschkerl", "1a Spieler"]) {
  assert(`erlaubt: ${gut}`, nameProblem(gut) === null);
}
assert("ein Zeichen zu kurz", /2 Zeichen/.test(nameProblem("A") || ""));
assert("leer → zu kurz", nameProblem("") !== null);
assert("nur Leerzeichen → zu kurz", nameProblem("   ") !== null);
assert("17 Zeichen zu lang", /Höchstens 16/.test(nameProblem("abcdefghijklmnopq") || ""));
assert("16 Zeichen gehen noch", nameProblem("abcdefghijklmnop") === null);
assert("Randleerzeichen zählen nicht mit", nameProblem("  abcdefghijklmnop  ") === null);
// Emoji bewusst nicht: in Bestenlisten je Gerät anders, nicht vorlesbar.
assert("Emoji abgelehnt", nameProblem("Flip 🎲") !== null);
assert("Zeichensalat abgelehnt", nameProblem("<script>x") !== null);
assert("nur Zahlen → Buchstabe fehlt", /Buchstabe/.test(nameProblem("1234") || ""));
assert("doppelte Leerzeichen abgelehnt", /doppelte/.test(nameProblem("a  b") || ""));
assert("Anonym ist reserviert", /reserviert/.test(nameProblem("Anonym") || ""));
assert("admin ist reserviert (auch klein)", /reserviert/.test(nameProblem("admin") || ""));
assert("null/undefined stürzen nicht ab", nameProblem(null) !== null && nameProblem(undefined) !== null);

// ---------- 2) Namens-Eigentum ----------
console.log("\n— Wem gehört ein Name —");
const dbWith = (device, sink) => ({
  prepare(sql) {
    return {
      bind(...a) { if (sink) { sink.sql = sql; sink.args = a; } return this; },
      async first() { return device ? { device } : null; },
    };
  },
});
{
  const sink = {};
  const owner = await nameOwner({ DB: dbWith("gerat-eins-123456", sink) }, "  Flip  ");
  assert("Eigentümer wird zurückgegeben", owner === "gerat-eins-123456");
  assert("Name wird getrimmt weitergegeben", sink.args[0] === "Flip");
  assert("Vergleich ist gross-/kleinschreibungsblind", /LOWER\(name\) = LOWER\(\?\)/.test(sink.sql));
  assert("älteste Zeile gewinnt (zuerst da = Eigentümer)", /ORDER BY id LIMIT 1/.test(sink.sql));
  assert("freier Name → null", (await nameOwner({ DB: dbWith(null) }, "Neu")) === null);
}

// ---------- 3) Der Endpunkt ----------
console.log("\n— GET /api/name —");
const envOf = (device) => ({
  DB: {
    prepare(sql) {
      return {
        bind() { return this; },
        // rateLimit benutzt dieselbe DB — hier immer „erlaubt"
        async first() {
          if (/hit|rate/i.test(sql)) return { n: 0 };
          return device ? { device } : null;
        },
        async all() { return { results: [] }; },
        async run() { return {}; },
      };
    },
  },
});
const call = async (env, q) => {
  const r = await api.onRequestGet({ request: new Request("https://x/api/name?" + q), env });
  return { status: r.status, body: await r.json() };
};

{
  const r = await call(envOf(null), "name=Neuling&device=geraet-aaaaaaaa");
  assert("freier Name → free", r.status === 200 && r.body.free === true && r.body.taken === false);
}
{
  const r = await call(envOf("anderes-geraet-1234"), "name=Flip&device=geraet-aaaaaaaa");
  assert("fremder Name → taken", r.body.free === false && r.body.taken === true);
  assert("verrät NICHT, wem er gehört", !JSON.stringify(r.body).includes("anderes-geraet"));
}
{
  const r = await call(envOf("geraet-aaaaaaaa"), "name=Flip&device=geraet-aaaaaaaa");
  assert("eigener Name → frei und mine", r.body.free === true && r.body.mine === true);
}
{
  const r = await call(envOf("geraet-aaaaaaaa"), "name=Flip&device=kurz");
  assert("unbrauchbare Geräte-Kennung gilt nicht als eigen", r.body.taken === true);
}
{
  const r = await call(envOf(null), "name=A&device=geraet-aaaaaaaa");
  assert("Formfehler → problem, kein free", r.body.free === false && /2 Zeichen/.test(r.body.problem));
}
{
  // Ohne Datenbank: darf nicht blockieren.
  const r = await api.onRequestGet({ request: new Request("https://x/api/name?name=Neuling"), env: {} });
  const b = await r.json();
  assert("ohne Datenbank → frei mit unknown", r.status === 200 && b.free === true && b.unknown === true);
}
{
  // Datenbank kaputt: fehlertolerant, kein 500.
  const env = { DB: { prepare() { return { bind() { return this; }, async first() { throw new Error("kaputt"); }, async run() {} }; } } };
  const r = await api.onRequestGet({ request: new Request("https://x/api/name?name=Neuling"), env });
  const b = await r.json();
  assert("Datenbankfehler → frei mit unknown, kein 500", r.status === 200 && b.free === true && b.unknown === true);
}
{
  // Drosselung greift (rateLimit sieht ein voll gelaufenes Fenster).
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() { return /rate|hit|COUNT/i.test(sql) ? { n: 9999 } : null; },
          async run() { return {}; },
          async all() { return { results: [] }; },
        };
      },
    },
  };
  const r = await api.onRequestGet({ request: new Request("https://x/api/name?name=Neuling"), env });
  const b = await r.json();
  assert("Drosselung → 429, aber nicht als vergeben", r.status === 429 && b.free === true);
}

// ---------- 4) Dieselbe Regel beim Einsenden ----------
console.log("\n— Einsendung benutzt dieselbe Abfrage —");
{
  const src = readFileSync(path.join(__dirname, "..", "functions", "api", "scores", "[game].js"), "utf8");
  assert("scores importiert nameOwner", /import \{[^}]*nameOwner[^}]*\} from "\.\.\/_util\.js"/.test(src));
  assert("scores benutzt nameOwner", /const owner = await nameOwner\(env, name\)/.test(src));
  assert("keine eigene Eigentums-Abfrage mehr in scores",
    !/SELECT device FROM scores WHERE LOWER\(name\)/.test(src));
  assert("fremder Name bleibt 409", /409/.test(src) && /gehört schon jemand anderem/.test(src));
}

// ---------- 5) Begrüßung auf der Startseite ----------
console.log("\n— Begrüßung (public/index.html) —");
{
  const html = readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

  assert("natives <dialog> (Fokusfalle/Esc gratis)", /<dialog id="welcome"/.test(html));
  // core.css setzt * { margin: 0 } und killt damit die vom Browser gelieferte
  // Zentrierung des <dialog>. Ohne margin: auto klebt es links oben.
  assert("Dialog ist mittig (margin: auto trotz core.css-Reset)",
    /\.welc \{[\s\S]{0,400}?margin: auto;/.test(html));
  assert("Dialog ist benannt (aria-labelledby)", /aria-labelledby="welc-h"/.test(html));
  assert("Eingabefeld hat ein <label>", /<label class="welc-lab" for="welc-name">/.test(html));
  assert("Feld ist mit dem Hinweis verknüpft", /aria-describedby="welc-hint"/.test(html));
  assert("Hinweise werden vorgelesen", /id="welc-hint"[^>]*aria-live="polite"/.test(html));
  assert("Handy-Tastatur passend (nickname/enterkeyhint)",
    /autocomplete="nickname"/.test(html) && /enterkeyhint="go"/.test(html));
  assert("Länge auch im Feld begrenzt", /id="welc-name"[\s\S]{0,200}maxlength="16"/.test(html));

  // Datenschutz: ein Satz sofort, Details auf Wunsch, ganze Erklärung verlinkt.
  assert("kurz erklärt: kein Konto", /kein Konto/.test(html));
  assert("Details aufklappbar", /<details class="welc-dp">/.test(html));
  assert("sagt, dass der Name auf dem Gerät bleibt", /auf diesem Gerät<\/b> gespeichert/.test(html));
  assert("sagt, wann er zum Server geht", /Zum Server geht er erst/.test(html));
  assert("nennt kein Tracking/keine Werbung", /kein Tracking/.test(html) && /keine Werbung/.test(html));
  assert("Spitzname ausdrücklich erlaubt", /Spitzname/.test(html));
  assert("verlinkt die Datenschutzerklärung", /<a href="\/datenschutz\/">Zur ganzen Datenschutzerklärung<\/a>/.test(html));

  // Freiwillig: Wegklicken erlaubt und gemerkt.
  assert("Wegklicken möglich", /id="welc-skip"/.test(html));
  assert("Esc gilt als spaeter", /addEventListener\("cancel"/.test(html) && /spaeter\(\)/.test(html));
  assert("Entscheidung wird gemerkt", /bb_onboard_v1/.test(html));
  assert("nach Wegklicken bleibt ein leiser Hinweis", /id="name-nudge"/.test(html) && /id="nudge-open"/.test(html));

  // Nur für Neue.
  assert("mit Namen wird nicht gefragt", /if \(myName\) \{[\s\S]{0,200}return;/.test(html));

  // Prüfung gegen den Server, entprellt, fehlertolerant.
  assert("prüft über /api/name", /\/api\/name\?name=/.test(html));
  assert("Prüfung entprellt", /setTimeout\(\(\) => pruefe\(v\), ms == null \? 450 : ms\)/.test(html));
  assert("veraltete Antworten werden verworfen", /inp\.value\.trim\(\) !== v\) return null/.test(html));
  assert("Regeln liegen NICHT doppelt im Browser",
    !/\\p\{L\}/.test(html) && !/NAME_RESERVED/.test(html));
  assert("Vorschläge zum Antippen", /welc-sug/.test(html) && /SUGGEST/.test(html));
  assert("Tastatur verdeckt die Info nicht (kein Autofokus auf Touch)",
    /\(hover: hover\) and \(pointer: fine\)/.test(html));
  assert("kein autofocus-Attribut (würde die Info verdecken)", !/id="welc-name"[\s\S]{0,200}autofocus/.test(html));
  assert("Name über GS gesetzt (eine Quelle)", /GS\.setName\(v\)/.test(html));
  assert("Bewegung respektiert die Systemeinstellung",
    /prefers-reduced-motion: no-preference\)\s*\{\s*\.welc\[open\]/.test(html));
}

console.log(ok ? "\n✅ name: alle Tests grün" : "\n❌ name: Tests fehlgeschlagen");
process.exit(ok ? 0 : 1);
