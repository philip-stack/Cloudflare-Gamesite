import { json } from "../_util.js";

// ====================================================================
// Gemeinsame Bestenlisten-API für alle Spiele.
//
//   GET  /api/scores/:game[?daily=1]  → { top: [{name, score}] }
//   POST /api/scores/:game            → { ok, rank, best }
//        body: { name, score, device, meta?, daily? }
//
// Schutz gegen Schummeln (ohne Login, also pragmatisch):
//  - Spiel-Allowlist mit Score-Obergrenzen
//  - Plausibilitätsprüfung über mitgeschickte Spielstatistik (meta)
//  - Geräte-Token: rate-limitet Einsendungen; ein Name gehört dem
//    Gerät, das ihn zuerst benutzt hat
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
    // score = ⌊Meter⌋ + Taler × 10
    check: (score, m) =>
      Number.isFinite(m.meters) && Number.isFinite(m.coins) &&
      m.meters >= 0 && m.meters <= 100_000 && m.coins >= 0 && m.coins <= 20_000 &&
      score === Math.floor(m.meters) + m.coins * 10,
  },
};

function keyFor(game, daily) { return daily ? `${game}:daily` : game; }

function topQuery(daily) {
  return daily
    ? "SELECT name, MAX(score) AS score FROM scores WHERE game = ? AND date(created_at) = date('now') GROUP BY LOWER(name) ORDER BY score DESC LIMIT 50"
    : "SELECT name, MAX(score) AS score FROM scores WHERE game = ? GROUP BY LOWER(name) ORDER BY score DESC LIMIT 50";
}

export async function onRequestGet({ request, env, params }) {
  const game = String(params.game || "");
  const cfg = GAMES[game];
  if (!cfg) return json({ error: "Unbekanntes Spiel" }, 404);
  const daily = new URL(request.url).searchParams.get("daily") === "1";
  if (daily && !cfg.daily) return json({ error: "Kein Tagesmodus" }, 400);

  const rows = (await env.DB.prepare(topQuery(daily)).bind(keyFor(game, daily)).all()).results;
  return json({ top: rows });
}

export async function onRequestPost({ request, env, params }) {
  const game = String(params.game || "");
  const cfg = GAMES[game];
  if (!cfg) return json({ error: "Unbekanntes Spiel" }, 404);

  const b = await request.json().catch(() => ({}));
  const daily = !!b.daily && !!cfg.daily;
  const key = keyFor(game, daily);

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

  const dailyCond = daily ? " AND date(created_at) = date('now')" : "";
  const myBest = (await env.DB.prepare(
    `SELECT MAX(score) AS m FROM scores WHERE game = ? AND LOWER(name) = LOWER(?)${dailyCond}`
  ).bind(key, name).first()).m;

  const rank = (await env.DB.prepare(
    `SELECT COUNT(*) + 1 AS r FROM (SELECT MAX(score) AS m FROM scores WHERE game = ?${dailyCond} GROUP BY LOWER(name)) WHERE m > ?`
  ).bind(key, myBest).first()).r;

  return json({ ok: true, rank, best: myBest }, 201);
}
