import { json } from "../_util.js";

// ====================================================================
// Gemeinsame Bestenlisten-API für alle Spiele.
//
//   GET  /api/scores/:game[?daily=1|?weekly=1]  → { top: [{name, score}] }
//   GET  /api/scores/:game?token=1&device=XXX   → { token }
//   POST /api/scores/:game                      → { ok, rank, best }
//        body: { name, score, device, token, meta?, daily?, weekly? }
//
// Schutz gegen Schummeln (ohne Login, also pragmatisch):
//  - Spiel-Allowlist mit Score-Obergrenzen
//  - Plausibilitätsprüfung über mitgeschickte Spielstatistik (meta)
//  - Geräte-Token: rate-limitet Einsendungen; ein Name gehört dem
//    Gerät, das ihn zuerst benutzt hat
//  - Lauf-Token (signierter Seed): jeder POST muss ein kurz vorher
//    ausgestelltes, HMAC-signiertes Token mitschicken. Das bindet die
//    Einsendung an einen echten Seitenaufruf und einen Zeitpunkt —
//    blindes Absenden per Skript wird so deutlich erschwert.
// ====================================================================

const GAMES = {
  funkelfeld: {
    max: 500_000,
  },
  komet: {
    max: 100_000,
    // score = Meter + Funken × 5
    check: (score, m) =>
      Number.isFinite(m.meters) && Number.isFinite(m.sparks) &&
      m.meters >= 0 && m.meters <= 30_000 && m.sparks >= 0 && m.sparks <= 5_000 &&
      score === Math.round(m.meters) + m.sparks * 5,
  },
  sternensturm: {
    max: 2_000_000,
    check: (score, m) =>
      Number.isInteger(m.wave) && m.wave >= 1 && m.wave <= 300 &&
      score <= m.wave * 4_000 + 3_000,
  },
  galopp: {
    max: 2_000_000,
    daily: true,
    weekly: true,
    // score = ⌊Meter⌋ + Taler × 10
    check: (score, m) =>
      Number.isFinite(m.meters) && Number.isFinite(m.coins) &&
      m.meters >= 0 && m.meters <= 100_000 && m.coins >= 0 && m.coins <= 20_000 &&
      score === Math.floor(m.meters) + m.coins * 10,
  },
};

// Modus aus Query/Body ableiten und gegen die Spiel-Config prüfen.
function modeOf(cfg, src) {
  if (src.weekly && cfg.weekly) return "weekly";
  if (src.daily && cfg.daily) return "daily";
  return "none";
}
function keyFor(game, mode) {
  return mode === "weekly" ? `${game}:weekly` : mode === "daily" ? `${game}:daily` : game;
}
function modeCond(mode) {
  if (mode === "weekly") return " AND strftime('%Y-%W', created_at) = strftime('%Y-%W','now')";
  if (mode === "daily") return " AND date(created_at) = date('now')";
  return "";
}

// ---- Lauf-Token (HMAC-signierter Seed) ----
const SECRET_FALLBACK = "gamesite-run-seed-2026-c7f1a9";
function secret(env) { return (env && env.SCORE_SECRET) || SECRET_FALLBACK; }

