import { json, rateLimit, clientIp, logError, weekMatch, dayMatch, DEVICE_RE, nameOwner } from "../_util.js";
import { sendToName } from "../push.js";
import { SCORED_GAMES } from "../_gamemeta.js";

// Anzeigenamen für Push-Texte (zentrale Server-Meta).
const GAME_LABEL = Object.fromEntries(Object.entries(SCORED_GAMES).map(([k, v]) => [k, v.name]));

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
//  - Lauf-Token ist EINMAL gültig: ein bereits verbrauchtes Token wird
//    abgelehnt (Replay-Schutz über die Tabelle used_token).
//  - IP-Rate-Limit: Ausstellung UND Einsendung sind pro Client-IP
//    gedrosselt. Die Geräte-Kennung ist client-seitig fälschbar, die
//    Cloudflare-IP nicht — deshalb zusätzlich zur Geräte-Drosselung.
// ====================================================================

const GAMES = {
  funkelfeld: {
    max: 500_000,
    scoped: true,
    // Punkte entstehen aus geräumten Linien (× Combo) + Funkelsteinen.
    // Die Obergrenze pro Linie/Stein ist bewusst großzügig — echte Läufe
    // bleiben stets darunter, blind hochgesetzte Fake-Scores nicht.
    check: (score, m) =>
      Number.isFinite(m.lines) && Number.isFinite(m.combo) && Number.isFinite(m.gems) &&
      m.lines >= 0 && m.lines <= 20_000 && m.combo >= 0 && m.combo <= 200 &&
      m.gems >= 0 && m.gems <= 20_000 &&
      score <= m.lines * (m.combo + 1) * 400 + m.gems * 50 + 3_000,
  },
  komet: {
    max: 100_000,
    scoped: true,
    // score = Meter + Funken × 5
    check: (score, m) =>
      Number.isFinite(m.meters) && Number.isFinite(m.sparks) &&
      m.meters >= 0 && m.meters <= 30_000 && m.sparks >= 0 && m.sparks <= 5_000 &&
      score === Math.round(m.meters) + m.sparks * 5,
  },
  sternensturm: {
    max: 2_000_000,
    scoped: true,
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
  wumms: {
    max: 2_000_000,
    daily: true,
    // Punkte aus geräumten Linien (× Combo) + Angriffen (shoves).
    // Großzügige Obergrenze, die echte Läufe nie erreichen — nur Fakes.
    check: (score, m) =>
      Number.isFinite(m.lines) && Number.isFinite(m.combo) && Number.isFinite(m.shoves) &&
      m.lines >= 0 && m.lines <= 20_000 && m.combo >= 0 && m.combo <= 200 &&
      m.shoves >= 0 && m.shoves <= 20_000 &&
      score <= m.lines * (m.combo + 1) * 500 + m.shoves * 30 + 3_000,
  },
  meeri: {
    // Score = Goldene Karotten (Prestige-Währung); rein lokales Idle-Spiel
    // ohne Server-Formel. Schutz hier: Obergrenze + Lauf-Token + Rate-Limit.
    max: 1_000_000_000,
  },
  schlange: {
    max: 100_000,
    scoped: true,
    // score = gefressene Orbs. Grob gegen die Spielzeit gedeckelt. Großzügig,
    // weil abgeschnittene Gegner in viele Orbs zerfallen und ×2 verdoppelt —
    // echte Bursts bleiben unter der Grenze, blind gesetzte Fakes nicht.
    check: (score, m) =>
      Number.isFinite(m.orbs) && Number.isFinite(m.time) &&
      m.orbs >= 0 && m.time >= 0 && m.time <= 36_000 &&
      score === Math.round(m.orbs) && m.orbs <= m.time * 30 + 60,
  },
  flatterfink: {
    max: 100_000,
    scoped: true,
    // score = Tore × 10 + Körndl × 5, wobei RISKANT platzierte Körndl (nah am
    // Heckenrand) 12 statt 5 zählen. koerndlRisk ist optional und eine Teilmenge
    // von koerndl — ältere, zwischengespeicherte Clients schicken es nicht und
    // werden mit 0 weiterhin korrekt geprüft (rückwärtskompatibel).
    check: (score, m) => {
      const risk = m.koerndlRisk === undefined ? 0 : m.koerndlRisk;
      return Number.isFinite(m.tore) && Number.isFinite(m.koerndl) && Number.isFinite(risk) &&
        m.tore >= 0 && m.tore <= 3_000 &&
        m.koerndl >= 0 && m.koerndl <= m.tore * 3 + 5 &&   // Ketten: bis zu 3 Körndl je Hecke
        risk >= 0 && risk <= m.koerndl &&
        score === m.tore * 10 + (m.koerndl - risk) * 5 + risk * 12;
    },
  },
};

// Modus aus Query/Body ableiten und gegen die Spiel-Config prüfen.
// Zwei Arten von Tages-/Wochen-Wertung:
//  - SEEDED (cfg.daily/weekly, z. B. galopp/wumms): jeder spielt dieselbe
//    generierte Strecke → eigener Bucket `game:daily`/`game:weekly`.
//  - SCOPED (cfg.scoped, nicht-deterministische Arcade-Spiele): normale Läufe,
//    nur zeitlich gefiltert → sie teilen sich den Gesamt-Bucket `game`, die
//    Sicht „Heute"/„Diese Woche" entsteht allein über den Datumsfilter.
function modeOf(cfg, src) {
  if (src.weekly && (cfg.weekly || cfg.scoped)) return "weekly";
  if (src.daily && (cfg.daily || cfg.scoped)) return "daily";
  return "none";
}
function keyFor(game, mode, cfg) {
  // Scoped-Spiele bleiben immer im Gesamt-Bucket (Datumsfilter macht die Sicht);
  // seeded-Challenges bekommen eigene Buckets.
  if (cfg && cfg.scoped) return game;
  return mode === "weekly" ? `${game}:weekly` : mode === "daily" ? `${game}:daily` : game;
}
function modeCond(mode) {
  // Gemeinsame Bucket-Ausdrücke aus _util (damit scores & season nie divergieren).
  if (mode === "weekly") return " AND " + weekMatch();
  if (mode === "daily") return " AND " + dayMatch();
  return "";
}

// ---- Lauf-Token (HMAC-signierter Seed) ----
// In Produktion ist SCORE_SECRET als Pages-Secret gesetzt (nur dort bekannt).
// Der Fallback ist NUR für lokale Entwicklung — er darf nie die echte
// Signatur ersetzen, sonst ließen sich Tokens fälschen.
const SECRET_FALLBACK = "gamesite-dev-only-seed-do-not-use-in-prod";
function secret(env) { return (env && env.SCORE_SECRET) || SECRET_FALLBACK; }
function hasRealSecret(env) { return !!(env && env.SCORE_SECRET); }
// Nur lokal (Dev) darf der Fallback-Schlüssel greifen. Auf einer echten Domain
// ohne gesetztes SCORE_SECRET würden sich Lauf-Token fälschen lassen — deshalb
// dort lieber laut abbrechen (fail-closed) als still ein Loch öffnen.
function isLocalHost(request) {
  try { const h = new URL(request.url).hostname; return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local"); }
  catch { return false; }
}
async function secretGuard(request, env) {
  if (hasRealSecret(env) || isLocalHost(request)) return null; // ok
  await logError(env, "SCORE_SECRET fehlt in Produktion — Score-Einsendung gesperrt", "scores");
  return json({ error: "Server nicht bereit — bitte später erneut versuchen" }, 503);
}

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

// Verbraucht ein (bereits signaturgeprüftes) Token EINMALIG: liefert true,
// wenn es frisch war, false bei Wiederverwendung (Replay). INSERT OR IGNORE
// scheitert lautlos beim zweiten Mal (PRIMARY KEY) → changes === 0.
// Fehlertolerant: bei DB-Problemen wird echten Spielern NIE der Score verwehrt.
async function consumeToken(env, token) {
  try {
    const res = await env.DB.prepare("INSERT OR IGNORE INTO used_token (jti) VALUES (?)")
      .bind(String(token)).run();
    const changes = res && res.meta ? res.meta.changes : (res && res.changes);
    // gelegentlich alte (ohnehin abgelaufene) Token wegräumen — kleine Tabelle halten
    if (Math.random() < 0.03) {
      await env.DB.prepare("DELETE FROM used_token WHERE at < datetime('now','-7 hours')").run();
    }
    return changes !== 0;
  } catch (e) { await logError(env, "consumeToken fehlgeschlagen (Replay-Schutz übersprungen)", "scores", e && e.message); return true; }
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
    const guard = await secretGuard(request, env); if (guard) return guard;
    const device = String(url.searchParams.get("device") || "").trim();
    if (!DEVICE_RE.test(device)) return json({ error: "Ungültiges Gerät" }, 400);
    // Pro IP höchstens 40 Token/Minute — bremst massenhaftes Skript-Ausstellen.
    if (!(await rateLimit(env, `tok:${clientIp(request)}`, 40, 60))) {
      return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
    }
    return json({ token: await issueToken(env, game, device, Date.now()) });
  }

  const mode = modeOf(cfg, {
    daily: url.searchParams.get("daily") === "1",
    weekly: url.searchParams.get("weekly") === "1",
  });

  // Einzel-Abfrage eines Spielers (für Freunde-Vergleich): Bestwert + Rang
  const player = url.searchParams.get("player");
  if (player) {
    const nm = String(player).trim().slice(0, 16);
    const cond = modeCond(mode);
    const best = (await env.DB.prepare(
      `SELECT MAX(score) AS m FROM scores WHERE game = ? AND LOWER(name) = LOWER(?)${cond}`
    ).bind(keyFor(game, mode, cfg), nm).first()).m;
    let rank = null;
    if (best != null) {
      rank = (await env.DB.prepare(
        `SELECT COUNT(*) + 1 AS r FROM (SELECT MAX(score) AS m FROM scores WHERE game = ?${cond} GROUP BY LOWER(name)) WHERE m > ?`
      ).bind(keyFor(game, mode, cfg), best).first()).r;
    }
    return json({ player: nm, best: best || 0, rank });
  }

  const rows = (await env.DB.prepare(topQuery(mode)).bind(keyFor(game, mode, cfg)).all()).results;
  return json({ top: rows });
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const game = String(params.game || "");
  const cfg = GAMES[game];
  if (!cfg) return json({ error: "Unbekanntes Spiel" }, 404);

  const guard = await secretGuard(request, env); if (guard) return guard;

  const b = await request.json().catch(() => ({}));
  const mode = modeOf(cfg, b);
  const key = keyFor(game, mode, cfg);

  const score = Number(b.score);
  if (!Number.isInteger(score) || score < 0 || score > cfg.max) {
    return json({ error: "Ungültiger Score" }, 400);
  }

  let name = String(b.name || "").trim().slice(0, 16);
  if (!name) name = "Anonym";

  const device = String(b.device || "").trim();
  if (!DEVICE_RE.test(device)) {
    return json({ error: "Ungültiges Gerät" }, 400);
  }

  // IP-Rate-Limit: höchstens 20 Einsendungen/Minute pro Client-IP (die
  // Geräte-Kennung ist fälschbar, die Cloudflare-IP nicht).
  if (!(await rateLimit(env, `post:${clientIp(request)}`, 20, 60))) {
    return json({ error: "Zu viele Einsendungen — kurz warten" }, 429);
  }

  // Über das Betreiber-Dashboard gesperrte Geräte dürfen nicht mehr einreichen.
  // Fehlertolerant: bei DB-Problemen NICHT blockieren (echte Spieler zuerst).
  try {
    const ban = await env.DB.prepare("SELECT COUNT(*) AS n FROM banned_device WHERE device = ?").bind(device).first();
    if (ban && ban.n > 0) return json({ error: "Einsendung nicht möglich" }, 403);
  } catch (e) { await logError(env, "Ban-Prüfung fehlgeschlagen", "scores", e && e.message); }

  // Lauf-Token prüfen (signierter Seed, kurz vorher ausgestellt)
  if (!(await verifyToken(env, game, device, b.token))) {
    return json({ error: "Sitzung abgelaufen — lade das Spiel neu" }, 403);
  }
  // …und nur EINMAL gültig (Replay-Schutz).
  if (!(await consumeToken(env, b.token))) {
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
  // Dieselbe Abfrage benutzt /api/name schon bei der Begrüßung — damit dort
  // nicht „frei" steht, was hier abgelehnt wird, liegt sie in _util.js.
  const owner = await nameOwner(env, name);
  if (owner && owner !== device) {
    return json({ error: "Dieser Name gehört schon jemand anderem — wähle einen anderen" }, 409);
  }

  // Vor dem Eintragen: aktuelle:r Spitzenreiter:in (nur Gesamtwertung) — um
  // erkennen zu können, ob diese Einsendung sie:ihn vom Thron stößt.
  let prevTop = null;
  if (mode === "none") {
    prevTop = await env.DB.prepare(
      "SELECT name, MAX(score) AS score FROM scores WHERE game = ? GROUP BY LOWER(name) ORDER BY score DESC LIMIT 1"
    ).bind(key).first();
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

  // Push: „Dein Rekord wurde geschlagen" — wenn diese Einsendung die/den
  // bisherige:n Spitzenreiter:in überholt (nur Gesamtwertung, anderer Name).
  // Fehlertolerant und außerhalb der Antwort (waitUntil), nie blockierend.
  if (mode === "none" && prevTop && prevTop.name && prevTop.name.toLowerCase() !== name.toLowerCase() && myBest > prevTop.score) {
    const label = GAME_LABEL[game] || game;
    const msg = {
      title: "👑 Dein Rekord wurde geschlagen!",
      body: `${name} hat dich bei ${label} überholt (${Number(myBest).toLocaleString("de-AT")}).`,
      url: "/saison/",
    };
    const wu = context && typeof context.waitUntil === "function"
      ? context.waitUntil.bind(context)
      : (p) => { if (p && p.catch) p.catch(() => {}); };
    wu(sendToName(env, prevTop.name, msg));
  }

  return json({ ok: true, rank, best: myBest }, 201);
}
