import { json, clientIp, rateLimit } from "./_util.js";

// ====================================================================
// Saison / Liga: eine plattformweite Wochenwertung über ALLE gewerteten
// Spiele. Eine Saison = eine ISO-Woche (Mo–So). Pro Spiel bekommt man
// Liga-Punkte nach Platzierung in der Wochen-Bestenliste dieses Spiels;
// über alle Spiele summiert ergibt das die Saison-Tabelle.
//
// Clou: Es braucht KEINE neuen Daten. Jede Score-Einsendung liegt bereits
// mit created_at im Basis-Bucket <spiel> — die Saison ist nur ein
// Zeitfenster darüber (strftime('%Y-%W')). Vergangene Saisons bleiben so
// dauerhaft nachrechenbar (Hall of Fame), solange die Zeilen existieren.
//
//   GET /api/season  → { season, prevSeason, weekStart, weekEnd, resetInMs,
//                        games:[{key,name,icon,leader}], standings:[...],
//                        prevChampion }
// ====================================================================

const GAME_KEYS = ["funkelfeld", "komet", "sternensturm", "galopp", "wumms", "meeri"];
const NAMES = { funkelfeld: "Funkelfeld", komet: "Komet", sternensturm: "Sternensturm", galopp: "Galopp", wumms: "WUMMS!", meeri: "MEERI-MANIA" };
const ICONS = { funkelfeld: "💎", komet: "☄️", sternensturm: "🚀", galopp: "🦄", wumms: "🦝", meeri: "🐹" };
const PTS = [25, 18, 15, 12, 10, 8, 6, 5, 4, 3, 2, 1];
const ptsFor = i => PTS[i] ?? 1;

// Liest die Wochen-Bestenliste eines Spiels für "cur" (diese Woche) oder
// "prev" (vorige Woche) und gibt [{name, score}] (max. 20) zurück.
async function weekTop(env, gameKey, which) {
  const cond = which === "prev"
    ? "strftime('%Y-%W',created_at) = strftime('%Y-%W','now','-7 days')"
    : "strftime('%Y-%W',created_at) = strftime('%Y-%W','now')";
  const rows = (await env.DB.prepare(
    `SELECT name, MAX(score) AS score FROM scores WHERE game = ? AND ${cond} GROUP BY LOWER(name) ORDER BY score DESC LIMIT 20`
  ).bind(gameKey).all()).results;
  return rows;
}

// Aggregiert die Liga-Tabelle über alle Spiele für "cur" oder "prev".
async function standingsFor(env, which) {
  const perName = {};                 // lowerName -> { name, points, games:{} }
  const leaders = {};                 // gameKey -> { name, score }
  for (const key of GAME_KEYS) {
    const top = await weekTop(env, key, which);
    if (top.length) leaders[key] = { name: top[0].name, score: top[0].score };
    top.forEach((row, i) => {
      const lk = row.name.toLowerCase();
      const p = perName[lk] || (perName[lk] = { name: row.name, points: 0, games: {} });
      const pts = ptsFor(i);
      p.points += pts;
      p.games[key] = { score: row.score, rank: i + 1, pts };
    });
  }
  const standings = Object.values(perName).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return { standings, leaders };
}

// Zeit bis zum nächsten Montag 00:00 UTC (Saison-Reset). Kosmetisch.
function resetInMs() {
  const now = new Date();
  const day = now.getUTCDay();                 // 0=So … 1=Mo
  const daysToMon = (8 - (day === 0 ? 7 : day)) % 7 || 7;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysToMon, 0, 0, 0));
  return next.getTime() - now.getTime();
}
function weekBounds() {
  const now = new Date();
  const day = now.getUTCDay();
  const back = (day === 0 ? 6 : day - 1);       // Tage zurück bis Montag
  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
  const sun = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 6));
  const iso = d => d.toISOString().slice(0, 10);
  return { weekStart: iso(mon), weekEnd: iso(sun) };
}

export async function onRequestGet({ request, env }) {
  if (!(await rateLimit(env, "season:" + clientIp(request), 120, 60))) {
    return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
  }
  const ids = await env.DB.prepare(
    "SELECT strftime('%Y-%W','now') AS cur, strftime('%Y-%W','now','-7 days') AS prev"
  ).first();

  const cur = await standingsFor(env, "cur");
  const prev = await standingsFor(env, "prev");

  const games = GAME_KEYS.map(k => ({ key: k, name: NAMES[k], icon: ICONS[k], leader: cur.leaders[k] || null }));
  const { weekStart, weekEnd } = weekBounds();

  return json({
    season: ids.cur,
    prevSeason: ids.prev,
    weekStart, weekEnd,
    resetInMs: resetInMs(),
    games,
    standings: cur.standings,
    prevChampion: prev.standings[0] || null,
  });
}
