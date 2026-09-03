import { json, clientIp, rateLimit, one, many } from "./_util.js";
import { opsEvaluate } from "./_ops.js";
import { cfStats } from "./_cf.js";
import { BEZIRK } from "./fire/_bezirk.js";
import { generate, loadCfg } from "./briefing/_gen.js";

// ====================================================================
// Betreiber-Dashboard (privat) — bündelt die ohnehin gesammelten
// Betriebsdaten an einem Ort und erlaubt ein paar geschützte Aktionen.
//
//   GET  /api/admin[?view=…]      (Header x-admin-key ODER ?key=)
//     → { status, scores, errors, push, fire, db, trends, recent, banned, ops }
//     view = ueberblick | fehler | moderation | system (Standard: alles).
//     Das Panel hat vier Ansichten; ohne view lädt es für jede davon auch die
//     Daten der anderen drei. Die Antwort enthält IMMER alle Schlüssel — nur
//     eben leer für die Gruppen, die diese Ansicht nicht braucht.
//   POST /api/admin              (Header x-admin-key, JSON { action, … })
//     → clearErrors | clear522 | flushQueue | deleteScore{id}
//       | banDevice{device} | unbanDevice{device} | triggerCron | refreshCf
//       | saveBriefing{…} | briefingNow{push?}
//
// Fehlgeschlagene Zugriffe landen als "auth:fail" im admin_log (max. 1 Zeile
// pro IP und Minute, damit ein Brute-Force-Versuch das Protokoll nicht mit
// sich selbst zuschüttet). Der versuchte Schlüssel wird NIE gespeichert.
//
// Schutz: ADMIN_TOKEN ist ein Pages-Secret (selbst erzeugt, gratis, hat
// nichts mit externen Diensten zu tun). Ohne gültigen Schlüssel: 401.
// Schreib-Aktionen laufen nur per POST mit x-admin-key-Header — Browser
// senden den Header nicht cross-origin, das macht sie CSRF-resistent.
// ====================================================================

