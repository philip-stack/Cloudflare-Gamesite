import { json, logError } from "../_util.js";
import { pushToEndpoint, sendToName } from "../push.js";
import { BEZIRK, bezName } from "./_bezirk.js";

// ====================================================================
// Zeitgesteuerte Prüfung neuer Feuerwehr-Einsätze (NÖ) und Bezirks-Alarm.
// Wird NICHT vom Browser, sondern vom Cron-Worker (worker-rt) aufgerufen:
//   GET /api/fire/cron?key=<CRON_TOKEN>
// Cloudflare Pages kann keine Cron-Trigger; darum pingt der Worker diese
// Route. Der Token (Secret in Pages UND Worker) schützt vor Fremdaufruf.
//
// Ablauf: aktive Einsätze holen → neue (Einsatznr. nicht in fire_seen)
// ermitteln → an alle fire_alert-Abos des jeweiligen Bezirks (oder "*")
// pushen → alle aktuellen als gesehen markieren → Historie schreiben →
// Gesundheitszustand festhalten (fire_health) → aufräumen.
// ====================================================================

const BASE = "https://infoscreen.florian10.info/OWS/wastlMobile";
const UA = "SpieleabendFireNoe/1.0 (+https://philip-stack.pages.dev/fire/noe/)";

const DETAIL_TTL_MIN = 6;   // Detail (Wehren) je Einsatz höchstens so oft neu holen
const DETAIL_CAP = 25;      // …und pro Lauf nie mehr als so viele (schont die Quelle)

// Robuster JSON-Abruf mit kleinem Retry (die Quelle ist gelegentlich zickig).
async function fetchJsonRetry(url, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i + 1 < tries) await new Promise(r => setTimeout(r, 400));
    }
  }
  throw lastErr;
}

async function writeHealth(env, active, detailFetched, note) {
  try {
    await env.DB.prepare(
      `INSERT INTO fire_health (k, last_run, active, detail_fetched, note)
       VALUES ('cron', CURRENT_TIMESTAMP, ?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET last_run=CURRENT_TIMESTAMP,
         active=excluded.active, detail_fetched=excluded.detail_fetched, note=excluded.note`
    ).bind(active, detailFetched, note).run();
  } catch (_) { /* Health ist optional */ }
}

