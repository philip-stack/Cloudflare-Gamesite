// Betriebsstatus: opsEvaluate() ist die EINZIGE Definition von „läuft alles?"
// — Dashboard-Ampel und Push-Alarm hängen beide daran. Eine Fehlbewertung
// heißt entweder Fehlalarm oder, schlimmer, ein stummer Ausfall.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "_ops.js").replace(/\\/g, "/");
const { opsEvaluate, opsFacts, OPS_LIMITS } = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// Alles in Ordnung
const gut = { fireAgeSec: 60, fireNote: "ok", errCount: 0, errWindowMin: 15, pushQueue: 0, spritAgeSec: 300, healthCronOk: true, vapid: true };
{
  const r = opsEvaluate(gut);
  assert("gesunder Zustand → ok, keine Warnungen", r.status === "ok" && r.warns.length === 0);
}

// Jede einzelne Bedingung muss anspringen
const faelle = [
  ["Fire-Cron ohne Lauf", { fireAgeSec: null }, /kein Lauf/],
  ["Fire-Cron verzögert", { fireAgeSec: OPS_LIMITS.fireAgeSec + 1 }, /verzögert/],
  ["Fire-Notiz nicht ok", { fireNote: "upstream-error" }, /^Fire: upstream-error$/],
  ["Fehlerspitze im 15-min-Fenster", { errCount: OPS_LIMITS.errPerWindow + 1 }, /interne Fehler\/15 min/],
  ["Push-Queue gestaut", { pushQueue: OPS_LIMITS.pushQueue + 1 }, /Push-Queue/],
  ["Sprit-Cron verzögert", { spritAgeSec: OPS_LIMITS.spritAgeSec + 1 }, /Sprit-Cron/],
  ["Cron-Totmann rot", { healthCronOk: false }, /Totmann/],
  ["VAPID fehlt", { vapid: false }, /VAPID/],
];
for (const [name, patch, re] of faelle) {
  const r = opsEvaluate({ ...gut, ...patch });
  assert(name + " → warn", r.status === "warn" && r.warns.some(w => re.test(w)));
}

// Das Fehler-Fenster entscheidet über die Schwelle: dieselbe Zahl ist im
// 15-Minuten-Fenster ein Alarm und über 24 Stunden völlig normal.
{
  const n = OPS_LIMITS.errPerWindow + 1;                       // 16
  const kurz = opsEvaluate({ ...gut, errCount: n, errWindowMin: 15 });
  const lang = opsEvaluate({ ...gut, errCount: n, errWindowMin: 1440 });
  assert("16 Fehler/15 min → warn", kurz.status === "warn");
  assert("16 Fehler/24 h → ok", lang.status === "ok");
  assert("24-h-Fenster beschriftet mit 24 h",
    opsEvaluate({ ...gut, errCount: OPS_LIMITS.errPerDay + 1, errWindowMin: 1440 }).warns.some(w => /\/24 h$/.test(w)));
}

// Unbekannt ist NICHT kaputt: fehlende Health-Angaben dürfen nicht warnen.
{
  const r = opsEvaluate({ ...gut, healthCronOk: null, vapid: null });
  assert("unbekannter Health-Zustand → keine Warnung", r.status === "ok");
}

// Sprit hat noch nie gelaufen (null) → kein Alarm, das ist kein Defekt.
{
  assert("Sprit ohne Lauf (null) → ok", opsEvaluate({ ...gut, spritAgeSec: null }).status === "ok");
}

// Mehrere Probleme gleichzeitig werden alle aufgeführt
{
  const r = opsEvaluate({ ...gut, pushQueue: 5000, vapid: false, fireAgeSec: null });
  assert("mehrere Probleme → alle drei genannt", r.warns.length === 3);
}

// opsFacts: liest nur, wirft nie — auch wenn die DB kaputt ist
{
  const env = { DB: { prepare() { throw new Error("DB weg"); } }, VAPID_PRIVATE_JWK: "x" };
  const f = await opsFacts(env);
  assert("opsFacts bei DB-Fehler → wirft nicht", f && f.errCount === 0 && f.pushQueue === 0);
  assert("opsFacts erkennt VAPID aus env", f.vapid === true);
  // Wichtig: fireAgeSec null bedeutet „kein Lauf bekannt" → das MUSS warnen,
  // sonst wäre ein DB-Ausfall ein stiller Grünzustand.
  assert("DB-Ausfall führt zu warn, nicht zu ok", opsEvaluate(f).status === "warn");
}

// Das Alarm-Fenster wird in die SQL übernommen (Regressionsschutz gegen ein
// versehentlich fest verdrahtetes Fenster)
{
  const sqls = [];
  const env = { DB: { prepare(sql) { sqls.push(sql); return { async first() { return { n: 0 }; } }; } } };
  await opsFacts(env, { errWindowMin: 42 });
  assert("errWindowMin landet in der Abfrage", sqls.some(q => q.includes("-42 minutes")));
  assert("522-Meldungen (externe Quelle) sind ausgenommen", sqls.some(q => q.includes("HTTP 522")));
  assert("Quiz-Meldungen sind keine Fehler", sqls.some(q => q.includes("quiz-report")));
}

console.log(ok ? "\n✅ ops: alle Tests grün" : "\n❌ ops: Tests fehlgeschlagen");
process.exit(ok ? 0 : 1);