async function hmacHex(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function issueToken(env, game, device, ts) {
  const sig = (await hmacHex(secret(env), `${game}|${device}|${ts}`)).slice(0, 16);
  return `${ts.toString(36)}.${sig}`;
}
async function verifyToken(env, game, device, token) {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [tsB36, sig] = token.split(".");
  const ts = parseInt(tsB36, 36);
  if (!Number.isFinite(ts)) return false;
  const now = Date.now();
  // Fenster: höchstens 6 h alt, maximal 60 s in der Zukunft (Uhr-Drift)
  if (ts > now + 60_000 || ts < now - 6 * 3600_000) return false;
  const expect = (await hmacHex(secret(env), `${game}|${device}|${ts}`)).slice(0, 16);
  // konstantzeitiger Vergleich
  if (sig.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  return diff === 0;
}

function topQuery(mode) {
  return `SELECT name, MAX(score) AS score FROM scores WHERE game = ?${modeCond(mode)} GROUP BY LOWER(name) ORDER BY score DESC LIMIT 50`;
}

export async function onRequestGet({ request, env, params }) {
  const game = String(params.game || "");
  const cfg = GAMES[game];
  if (!cfg) return json({ error: "Unbekanntes Spiel" }, 404);
  const url = new URL(request.url);

  // Token-Ausstellung für einen Lauf
  if (url.searchParams.get("token") === "1") {
    const device = String(url.searchParams.get("device") || "").trim();
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(device)) return json({ error: "Ungültiges Gerät" }, 400);
    return json({ token: await issueToken(env, game, device, Date.now()) });
  }

  const mode = modeOf(cfg, {
    daily: url.searchParams.get("daily") === "1",
    weekly: url.searchParams.get("weekly") === "1",
  });
  const rows = (await env.DB.prepare(topQuery(mode)).bind(keyFor(game, mode)).all()).results;
  return json({ top: rows });
}

export async function onRequestPost({ request, env, params }) {
  const game = String(params.game || "");
  const cfg = GAMES[game];
  if (!cfg) return json({ error: "Unbekanntes Spiel" }, 404);

  const b = await request.json().catch(() => ({}));
  const mode = modeOf(cfg, b);
  const key = keyFor(game, mode);

  const score = Number(b.score);
  if (!Number.isInteger(score) || score < 0 || score > cfg.max) {
    return json({ error: "Ungültiger Score" }, 400);
  }

  let name = String(b.name || "").trim().slice(0, 16);
  if (!name) name = "Anonym";

  const device = String(b.device || "").trim();
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(device)) {
    return json({ error: "Ungültiges Gerät" }, 400);
  }

  // Lauf-Token prüfen (signierter Seed, kurz vorher ausgestellt)
  if (!(await verifyToken(env, game, device, b.token))) {
    return json({ error: "Sitzung abgelaufen — lade das Spiel neu" }, 403);
  }

  // Plausibilität: wenn das Spiel eine Prüfung definiert, muss die
  // mitgeschickte Statistik zum Score passen.
  if (cfg.check) {
    const m = b.meta;
    if (!m || typeof m !== "object" || !cfg.check(score, m)) {
      return json({ error: "Ungültiger Score" }, 400);
    }
  }

  // Rate-Limit pro Gerät: max. 8 Einsendungen in 2 Minuten
  const recent = (await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM scores WHERE device = ? AND created_at > datetime('now', '-120 seconds')"
  ).bind(device).first()).n;
  if (recent >= 8) return json({ error: "Zu viele Einsendungen — kurz warten" }, 429);

  // Namensschutz: Der Name gehört dem Gerät, das ihn zuerst benutzt hat.
  const owner = await env.DB.prepare(
    "SELECT device FROM scores WHERE LOWER(name) = LOWER(?) AND device IS NOT NULL ORDER BY id LIMIT 1"
  ).bind(name).first();
  if (owner && owner.device !== device) {
    return json({ error: "Dieser Name gehört schon jemand anderem — wähle einen anderen" }, 409);
  }

  await env.DB.prepare(
    "INSERT INTO scores (game, name, device, score, meta) VALUES (?, ?, ?, ?, ?)"
  ).bind(key, name, device, score, b.meta ? JSON.stringify(b.meta).slice(0, 500) : null).run();

  const cond = modeCond(mode);
  const myBest = (await env.DB.prepare(
    `SELECT MAX(score) AS m FROM scores WHERE game = ? AND LOWER(name) = LOWER(?)${cond}`
  ).bind(key, name).first()).m;

  const rank = (await env.DB.prepare(
    `SELECT COUNT(*) + 1 AS r FROM (SELECT MAX(score) AS m FROM scores WHERE game = ?${cond} GROUP BY LOWER(name)) WHERE m > ?`
  ).bind(key, myBest).first()).r;

  return json({ ok: true, rank, best: myBest }, 201);
}
