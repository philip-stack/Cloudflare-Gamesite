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
