import { json, clientIp, rateLimit } from "./_util.js";

// ====================================================================
// Betreiber-Dashboard (privat) — bündelt die ohnehin gesammelten
// Betriebsdaten an einem Ort, damit man nicht mehr einzeln wrangler-
// d1-Abfragen tippen muss.
//
//   GET /api/admin?key=<ADMIN_TOKEN>   (oder Header  x-admin-key)
//     → { scores, errors, push, fire, db }
//
// Schutz: ADMIN_TOKEN ist ein Pages-Secret (selbst erzeugt, gratis, hat
// nichts mit externen Diensten zu tun). Ohne gültigen Schlüssel: 401.
// Zusätzlich IP-Rate-Limit gegen Schlüssel-Raten.
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
  if (!(await rateLimit(env, "admin:" + clientIp(request), 20, 60))) {
    return json({ error: "Zu viele Anfragen" }, 429);
  }
  if (!keyOk(env, request)) return json({ error: "Nicht berechtigt" }, 401);

  // ---- Scores ----
  const sTotal = (await one(env, "SELECT COUNT(*) n FROM scores"))?.n ?? 0;
  const s24 = (await one(env, "SELECT COUNT(*) n FROM scores WHERE created_at > datetime('now','-1 day')"))?.n ?? 0;
  // SQLite: bei MAX() liefern die nackten Spalten die Zeile des Maximums.
  const perRaw = await many(env,
    "SELECT game, name, MAX(score) top, COUNT(*) subs, COUNT(DISTINCT lower(name)) players FROM scores GROUP BY game");
  const games = {};
  for (const r of perRaw) {
    const g = baseGame(r.game);
    const e = (games[g] ||= { game: g, subs: 0, players: 0, top: 0, topName: null });
    e.subs += r.subs;
    e.players = Math.max(e.players, r.players);  // Näherung (Overall dominiert)
    if (r.top > e.top) { e.top = r.top; e.topName = r.name; }
  }

  // ---- Fehler-Log ----
  const eTotal = (await one(env, "SELECT COUNT(*) n FROM error_log"))?.n ?? 0;
  const e24 = (await one(env, "SELECT COUNT(*) n FROM error_log WHERE created_at > datetime('now','-1 day')"))?.n ?? 0;
  const eLatest = await many(env,
    "SELECT created_at, page, msg FROM error_log ORDER BY id DESC LIMIT 15");

  // ---- Push ----
  const pSubs = (await one(env, "SELECT COUNT(*) n FROM push_sub"))?.n ?? 0;
  const pQueue = (await one(env, "SELECT COUNT(*) n FROM push_queue"))?.n ?? 0;

  // ---- Fire ----
  const fh = await one(env, "SELECT last_run, active, detail_fetched, note FROM fire_health WHERE k='cron'");
  const fOpen = (await one(env, "SELECT COUNT(*) n FROM fire_op WHERE ended=0"))?.n ?? 0;
  const fKept = (await one(env, "SELECT COUNT(*) n FROM fire_op"))?.n ?? 0;

  // ---- DB-Hilfstabellen ----
  const rate = (await one(env, "SELECT COUNT(*) n FROM rate"))?.n ?? 0;
  const usedTok = (await one(env, "SELECT COUNT(*) n FROM used_token"))?.n ?? 0;

  return json({
    generatedAt: new Date().toISOString(),
    scores: { total: sTotal, last24h: s24, games: Object.values(games).sort((a, b) => b.subs - a.subs) },
    errors: { total: eTotal, last24h: e24, latest: eLatest },
    push: { subscriptions: pSubs, queued: pQueue },
    fire: {
      lastRun: fh?.last_run || null, ageSec: ageSec(fh?.last_run),
      active: fh?.active ?? null, detailFetched: fh?.detail_fetched ?? null,
      note: fh?.note || null, openOps: fOpen, keptOps: fKept,
    },
    db: { rateRows: rate, usedTokens: usedTok },
  });
}
