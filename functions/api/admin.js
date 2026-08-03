import { json, clientIp, rateLimit } from "./_util.js";

// ====================================================================
// Betreiber-Dashboard (privat) — bündelt die ohnehin gesammelten
// Betriebsdaten an einem Ort und erlaubt ein paar geschützte Aktionen.
//
//   GET  /api/admin              (Header x-admin-key ODER ?key=)
//     → { status, scores, errors, push, fire, db, trends, recent, banned }
//   POST /api/admin              (Header x-admin-key, JSON { action, … })
//     → clearErrors | clear522 | flushQueue | deleteScore{id}
//       | banDevice{device} | unbanDevice{device} | triggerCron
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

const one = async (env, sql, ...bind) => {
  try { return await env.DB.prepare(sql).bind(...bind).first(); } catch { return null; }
};
const many = async (env, sql, ...bind) => {
  try { return (await env.DB.prepare(sql).bind(...bind).all()).results || []; } catch { return []; }
};

export async function onRequestGet({ request, env }) {
  if (!(await rateLimit(env, "admin:" + clientIp(request), 30, 60))) {
    return json({ error: "Zu viele Anfragen" }, 429);
  }
  if (!keyOk(env, request)) return json({ error: "Nicht berechtigt" }, 401);

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

  // Trend-Zeitraum (validiert → sichere Zahl für die Interpolation unten)
  const days = [7, 30, 90].includes(+url.searchParams.get("days")) ? +url.searchParams.get("days") : 30;

  // ---- Scores ----
  const sTotal = (await one(env, "SELECT COUNT(*) n FROM scores"))?.n ?? 0;
  const s24 = (await one(env, "SELECT COUNT(*) n FROM scores WHERE created_at > datetime('now','-1 day')"))?.n ?? 0;
  const perRaw = await many(env,
    "SELECT game, name, MAX(score) top, COUNT(*) subs, COUNT(DISTINCT lower(name)) players FROM scores GROUP BY game");
  const games = {};
  for (const r of perRaw) {
    const g = baseGame(r.game);
    const e = (games[g] ||= { game: g, subs: 0, players: 0, top: 0, topName: null });
    e.subs += r.subs;
    e.players = Math.max(e.players, r.players);
    if (r.top > e.top) { e.top = r.top; e.topName = r.name; }
  }

  // ---- Fehler-Log: Gesamt, gruppiert (24h), letzte roh (inkl. UA), 522 separat ----
  const eTotal = (await one(env, "SELECT COUNT(*) n FROM error_log"))?.n ?? 0;
  const e24 = (await one(env, "SELECT COUNT(*) n FROM error_log WHERE created_at > datetime('now','-1 day')"))?.n ?? 0;
  const e522 = (await one(env, "SELECT COUNT(*) n FROM error_log WHERE created_at > datetime('now','-1 day') AND msg LIKE '%HTTP 522%'"))?.n ?? 0;
  const eTop = await many(env,
    "SELECT msg, COUNT(*) n, MAX(created_at) last, MAX(page) page FROM error_log " +
    "WHERE created_at > datetime('now','-1 day') GROUP BY msg ORDER BY n DESC LIMIT 20");
  const eLatest = await many(env,
    "SELECT created_at, page, msg, ua FROM error_log ORDER BY id DESC LIMIT 25");

  // ---- Push ----
  const pSubs = (await one(env, "SELECT COUNT(*) n FROM push_sub"))?.n ?? 0;
  const pQueue = (await one(env, "SELECT COUNT(*) n FROM push_queue"))?.n ?? 0;
  const pOldest = (await one(env, "SELECT MIN(created_at) t FROM push_queue"))?.t || null;

  // ---- Fire ----
  const fh = await one(env, "SELECT last_run, active, detail_fetched, note FROM fire_health WHERE k='cron'");
  const fOpen = (await one(env, "SELECT COUNT(*) n FROM fire_op WHERE ended=0"))?.n ?? 0;
  const fKept = (await one(env, "SELECT COUNT(*) n FROM fire_op"))?.n ?? 0;

  // ---- DB-Hilfstabellen ----
  const rate = (await one(env, "SELECT COUNT(*) n FROM rate"))?.n ?? 0;
  const usedTok = (await one(env, "SELECT COUNT(*) n FROM used_token"))?.n ?? 0;

  // ---- Trends (Zeitraum wählbar 7/30/90 Tage, roh je Tag; Client füllt Lücken) ----
  const tScores = await many(env, `SELECT date(created_at) d, COUNT(*) n FROM scores WHERE created_at > datetime('now','-${days} days') GROUP BY d`);
  const tErrors = await many(env, `SELECT date(created_at) d, COUNT(*) n FROM error_log WHERE created_at > datetime('now','-${days} days') GROUP BY d`);
  const tDevices = await many(env, `SELECT date(created_at) d, COUNT(DISTINCT device) n FROM scores WHERE created_at > datetime('now','-${days} days') AND device IS NOT NULL GROUP BY d`);
  const alertName = (await one(env, "SELECT v FROM app_config WHERE k='alert_name'"))?.v || "";

  // ---- Moderation: letzte Einsendungen + gesperrte Geräte ----
  const recent = await many(env,
    "SELECT id, game, name, device, score, substr(meta,1,140) meta, created_at FROM scores ORDER BY id DESC LIMIT 40");
  const banned = await many(env, "SELECT device, at FROM banned_device ORDER BY at DESC LIMIT 100");

  // ---- Gesamtstatus (Ampel) ----
  const fAge = ageSec(fh?.last_run);
  let status = "ok";
  const warns = [];
  if (fAge == null || fAge > 900) { status = "warn"; warns.push(fAge == null ? "Fire-Cron: kein Lauf" : "Fire-Cron verzögert"); }
  if (fh?.note && fh.note !== "ok") { status = "warn"; warns.push("Fire: " + fh.note); }
  if (e24 - e522 > 20) { status = "warn"; warns.push(`${e24 - e522} interne Fehler/24 h`); }
  if (pQueue > 200) { status = "warn"; warns.push(`Push-Queue: ${pQueue}`); }

  return json({
    generatedAt: new Date().toISOString(),
    status, warns,
    scores: { total: sTotal, last24h: s24, games: Object.values(games).sort((a, b) => b.subs - a.subs) },
    errors: { total: eTotal, last24h: e24, upstream522: e522, top: eTop, latest: eLatest },
    push: { subscriptions: pSubs, queued: pQueue, oldestAgeSec: ageSec(pOldest) },
    fire: {
      lastRun: fh?.last_run || null, ageSec: fAge,
      active: fh?.active ?? null, detailFetched: fh?.detail_fetched ?? null,
      note: fh?.note || null, openOps: fOpen, keptOps: fKept,
    },
    db: { rateRows: rate, usedTokens: usedTok, bannedDevices: banned.length },
    trends: { days, scores: tScores, errors: tErrors, devices: tDevices },
    alert: { name: alertName },
    recent, banned,
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await rateLimit(env, "adminw:" + clientIp(request), 30, 60))) {
    return json({ error: "Zu viele Anfragen" }, 429);
  }
  if (!keyOk(env, request)) return json({ error: "Nicht berechtigt" }, 401);

  const b = await request.json().catch(() => ({}));
  const action = String(b.action || "");
  const run = (sql, ...bind) => env.DB.prepare(sql).bind(...bind).run();

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
      case "setAlert": {
        // Bestenlisten-Name, an den bei „Achtung" gepusht wird (leer = aus).
        const name = String(b.name || "").trim().slice(0, 16);
        await run("INSERT INTO app_config (k, v) VALUES ('alert_name', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", name);
        return json({ ok: true, name });
      }
      case "triggerCron": {
        const token = env && env.CRON_TOKEN;
        if (!token) return json({ error: "CRON_TOKEN nicht gesetzt" }, 400);
        const origin = new URL(request.url).origin;
        const res = await fetch(`${origin}/api/fire/cron?key=${encodeURIComponent(token)}`);
        return json({ ok: res.ok, cronStatus: res.status });
      }
      default:
        return json({ error: "Unbekannte Aktion" }, 400);
    }
  } catch (e) {
    return json({ error: "Aktion fehlgeschlagen: " + (e && e.message) }, 500);
  }
}