export async function onRequestGet({ request, env }) {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!env.CRON_TOKEN || key !== env.CRON_TOKEN) return json({ error: "forbidden" }, 403);

  let list = [];
  try {
    const data = await fetchJsonRetry(`${BASE}/getEinsatzAktiv.ashx`, 2);
    list = Array.isArray(data && data.Einsatz) ? data.Einsatz : [];
  } catch (e) {
    await logError(env, "fire-cron: upstream " + e.message, "fire/cron");
    await writeHealth(env, -1, 0, "upstream-error");
    return json({ ok: false, error: "upstream" });
  }

  // Die Quelle liefert (auch bei Störungen) manchmal eine leere Liste. In dem
  // Fall NICHTS beenden — sonst würde ein kurzer Aussetzer alle Einsätze als
  // „beendet" markieren. Nur Health festhalten und sauber aussteigen.
  if (!list.length) {
    await writeHealth(env, 0, 0, "empty");
    return json({ ok: true, active: 0, sent: 0 });
  }

  const nums = list.map(e => String(e.n || "")).filter(Boolean);

  // ---- Neue Einsätze erkennen und Bezirks-Abos pushen ----
  const seen = new Set();
  try {
    const rows = (await env.DB.prepare(
      `SELECT n FROM fire_seen WHERE n IN (${nums.map(() => "?").join(",")})`
    ).bind(...nums).all()).results || [];
    for (const r of rows) seen.add(r.n);
  } catch (e) { await logError(env, "fire-cron: seen " + e.message, "fire/cron"); }

  const fresh = list.filter(e => e.n && !seen.has(String(e.n)));
  let sent = 0;

  for (const e of fresh) {
    const bez = String(e.b || "");
    let targets = [];
    try {
      targets = (await env.DB.prepare(
        "SELECT DISTINCT endpoint FROM fire_alert WHERE bezirk = ? OR bezirk = '*'"
      ).bind(bez).all()).results || [];
    } catch (_) {}

    const msg = {
      title: "🚒 " + (e.a ? e.a + " · " : "") + (e.m || "Einsatz"),
      body: (e.o || "") + (bezName(bez) ? " · " + bezName(bez) : ""),
      // Deep-Link direkt auf den Einsatz — die App öffnet die Detailansicht
      // und lädt automatisch den passenden Feed (aktiv/beendet).
      url: "/fire/noe/#n=" + encodeURIComponent(String(e.n || "")),
    };
    for (const t of targets) {
      const r = await pushToEndpoint(env, t.endpoint, msg);
      if (r.ok) sent++;
      if (r.gone) {
        try {
          await env.DB.prepare("DELETE FROM fire_alert WHERE endpoint = ?").bind(t.endpoint).run();
          await env.DB.prepare("DELETE FROM push_queue WHERE endpoint = ?").bind(t.endpoint).run();
        } catch (_) {}
      }
    }
  }

  // Alle aktuellen als gesehen markieren (baut die Basislinie auf; neue
  // Abonnenten bekommen dadurch nur künftige Einsätze, nicht den Rückstand).
  try {
    for (const n of nums) {
      await env.DB.prepare("INSERT OR IGNORE INTO fire_seen (n) VALUES (?)").bind(n).run();
    }
    await env.DB.prepare("DELETE FROM fire_seen WHERE at < datetime('now','-2 days')").run();
    await env.DB.prepare("DELETE FROM push_queue WHERE created_at < datetime('now','-1 day')").run();
  } catch (e) { await logError(env, "fire-cron: seen-mark " + e.message, "fire/cron"); }

  // ---- Historie schreiben (inkl. Wehren) ----
  let detailFetched = 0;
  try {
    // Bekannten Stand der aktuellen Einsätze laden → entscheiden, für welche
    // wir das Detail (Wehren/PLZ) (neu) holen. So bleibt die Upstream-Last
    // auch bei Unwetter mit vielen Einsätzen beschränkt.
    const existing = new Map();
    try {
      const rows = (await env.DB.prepare(
        `SELECT n, (dispo IS NOT NULL) AS has_dispo, last_detail FROM fire_op WHERE n IN (${nums.map(() => "?").join(",")})`
      ).bind(...nums).all()).results || [];
      for (const r of rows) existing.set(String(r.n), r);
    } catch (_) {}

    const needsDetail = e => {
      if (!e.i) return false;
      const r = existing.get(String(e.n));
      if (!r || !r.has_dispo || !r.last_detail) return true;
      const age = Date.now() - Date.parse(String(r.last_detail).replace(" ", "T") + "Z");
      return isNaN(age) || age > DETAIL_TTL_MIN * 60000;
    };

    // Kandidaten: neue (noch ohne Wehren) zuerst, dann die ältesten Details.
    const candidates = list.filter(needsDetail).sort((a, b) => {
      const na = existing.has(String(a.n)) ? 1 : 0, nb = existing.has(String(b.n)) ? 1 : 0;
      return na - nb;
    });

    const detailMap = new Map();   // n -> { plz, dispo }
    for (const e of candidates) {
      if (detailFetched >= DETAIL_CAP) break;
      try {
        const det = await fetchJsonRetry(`${BASE}/getEinsatzData.ashx?id=${encodeURIComponent(e.i)}`, 2);
        let dispo = null;
        if (det && Array.isArray(det.Dispo) && det.Dispo.length) {
          dispo = JSON.stringify(det.Dispo.map(u => ({ n: u.n, s: u.s, dt: u.dt, ot: u.ot, it: u.it })));
        }
        detailMap.set(String(e.n), { plz: det && det.p ? String(det.p) : "", dispo });
        detailFetched++;
      } catch (_) { /* dieses Detail eben nicht — Liste reicht als Minimum */ }
    }

    for (const e of list) {
      const det = detailMap.get(String(e.n));
      const touched = det ? 1 : 0;
      await env.DB.prepare(
        `INSERT INTO fire_op (n, m, a, o, o2, b, plz, d, t, dispo, last_detail, last_seen, ended)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${touched ? "CURRENT_TIMESTAMP" : "NULL"}, CURRENT_TIMESTAMP, 0)
         ON CONFLICT(n) DO UPDATE SET m=excluded.m, a=excluded.a, o=excluded.o, o2=excluded.o2, b=excluded.b,
           plz=COALESCE(NULLIF(excluded.plz,''), fire_op.plz),
           d=COALESCE(NULLIF(excluded.d,''), fire_op.d),
           t=COALESCE(NULLIF(excluded.t,''), fire_op.t),
           dispo=COALESCE(excluded.dispo, fire_op.dispo),
           ${touched ? "last_detail=CURRENT_TIMESTAMP," : ""}
           last_seen=CURRENT_TIMESTAMP, ended=0, ended_at=NULL`
      ).bind(String(e.n), e.m || "", e.a || "", e.o || "", e.o2 || "", String(e.b || ""),
             det ? det.plz : "", e.d || "", e.t || "", det ? det.dispo : null).run();
    }

    const placeholders = nums.map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE fire_op SET ended=1, ended_at=CURRENT_TIMESTAMP WHERE ended=0 AND n NOT IN (${placeholders})`
    ).bind(...nums).run();

    // Dauerhafte Tages-Aggregate: beendete Einsätze idempotent (rolled-Flag)
    // in fire_stat_daily rollen, BEVOR die Rohzeilen (>3 Tage) gelöscht werden.
    // So bleiben Trends über Wochen erhalten, obwohl fire_op nur 3 Tage hält.
    await env.DB.prepare(
      `INSERT INTO fire_stat_daily (day, b, kind, n, dur_sum, dur_n)
       SELECT date(first_seen) AS day, COALESCE(b, '') AS b,
         CASE WHEN upper(substr(a,1,1)) IN ('B','T','S') THEN upper(substr(a,1,1)) ELSE 'X' END AS kind,
         COUNT(*) AS n,
         CAST(SUM(CASE WHEN ended_at IS NOT NULL THEN (julianday(ended_at)-julianday(first_seen))*86400 ELSE 0 END) AS INTEGER) AS dur_sum,
         SUM(CASE WHEN ended_at IS NOT NULL THEN 1 ELSE 0 END) AS dur_n
       FROM fire_op
       WHERE ended = 1 AND rolled = 0 AND first_seen IS NOT NULL
       GROUP BY day, b, kind
       ON CONFLICT(day, b, kind) DO UPDATE SET
         n = n + excluded.n, dur_sum = dur_sum + excluded.dur_sum, dur_n = dur_n + excluded.dur_n`
    ).run();
    await env.DB.prepare("UPDATE fire_op SET rolled = 1 WHERE ended = 1 AND rolled = 0").run();

    // 3 Tage aufheben, damit geteilte Deep-Links so lange funktionieren
    // (die App-Liste zeigt trotzdem nur die letzten 24 h — siehe noe.js).
    await env.DB.prepare("DELETE FROM fire_op WHERE ended=1 AND ended_at < datetime('now','-3 days')").run();
  } catch (e) {
    await logError(env, "fire-cron: history " + e.message, "fire/cron");
  }

  await writeHealth(env, list.length, detailFetched, "ok");
  await checkAdminAlert(env);
  return json({ ok: true, active: list.length, fresh: fresh.length, sent, detailFetched });
}

// ------------------------------------------------------------------
// Betreiber-Alarm: Da dieser Cron zuverlässig alle 2 min läuft, prüft er
// nebenbei den Plattform-Zustand und pusht bei einem Wechsel ok→Achtung
// EINMAL an den im Dashboard konfigurierten Bestenlisten-Namen (kein Spam:
// Zustand wird in app_config gemerkt). Alles best-effort — darf den Cron nie
// stören. Hinweis: „Fire-Cron hängt" kann sich hier naturgemäß nicht selbst
// melden (dann liefe dieser Code nicht); dafür bleibt das Dashboard-Banner.
// ------------------------------------------------------------------
async function checkAdminAlert(env) {
  try {
    const cfg = await env.DB.prepare("SELECT v FROM app_config WHERE k='alert_name'").first();
    const name = cfg && cfg.v;
    if (!name) return;   // Alarm aus

    const e15 = (await env.DB.prepare(
      "SELECT COUNT(*) n FROM error_log WHERE created_at > datetime('now','-15 minutes') AND msg NOT LIKE '%HTTP 522%'"
    ).first())?.n ?? 0;
    const q = (await env.DB.prepare("SELECT COUNT(*) n FROM push_queue").first())?.n ?? 0;

    const reasons = [];
    if (e15 > 15) reasons.push(`${e15} interne Fehler/15 min`);
    if (q > 200) reasons.push(`Push-Queue ${q}`);
    const bad = reasons.length > 0;

    const prev = (await env.DB.prepare("SELECT v FROM app_config WHERE k='alert_state'").first())?.v || "ok";
    const setState = s => env.DB.prepare(
      "INSERT INTO app_config (k, v) VALUES ('alert_state', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v"
    ).bind(s).run();

    if (bad && prev !== "bad") {
      await sendToName(env, name, {
        title: "⚠️ Spieleabend: Achtung",
        body: reasons.join(" · "),
        url: "/admin/",
      });
      await setState("bad");
    } else if (!bad && prev === "bad") {
      await sendToName(env, name, { title: "✅ Spieleabend: wieder ok", body: "Alle Werte normal.", url: "/admin/" });
      await setState("ok");
    }
  } catch (e) {
    await logError(env, "fire-cron: admin-alert " + e.message, "fire/cron");
  }
}
