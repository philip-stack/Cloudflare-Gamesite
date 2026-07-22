import { json, makeCode, clientIp, rateLimit } from "./_util.js";

// ====================================================================
// Spieleabend-Raum ("Party"): mehrere Freunde spielen dieselben Spiele
// und sammeln in einer gemeinsamen Abend-Wertung Punkte. Weil die Spiele
// völlig unterschiedliche Punkteskalen haben, zählt NICHT der rohe Score,
// sondern die Platzierung je Spiel (Rang-Punkte) — fair über alle Spiele.
//
//   POST /api/party  { action:"create", games:[...], name }  → { code, games }
//   POST /api/party  { action:"join",   code, name }         → { ok, games }
//   POST /api/party  { action:"submit", code, name, game, score } → { ok }
//   GET  /api/party?code=XXXXXX  → { games, standings:[...], count }
// ====================================================================

const ALLOWED = ["funkelfeld", "komet", "sternensturm", "galopp", "wumms", "meeri"];
const CODE_RE = /^[A-Z0-9]{6}$/;
const MAX_SCORE = 2_000_000_000;
const PTS = [10, 7, 5, 3, 2];               // Rang 1..5, danach 1 Punkt
const cleanName = n => String(n || "").trim().slice(0, 16);

export async function onRequestPost({ request, env }) {
  if (!(await rateLimit(env, "party:" + clientIp(request), 60, 60))) {
    return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
  }
  const b = await request.json().catch(() => ({}));
  const action = String(b.action || "");

  if (action === "create") {
    const games = Array.isArray(b.games) ? [...new Set(b.games.filter(g => ALLOWED.includes(g)))] : [];
    if (!games.length) return json({ error: "Wähle mindestens ein Spiel" }, 400);
    const name = cleanName(b.name);
    let code = "";
    for (let i = 0; i < 5; i++) {           // seltenen Code-Konflikt vermeiden
      code = makeCode();
      const exists = await env.DB.prepare("SELECT 1 FROM party WHERE code = ?").bind(code).first();
      if (!exists) break;
    }
    await env.DB.prepare("INSERT INTO party (code, games) VALUES (?, ?)").bind(code, JSON.stringify(games)).run();
    if (name) await env.DB.prepare("INSERT OR IGNORE INTO party_member (code, name) VALUES (?, ?)").bind(code, name).run();
    return json({ ok: true, code, games });
  }

  const code = String(b.code || "").trim().toUpperCase();
  if (!CODE_RE.test(code)) return json({ error: "Ungültiger Raum-Code" }, 400);
  const room = await env.DB.prepare("SELECT games FROM party WHERE code = ?").bind(code).first();
  if (!room) return json({ error: "Raum nicht gefunden" }, 404);
  const games = JSON.parse(room.games);

  if (action === "join") {
    const name = cleanName(b.name);
    if (!name) return json({ error: "Name fehlt" }, 400);
    await env.DB.prepare("INSERT OR IGNORE INTO party_member (code, name) VALUES (?, ?)").bind(code, name).run();
    return json({ ok: true, games });
  }

  if (action === "submit") {
    const name = cleanName(b.name);
    const game = String(b.game || "");
    const score = Number(b.score);
    if (!name) return json({ error: "Name fehlt" }, 400);
    if (!games.includes(game)) return json({ error: "Spiel gehört nicht zum Raum" }, 400);
    if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return json({ error: "Ungültiger Score" }, 400);
    await env.DB.prepare("INSERT OR IGNORE INTO party_member (code, name) VALUES (?, ?)").bind(code, name).run();
    await env.DB.prepare(
      `INSERT INTO party_score (code, name, game, score) VALUES (?, ?, ?, ?)
       ON CONFLICT(code, name, game) DO UPDATE SET score = MAX(score, excluded.score), updated_at = datetime('now')`
    ).bind(code, name, game, score).run();
    return json({ ok: true });
  }

  return json({ error: "Unbekannte Aktion" }, 400);
}

export async function onRequestGet({ request, env }) {
  if (!(await rateLimit(env, "partyr:" + clientIp(request), 120, 60))) {
    return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
  }
  const code = String(new URL(request.url).searchParams.get("code") || "").trim().toUpperCase();
  if (!CODE_RE.test(code)) return json({ error: "Ungültiger Raum-Code" }, 400);
  const room = await env.DB.prepare("SELECT games FROM party WHERE code = ?").bind(code).first();
  if (!room) return json({ error: "Raum nicht gefunden" }, 404);
  const games = JSON.parse(room.games);

  const members = (await env.DB.prepare("SELECT name FROM party_member WHERE code = ?").bind(code).all()).results.map(r => r.name);
  const scores = (await env.DB.prepare("SELECT name, game, score FROM party_score WHERE code = ?").bind(code).all()).results;

  // alle Namen (Mitglieder + wer schon einen Score hat)
  const names = [...new Set([...members, ...scores.map(s => s.name)])];
  const perName = {};
  names.forEach(n => { perName[n] = { name: n, scores: {}, points: 0 }; });
  for (const s of scores) { if (perName[s.name]) perName[s.name].scores[s.game] = s.score; }

  // Rang-Punkte je Spiel vergeben
  for (const g of games) {
    const ranked = scores.filter(s => s.game === g).sort((a, b) => b.score - a.score);
    ranked.forEach((s, i) => { if (perName[s.name]) perName[s.name].points += (PTS[i] ?? 1); });
  }

  const standings = Object.values(perName).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return json({ games, standings, count: names.length });
}
