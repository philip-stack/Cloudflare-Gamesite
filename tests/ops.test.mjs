// Betriebsstatus: opsEvaluate() ist die EINZIGE Definition von „läuft alles?"
// — Dashboard-Ampel und Push-Alarm hängen beide daran. Eine Fehlbewertung
// heißt entweder Fehlalarm oder, schlimmer, ein stummer Ausfall.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "_ops.js").replace(/\\/g, "/");
const { opsEvaluate, opsFacts, opsTransition, OPS_LIMITS, opsDue, houseDue } = await import(modUrl);

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

// opsTransition: schreibt NUR bei echtem Wechsel — sonst wäre der Verlauf
// alle zwei Minuten eine Zeile länger und der Push-Alarm Dauerbeschallung.
{
  const mk = (prev) => {
    const runs = [];
    const env = { DB: { prepare(sql) { return { sql, args: [], bind(...a) { this.args = a; return this; },
      async first() { return sql.includes("alert_state") ? { v: prev } : {}; },
      async run() { runs.push({ sql, args: this.args }); return {}; } }; } } };
    return { env, runs };
  };
  {
    const { env, runs } = mk("ok");
    const changed = await opsTransition(env, "warn", ["Push-Queue: 900"]);
    assert("Wechsel ok→warn → true", changed === true);
    const row = runs.find(r => /INSERT INTO ops_log/.test(r.sql));
    assert("Wechsel schreibt ops_log mit Grund", !!row && row.args[0] === "warn" && row.args[1] === "Push-Queue: 900");
    assert("Wechsel merkt den neuen Zustand", runs.some(r => /alert_state/.test(r.sql) && r.args[0] === "warn"));
  }
  {
    const { env, runs } = mk("warn");
    const changed = await opsTransition(env, "warn", ["egal"]);
    assert("gleicher Zustand → false, kein Schreiben", changed === false && runs.length === 0);
  }
  {
    const { env, runs } = mk("warn");
    await opsTransition(env, "ok", []);
    const row = runs.find(r => /INSERT INTO ops_log/.test(r.sql));
    assert("Entwarnung schreibt ohne Grund (NULL)", !!row && row.args[0] === "ok" && row.args[1] === null);
  }
  {
    const env = { DB: { prepare() { throw new Error("DB weg"); } } };
    assert("DB-Fehler → false statt Ausnahme", (await opsTransition(env, "warn", [])) === false);
  }
}

// ---------- Taktung: was muss NICHT alle 2 Minuten laufen ----------
// Hintergrund: der Fire-Cron läuft 720× am Tag. Jede Abfrage darin zählt 720×
// aufs D1-Leselimit — auch die, die Zeilen löscht, die Tage alt sind.
{
  const bei = (min) => new Date(Date.UTC(2026, 8, 3, 12, min, 0));
  const treffer = (fn) => { let n = 0; for (let m = 0; m < 60; m += 2) if (fn(bei(m))) n++; return n; };

  // Bei 2-Minuten-Takt: genau ein Lauf je 10-Minuten-Fenster.
  assert("opsDue: 6× pro Stunde (alle 10 min)", treffer(opsDue) === 6);
  assert("opsDue: trifft die Minute 0", opsDue(bei(0)) === true);
  assert("opsDue: trifft 10, 20, 30, 40, 50", [10, 20, 30, 40, 50].every(m => opsDue(bei(m))));
  assert("opsDue: nicht bei 2, 4, 6, 8", [2, 4, 6, 8].every(m => !opsDue(bei(m))));
  // 720 → 144 Läufe/Tag: die Ersparnis, um die es geht.
  assert("opsDue: 144 statt 720 Läufe am Tag", treffer(opsDue) * 24 === 144);

  assert("houseDue: 1× pro Stunde", treffer(houseDue) === 1);
  assert("houseDue: nur zu Beginn der Stunde", houseDue(bei(0)) === true && houseDue(bei(30)) === false);

  // Ohne Argument darf es nicht krachen (der Cron ruft es so auf).
  assert("ohne Argument nutzbar", typeof opsDue() === "boolean" && typeof houseDue() === "boolean");

  // Die Drosselung darf einen hängenden Cron NICHT später sichtbar machen:
  // die Grenzwerte liegen deutlich über dem 10-Minuten-Takt.
  assert("Alarm bleibt scharf: Grenzen > Prüfabstand",
    OPS_LIMITS.fireAgeSec >= 600 && OPS_LIMITS.spritAgeSec >= 600);
}

// ---------- Die Abfragen brauchen ihre Indizes ----------
// Ein Index auf der Filterspalte ist hier kein Feinschliff: ohne ihn liest
// SQLite die ganze Tabelle, und das 720× am Tag.
{
  const migDir = path.join(__dirname, "..", "migrations");
  const alle = readdirSync(migDir).filter(f => f.endsWith(".sql"))
    .map(f => readFileSync(path.join(migDir, f), "utf8")).join("\n");
  const hat = (tabelle, spalte) =>
    new RegExp("CREATE INDEX[^;]*ON\\s+" + tabelle + "\\s*\\(\\s*" + spalte, "i").test(alle);

  assert("Index error_log(created_at)", hat("error_log", "created_at"));
  assert("Index client_log(created_at)", hat("client_log", "created_at"));
  assert("Index push_queue(created_at)", hat("push_queue", "created_at"));
  assert("Index fire_seen(at)", hat("fire_seen", "at"));
  // Primärschlüssel ist (station_id, fuel, day) — für "WHERE day < ?" nutzlos.
  assert("Index sprit_price_log(day)", hat("sprit_price_log", "day"));
}

// ---------- Die Crons benutzen die Taktung wirklich ----------
{
  const fire = readFileSync(path.join(__dirname, "..", "functions", "api", "fire", "cron.js"), "utf8");
  const sprit = readFileSync(path.join(__dirname, "..", "functions", "api", "sprit", "cron.js"), "utf8");

  assert("fire: Ampel hinter opsDue", /if \(opsDue\(\)\) await checkAdminAlert\(env\)/.test(fire));
  assert("fire: Lebenszeichen weiter in JEDEM Lauf",
    /await writeHealth\(env, list\.length, detailFetched, "ok"\);/.test(fire) &&
    !/if \([a-zA-Z]+\(\)\) await writeHealth/.test(fire));
  assert("fire: Aufräum-Löschungen hinter houseDue",
    /if \(houseDue\(\)\) \{[\s\S]{0,400}DELETE FROM fire_seen/.test(fire) &&
    /if \(houseDue\(\)\) \{[\s\S]{0,400}DELETE FROM push_queue/.test(fire));
  assert("sprit: Preisverlauf hinter houseDue",
    /if \(houseDue\(\)\) \{[\s\S]{0,400}DELETE FROM sprit_price_log/.test(sprit));
}

console.log(ok ? "\n✅ ops: alle Tests grün" : "\n❌ ops: Tests fehlgeschlagen");
process.exit(ok ? 0 : 1);
