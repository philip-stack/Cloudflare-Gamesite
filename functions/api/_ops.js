// ====================================================================
// Betriebsstatus — EINE Definition von „läuft alles?".
//
// Vorher gab es zwei: die Ampel im Dashboard (7 Bedingungen) und der
// Push-Alarm im Fire-Cron (2 Bedingungen). Damit konnte das Dashboard rot
// sein, ohne dass je eine Benachrichtigung kam — genau der Fall, für den
// man einen Alarm hat. Beide Seiten rechnen jetzt mit opsEvaluate().
//
// opsFacts()    holt die Rohwerte aus der DB (für den Cron).
// opsEvaluate() bewertet Rohwerte → { status, warns }  (rein, testbar).
// ====================================================================

export const OPS_LIMITS = {
  fireAgeSec: 900,      // Fire-Cron läuft alle 2 min → 15 min = eindeutig hängt
  spritAgeSec: 1800,    // Sprit drosselt selbst auf ~12 min
  pushQueue: 200,       // Queue staut → Zustellung kaputt
  errPerDay: 20,        // Dashboard-Fenster (24 h)
  errPerWindow: 15,     // Alarm-Fenster (15 min) — Spitze, nicht Grundrauschen
};

// Wie oft muss der Betriebsstatus geprüft werden? Der Cron läuft alle 2
// Minuten; die Ampel-Auswertung kostet 4 Abfragen. Für einen Betriebsalarm ist
// eine Verzögerung von höchstens 10 Minuten belanglos — die Grenzwerte oben
// liegen bei 15 bzw. 30 Minuten, ein Alarm kann also gar nicht später kommen
// als vorher. Damit fällt die Prüfung von 720 auf 144 Läufe am Tag.
//
// Bewusst aus der Uhr abgeleitet und nicht aus einem gespeicherten Zeitstempel:
// Letzteres wäre selbst eine Abfrage pro Lauf und damit ein Teil des Problems.
// Bei 2-Minuten-Takt trifft "Minute % 10 < 2" genau einen Lauf je 10 Minuten.
export function opsDue(now = new Date()) {
  return now.getUTCMinutes() % 10 < 2;
}

// Aufräum-Löschungen (alte Warteschlangen-Einträge, gesehene Einsätze,
// Preisverlauf). Die dürfen stündlich laufen — sie löschen Zeilen, die Tage
// alt sind. Vorher liefen sie in jedem Lauf, also 720× für dieselbe Arbeit.
export function houseDue(now = new Date()) {
  return now.getUTCMinutes() < 2;
}

// f = {
//   fireAgeSec, fireNote, errCount, errWindowMin, pushQueue,
//   spritAgeSec, healthCronOk (bool|null), vapid (bool|null)
// }
export function opsEvaluate(f) {
  const warns = [];
  if (f.fireAgeSec == null) warns.push("Fire-Cron: kein Lauf");
  else if (f.fireAgeSec > OPS_LIMITS.fireAgeSec) warns.push("Fire-Cron verzögert");
  if (f.fireNote && f.fireNote !== "ok") warns.push("Fire: " + f.fireNote);

  const long = (f.errWindowMin || 0) >= 1440;
  const limit = long ? OPS_LIMITS.errPerDay : OPS_LIMITS.errPerWindow;
  const label = long ? "24 h" : (f.errWindowMin || 15) + " min";
  if ((f.errCount || 0) > limit) warns.push(`${f.errCount} interne Fehler/${label}`);

  if ((f.pushQueue || 0) > OPS_LIMITS.pushQueue) warns.push(`Push-Queue: ${f.pushQueue}`);
  if (f.spritAgeSec != null && f.spritAgeSec > OPS_LIMITS.spritAgeSec) warns.push("Sprit-Cron verzögert");
  if (f.healthCronOk === false) warns.push("Health: Cron-Totmann rot");
  if (f.vapid === false) warns.push("Health: VAPID nicht konfiguriert");

  return { status: warns.length ? "warn" : "ok", warns };
}

// Statuswechsel festhalten: eine Zeile in ops_log, aber NUR wenn sich der
// Zustand wirklich geändert hat. Rückgabe true = Wechsel (dann lohnt eine
// Benachrichtigung). Der Verlauf wird unabhängig davon geschrieben, ob ein
// Alarm-Name konfiguriert ist — sonst fehlt gerade die Geschichte, die man
// im Nachhinein braucht.
// Der Zustandsschlüssel heißt weiterhin alert_state, damit ein bestehender
// „bad"-Zustand nicht als frischer Wechsel gemeldet wird.
export async function opsTransition(env, status, reasons) {
  try {
    const prev = (await env.DB.prepare("SELECT v FROM app_config WHERE k='alert_state'").first())?.v || "ok";
    if (prev === status) return false;
    const txt = reasons && reasons.length ? reasons.join(" · ").slice(0, 500) : null;
    await env.DB.prepare("INSERT INTO ops_log (status, reasons) VALUES (?, ?)").bind(status, txt).run();
    await env.DB.prepare(
      "INSERT INTO app_config (k, v) VALUES ('alert_state', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v"
    ).bind(status).run();
    return true;
  } catch { return false; }   // Protokoll darf den Cron nie stoppen
}

// Rohwerte für den Alarm-Pfad. Bewusst nur DB + env — kein Sub-Fetch auf
// /api/health, das würde im Cron nur denselben Zustand nochmal herleiten.
// „Fire-Cron hängt" kann sich hier naturgemäß nicht selbst melden (dann liefe
// dieser Code nicht) — dafür bleibt die Ampel im Dashboard.
export async function opsFacts(env, { errWindowMin = 15 } = {}) {
  const q = async (sql) => { try { return await env.DB.prepare(sql).first(); } catch { return null; } };

  const fh = await q("SELECT last_run, note FROM fire_health WHERE k='cron'");
  const err = await q(
    `SELECT COUNT(*) n FROM error_log WHERE created_at > datetime('now','-${errWindowMin} minutes')` +
    ` AND msg NOT LIKE '%HTTP 522%' AND page IS NOT 'quiz-report'`);
  const pq = await q("SELECT COUNT(*) n FROM push_queue");
  const sp = await q("SELECT v FROM app_config WHERE k='sprit_cron_at'");

  const age = (s, utcSpaceFormat) => {
    if (!s) return null;
    const t = Date.parse(utcSpaceFormat ? String(s).replace(" ", "T") + "Z" : String(s));
    return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null;
  };

  return {
    fireAgeSec: age(fh?.last_run, true),
    fireNote: fh?.note || null,
    errCount: err?.n ?? 0,
    errWindowMin,
    pushQueue: pq?.n ?? 0,
    spritAgeSec: age(sp?.v, false),
    healthCronOk: null,
    vapid: env && env.VAPID_PRIVATE_JWK ? true : false,
  };
}