function keyOk(env, request) {
  const want = env && env.ADMIN_TOKEN;
  if (!want) return false;                       // ohne gesetztes Secret gesperrt
  const url = new URL(request.url);
  const got = request.headers.get("x-admin-key") || url.searchParams.get("key") || "";
  if (got.length !== want.length) return false;  // konstantzeitiger Vergleich
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

// Basis-Spielname ohne :daily/:weekly-Suffix.
function baseGame(g) { const i = String(g).indexOf(":"); return i < 0 ? g : String(g).slice(0, i); }

// "YYYY-MM-DD HH:MM:SS" (UTC) → Alter in Sekunden.
function ageSec(s) {
  if (!s) return null;
  const t = Date.parse(String(s).replace(" ", "T") + "Z");
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null;
}

// one()/many() kommen jetzt aus _util.js (früher hier privat dupliziert).

// Fehlgeschlagener Zugriff → eine Zeile ins Audit-Log. Gedrosselt auf 1×/IP
// und Minute: sonst verdrängt ein Brute-Force-Versuch mit seinen eigenen
// Zeilen genau die echten Einträge, die man danach sehen will.
// Protokolliert wird NUR, DASS ein Schlüssel mitkam — niemals welcher.
async function logAuthFail(env, request, method) {
  try {
    const ip = clientIp(request);
    if (!(await rateLimit(env, "adminfail:" + ip, 1, 60))) return;
    const url = new URL(request.url);
    const via = request.headers.get("x-admin-key") ? "Header" : (url.searchParams.get("key") ? "URL" : "ohne");
    await env.DB.prepare("INSERT INTO admin_log (action, detail, ip) VALUES ('auth:fail', ?, ?)")
      .bind(`${method} · Schlüssel: ${via}`, ip).run();
  } catch (_) { /* Protokoll darf den Ablauf nie stören */ }
}

export async function onRequestGet({ request, env }) {
  if (!(await rateLimit(env, "admin:" + clientIp(request), 30, 60))) {
    return json({ error: "Zu viele Anfragen" }, 429);
  }
  if (!keyOk(env, request)) {
    await logAuthFail(env, request, "GET");
    return json({ error: "Nicht berechtigt" }, 401);
  }

  const url = new URL(request.url);

  // Sub-Abfrage: echte Bestenliste eines Spiels (Top 50), mit Row-id zum Löschen —
  // erwischt auch alte, eingenistete Fake-Scores, die in „letzte Einsendungen" fehlen.
  const board = url.searchParams.get("board");
  if (board) {
    const rows = await many(env,
      "SELECT id, name, device, MAX(score) score, created_at FROM scores WHERE game = ? GROUP BY lower(name) ORDER BY score DESC LIMIT 50", board);
    return json({ board, rows });
  }
  // Sub-Abfrage: Suche nach Name ODER Gerät über alle Spiele (Beweislage vor dem Sperren).
  const search = url.searchParams.get("search");
  if (search != null) {
    const q = String(search).trim().slice(0, 40).toLowerCase();
    if (!q) return json({ q: "", rows: [] });
    const like = "%" + q + "%";
    const rows = await many(env,
      "SELECT id, game, name, device, score, created_at FROM scores WHERE lower(name) LIKE ? OR lower(device) LIKE ? ORDER BY id DESC LIMIT 100", like, like);
    return json({ q, rows });
  }

  // Welche Ansicht fragt? Unbekanntes → alles (auch für Aufrufe per curl).
  const VIEWS = ["ueberblick", "fehler", "moderation", "system"];
  const view = String(url.searchParams.get("view") || "");

  // Trend-Zeitraum (validiert → sichere Zahl für die Interpolation unten)
  const days = [7, 30, 90].includes(+url.searchParams.get("days")) ? +url.searchParams.get("days") : 30;

  // Quiz-Meldungen (page='quiz-report') sind KEINE Fehler → aus allen
  // Fehler-Zahlen und -Listen ausschließen (eigener Block weiter unten),
  // damit die Ampel sauber bleibt.
  const NOREP = "page IS NOT 'quiz-report'";
  const cnt = (sql, ...a) => one(env, sql, ...a).then(r => r?.n ?? 0);

  // Nur laden, was die aufrufende Ansicht zeigt. `q(bedingung, fn, ersatz)`
  // nimmt die Abfrage als Funktion, damit sie bei false gar nicht erst
  // losgeschickt wird.
  const q = (cond, fn, fallback) => (cond ? fn() : Promise.resolve(fallback));
  const vAll = !VIEWS.includes(view);
  const vU = vAll || view === "ueberblick";
  const vF = vAll || view === "fehler";
  const vM = vAll || view === "moderation";
  const vS = vAll || view === "system";

  // Immer dabei: alles, was Statuszeile und Reiter-Zähler brauchen — die
  // stehen in JEDER Ansicht.
  const [
    sTotal, s24, perRaw,
    reachTotal, reachNew7, reachActive7, reachReturning,
    eTotal, e24, e522, eTop, eLatest,
    clTotal, cl24, clLatest,
    pSubs, pQueue, pOldestRow,
    fh, fOpen, fKept,
    shRow, sAlerts, sSubs, sLog,
    rate, usedTok,
    kPlayers, kGames, kTop, kEntries,
    qPlayers, qGames, qTop, qEntries, qReportCount, qReports,
    liveRooms, adminLog,
    tScores, tErrors, tDevices, alertRow, usage,
    recent, banned, tableRows, health,
    opsLastRow, opsLog, cf, aiToday, briefingCfg, briefingLast,
  ] = await Promise.all([
    // ---- Scores ----
    q(vU, () => cnt("SELECT COUNT(*) n FROM scores"), 0),
    q(vU, () => cnt("SELECT COUNT(*) n FROM scores WHERE created_at > datetime('now','-1 day')"), 0),
    q(vU, () => many(env, "SELECT game, name, MAX(score) top, COUNT(*) subs, COUNT(DISTINCT lower(name)) players FROM scores GROUP BY game"), []),

    // ---- Reichweite: die Zahl, an der alles andere hängt ----
    // Namen sind frei gewählt und nicht eindeutig — das ist die beste
    // verfügbare Näherung für „Menschen", ohne irgendwas mitzuschneiden.
    q(vU, () => cnt("SELECT COUNT(DISTINCT lower(name)) n FROM scores"), 0),
    q(vU, () => cnt("SELECT COUNT(*) n FROM (SELECT lower(name) nm, MIN(created_at) f FROM scores GROUP BY lower(name)) WHERE f > datetime('now','-7 days')"), 0),
    q(vU, () => cnt("SELECT COUNT(DISTINCT lower(name)) n FROM scores WHERE created_at > datetime('now','-7 days')"), 0),
    q(vU, () => cnt("SELECT COUNT(*) n FROM (SELECT lower(name) nm, COUNT(DISTINCT date(created_at)) dd FROM scores GROUP BY lower(name)) WHERE dd >= 2"), 0),

    // ---- Fehler-Log ----
    q(vF, () => cnt(`SELECT COUNT(*) n FROM error_log WHERE ${NOREP}`), 0),
    cnt(`SELECT COUNT(*) n FROM error_log WHERE created_at > datetime('now','-1 day') AND ${NOREP}`),   // Ampel + Reiter
    cnt("SELECT COUNT(*) n FROM error_log WHERE created_at > datetime('now','-1 day') AND msg LIKE '%HTTP 522%'"),
    // Gruppiert über die GANZE Tabelle, gefiltert auf 24 h per HAVING: so
    // kommt firstSeen (erstes Auftreten überhaupt) in EINEM Durchlauf mit —
    // damit lässt sich „neue Fehlerart" von „altem Bekannten" unterscheiden.
    q(vF, () => many(env,
      `SELECT msg, MAX(created_at) last, MAX(page) page, MIN(created_at) firstSeen, COUNT(*) total,` +
      ` SUM(CASE WHEN created_at > datetime('now','-1 day') THEN 1 ELSE 0 END) n` +
      ` FROM error_log WHERE ${NOREP} GROUP BY msg HAVING n > 0 ORDER BY n DESC LIMIT 20`), []),
    // extra = Zusatzkontext aus logError(env, msg, page, extra). Wurde bisher
    // geschrieben, aber nie gelesen.
    q(vF, () => many(env, `SELECT created_at, page, msg, ua, extra FROM error_log WHERE ${NOREP} ORDER BY id DESC LIMIT 25`), []),

    // ---- Client-Fehler (Geräte, /api/log) ----
    q(vF, () => cnt("SELECT COUNT(*) n FROM client_log"), 0),
    cnt("SELECT COUNT(*) n FROM client_log WHERE created_at > datetime('now','-1 day')"),                // Reiter-Zähler
    q(vF, () => many(env, "SELECT created_at, page, msg, ua, extra FROM client_log ORDER BY id DESC LIMIT 25"), []),

    // ---- Push ----
    q(vS, () => cnt("SELECT COUNT(*) n FROM push_sub"), 0),
    cnt("SELECT COUNT(*) n FROM push_queue"),                                                            // Ampel
    q(vS, () => one(env, "SELECT MIN(created_at) t FROM push_queue"), null),

    // ---- Fire (Ampel braucht die Zeile immer) ----
    one(env, "SELECT last_run, active, detail_fetched, note FROM fire_health WHERE k='cron'"),
    q(vS, () => cnt("SELECT COUNT(*) n FROM fire_op WHERE ended=0"), 0),
    q(vS, () => cnt("SELECT COUNT(*) n FROM fire_op"), 0),

    // ---- Sprit (Preis-Alarm; Alter geht in die Ampel) ----
    one(env, "SELECT v FROM app_config WHERE k='sprit_cron_at'"),
    q(vS, () => cnt("SELECT COUNT(*) n FROM sprit_alert"), 0),
    q(vS, () => cnt("SELECT COUNT(DISTINCT endpoint) n FROM sprit_alert"), 0),
    q(vS, () => cnt("SELECT COUNT(*) n FROM sprit_price_log"), 0),

    // ---- DB-Hilfstabellen ----
    q(vS, () => cnt("SELECT COUNT(*) n FROM rate"), 0),
    q(vS, () => cnt("SELECT COUNT(*) n FROM used_token"), 0),

    // ---- Kritzeln & Raten ----
    q(vU || vM, () => cnt("SELECT COUNT(*) n FROM draw_score"), 0),
    q(vU, () => cnt("SELECT COALESCE(SUM(wins),0) n FROM draw_score"), 0),   // je Spiel genau 1 Sieg
    q(vU, () => one(env, "SELECT name, points FROM draw_score ORDER BY points DESC LIMIT 1"), null),
    q(vM, () => many(env, "SELECT name, points, games, wins, best FROM draw_score ORDER BY points DESC LIMIT 50"), []),

    // ---- Wer weiß's? (Quiz) ----
    q(vU || vM, () => cnt("SELECT COUNT(*) n FROM quiz_score"), 0),
    q(vU, () => cnt("SELECT COALESCE(SUM(wins),0) n FROM quiz_score"), 0),    // je Spiel genau 1 Sieg
    q(vU, () => one(env, "SELECT name, points FROM quiz_score ORDER BY points DESC LIMIT 1"), null),
    q(vM, () => many(env, "SELECT name, points, games, wins, best FROM quiz_score ORDER BY points DESC LIMIT 50"), []),
    cnt("SELECT COUNT(*) n FROM error_log WHERE page = 'quiz-report'"),                                  // Reiter-Zähler
    q(vF, () => many(env, "SELECT id, created_at, msg, extra FROM error_log WHERE page = 'quiz-report' ORDER BY id DESC LIMIT 40"), []),

    // ---- Live-Räume + Audit-Log ----
    // Nur frische Zeilen; das Wegräumen alter macht der Cron (sweepStale),
    // nicht diese Anzeige.
    q(vU, () => many(env, "SELECT code, game, players, state, updated_at FROM live_room WHERE updated_at > datetime('now','-2 minutes') AND players > 0 ORDER BY updated_at DESC LIMIT 50"), []),
    q(vS, () => many(env, "SELECT action, detail, created_at FROM admin_log ORDER BY id DESC LIMIT 40"), []),

    // ---- Trends (Zeitraum 7/30/90 Tage, roh je Tag; Client füllt Lücken) ----
    q(vU, () => many(env, `SELECT date(created_at) d, COUNT(*) n FROM scores WHERE created_at > datetime('now','-${days} days') GROUP BY d`), []),
    q(vU, () => many(env, `SELECT date(created_at) d, COUNT(*) n FROM error_log WHERE created_at > datetime('now','-${days} days') GROUP BY d`), []),
    q(vU, () => many(env, `SELECT date(created_at) d, COUNT(DISTINCT device) n FROM scores WHERE created_at > datetime('now','-${days} days') AND device IS NOT NULL GROUP BY d`), []),
    q(vS, () => one(env, "SELECT v FROM app_config WHERE k='alert_name'"), null),

    // ---- Nutzungszähler (anonym, aggregiert): play/duel/share je Spiel ----
    // ai:*-Schlüssel gehören nicht in die Spiele-Tabelle (eigene Karte).
    q(vU, () => many(env, `SELECT k, SUM(n) n FROM stat_daily WHERE day > date('now','-${days} days') AND k NOT LIKE 'ai:%' GROUP BY k ORDER BY n DESC`), []),

    // ---- Moderation ----
    q(vM, () => many(env, "SELECT id, game, name, device, score, substr(meta,1,140) meta, created_at FROM scores ORDER BY id DESC LIMIT 40"), []),
    q(vM || vS, () => many(env, "SELECT device, at FROM banned_device ORDER BY at DESC LIMIT 100"), []),

    // ---- Tabellengrößen: was wächst unbemerkt? (eine Abfrage) ----
    q(vS, () => one(env,
      "SELECT (SELECT COUNT(*) FROM scores) scores," +
      " (SELECT COUNT(*) FROM error_log) error_log," +
      " (SELECT COUNT(*) FROM client_log) client_log," +
      " (SELECT COUNT(*) FROM rate) rate," +
      " (SELECT COUNT(*) FROM used_token) used_token," +
      " (SELECT COUNT(*) FROM sprit_price_log) sprit_price_log," +
      " (SELECT COUNT(*) FROM sprit_alert) sprit_alert," +
      " (SELECT COUNT(*) FROM stat_daily) stat_daily," +
      " (SELECT COUNT(*) FROM push_queue) push_queue," +
      " (SELECT COUNT(*) FROM push_sub) push_sub," +
      " (SELECT COUNT(*) FROM fire_op) fire_op," +
      " (SELECT COUNT(*) FROM ops_log) ops_log," +
      " (SELECT COUNT(*) FROM admin_log) admin_log"), null),

    // ---- Health (Cron-Totmann + VAPID) — geht in die Ampel ----
    fetch(new URL("/api/health", request.url).toString(), { headers: { "User-Agent": "admin/health" } })
      .then(r => r.json()).catch(() => null),

    // ---- Vorfall-Verlauf: letzter Wechsel (für „seit … ok") + Liste ----
    one(env, "SELECT at, status FROM ops_log ORDER BY id DESC LIMIT 1").catch(() => null),
    q(vS, () => many(env, "SELECT at, status, reasons FROM ops_log ORDER BY id DESC LIMIT 20"), []),

    // ---- Cloudflare-Kontingente (10 min zwischengespeichert) ----
    q(vS, () => cfStats(env), null),

    // ---- KI-Aufrufe HEUTE je Anlass (eigener Zähler; Cloudflare kennt nur
    // die Summe, weil beide Anlässe dasselbe Modell benutzen) ----
    q(vS, () => many(env, "SELECT k, n FROM stat_daily WHERE day = date('now') AND k LIKE 'ai:%' ORDER BY n DESC"), []),

    // ---- Tages-Briefing: Einstellungen + letzter Text ----
    q(vS, () => loadCfg(env), null),
    q(vS, () => one(env, "SELECT day, via, at, substr(text,1,300) text FROM briefing ORDER BY day DESC LIMIT 1"), null),
  ]);

  // Einsendungen je Spiel: :daily/:weekly auf das Basisspiel zusammenfassen
  const games = {};
  for (const r of perRaw) {
    const g = baseGame(r.game);
    const e = (games[g] ||= { game: g, subs: 0, players: 0, top: 0, topName: null });
    e.subs += r.subs;
    e.players = Math.max(e.players, r.players);
    if (r.top > e.top) { e.top = r.top; e.topName = r.name; }
  }

  const pOldest = pOldestRow?.t || null;
  const sh = shRow?.v || null;
  const sAge = sh ? Math.max(0, Math.round((Date.now() - Date.parse(sh)) / 1000)) : null;   // ISO → Alter
  const alertName = alertRow?.v || "";

  // ---- Gesamtstatus (Ampel) — dieselbe Bewertung wie der Push-Alarm ----
  const fAge = ageSec(fh?.last_run);
  const { status, warns } = opsEvaluate({
    fireAgeSec: fAge,
    fireNote: fh?.note || null,
    errCount: e24 - e522,          // 522 kommt von außen und zählt nicht als unser Fehler
    errWindowMin: 1440,
    pushQueue: pQueue,
    spritAgeSec: sAge,
    healthCronOk: health && health.cron ? health.cron.ok : null,
    vapid: health ? health.vapid : null,
  });

  return json({
    generatedAt: new Date().toISOString(),
    view: vAll ? "all" : view,
    status, warns,
    scores: { total: sTotal, last24h: s24, games: Object.values(games).sort((a, b) => b.subs - a.subs) },
    errors: { total: eTotal, last24h: e24, upstream522: e522, top: eTop, latest: eLatest },
    push: { subscriptions: pSubs, queued: pQueue, oldestAgeSec: ageSec(pOldest) },
    fire: {
      lastRun: fh?.last_run || null, ageSec: fAge,
      active: fh?.active ?? null, detailFetched: fh?.detail_fetched ?? null,
      note: fh?.note || null, openOps: fOpen, keptOps: fKept,
    },
    sprit: { lastRun: sh, ageSec: sAge, alerts: sAlerts, subscribers: sSubs, priceLog: sLog },
    db: { rateRows: rate, usedTokens: usedTok, bannedDevices: banned.length, tables: tableRows || {} },
    reach: { players: reachTotal, new7: reachNew7, active7: reachActive7, returning: reachReturning },
    ops: { since: opsLastRow?.at || null, sinceStatus: opsLastRow?.status || null, log: opsLog },
    cf,
    aiToday,
    briefing: { cfg: briefingCfg, last: briefingLast, bezirke: BEZIRK },
    kritzeln: { players: kPlayers, games: kGames, topName: kTop?.name || null, topPoints: kTop?.points ?? 0, entries: kEntries },
    quiz: { players: qPlayers, games: qGames, topName: qTop?.name || null, topPoints: qTop?.points ?? 0, entries: qEntries, reportCount: qReportCount, reports: qReports },
    live: { rooms: liveRooms },
    clientErrors: { total: clTotal, last24h: cl24, latest: clLatest },
    health,
    adminLog,
    trends: { days, scores: tScores, errors: tErrors, devices: tDevices },
    usage,
    alert: { name: alertName },
    recent, banned,
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await rateLimit(env, "adminw:" + clientIp(request), 30, 60))) {
    return json({ error: "Zu viele Anfragen" }, 429);
  }
  if (!keyOk(env, request)) {
    await logAuthFail(env, request, "POST");
    return json({ error: "Nicht berechtigt" }, 401);
  }

  const b = await request.json().catch(() => ({}));
  const action = String(b.action || "");
  const run = (sql, ...bind) => env.DB.prepare(sql).bind(...bind).run();

  // Audit: jede geschützte Aktion (auch fehlgeschlagene Versuche) protokollieren.
  if (action) {
    const detail = [b.name, b.device, b.id, b.which].filter(v => v != null && v !== "").join(" ").slice(0, 120);
    try { await env.DB.prepare("INSERT INTO admin_log (action, detail, ip) VALUES (?, ?, ?)").bind(action, detail || null, clientIp(request)).run(); } catch (_) {}
  }

  try {
    switch (action) {
      case "clearErrors": {
        const r = await run("DELETE FROM error_log");
        return json({ ok: true, deleted: r?.meta?.changes ?? null });
      }
      case "clear522": {
        const r = await run("DELETE FROM error_log WHERE msg LIKE '%HTTP 522%'");
        return json({ ok: true, deleted: r?.meta?.changes ?? null });
      }
      case "flushQueue": {
        const r = await run("DELETE FROM push_queue");
        return json({ ok: true, deleted: r?.meta?.changes ?? null });
      }
      case "deleteScore": {
        const id = Number(b.id);
        if (!Number.isInteger(id)) return json({ error: "Ungültige id" }, 400);
        const r = await run("DELETE FROM scores WHERE id = ?", id);
        return json({ ok: true, deleted: r?.meta?.changes ?? null });
      }
      case "banDevice": {
        const device = String(b.device || "").trim();
        if (!/^[A-Za-z0-9_-]{8,40}$/.test(device)) return json({ error: "Ungültiges Gerät" }, 400);
        await run("INSERT OR IGNORE INTO banned_device (device) VALUES (?)", device);
        const r = await run("DELETE FROM scores WHERE device = ?", device);
        return json({ ok: true, removedScores: r?.meta?.changes ?? null });
      }
      case "unbanDevice": {
        const device = String(b.device || "").trim();
        await run("DELETE FROM banned_device WHERE device = ?", device);
        return json({ ok: true });
      }
      case "deleteDraw": {
        const name = String(b.name || "").trim();
        if (!name) return json({ error: "kein Name" }, 400);
        const r = await run("DELETE FROM draw_score WHERE name = ?", name);
        return json({ ok: true, deleted: r?.meta?.changes ?? null });
      }
      case "clearDraw": {
        const r = await run("DELETE FROM draw_score");
        return json({ ok: true, deleted: r?.meta?.changes ?? null });
      }
      case "deleteQuiz": {
        const name = String(b.name || "").trim();
        if (!name) return json({ error: "kein Name" }, 400);
        const r = await run("DELETE FROM quiz_score WHERE name = ?", name);
        return json({ ok: true, deleted: r?.meta?.changes ?? null });
      }
      case "clearQuiz": {
        const r = await run("DELETE FROM quiz_score");
        return json({ ok: true, deleted: r?.meta?.changes ?? null });
      }
      case "clearQuizReports": {
        const r = await run("DELETE FROM error_log WHERE page = 'quiz-report'");
        return json({ ok: true, deleted: r?.meta?.changes ?? null });
      }
      case "deleteQuizReport": {
        const id = Number(b.id);
        if (!Number.isInteger(id)) return json({ error: "Ungültige id" }, 400);
        const r = await run("DELETE FROM error_log WHERE id = ? AND page = 'quiz-report'", id);
        return json({ ok: true, deleted: r?.meta?.changes ?? null });
      }
      case "setAlert": {
        // Bestenlisten-Name, an den bei „Achtung" gepusht wird (leer = aus).
        const name = String(b.name || "").trim().slice(0, 16);
        await run("INSERT INTO app_config (k, v) VALUES ('alert_name', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", name);
        return json({ ok: true, name });
      }
      case "saveBriefing": {
        // Einstellungen des Tages-Briefings. Alles einzeln optional: ohne
        // Koordinaten kein Wetter/Sprit, ohne Bezirk keine Einsätze.
        const lat = Number(b.lat), lng = Number(b.lng);
        const okGeo = Number.isFinite(lat) && Number.isFinite(lng) && lat > 45 && lat < 50 && lng > 13 && lng < 18;
        if ((b.lat !== "" && b.lat != null) && !okGeo) return json({ error: "Koordinaten außerhalb Österreichs" }, 400);
        const bez = String(b.bezirk || "").trim();
        if (bez && !/^\d{2,3}$/.test(bez)) return json({ error: "Ungültiger Bezirks-Code" }, 400);
        const vals = {
          briefing_on: b.on ? "1" : "0",
          briefing_hour: String(Math.min(23, Math.max(0, Number(b.hour) || 0))),
          briefing_name: String(b.name || "").trim().slice(0, 16),
          briefing_lat: okGeo ? String(lat) : "",
          briefing_lng: okGeo ? String(lng) : "",
          briefing_fuel: ["DIE", "SUP", "GAS"].includes(String(b.fuel)) ? String(b.fuel) : "DIE",
          briefing_bezirk: bez,
        };
        for (const [k, v] of Object.entries(vals)) {
          await run("INSERT INTO app_config (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
        }
        return json({ ok: true });
      }
      case "briefingNow": {
        // Sofort erzeugen — übergeht Uhrzeit und „heute schon erledigt".
        // push:false, damit ein Test nicht jedes Mal aufs Handy klingelt.
        const r = await generate(env, { force: true, push: !!b.push });
        return json(r);
      }
      case "refreshCf": {
        // Die Cloudflare-Zahlen sind 10 Minuten zwischengespeichert (die
        // Analytics-API ist langsam und gedrosselt). maxAgeSec: 0 erzwingt
        // einen frischen Abruf — bewusst als Aktion und nicht automatisch.
        const cf = await cfStats(env, { maxAgeSec: 0 });
        return json({ ok: !cf.error, error: cf.error || null, at: cf.at || null });
      }
      case "triggerCron": {
        const token = env && env.CRON_TOKEN;
        if (!token) return json({ error: "CRON_TOKEN nicht gesetzt" }, 400);
        const which = b.which === "sprit" ? "sprit" : "fire";
        const origin = new URL(request.url).origin;
        // Sprit-Cron drosselt sich selbst → force=1 umgeht die Sperre beim Handauslösen.
        const path = which === "sprit" ? "/api/sprit/cron?force=1" : "/api/fire/cron";
        const res = await fetch(`${origin}${path}`, { headers: { "x-cron-key": token } });
        const body = await res.json().catch(() => ({}));
        return json({ ok: res.ok, cronStatus: res.status, which, result: body });
      }
      default:
        return json({ error: "Unbekannte Aktion" }, 400);
    }
  } catch (e) {
    return json({ error: "Aktion fehlgeschlagen: " + (e && e.message) }, 500);
  }
}
